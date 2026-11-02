// engine/ai/bot.js - ťažký AI bot (docs/AI_PLAN.md). Dostáva LEN payloady ako klient (onYouAre / onState /
// onNewGame) a na požiadanie rozhodne (decide): výber postavy, frontu kola alebo THE WORLD zmrazené akcie.
// Kolo = maticová hra: kandidáti oboch strán (candidates.js), hodnota dvojice front = priemer eval po
// simulovanom kole cez determinizácie skrytého stavu, rovnováha regret matchingom, rozšírenie sád
// najlepšími odpoveďami (double oracle), kým nevyprší čas. Fronta sa vyžrebuje z rovnovážnej zmesi.
import { CHARS, SIDE_CHARS, seededRng, cloneData } from "../constants.js";
import { createBelief, decisionKind, hasHidden, simState } from "./view.js";
import { createSim } from "./sim.js";
import { baseQueues, extraVariants, queueKey } from "./candidates.js";
import { evaluate, DEFAULT_WEIGHTS } from "./eval.js";
import { solveMatrix, sampleMix } from "./solve.js";

const other = (s) => (s === "p1" ? "p2" : "p1");
const TS_TYPES = ["move", "dash", "recharge", "attack", "melee", "shield", "shield_breaker", "special1"];
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];

// budgetMs = čas na rozhodnutie; budgetSims (voliteľné) = deterministický režim pre testy a self-play: „čas"
// sa meria počtom simulácií (budgetSims simulácií = budgetMs), takže výsledok nezávisí od rýchlosti CPU
export function createBot({ seed = 1, budgetMs = 5000, budgetSims = null, weights = DEFAULT_WEIGHTS, log = null } = {}) {
  const belief = createBelief();
  const rng = seededRng(seed);
  const sim = createSim(), tsSim = createSim();
  const stats = { decisions: 0, sims: 0 };
  const now = budgetSims ? () => stats.sims * budgetMs / budgetSims : () => performance.now();

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // ---------- THE WORLD v simulácii: najlepšia z pár náhodných zmrazených trojíc (lacná politika) ----------
  function randomFrozen(char) {
    const pool = [...TS_TYPES], q = [];
    while (q.length < 3) {
      const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      if (t === "shield_breaker" && q.some(a => a.type === "shield")) continue;
      if (t === "shield" && q.some(a => a.type === "shield_breaker")) continue;
      const a = { type: t };
      if (t === "move" || t === "dash") a.dir = pick(DIRS.slice(0, 4));
      if (t === "attack") a.dir = pick(DIRS);
      if (t === "special1") a.dir = pick(["left", "right"]);
      q.push(a);
    }
    return q;
  }
  function tsPolicy(game, slot) {
    let best = null, bestV = -Infinity;
    for (let k = 0; k < 6; k++) {
      const q = randomFrozen(game.players[slot].char);
      tsSim.engine.loadState(cloneData(game), seededRng(k + 1));
      let ok = false;
      tsSim.engine.timestopActions(slot === "p1" ? "A" : "B", q, (r) => { ok = !!r?.ok; });
      if (!ok) continue;
      stats.sims++;
      const v = evaluate(tsSim.engine.game, slot, weights);
      if (v > bestV) { bestV = v; best = q; }
    }
    return best;
  }

  // ---------- hodnota dvojice front (priemer cez determinizácie), s cache ----------
  function makeValue(states, me) {
    const opp = other(me), cache = new Map();
    return function value(qm, qo) {
      const key = queueKey(qm) + "|" + queueKey(qo);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let s = 0, n = 0;
      for (let i = 0; i < states.length; i++) {
        const res = sim.play(states[i], { [me]: qm, [opp]: qo }, seededRng(i * 7919 + 17), tsPolicy);
        stats.sims++;
        if (!res) continue;
        s += evaluate(res, me, weights); n++;
      }
      const v = n ? s / n : 0;
      cache.set(key, v);
      return v;
    };
  }

  // rýchlosť simulácie (dvojíc front za ms pri D = 1) - priebežne meraná, určuje veľkosť vzoriek
  let rate = budgetSims ? budgetSims / budgetMs : 8;

  // ohodnoť frontu z poolu proti sondám; vráti `count` najlepších (deduplikácia podľa vektora hodnôt)
  function prefilter(pool, probes, score, count, deadline) {
    const seen = new Set();
    const scored = [];
    for (const q of pool) {
      if (now() > deadline && scored.length >= count) break;
      const vec = probes.map(p => score(q, p));
      const sig = vec.map(v => v.toFixed(4)).join(",");
      if (seen.has(sig)) continue;
      seen.add(sig);
      scored.push({ q, s: vec.reduce((a, b) => a + b, 0) / (vec.length || 1) });
    }
    scored.sort((a, b) => b.s - a.s);
    return { top: scored.slice(0, count).map(x => x.q), all: scored.map(x => x.q) };
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // najlepšia odpoveď z poolu na zmes súpera (sign = +1 maximalizujem ja, −1 súper minimalizuje)
  function bestResponse(pool, support, val, sign, bar, deadline) {
    let best = null, bestV = bar;
    for (const q of pool) {
      if (now() > deadline) break;
      let v = 0;
      for (const [o, p] of support) v += p * val(q, o);
      if (sign * v > sign * bestV) { bestV = v; best = q; }
    }
    return best;
  }

  // ---------- rozhodnutie kola ----------
  function decideRound() {
    const t0 = now(), deadline = t0 + budgetMs, sims0 = stats.sims;
    const me = belief.mySlot, opp = other(me);
    const D = hasHidden(belief) ? 4 : 1;
    const states = Array.from({ length: D }, () => simState(belief, rng));
    const s0 = states[0];
    const myPool = shuffle(baseQueues(sim, s0, me));
    let oppPool = shuffle(baseQueues(sim, s0, opp));
    if (!myPool.length) return null;
    if (!oppPool.length) oppPool = [[{ type: "pass" }, { type: "pass" }, { type: "pass" }]];
    const value = makeValue(states, me);
    const vMe = (q, o) => value(q, o), vOpp = (o, q) => -value(q, o);
    const left = () => deadline - now();

    // rozpočet v dvojiciach front: ~15 % predvýber každej strany, ~15 % matica, zvyšok double oracle
    const pairs = Math.max(200, left() * rate / D);
    const NPROBE = 4;
    const sampleN = clamp(Math.floor(pairs * 0.15 / NPROBE), 30, 4000);
    const K = clamp(Math.floor(Math.sqrt(pairs * 0.15)), 8, 40);

    // 1. sondy: malá rôznorodá vzorka súperových / mojich front; predvýber najlepších proti nim
    const probesOpp = oppPool.slice(0, NPROBE), probesMe = myPool.slice(0, NPROBE);
    const pm = prefilter(myPool.slice(0, sampleN), probesOpp, vMe, K, now() + left() * 0.2);
    const po = prefilter(oppPool.slice(0, sampleN), probesMe, vOpp, K, now() + left() * 0.25);
    // golden doplnky (predťah / golden mana / last stand / last hope) k najlepším základným frontám
    const withExtras = (top, slot) => {
      const out = [...top];
      for (const q of top.slice(0, Math.ceil(K / 4))) out.push(...extraVariants(sim, s0, slot, q));
      return out;
    };
    let R = withExtras(pm.top, me);
    const C = withExtras(po.top, opp);
    // pool pre najlepšie odpovede: ohodnotené (s doplnkami) a potom zvyšok neohodnotených
    const fullR = [...R, ...pm.all.slice(K), ...myPool.slice(sampleN)];
    const fullC = [...C, ...po.all.slice(K), ...oppPool.slice(sampleN)];

    // 2. maticová hra (stavba s kontrolou času - pri nedostatku orežem riadky)
    const matrix = () => {
      const M = [];
      for (const r of R) {
        M.push(C.map(c => value(r, c)));
        if (now() > deadline) break;
      }
      R = R.slice(0, M.length);
      return M;
    };
    let sol = solveMatrix(matrix());
    // 3. double oracle: najlepšie odpovede z celého poolu, kým je čas
    for (let it = 0; it < 30 && left() > 0; it++) {
      let added = false;
      const colSup = C.map((c, j) => [c, sol.col[j]]).filter(([, p]) => p > 0.01);
      const br = bestResponse(fullR, colSup, vMe, 1, sol.value + 0.005, now() + left() / 3);
      if (br && !R.includes(br)) { R.push(br); added = true; }
      const rowSup = R.map((r, i) => [r, sol.row[i] ?? 0]).filter(([, p]) => p > 0.01);
      const bo = bestResponse(fullC, rowSup, (o, r) => value(r, o), -1, sol.value - 0.005, now() + left() / 2);
      if (bo && !C.includes(bo)) { C.push(bo); added = true; }
      if (!added) break;
      sol = solveMatrix(matrix());
    }
    const i = sampleMix(sol.row, rng);
    const ms = now() - t0;
    if (ms > 50 && !budgetSims) rate = 0.7 * rate + 0.3 * ((stats.sims - sims0) / D / ms);
    log?.({ kind: "round", ms: Math.round(ms), R: R.length, C: C.length, pool: [myPool.length, oppPool.length], D,
      value: +sol.value.toFixed(3), pick: queueKey(R[i]), p: +sol.row[i].toFixed(2), sims: stats.sims - sims0 });
    return R[i];
  }

  // ---------- THE WORLD (bot = Jotaro): súper je zmrazený → jednostranná optimalizácia ----------
  // Pohľad počas pauzy nenesie zvyšok kola (súperove zostávajúce akcie sú pre bota skryté, ako pre človeka):
  // aproximácia = kolo, v ktorom je súper skamenený a ja hrám zmrazené akcie.
  function decideTimestop() {
    const t0 = now(), deadline = t0 + Math.min(budgetMs, 2000);
    const me = belief.mySlot, opp = other(me);
    const st = simState(belief, rng);
    st.players[opp].stone = 3;
    st.timestop = null;
    const stoned = [{ type: "stoned" }, { type: "stoned" }, { type: "stoned" }];
    let best = null, bestV = -Infinity;
    const tried = new Set();
    for (let attempt = 0; now() < deadline && tried.size < 400 && attempt < 2000; attempt++) {
      const q = randomFrozen(st.players[me].char);
      const k = queueKey(q);
      if (tried.has(k)) continue;
      tried.add(k);
      const res = sim.play(st, { [me]: q, [opp]: stoned }, seededRng(1), tsPolicy);
      stats.sims++;
      if (!res) continue;
      const v = evaluate(res, me, weights);
      if (v > bestV) { bestV = v; best = q; }
    }
    log?.({ kind: "timestop", ms: Math.round(now() - t0), tried: tried.size, pick: best && queueKey(best) });
    return best || [{ type: "recharge" }, { type: "shield" }, { type: "move", dir: "up" }];
  }

  // ---------- výber postavy (slepý, ako pre človeka) ----------
  function decideCharacter() {
    const me = belief.mySlot;
    const pool = [...CHARS, ...Object.keys(SIDE_CHARS).filter(k => SIDE_CHARS[k] === me)];
    return pick(pool);
  }

  function decide() {
    const kind = decisionKind(belief);
    if (!kind) return null;
    stats.decisions++;
    if (kind === "character") return { kind, char: decideCharacter() };
    if (kind === "timestop") return { kind, queue: decideTimestop() };
    return { kind, queue: decideRound() };
  }

  return {
    onYouAre: belief.onYouAre, onState: belief.onState, onNewGame: belief.onNewGame,
    decide, belief, stats,
  };
}
