// tools/ai-tune.mjs - ladenie hodnotiacej funkcie AI bota self-play-om (docs/AI_PLAN.md, fáza A3).
// Generácia = bot hrá sám proti sebe (aktuálne váhy, náhodné postavy) na všetkých jadrách → stavy na začiatku
// kôl + konečný výsledok → logistická regresia P(výhra) = σ(β·features) (váha eval = β/2, lebo
// tanh(s) = 2σ(2s) − 1) → duel nové vs staré váhy (rovnaké seedy, vymenené strany). Prijaté váhy sa zapíšu
// do engine/ai/weights.js. Dáta všetkých generácií sa sčítavajú.
// Spustenie: node tools/ai-tune.mjs [--gens 3] [--games 600] [--duel 200] [--sims 800] [--workers 8]
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { playMatch } from "./ai-vs.mjs";
import { FEATURES, DOOM_FEATURES, features, doomFeatures } from "../engine/ai/eval.js";
import { WEIGHTS } from "../engine/ai/weights.js";


// ---------------- worker: zápasy ----------------
if (!isMainThread) {
  const { task, seeds, weights, weightsB, sims } = workerData;
  const out = { samples: [], wins: 0, games: 0 };
  for (const seed of seeds) {
    if (task === "selfplay") {
      const states = [];
      const r = playMatch(seed, { A: "bot", B: "bot" }, { budgetSims: sims, budgetMs: 100,
        botOpts: { A: { weights }, B: { weights } }, onRound: (st) => states.push(st) });
      if (!r.winner) continue;
      out.games++;
      for (const st of states) {
        const winSlot = st.seats.p1 === r.winner ? "p1" : "p2";
        const p1 = st.players.p1, p2 = st.players.p2;
        if (p1.lastStandDoom !== p2.lastStandDoom) {
          const ds = p1.lastStandDoom ? "p1" : "p2", df = doomFeatures(st, ds);
          out.samples.push({ doom: true, x: DOOM_FEATURES.map(k => df[k]), y: ds === winSlot ? 1 : 0 });
          continue;
        }
        for (const me of ["p1", "p2"]) {
          const f = features(st, me);
          out.samples.push({ doom: false, x: FEATURES.map(k => f[k]), y: me === winSlot ? 1 : 0 });
        }
      }
    } else {
      // duel: osoba A má váhy `weights`, B má `weightsB`; nepárny seed = vymenené strany
      const swap = seed % 2 === 1;
      const wA = swap ? weightsB : weights, wB = swap ? weights : weightsB;
      const r = playMatch(seed, { A: "bot", B: "bot" }, { budgetSims: sims, budgetMs: 100, botOpts: { A: { weights: wA }, B: { weights: wB } } });
      if (!r.winner) continue;
      out.games++;
      if ((r.winner === "A") !== swap) out.wins++; // výhra hráča s `weights`
    }
  }
  parentPort.postMessage(out);
}

// ---------------- hlavné vlákno ----------------
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : d; };

function runParallel(task, seeds, extra, workers) {
  const chunks = Array.from({ length: workers }, (_, i) => seeds.filter((_, j) => j % workers === i)).filter(c => c.length);
  return Promise.all(chunks.map(chunk => new Promise((res, rej) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { task, seeds: chunk, ...extra } });
    w.once("message", res); w.once("error", rej);
  }))).then(parts => ({
    samples: parts.flatMap(p => p.samples), wins: parts.reduce((a, p) => a + p.wins, 0), games: parts.reduce((a, p) => a + p.games, 0),
  }));
}

// logistická regresia bez interceptu (features sú antisymetrické), L2, Adam
function fitLogistic(samples, dim, { l2 = 1e-3, iters = 400, lr = 0.05 } = {}) {
  const beta = new Float64Array(dim), m = new Float64Array(dim), v = new Float64Array(dim), g = new Float64Array(dim);
  const n = samples.length;
  for (let t = 1; t <= iters; t++) {
    g.fill(0);
    for (const s of samples) {
      let z = 0;
      for (let k = 0; k < dim; k++) z += beta[k] * s.x[k];
      const p = 1 / (1 + Math.exp(-z)), e = p - s.y;
      for (let k = 0; k < dim; k++) if (s.x[k]) g[k] += e * s.x[k];
    }
    for (let k = 0; k < dim; k++) {
      const gk = g[k] / n + l2 * beta[k];
      m[k] = 0.9 * m[k] + 0.1 * gk; v[k] = 0.999 * v[k] + 0.001 * gk * gk;
      beta[k] -= lr * (m[k] / (1 - 0.9 ** t)) / (Math.sqrt(v[k] / (1 - 0.999 ** t)) + 1e-8);
    }
  }
  let ll = 0;
  for (const s of samples) {
    let z = 0;
    for (let k = 0; k < dim; k++) z += beta[k] * s.x[k];
    const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-z))));
    ll += s.y ? Math.log(p) : Math.log(1 - p);
  }
  return { beta: [...beta], logloss: -ll / n };
}

function writeWeights(w, note) {
  const fmt = (o) => Object.entries(o).filter(([, x]) => Math.abs(x) > 1e-4).map(([k, x]) => `  ${JSON.stringify(k)}: ${+x.toFixed(4)},`).join("\n");
  writeFileSync(new URL("../engine/ai/weights.js", import.meta.url),
`// engine/ai/weights.js - váhy hodnotiacej funkcie AI bota (engine/ai/eval.js). GENEROVANÉ: tools/ai-tune.mjs
// (self-play + logistická regresia) - ručne neupravovať, spusti ladenie znova.
// ${note}
export const WEIGHTS = {
${fmt(w)}
};
`);
}

if (isMainThread) {
  const GENS = opt("--gens", 3), GAMES = opt("--games", 600), DUEL = opt("--duel", 200), SIMS = opt("--sims", 800);
  const WORKERS = opt("--workers", Math.max(1, cpus().length));
  let current = { ...WEIGHTS };
  const data = [];
  let seedBase = 100000 + Math.floor(Date.now() / 1000) % 100000 * 10;
  for (let gen = 1; gen <= GENS; gen++) {
    const t0 = Date.now();
    const seeds = Array.from({ length: GAMES }, (_, i) => seedBase + i); seedBase += GAMES;
    const sp = await runParallel("selfplay", seeds, { weights: current, sims: SIMS }, WORKERS);
    data.push(...sp.samples);
    const normal = data.filter(s => !s.doom), doom = data.filter(s => s.doom);
    const fit = fitLogistic(normal, FEATURES.length);
    const cand = {};
    FEATURES.forEach((k, i) => { cand[k] = fit.beta[i] / 2; });
    let doomNote = "doom: málo dát";
    if (doom.length >= 30) {
      const fd = fitLogistic(doom, DOOM_FEATURES.length, { l2: 1e-2 });
      DOOM_FEATURES.forEach((k, i) => { cand[k] = fd.beta[i] / 2; });
      doomNote = `doom: ${doom.length} stavov, výhra doomu ${(100 * doom.filter(s => s.y).length / doom.length).toFixed(0)} %`;
    } else for (const k of DOOM_FEATURES) cand[k] = current[k] ?? 0;
    console.log(`gen ${gen}: ${sp.games} hier, ${normal.length} stavov (spolu), logloss ${fit.logloss.toFixed(4)}, ${doomNote}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const top = Object.entries(cand).filter(([k]) => !k.includes(":")).map(([k, x]) => `${k}=${x.toFixed(2)}`).join(" ");
    console.log("   " + top);
    // duel nové vs aktuálne
    const dseeds = Array.from({ length: DUEL }, (_, i) => seedBase + i); seedBase += DUEL;
    const d = await runParallel("duel", dseeds, { weights: cand, weightsB: current, sims: SIMS }, WORKERS);
    const rate = d.wins / Math.max(1, d.games);
    const se = Math.sqrt(rate * (1 - rate) / Math.max(1, d.games));
    console.log(`   duel nové vs staré: ${d.wins}/${d.games} = ${(100 * rate).toFixed(1)} % (±${(196 * se).toFixed(1)})`);
    if (rate > 0.5) {
      current = cand;
      writeWeights(current, `gen ${gen}: ${data.length} stavov self-play (${SIMS} sim/rozhodnutie), duel proti predchodcovi ${(100 * rate).toFixed(1)} %; ${doomNote}`);
      console.log("   → prijaté, zapísané do engine/ai/weights.js");
    } else console.log("   → zamietnuté (ostávajú staré váhy)");
  }
}
