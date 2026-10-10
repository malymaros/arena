// tools/simulate.mjs - headless simulácia zápasov priamo cez engine (bez servera, socketov a čakania).
// Hráči ťahajú náhodne (tools/random-bot.mjs - náhodné fronty, o platnosti rozhoduje engine),
// takže výsledky hovoria o stabilite enginu, nie o balanse postáv.
// Spustenie:  node tools/simulate.mjs [počet zápasov na dvojicu=20] [p1postava p2postava]
//   napr.     node tools/simulate.mjs 50
//             node tools/simulate.mjs 200 naruto jotaro
import { createEngine } from "../engine/game.js";
import { CHARS } from "../engine/constants.js";
import { playBotMatch } from "./random-bot.mjs";

const N = Number(process.argv[2]) || 20;
const pairArg = process.argv.slice(3, 5);
const P1_POOL = [...CHARS, "countess", "luffy"]; // side-postavy viazané na p1
const P2_POOL = [...CHARS, "onre", "jotaro"];    // side-postavy viazané na p2
const MAX_ROUNDS = 60;
const CONFIG = {
  format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white", // osoba A = p1
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
};

function playMatch(ch1, ch2, seed) {
  let result = null, frames = 0;
  const engine = createEngine({
    seed,
    emit: (ev, payload) => { if (ev === "game_result") result = payload; },
    emitState: (timeline) => { if (timeline) frames += timeline.length; },
  });
  engine.startMatch(engine.sanitizeConfig(CONFIG));
  engine.chooseCharacter("A", ch1);
  engine.chooseCharacter("B", ch2);
  const g = () => engine.game;
  if (g().players.p1.char !== ch1 || g().players.p2.char !== ch2) throw new Error(`voľba postáv zlyhala ${ch1}/${ch2}`);
  const rounds = playBotMatch(engine, seed, () => !!result, MAX_ROUNDS);
  return { winner: result?.gameWinner ?? null, rounds, frames };
}

const pairs = pairArg.length === 2 ? [pairArg] : P1_POOL.flatMap(a => P2_POOL.map(b => [a, b]));
const t0 = performance.now();
let games = 0, unfinished = 0, totalRounds = 0;
const wins = {}; // postava → { w, n }
// každá dvojica má vlastné seedy - pri spoločných by dlaždice aj náhodné ťahy boli rovnaké a výsledky umelo korelovali
pairs.forEach(([a, b], pi) => {
  for (let i = 0; i < N; i++) {
    const r = playMatch(a, b, 1000 + pi * 100000 + i);
    games++; totalRounds += r.rounds;
    if (!r.winner) { unfinished++; continue; }
    for (const [ch, slot] of [[a, "p1"], [b, "p2"]]) {
      wins[ch] ??= { w: 0, n: 0 };
      wins[ch].n++;
      if (r.winner === slot) wins[ch].w++;
    }
  }
});
const ms = performance.now() - t0;
console.log(`${games} zápasov, ${totalRounds} kôl za ${(ms / 1000).toFixed(2)} s (${(ms / games).toFixed(1)} ms/zápas), nedohraných: ${unfinished}`);
console.log("Úspešnosť pri NÁHODNÝCH ťahoch (nie balans!):");
for (const [ch, { w, n }] of Object.entries(wins).sort((x, y) => y[1].w / y[1].n - x[1].w / x[1].n))
  console.log(`  ${ch.padEnd(10)} ${(100 * w / n).toFixed(0).padStart(3)} %  (${w}/${n})`);
