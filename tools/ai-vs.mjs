// tools/ai-vs.mjs - zápasy AI bota (engine/ai/bot.js) priamo na engine (docs/AI_PLAN.md, meranie sily).
// Bot dostáva rovnaké payloady ako klient na serveri (snapshotFor + redactTimelineFor, you_are, new_game).
// Spustenie: node tools/ai-vs.mjs [zápasov=20] [--budget ms=300] [--sims n] [--level baby|cheater] [--vs random|bot] [--chars p1,p2] [--log] [--portal | --swamp]
//   --sims n     deterministický rozpočet: n simulácií na rozhodnutie (namiesto času)
//   --vs random  bot (osoba B) proti náhodnému botovi (tools/random-bot.mjs) - cieľ ≥ 98 % výhier
//   --vs bot     bot proti botu (rovnaké nastavenie, rôzne seedy) - sanity / ladenie
//   --vs shieldy|aggro|turtle|greedy  bot proti predvídateľnému štýlu (tools/scripted-bots.mjs)
import { createEngine } from "../engine/game.js";
import { CHARS, SIDE_CHARS, seededRng } from "../engine/constants.js";
import { createBot } from "../engine/ai/bot.js";
import { botLock, botTimestop } from "./random-bot.mjs";
import { scriptedLock } from "./scripted-bots.mjs";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const N = Number(argv.find(a => /^\d+$/.test(a))) || 20;
const BUDGET = Number(opt("--budget", 300));
const SIMS = opt("--sims", null) ? Number(opt("--sims")) : null; // deterministický rozpočet (počet simulácií)
const VS = opt("--vs", "random");
const CHARS_ARG = opt("--chars", null)?.split(",");
const LOG = argv.includes("--log");
const BABY_TUNE = opt("--baby", null) ? Object.fromEntries(opt("--baby").split(",").map(kv => { const [k, v] = kv.split("="); return [k, Number(v)]; })) : null;
const LEVEL = opt("--level", null); // úroveň bota B (baby / normal); s --vs bot hrá A normálny bot
const NO_MODEL = argv.includes("--no-model");
const ARENA = argv.includes("--portal") ? "portal" : argv.includes("--swamp") ? "swamp" : null; // aréna (bez voľby Stone Bridge) // bot bez modelu súpera (porovnanie A5)

const poolFor = (slot) => [...CHARS, ...Object.keys(SIDE_CHARS).filter(k => SIDE_CHARS[k] === slot)];

// jeden zápas: hráči = { A: "bot"|"random", B: ... }; vráti víťaznú osobu a počet kôl
export function playMatch(seed, players, { budgetMs = BUDGET, budgetSims = SIMS, chars = null, log = null, botOpts = {}, onRound = null, onTimeline = null } = {}) {
  const bots = {};
  let result = null;
  const engine = createEngine({
    seed,
    schedule: () => {},
    emit: (ev, payload) => {
      if (ev === "game_result") result = payload;
      if (ev === "new_game") for (const b of Object.values(bots)) b.onNewGame(payload);
    },
    emitState: (tl) => {
      if (tl) onTimeline?.(tl, engine.game); // analýzy (nezredigovaná timeline kola)
      for (const [person, b] of Object.entries(bots)) {
        const slot = engine.slotForPerson(person);
        b.onState({ ...engine.snapshotFor(person), ...(tl ? { timeline: engine.redactTimelineFor(slot, tl) } : {}) });
      }
    },
    emitYouAre: () => {},
  });
  for (const person of ["A", "B"]) if (players[person] === "bot") bots[person] = (botOpts[person]?.create || createBot)({ seed: seed * 31 + (person === "A" ? 1 : 2), budgetMs, budgetSims, log, ...(NO_MODEL ? { model: false } : {}), ...(botOpts[person] || {}) });
  engine.startMatch(engine.sanitizeConfig({
    format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "random",
    tileWeights: ARENA === "portal" ? { dmg: 90, ik: 10 } : { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 },
    ...(ARENA ? { arena: ARENA } : {}),
  }));
  for (const [person, b] of Object.entries(bots)) { b.onYouAre({ slot: engine.slotForPerson(person) }); b.onState(engine.snapshotFor(person)); }
  const rng = { A: seededRng(seed * 2 + 11), B: seededRng(seed * 2 + 12), spy: seededRng(seed * 2 + 13) };
  // postavy
  for (const person of ["A", "B"]) {
    const slot = engine.slotForPerson(person);
    let ch = chars?.[slot];
    if (!ch && bots[person]) ch = bots[person].decide()?.char;
    if (!ch) { const pool = poolFor(slot); ch = pool[Math.floor(rng[person]() * pool.length)]; }
    engine.chooseCharacter(person, ch);
  }
  let rounds = 0;
  while (!result && rounds < 80) {
    const g = engine.game;
    if (g.timestop?.mode === "waiting") {
      const person = g.seats[g.timestop.slot];
      if (bots[person]) {
        const d = bots[person].decide();
        let ok = false;
        engine.timestopActions(person, d?.queue, (r) => { ok = !!r?.ok; });
        if (!ok) botTimestop(engine, person, rng[person]);
      } else botTimestop(engine, person, rng[person]);
      continue;
    }
    rounds++;
    onRound?.(engine.exportState()); // ladenie (tools/ai-tune.mjs): úplný stav na začiatku kola
    // čerstvý stav pred kolom (ako server): posledná timeline kola nesie ešte „locked" oboch - bot, ktorý
    // rozhoduje prvý (osoba A), by inak čakal na odomknutie a fronta by sa nezahrala
    for (const [person, b] of Object.entries(bots)) b.onState(engine.snapshotFor(person));
    for (const person of ["A", "B"]) {
      if (bots[person]) {
        // CHEATER (--level cheater, len B): uvidí jednu náhodnú akciu už zamknutej fronty A (ako na serveri)
        const foe = g.players[engine.slotForPerson("A")];
        const spy = person === "B" && LEVEL === "cheater" && foe.locked && foe.queue?.length
          ? (() => { const idx = Math.floor(rng.spy() * foe.queue.length); return { idx, action: { ...foe.queue[idx] } }; })() : null;
        // CHEATER ako na serveri: najprv bežné rozhodnutie (výpočet počas plánovania), potom dopočet s odhalenou akciou
        let d = bots[person].decide();
        if (spy) d = bots[person].decide({ spy }) || d;
        let ok = false;
        if (d?.queue) engine.lockIn(person, d.queue, g.turn, (r) => { ok = !!r?.ok; });
        if (!ok) { log?.({ kind: "reject", person, queue: d?.queue }); botLock(engine, person, rng[person]); }
      } else if (players[person]?.startsWith("script:")) {
        if (!scriptedLock(engine, person, players[person].slice(7))) botLock(engine, person, rng[person]);
      } else botLock(engine, person, rng[person]);
      if (result) break;
    }
  }
  const winSlot = result?.gameWinner;
  return { winner: winSlot === "p1" || winSlot === "p2" ? engine.game.seats[winSlot] : null, rounds,
    chars: { A: engine.game.players[engine.slotForPerson("A")].char, B: engine.game.players[engine.slotForPerson("B")].char },
    sims: Object.values(bots).reduce((a, b) => a + b.stats.sims, 0) };
}

if (process.argv[1]?.endsWith("ai-vs.mjs")) {
  const players = VS === "bot" ? { A: "bot", B: "bot" } : { A: VS === "random" ? "random" : "script:" + VS, B: "bot" };
  const t0 = performance.now();
  let wins = 0, done = 0, rounds = 0, sims = 0;
  const losses = [];
  for (let i = 0; i < N; i++) {
    const chars = CHARS_ARG ? { p1: CHARS_ARG[0], p2: CHARS_ARG[1] } : null;
    const r = playMatch(1000 + i, players, { chars, log: LOG ? (e) => console.log(JSON.stringify(e)) : null, ...(LEVEL ? { botOpts: { B: { level: LEVEL, ...(BABY_TUNE ? { babyTune: BABY_TUNE } : {}) } } } : {}) });
    done++; rounds += r.rounds; sims += r.sims;
    if (r.winner === "B") wins++; else losses.push(`seed ${1000 + i} ${r.chars.A}(A) vs ${r.chars.B}(B) → ${r.winner ?? "nedohraté"}`);
    process.stdout.write(`\r${done}/${N}  B vyhral ${wins}  (${(100 * wins / done).toFixed(0)} %)   `);
  }
  const s = (performance.now() - t0) / 1000;
  console.log(`\n${VS === "bot" ? "bot vs bot" : `bot (B) vs ${VS} (A)`}: B vyhral ${wins}/${N} (${(100 * wins / N).toFixed(1)} %), ${(rounds / N).toFixed(1)} kôl/zápas, ${s.toFixed(0)} s, ${Math.round(sims / s)} sim/s`);
  if (losses.length && losses.length <= 15) console.log("Prehry / remízy B:\n  " + losses.join("\n  "));
}
