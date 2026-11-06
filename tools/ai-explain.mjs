// tools/ai-explain.mjs - rozbor rozhodnutia AI bota v konkrétnom kole zápasu z telemetrie (bug report z AI roomky).
// Prehrá zápas zo vstupov (ako tools/replay.mjs - funguje len na commite, na ktorom sa hral), botovi posiela
// rovnaké payloady ako server a pred zadaným kolom ho nechá rozhodnúť znova (s rovnakým rozpočtom simulácií).
// Vypíše maticu: moje fronty (riadky) × súperove (stĺpce), rovnovážne pravdepodobnosti a čo hral človek.
// Spustenie: node tools/ai-explain.mjs <dáta.jsonl|adresár> --match <id> --game <g> --turn <t> [--sims 1500] [--rows 12] [--cols 10]
//            [--opp "<fronta ako v bugs.mjs>"] = pridaj do stĺpcov aj túto súperovu frontu (napr. čo naozaj zahral)
import fs from "node:fs";
import path from "node:path";
import { createRecordedEngine, SLOT } from "../telemetry/recorder.js";
import { createBot } from "../engine/ai/bot.js";
import { queueKey, baseQueues, extraVariants } from "../engine/ai/candidates.js";
import { createSim } from "../engine/ai/sim.js";
import { seededRng } from "../engine/constants.js";
import { evaluate } from "../engine/ai/eval.js";
import { isTournament, seriesValue, teamLead } from "../engine/ai/series.js";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const src = argv[0];
const MATCH = opt("--match"), G = Number(opt("--game", 1)), T = Number(opt("--turn", 1));
const SIMS = Number(opt("--sims", 1500)), ROWS = Number(opt("--rows", 12)), COLS = Number(opt("--cols", 10));
if (!src || !MATCH) { console.error("použitie: node tools/ai-explain.mjs <dáta> --match <id> --game <g> --turn <t>"); process.exit(1); }

const files = fs.statSync(src).isDirectory() ? fs.readdirSync(src).filter(f => f.endsWith(".jsonl")).sort().map(f => path.join(src, f)) : [src];
const recs = files.flatMap(f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l))).filter(r => r.m === MATCH || (r.t === "bot" && r.match === MATCH)); // zdôvodnenia bota nesú id v poli match
const start = recs.find(r => r.t === "match_start");
const aiRec = recs.find(r => r.t === "ai");
if (!start || !aiRec) { console.error("zápas nenájdený alebo nie je z AI roomky"); process.exit(1); }
const botSide = aiRec.side;

let dbg = null;
// --spy: CHEATER - po rozhodnutí z plánovania aj dopočet s akciou hráča, ktorú bot v tom kole naozaj videl (telemetria)
const SPY = argv.includes("--spy");
const bot = createBot({ seed: 7, budgetMs: 5000, budgetSims: SIMS, debug: (d) => { dbg = d; }, ...(SPY ? { level: "cheater" } : {}) });
const pending = [];
const engine = createRecordedEngine({
  schedule: (fn) => { pending.push(fn); },
  emit: (ev, payload) => { if (ev === "new_game") bot.onNewGame(payload); },
  emitState: (tl) => {
    const person = engine.game.seats[SLOT[botSide]];
    bot.onState({ ...engine.snapshotFor(person), ...(tl ? { timeline: engine.redactTimelineFor(SLOT[botSide], tl) } : {}) });
  },
  emitYouAre: () => {},
}, { sink: null, now: () => 0, newId: () => MATCH, seed: () => start.seed });
const person = (side) => engine.game.seats[SLOT[side]];
const noop = () => {};
const humanQ = {};
let done = false;
for (const r of recs) {
  if (r.t === "lock" && r.g === G && r.turn === T) humanQ[r.side] = r.q;
}
for (const r of recs) {
  if (done) break;
  switch (r.t) {
    case "match_start":
      engine.startMatch(r.config);
      bot.onYouAre({ slot: SLOT[botSide] });
      bot.onState(engine.snapshotFor(person(botSide)));
      break;
    case "team": if (!r.random) engine.chooseTeam(person(r.side), r.team); break; // turnaj: draft (inak sa zápas zasekne v team_select)
    case "pick": if (!r.random) engine.chooseCharacter(person(r.side), r.char); break;
    case "lock":
      if (r.g === G && r.turn === T) { done = true; break; }
      engine.lockIn(person(r.side), r.q, r.turn, noop); break;
    case "ts": engine.timestopActions(person(r.side), r.q, noop); break;
    case "auto":
      for (const [side, draft] of Object.entries(r.drafts || {})) engine.game.players[SLOT[side]].draft = draft === null ? undefined : structuredClone(draft);
      engine.autoLock(); break;
    case "next": pending.shift()?.(); break;
    default: break;
  }
}
if (!done) { console.error("kolo nenájdené"); process.exit(1); }

const g = engine.game;
const fmtP = (s) => { const p = g.players[s]; return `${p.char} HP ${p.hp} MP ${p.mana} @${p.x},${p.y}${p.lastStand ? " LAST_STAND" : ""}${p.doom ? " DOOM" : ""}${p.shield ? " shield" : ""}`; };
console.log(`zápas ${MATCH} hra ${G} kolo ${T} (commit zápasu ${start.commit}); bot = ${botSide} (${SLOT[botSide]})`);
console.log(`  white ${fmtP("p1")}\n  black ${fmtP("p2")}`);
console.log(`  tiles: ${JSON.stringify(g.tiles)}  iks: ${JSON.stringify(g.iks)}`);
bot.onState(engine.snapshotFor(person(botSide))); // čerstvý pohľad pred kolom (ako server pred rozhodnutím)
const res = bot.decide();
if (!dbg) { console.log("bot nerozhodoval kolo:", res); process.exit(0); }
if (SPY) {
  const spyRec = recs.find(r => r.t === "bot" && r.g === G && r.turn === T && r.spy);
  const hq = humanQ[botSide === "white" ? "black" : "white"];
  const EXTRA = new Set(["golden_shield", "golden_mirror", "golden_mana", "last_stand", "last_hope"]);
  const base = (hq || []).filter(a => !EXTRA.has(a.type));
  if (!spyRec || !base.length) console.log("\n--spy: v telemetrii chýba odhalená akcia tohto kola");
  else {
    const idx = spyRec.spy.slot - 1;
    const r2 = bot.decide({ spy: { idx, action: { ...base[idx] } } });
    console.log(`\nCHEATER videl ${spyRec.spy.slot}. akciu (${spyRec.spy.a}); v hre zahral: ${spyRec.pick}`);
    console.log(`dopočet teraz: ${queueKey(r2?.queue || [])}  (hodnota ${r2?.why?.value}, p ${r2?.why?.p})`);
    console.log(`  čakal od súpera: ${(r2?.why?.opp || []).map(o => `${o.q} p=${o.p}`).join(" | ")}`);
  }
}
const { R, C, sol, mix, value } = dbg;
const oppSide = botSide === "white" ? "black" : "white";
const human = humanQ[oppSide];
if (human) {
  const k = queueKey(human);
  if (!C.some(c => queueKey(c) === k)) C.push(human);
}
const extra = opt("--opp");
const cols = C.map((c, j) => ({ c, j, p: sol.col[j] ?? 0 }))
  .sort((a, b) => b.p - a.p).slice(0, COLS);
for (const c of C.map((c, j) => ({ c, j, p: sol.col[j] ?? 0 }))) {
  const k = queueKey(c.c);
  if ((human && k === queueKey(human)) || (extra && k === extra)) if (!cols.includes(c) && !cols.some(x => x.j === c.j)) cols.push(c);
}
const rows = R.map((r, i) => ({ r, i, p: mix[i] ?? 0, avg: C.reduce((s, c) => s + value(r, c), 0) / C.length,
  vs: C.reduce((s, c, j) => s + (sol.col[j] ?? 0) * value(r, c), 0) }))
  .sort((a, b) => b.p - a.p || b.vs - a.vs).slice(0, ROWS);
console.log(`\nhodnota rovnováhy ${sol.value.toFixed(3)}; matica ${R.length}×${C.length}; bot zvolil: ${queueKey(R[dbg.pick])}`);
if (human) console.log(`človek (${oppSide}) naozaj zahral: ${queueKey(human)}`);
console.log("\nstĺpce (súper):");
cols.forEach((c, k) => console.log(`  c${k} p=${c.p.toFixed(2)}  ${queueKey(c.c)}${human && queueKey(c.c) === queueKey(human) ? "   ← človek" : ""}`));
console.log("\nriadky (bot): p  vs-zmes  priemer | hodnoty proti c0…");
for (const x of rows) {
  const vals = cols.map(c => value(x.r, c.c).toFixed(2).padStart(6)).join("");
  console.log(`  ${x.p.toFixed(2)} ${x.vs.toFixed(2).padStart(6)} ${x.avg.toFixed(2).padStart(6)} |${vals}   ${queueKey(x.r)}`);
}

// --pair "<moja fronta>|<súperova fronta>" = priebeh simulovaného kola tejto dvojice (zásahy, HP)
const pair = opt("--pair");
if (pair) {
  const [rk, ck] = pair.split("|").map(s => s.trim());
  const r = R.find(q => queueKey(q) === rk), c = C.find(q => queueKey(q) === ck);
  if (!r || !c) { console.log("\n--pair: fronta nenájdená v matici"); process.exit(0); }
  const sim = createSim();
  const opp = dbg.me === "p1" ? "p2" : "p1";
  const end = sim.play(dbg.s0, { [dbg.me]: r, [opp]: c }, seededRng(17));
  console.log(`\npriebeh ${rk}  ×  ${ck}:`);
  for (const f of sim.lastTimeline()) for (const e of f.effects || []) {
    if (["action", "hit", "block", "mirror", "invalid", "special", "demon", "last_stand", "last_hope", "tile_proc"].includes(e.kind) || e.kind?.includes("doom"))
      console.log("   ", JSON.stringify(e).slice(0, 160));
  }
  console.log(`  koniec: p1 HP ${end.players.p1.hp}, p2 HP ${end.players.p2.hp}, winner ${end.winner ?? "-"}`);
  // turnaj: zložky hodnoty (series.js) - eval hry, lavičky, hodnota turnaja
  if (isTournament(dbg.s0)) {
    const e = evaluate(end, dbg.me);
    console.log(`  turnaj: eval hry ${e.toFixed(3)}, hodnota turnaja ${seriesValue(end, dbg.me, e, teamLead(dbg.s0, dbg.me), dbg.s0.players[dbg.me].hp).toFixed(3)}`);
    console.log(`  na doske: p1 ${end.players.p1.char} ${end.players.p1.hp}/${end.players.p1.mana}, p2 ${end.players.p2.char} ${end.players.p2.hp}/${end.players.p2.mana}; lavičky HP ${JSON.stringify(end.mageHp)} mana ${JSON.stringify(end.mageMana)}`);
  }
}

// --br "<súperova fronta>" = moje najlepšie odpovede z CELÉHO poolu (vrátane golden doplnkov) na túto frontu
const brKey = opt("--br");
if (brKey) {
  const c = C.find(q => queueKey(q) === brKey);
  if (!c) { console.log("\n--br: fronta nie je v matici"); process.exit(0); }
  const sim = createSim();
  const pool = baseQueues(sim, dbg.s0, dbg.me);
  const all = [...pool, ...pool.flatMap(q => extraVariants(sim, dbg.s0, dbg.me, q))];
  const sc = all.map(q => ({ q, v: value(q, c) })).sort((a, b) => b.v - a.v);
  console.log(`\nnajlepšie odpovede na ${brKey} (z ${all.length} front):`);
  sc.slice(0, 8).forEach(x => console.log(`  ${x.v.toFixed(2).padStart(6)}  ${queueKey(x.q)}`));
}
