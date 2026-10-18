// tools/sound-windows.mjs - OKNÁ zvukových udalostí zmerané priamo z enginu: seedované zápasy náhodných botov
// (všetky dvojice postáv) → každý frame timeline prejde tou istou logikou ako v hre (public/sounds/events.js)
// → pre každý kľúč (aj "<kľúč>.<char>") medián a všetky rôzne dĺžky okna v ms. Výsledok public/sounds/windows.json ukazuje
// Sound Lab ako cieľovú dĺžku zvuku a sound.js podľa neho prispôsobuje zvuky (fit).
//   node tools/sound-windows.mjs           → prepíše public/sounds/windows.json (npm run sounds:windows)
//   node tools/sound-windows.mjs --check   → porovná s uloženým (npm test); zmena časovania hry bez
//                                            pregenerovania = FAIL, rovnako ako golden master
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createEngine } from "../engine/game.js";
import { CHARS } from "../engine/constants.js";
import { playBotMatch } from "./random-bot.mjs";
import { eventsForFrame, newTracker } from "../public/sounds/events.js";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sounds", "windows.json");
const CHECK = process.argv.includes("--check");
const PER_PAIR = 2;
const MAX_ROUNDS = 60;
const P1_POOL = [...CHARS, "countess", "luffy"]; // rovnaké pooly ako tools/simulate.mjs
const P2_POOL = [...CHARS, "onre", "jotaro"];
const CONFIG = {
  format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white",
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
};

const samples = {}; // kľúč → [ms]
const add = (k, ms) => (samples[k] ||= []).push(ms);

function measure(timeline) {
  const tr = newTracker();
  for (let i = 1; i < timeline.length; i++) {
    const before = { p1: timeline[i - 1].p1, p2: timeline[i - 1].p2 };
    for (const ev of eventsForFrame(timeline, i, before, tr)) {
      add(ev.key, ev.windowMs);
      if (ev.char) add(`${ev.key}.${ev.char}`, ev.windowMs);
    }
  }
}

P1_POOL.forEach((a, ai) => P2_POOL.forEach((b, bi) => {
  for (let n = 0; n < PER_PAIR; n++) {
    const seed = 7000 + ai * 1000 + bi * 10 + n;
    let over = false;
    const engine = createEngine({
      seed,
      emit: (ev) => { if (ev === "game_result") over = true; },
      emitState: (timeline) => { if (timeline) measure(timeline); },
    });
    engine.startMatch(engine.sanitizeConfig(CONFIG));
    engine.chooseCharacter("A", a);
    engine.chooseCharacter("B", b);
    playBotMatch(engine, seed, () => over, MAX_ROUNDS);
  }
}));

const stats = {};
for (const k of Object.keys(samples).sort()) {
  const v = samples[k].sort((x, y) => x - y);
  // values = všetky rôzne dĺžky okna (napr. let strely 1/2/3 bunky); bez počtu vzoriek - ten by sa menil pri
  // každej zmene náhody enginu a check by zbytočne padal
  stats[k] = { med: v[Math.floor(v.length / 2)], values: [...new Set(v)] };
}
const json = JSON.stringify(stats, null, 1) + "\n";

if (CHECK) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (old.replace(/\r\n/g, "\n") === json) { console.log(`sound-windows: OK (${Object.keys(stats).length} kľúčov)`); process.exit(0); }
  console.log("sound-windows: FAIL - okná zvukov nesedia s aktuálnym enginom (zmenilo sa časovanie alebo mapovanie).");
  console.log("  Ak je zmena zámerná: npm run sounds:windows (a v Sound Labe skontroluj balíky s posunutým oknom).");
  process.exit(1);
}
fs.writeFileSync(OUT, json);
console.log(`sound-windows: zapísaných ${Object.keys(stats).length} kľúčov → ${path.relative(process.cwd(), OUT)}`);
