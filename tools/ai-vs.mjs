// tools/ai-vs.mjs - zápasy AI bota (engine/ai/bot.js) priamo na engine (docs/AI_PLAN.md, meranie sily).
// Bot dostáva rovnaké payloady ako klient na serveri (snapshotFor + redactTimelineFor, you_are, new_game).
// Spustenie: node tools/ai-vs.mjs [zápasov=20] [--budget ms=300] [--sims n] [--vs random|bot] [--chars p1,p2] [--log]
//   --sims n     deterministický rozpočet: n simulácií na rozhodnutie (namiesto času)
//   --vs random  bot (osoba B) proti náhodnému botovi (tools/random-bot.mjs) - cieľ ≥ 98 % výhier
//   --vs bot     bot proti botu (rovnaké nastavenie, rôzne seedy) - sanity / ladenie
import { createEngine } from "../engine/game.js";
import { CHARS, SIDE_CHARS, seededRng } from "../engine/constants.js";
import { createBot } from "../engine/ai/bot.js";
import { botLock, botTimestop } from "./random-bot.mjs";

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const N = Number(argv.find(a => /^\d+$/.test(a))) || 20;
const BUDGET = Number(opt("--budget", 300));
const SIMS = opt("--sims", null) ? Number(opt("--sims")) : null; // deterministický rozpočet (počet simulácií)
const VS = opt("--vs", "random");
const CHARS_ARG = opt("--chars", null)?.split(",");
const LOG = argv.includes("--log");

const poolFor = (slot) => [...CHARS, ...Object.keys(SIDE_CHARS).filter(k => SIDE_CHARS[k] === slot)];

// jeden zápas: hráči = { A: "bot"|"random", B: ... }; vráti víťaznú osobu a počet kôl
export function playMatch(seed, players, { budgetMs = BUDGET, budgetSims = SIMS, chars = null, log = null, botOpts = {} } = {}) {
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
      for (const [person, b] of Object.entries(bots)) {
        const slot = engine.slotForPerson(person);
        b.onState({ ...engine.snapshotFor(person), ...(tl ? { timeline: engine.redactTimelineFor(slot, tl) } : {}) });
      }
    },
    emitYouAre: () => {},
  });
  for (const person of ["A", "B"]) if (players[person] === "bot") bots[person] = createBot({ seed: seed * 31 + (person === "A" ? 1 : 2), budgetMs, budgetSims, log, ...(botOpts[person] || {}) });
  engine.startMatch(engine.sanitizeConfig({
    format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "random",
    tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 },
  }));
  for (const [person, b] of Object.entries(bots)) { b.onYouAre({ slot: engine.slotForPerson(person) }); b.onState(engine.snapshotFor(person)); }
  const rng = { A: seededRng(seed * 2 + 11), B: seededRng(seed * 2 + 12) };
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
    for (const person of ["A", "B"]) {
      if (bots[person]) {
        const d = bots[person].decide();
        let ok = false;
        if (d?.queue) engine.lockIn(person, d.queue, g.turn, (r) => { ok = !!r?.ok; });
        if (!ok) { log?.({ kind: "reject", person, queue: d?.queue }); botLock(engine, person, rng[person]); }
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
  const players = VS === "bot" ? { A: "bot", B: "bot" } : { A: "random", B: "bot" };
  const t0 = performance.now();
  let wins = 0, done = 0, rounds = 0, sims = 0;
  const losses = [];
  for (let i = 0; i < N; i++) {
    const chars = CHARS_ARG ? { p1: CHARS_ARG[0], p2: CHARS_ARG[1] } : null;
    const r = playMatch(1000 + i, players, { chars, log: LOG ? (e) => console.log(JSON.stringify(e)) : null });
    done++; rounds += r.rounds; sims += r.sims;
    if (r.winner === "B") wins++; else losses.push(`seed ${1000 + i} ${r.chars.A}(A) vs ${r.chars.B}(B) → ${r.winner ?? "nedohraté"}`);
    process.stdout.write(`\r${done}/${N}  B vyhral ${wins}  (${(100 * wins / done).toFixed(0)} %)   `);
  }
  const s = (performance.now() - t0) / 1000;
  console.log(`\n${VS === "bot" ? "bot vs bot" : "bot (B) vs random (A)"}: B vyhral ${wins}/${N} (${(100 * wins / N).toFixed(1)} %), ${(rounds / N).toFixed(1)} kôl/zápas, ${s.toFixed(0)} s, ${Math.round(sims / s)} sim/s`);
  if (losses.length && losses.length <= 15) console.log("Prehry / remízy B:\n  " + losses.join("\n  "));
}
