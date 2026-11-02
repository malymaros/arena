// tools/ai-duel.mjs - duel dvoch verzií / nastavení AI bota (docs/AI_PLAN.md 5.2) na všetkých jadrách.
// Každý seed sa hrá dvakrát s vymenenými stranami (párovanie znižuje vplyv postáv a seedu).
// Spustenie: node tools/ai-duel.mjs --games 200 --sims 3000 [--a engine/ai/bot.js] [--b engine/ai/bot.js]
//            [--b script:shieldy|aggro|turtle|greedy]  (B = predvídateľný štýl z tools/scripted-bots.mjs)
//            [--a-opts '{"model":false}'] [--b-opts '{}'] [--a-sims n] [--b-sims n] [--workers 8]
// Výsledok: koľko hier vyhrala verzia A (+ 95 % interval).
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { cpus } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { playMatch } from "./ai-vs.mjs";

if (!isMainThread) {
  const { seeds, a, b } = workerData;
  const load = async (v) => (await import(pathToFileURL(path.resolve(v.path)).href)).createBot;
  const isScript = (v) => v.path.startsWith("script:");
  const [ca, cb] = [await load(a), isScript(b) ? null : await load(b)];
  let wins = 0, games = 0;
  for (const seed of seeds) {
    for (const swap of [false, true]) {
      const [pa, pb] = swap ? ["B", "A"] : ["A", "B"]; // osoba s verziou A
      const opts = {
        [pa]: { create: ca, ...a.opts, budgetSims: a.sims },
        [pb]: { create: cb, ...b.opts, budgetSims: b.sims },
      };
      const players = { [pa]: "bot", [pb]: isScript(b) ? b.path : "bot" };
      const r = playMatch(seed, players, { budgetMs: 100, budgetSims: a.sims, botOpts: opts });
      if (!r.winner) continue;
      games++;
      if (r.winner === pa) wins++;
    }
  }
  parentPort.postMessage({ wins, games });
} else {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
  const GAMES = Number(opt("--games", 200)), SIMS = Number(opt("--sims", 3000));
  const WORKERS = Number(opt("--workers", cpus().length));
  const a = { path: opt("--a", "engine/ai/bot.js"), opts: JSON.parse(opt("--a-opts", "{}")), sims: Number(opt("--a-sims", SIMS)) };
  const b = { path: opt("--b", "engine/ai/bot.js"), opts: JSON.parse(opt("--b-opts", "{}")), sims: Number(opt("--b-sims", SIMS)) };
  const seedBase = Number(opt("--seed", 50000));
  const seeds = Array.from({ length: Math.ceil(GAMES / 2) }, (_, i) => seedBase + i);
  const t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: WORKERS }, (_, w) => seeds.filter((_, i) => i % WORKERS === w)).filter(c => c.length)
    .map(chunk => new Promise((res, rej) => {
      const wk = new Worker(fileURLToPath(import.meta.url), { workerData: { seeds: chunk, a, b } });
      wk.once("message", res); wk.once("error", rej);
    })));
  const wins = parts.reduce((s, p) => s + p.wins, 0), games = parts.reduce((s, p) => s + p.games, 0);
  const r = wins / Math.max(1, games), ci = 196 * Math.sqrt(r * (1 - r) / Math.max(1, games));
  console.log(`A (${a.path} ${JSON.stringify(a.opts)} ${a.sims} sim) vs B (${b.path} ${JSON.stringify(b.opts)} ${b.sims} sim)`);
  console.log(`A vyhral ${wins}/${games} = ${(100 * r).toFixed(1)} % (±${ci.toFixed(1)}), ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
