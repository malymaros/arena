// tools/ai-bench.mjs - fáza A0 AI bota (docs/AI_PLAN.md): overí a zmeria simuláciu kola z uloženého stavu.
// Odohrá náhodné zápasy (tools/random-bot.mjs); na začiatku každého kola stav exportuje (exportState), načíta
// do simulačného enginu (loadState) a zahrá v ňom tie isté dve fronty:
//   1. správnosť - simulácia bez frame-ov (io.noFrames) musí skončiť v bit-identickom stave ako s frame-ami
//      a ako skutočné kolo hlavného enginu (pri rovnakom rng);
//   2. rýchlosť - ms na simulované kolo s frame-ami a bez nich.
// Spustenie: node tools/ai-bench.mjs [počet zápasov na dvojicu=2]
import { createEngine } from "../engine/game.js";
import { CHARS, seededRng, cloneData } from "../engine/constants.js";
import { candidate } from "./random-bot.mjs";

const N = Number(process.argv[2]) || 2;
const P1_POOL = [...CHARS, "countess", "luffy"];
const P2_POOL = [...CHARS, "onre", "jotaro"];
const CONFIG = {
  format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white",
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
};
const REPS = 20; // opakovaní simulácie toho istého kola pri meraní času

// platná náhodná fronta pre slot (overená validQueue, bez zamknutia)
function randomQueue(engine, slot, rng) {
  const g = engine.game;
  for (let i = 0; i < 2000; i++) {
    const q = candidate(rng, g.board, g.players[slot].stone, g.starter === slot);
    if (engine.validQueue(q, slot)) return q;
  }
  return null;
}

// zahrá jedno kolo v engine (lockIn oboch osôb); vráti false, ak ho engine neprijal
function playRound(engine, qA, qB) {
  let ok = 0;
  engine.lockIn("A", qA, undefined, (r) => { if (r?.ok) ok++; });
  engine.lockIn("B", qB, undefined, (r) => { if (r?.ok) ok++; });
  return ok === 2;
}

// stav po kole bez polí, ktoré sa medzi enginmi legitímne líšia (žiadne také zatiaľ nie sú)
const stateKey = (g) => JSON.stringify(g);

const sim = { frames: createEngine({ schedule: () => {} }), fast: createEngine({ noFrames: true, schedule: () => {} }) };
let rounds = 0, mismatches = 0, paused = 0;
const time = { clone: 0, frames: 0, fast: 0 };

const pairs = P1_POOL.flatMap(a => P2_POOL.map(b => [a, b]));
pairs.forEach(([ch1, ch2], pi) => {
  for (let m = 0; m < N; m++) {
    const seed = 5000 + pi * 1000 + m;
    let over = false;
    const main = createEngine({ seed, schedule: () => {}, emit: (ev) => { if (ev === "game_result") over = true; } });
    main.startMatch(main.sanitizeConfig(CONFIG));
    main.chooseCharacter("A", ch1);
    main.chooseCharacter("B", ch2);
    const rng = seededRng(seed * 7 + 3);
    for (let r = 0; r < 60 && !over; r++) {
      const g = main.game;
      if (g.timestop) break; // THE WORLD pauza - mimo rozsahu A0 (kolo je rozdelené na dve časti)
      const qA = randomQueue(main, g.seats.p1 === "A" ? "p1" : "p2", rng);
      const qB = randomQueue(main, g.seats.p1 === "B" ? "p1" : "p2", rng);
      if (!qA || !qB) break;

      // simulácie z exportovaného stavu - herný rand nahradí kópia v rovnakom stave (porovnanie s hlavným enginom)
      const t0 = performance.now();
      const snap = main.exportState();
      time.clone += performance.now() - t0;
      const rngSeed = Math.floor(rng() * 2 ** 31);
      const results = {};
      for (const [k, eng] of Object.entries(sim)) {
        const t1 = performance.now();
        for (let i = 0; i < REPS; i++) {
          eng.loadState(cloneData(snap), seededRng(rngSeed));
          playRound(eng, qA, qB);
        }
        time[k] += (performance.now() - t1) / REPS;
        results[k] = eng.game.timestop ? null : stateKey(eng.game);
      }

      // hlavný engine: rovnaké fronty, rovnaký rng ako simulácie
      main.loadState(main.game, seededRng(rngSeed));
      if (!playRound(main, qA, qB)) throw new Error(`hlavný engine neprijal fronty ${ch1}/${ch2} seed ${seed}`);
      rounds++;
      if (main.game.timestop) { paused++; break; }
      const real = stateKey(main.game);
      if (results.frames !== real || results.fast !== real) {
        mismatches++;
        if (mismatches <= 3) console.log(`ROZDIEL ${ch1}/${ch2} seed ${seed} kolo ${r + 1}: frames=${results.frames === real} fast=${results.fast === real}`);
      }
    }
  }
});

const per = (ms) => (ms / rounds).toFixed(4);
console.log(`${rounds} kôl, rozdielov: ${mismatches}, THE WORLD páuz (preskočené): ${paused}`);
console.log(`ms/kolo: export stavu ${per(time.clone)} | simulácia s frame-ami ${per(time.frames)} | bez frame-ov ${per(time.fast)}`);
console.log(`→ bez frame-ov ~${Math.round(1000 / ((time.fast + time.clone) / rounds))} simulovaných kôl/s (vrátane klonovania stavu)`);
if (mismatches) process.exit(1);
