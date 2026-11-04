// engine/ai/bot.js - ťažký AI bot (docs/AI_PLAN.md). Dostáva LEN payloady ako klient (onYouAre / onState /
// onNewGame) a na požiadanie rozhodne (decide): výber postavy, frontu kola alebo THE WORLD zmrazené akcie.
// Kolo = maticová hra: kandidáti oboch strán (candidates.js), hodnota dvojice front = priemer eval po
// simulovanom kole cez determinizácie skrytého stavu, rovnováha regret matchingom, rozšírenie sád
// najlepšími odpoveďami (double oracle), kým nevyprší čas. Fronta sa vyžrebuje z rovnovážnej zmesi.
import { CHARS, SIDE_CHARS, TEAM_SIZE, seededRng, cloneData, moonLevelFor } from "../constants.js";
import { SHIELD_COST } from "../../shared/balance.js";
import { createBelief, decisionKind, hasHidden, simState } from "./view.js";
import { createSim } from "./sim.js";
import { baseQueues, extraVariants, swapVariants, queueKey, affordable, dominatedShot } from "./candidates.js";
import { isTournament, seriesValue, teamLead, swapCount, SERIES } from "./series.js";
import { evaluate, desperate } from "./eval.js";
import { WEIGHTS } from "./weights.js";
import { solveMatrix, sampleMix } from "./solve.js";
import { createOpponentModel } from "./model.js";
import { seedPlans, doomPlans } from "./plans.js";

const other = (s) => (s === "p1" ? "p2" : "p1");
// Baby bot: podiel času / simulácií normálneho bota, šanca prehliadnuť istú výhru (vedie / prehráva), penalizácia
// za obranu, max. odstup od najlepšej fronty, teplota softmaxu = BABY_T + BABY_T_LEAD × náskok HP (orezaná)
// (babyTune v createBot ich prepíše - ladenie cez tools/ai-vs.mjs --baby "T=0.3,SPREAD=1")
export const BABY = { NAIVE: 0.8, NAIVE_LEAD: 0.1, NAIVE_MIN: 0.3, NAIVE_MAX: 0.95, SLOP: 0.6, SLOP_LEAD: 0.1, SLOP_MIN: 0.2, SLOP_MAX: 0.9, TOP: 0.8, BUDGET: 0.15, MERCY: 0.7, MERCY_BEHIND: 0.35, DEF_PEN: 0.08, SPREAD: 0.45, T: 0.1, T_LEAD: 0.03, T_MIN: 0.05, T_MAX: 0.35 };
// CHEATER (podvádzajúci bot, docs/AI_PLAN.md 8c): po hráčovom zamknutí vidí JEDNU náhodnú akciu jeho fronty
// (typ + smer / bunka). Počas plánovania počíta ako NORMAL (plný rozpočet; tento ťah je zároveň záloha, keď
// vyprší čas kola) a výpočet si odloží; po odhalení ho len dopočíta (refineRound, REFINE rozpočtu) - stĺpce
// matice = súperove fronty s odhalenou akciou (aspoň MIN_COLS). Bez odloženého výpočtu: celé kolo so zúžením (SPY).
export const CHEAT = { REFINE: 0.15, SPY: 0.3, MIN_COLS: 12, CHECK: 400, SAFE: 0.1 };
// základné akcie fronty (bez golden predťahu / golden many / démona / Last Hope) - poradie = slot 1-3 (ako me.queue po lockIn)
const EXTRA = new Set(["golden_shield", "golden_mirror", "golden_mana", "last_stand", "last_hope"]);
export const baseActions = (q) => q.filter(a => !EXTRA.has(a.type));
const actKey = (a) => a ? a.type + (a.dir ? ":" + a.dir : "") + (a.cell ? `@${a.cell.x},${a.cell.y}` : "") + (a.to ? ">" + a.to : "") : "";
const TS_TYPES = ["move", "dash", "recharge", "attack", "melee", "shield", "shield_breaker", "special1"];
const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];

// budgetMs = čas na rozhodnutie; budgetSims (voliteľné) = deterministický režim pre testy a self-play: „čas"
// sa meria počtom simulácií (budgetSims simulácií = budgetMs), takže výsledok nezávisí od rýchlosti CPU
// level = "normal" (plná sila) | "baby" (pre deti a úplných začiatočníkov, babyPick nižšie): rovnaké hodnotenie
// front, len výber je mäkký, s menej simuláciami, bez modelu súpera a so skrytým vyrovnávaním hry |
// "cheater" (plná sila + jedna odhalená súperova akcia za kolo, decide({ spy }))
export function createBot({ seed = 1, budgetMs = 5000, budgetSims = null, weights = WEIGHTS, model = true, log = null, debug = null, level = "normal", babyTune = null } = {}) {
  const BB = { ...BABY, ...(babyTune || {}) };
  const base = { budgetMs, budgetSims, model };
  let baby = false, cheater = false;
  const belief = createBelief();
  const rng = seededRng(seed);
  const sim = createSim(), tsSim = createSim();
  const stats = { decisions: 0, sims: 0 };
  const now = budgetSims ? () => stats.sims * budgetMs / budgetSims : () => performance.now();

  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  let lastWhy = null; // zdôvodnenie posledného ťahu kola (decide → why)

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

  // všetky zmrazené trojice (každý typ max 1×, štít XOR breaker), ktoré si Jotaro môže dovoliť - náhodné
  // vzorkovanie ich minulo (napr. pri 1 mane jedinú rozumnú „recharge, útok"); pozícia sa sleduje len na
  // vyradenie pohybu do steny a zbytočných diagonálnych smerov basicu
  function allFrozen(st, me) {
    const p = st.players[me], diag = !!SIDE_CHARS[p.char];
    const opts = [];
    for (const t of TS_TYPES) {
      if (t === "move" || t === "dash") for (const dir of DIRS.slice(0, 4)) opts.push({ type: t, dir });
      else if (t === "attack") for (const dir of diag ? DIRS.slice(4) : DIRS.slice(0, 4)) opts.push({ type: t, dir });
      else if (t === "special1") for (const dir of ["left", "right"]) opts.push({ type: t, dir });
      else opts.push({ type: t });
    }
    const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const out = [];
    const rec = (q, x, y) => {
      if (q.length === 3) { if (affordable(q, p.mana, p.char)) out.push(q); return; }
      for (const a of opts) {
        if (q.some(b => b.type === a.type)) continue;
        if ((a.type === "shield" && q.some(b => b.type === "shield_breaker")) || (a.type === "shield_breaker" && q.some(b => b.type === "shield"))) continue;
        if (a.type === "attack" && diag && dominatedShot(st.board, x, y, a.dir)) continue;
        let nx = x, ny = y;
        if (a.type === "move" || a.type === "dash") {
          const [dx, dy] = STEP[a.dir], n = a.type === "dash" ? 2 : 1;
          nx = Math.max(0, Math.min(st.board.w - 1, x + dx * n)); ny = Math.max(0, Math.min(st.board.h - 1, y + dy * n));
          if (nx === x && ny === y) continue; // do steny
        }
        rec([...q, a], nx, ny);
      }
    };
    rec([], p.x, p.y);
    return out;
  }

  // ---------- hodnota dvojice front (priemer cez determinizácie), s cache ----------
  // turnaj (series.js): hodnota = odhad P(výhra turnaja) - hra × sila tímov po nej, sklon k riziku podľa náskoku
  // tímov, penalizácia swapu; value.dead / value.kill = moja / súperova smrť v hre (v turnaji hodnota prehry
  // nie je −1, citlivosť na smrť a „istá výhra" BABY sa preto čítajú z výsledku hry, nie z hodnoty)
  function makeValue(states, me) {
    const opp = other(me), cache = new Map(), outcome = new Map();
    const tour = isTournament(states[0]);
    const lead = tour ? teamLead(states[0], me) : 0, hp0 = states[0].players[me].hp;
    // súper už niekedy swapol (odhalené fronty) → jeho swap nie je až taká výnimka
    const oppPen = belief.history.some(h => h.actions?.some(a => a?.type === "swap")) ? SERIES.SWAP_OPP_SEEN : SERIES.SWAP_OPP_PEN;
    function value(qm, qo) {
      const key = queueKey(qm) + "|" + queueKey(qo);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      let s = 0, n = 0, g = 0;
      for (let i = 0; i < states.length; i++) {
        const res = sim.play(states[i], { [me]: qm, [opp]: qo }, seededRng(i * 7919 + 17), tsPolicy);
        stats.sims++;
        if (!res) continue;
        const e = evaluate(res, me, weights);
        if (tour) {
          const a = res.players[me].hp, b = res.players[opp].hp;
          g += b <= 0 && a > 0 ? 1 : a <= 0 && b > 0 ? -1 : 0;
          s += seriesValue(res, me, e, lead, hp0);
        } else s += e;
        n++;
      }
      let v = n ? s / n : 0;
      if (tour) { v += oppPen * swapCount(qo) - SERIES.SWAP_PEN * swapCount(qm); outcome.set(key, n ? g / n : 0); }
      cache.set(key, v);
      return v;
    }
    const game = (qm, qo) => { value(qm, qo); return outcome.get(queueKey(qm) + "|" + queueKey(qo)) ?? 0; };
    value.dead = tour ? (qm, qo) => game(qm, qo) <= DEATH : (qm, qo) => value(qm, qo) <= DEATH;
    value.kill = tour ? (qm, qo) => game(qm, qo) >= -DEATH : (qm, qo) => value(qm, qo) >= -DEATH;
    return value;
  }

  // rýchlosť simulácie (dvojíc front za ms pri D = 1) - priebežne meraná, určuje veľkosť vzoriek
  let rate = budgetSims ? budgetSims / budgetMs : 8;

  // obťažnosť (dá sa zmeniť aj po vytvorení - server ju nastaví, keď si hráč sadne do AI roomky)
  function setLevel(lv) {
    baby = lv === "baby"; cheater = lv === "cheater";
    model = baby ? false : base.model;
    budgetMs = base.budgetMs; budgetSims = base.budgetSims;
    if (baby) {
      if (budgetSims) budgetSims = Math.max(50, Math.round(budgetSims * BB.BUDGET));
      else budgetMs = Math.max(300, Math.round(budgetMs * BB.BUDGET));
    }
    if (budgetSims) rate = budgetSims / budgetMs;
  }
  setLevel(level);

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
  // spy = { idx, action } - odhalená akcia súpera (len CHEATER); bez nej CHEATER počíta len záložný ťah
  function decideRound(spy = null) {
    const share = cheater && spy ? CHEAT.SPY : 1;
    const t0 = now(), deadline = t0 + budgetMs * share, sims0 = stats.sims;
    const me = belief.mySlot, opp = other(me);
    const D = hasHidden(belief) ? 4 : 1;
    const states = Array.from({ length: D }, () => simState(belief, rng));
    const s0 = states[0];
    let myPool = shuffle(baseQueues(sim, s0, me));
    let oppPool = shuffle(baseQueues(sim, s0, opp));
    // CHEATER: súper hrá len fronty, ktoré majú v odhalenom slote presne odhalenú akciu (žiadna nesedí = bez zúženia)
    const fits = spy ? (q) => actKey(baseActions(q)[spy.idx]) === actKey(spy.action) : null;
    let spied = false;
    if (fits) { const f = oppPool.filter(fits); if (f.length) { oppPool = f; spied = true; } }
    const keep = (qs) => (spied ? qs.filter(fits) : qs);
    if (!myPool.length) return null;
    if (!oppPool.length) oppPool = [[{ type: "pass" }, { type: "pass" }, { type: "pass" }]];
    // rozumné plány oboch strán (plans.js, „ako človek") idú na začiatok poolov - sú aj sondami predvýberu
    // a vždy sa dostanú do matice: súperove zjavné hrozby (aj tie, čo ma zabijú) a moje odpovede na ne
    const seedMe = seedPlans(s0, me, myPool).map(p => p.q), seedOpp = keep(seedPlans(s0, opp, oppPool).map(p => p.q));
    const front = (pool, seeds) => { const set = new Set(seeds); return [...seeds, ...pool.filter(q => !set.has(q))]; };
    myPool = front(myPool, seedMe); oppPool = front(oppPool, seedOpp);
    const value = makeValue(states, me);
    const vMe = (q, o) => value(q, o), vOpp = (o, q) => -value(q, o);
    const left = () => deadline - now();

    // rozpočet v dvojiciach front: ~20 % predvýber každej strany, ~15 % matica, zvyšok double oracle
    const pairs = Math.max(200, left() * rate / D);
    const K = clamp(Math.floor(Math.sqrt(pairs * 0.15)), 8, 40);
    const sampleN = clamp(Math.floor(pairs * 0.14 / 2), 60, 6000);

    // 1. predvýber v dvoch stupňoch: čo najviac front proti 2 sondám (hrubé sito), potom 3K najlepších
    //    dôkladnejšie proti 6 sondám (prvé 2 sú už v cache) → K do matice
    const probesOpp = oppPool.slice(0, 6), probesMe = myPool.slice(0, 6);
    const stage = (pool, probes, score, share) => {
      const a = prefilter(pool.slice(0, sampleN), probes.slice(0, 2), score, 3 * K, now() + left() * share);
      const b = prefilter(a.top, probes, score, K, now() + left() * share);
      return { top: b.top, all: [...b.all, ...a.all.slice(3 * K)] };
    };
    const pm = stage(myPool, probesOpp, vMe, 0.2);
    const po = stage(oppPool, probesMe, vOpp, 0.25);
    // golden doplnky (predťah / golden mana / last stand / last hope) k najlepším základným frontám
    // démon (last_stand) len v zúfalej situácii - inak ho bot bral ako „poistku" (pevná hodnota doomu je
    // pri pesimistickej rovnováhe lákavá už v 1. kole); súperovi ho nechávam, ak je zúfalý on
    const withExtras = (top, slot) => {
      const out = [...top];
      const demonOk = desperate(s0, slot);
      for (const q of top.slice(0, Math.ceil(K / 4)))
        out.push(...extraVariants(sim, s0, slot, q).filter(v => demonOk || !v.some(a => a.type === "last_stand")));
      return out;
    };
    const lead = (seeds, rest) => [...seeds, ...rest.filter(q => !seeds.includes(q))];
    // kolo s démonom: štandardné plány oboch strán (démon v 1./2./3. akcii, obrana kryjúca 2 z 3) vždy v matici
    const doomMe = doomPlans(sim, s0, me, myPool), doomOpp = keep(doomPlans(sim, s0, opp, oppPool));
    let R = lead([...doomMe, ...seedMe.slice(0, 8)], withExtras(pm.top, me));
    const C = keep(lead([...doomOpp, ...seedOpp.slice(0, 10)], withExtras(po.top, opp)));
    // turnaj: pár front so swapom navyše (výnimka - zlý matchup / kombo nového maga), súperovi menej
    if (isTournament(s0)) {
      for (const q of swapVariants(sim, s0, me, pm.top, { plans: seedPlans })) if (!R.includes(q)) R.push(q);
      for (const q of keep(swapVariants(sim, s0, opp, po.top, { first: 2, last: 1, plans: seedPlans }))) if (!C.includes(q)) C.push(q);
    }
    // model súpera: fronty s jeho opakovanými vzormi typov akcií pridaj do matice, aj keď nie sú „rovnovážne"
    const om = model ? createOpponentModel(belief.history) : null;
    const useModel = !!om && om.observations >= 2 && om.weight > 0.05;
    if (useModel) for (const pat of om.patterns()) {
      let added = 0;
      for (const q of oppPool) {
        if (added >= 6) break;
        if (q.map(a => a.type).join(" ") !== pat || C.includes(q)) continue;
        C.push(q); added++;
      }
    }
    // pool pre najlepšie odpovede: ohodnotené (s doplnkami) a potom zvyšok neohodnotených
    const fullR = [...R, ...pm.all.slice(K), ...myPool.slice(sampleN)];
    const fullC = keep([...C, ...po.all.slice(K), ...oppPool.slice(sampleN)]);

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
    // 3. double oracle: najlepšie odpovede z celého poolu, kým je čas (s modelom ostane rezerva na využitie)
    const reserve = useModel ? (deadline - t0) * 0.15 : 0;
    const doLeft = () => left() - reserve;
    for (let it = 0; it < 30 && doLeft() > 0; it++) {
      let added = false;
      const colSup = C.map((c, j) => [c, sol.col[j]]).filter(([, p]) => p > 0.01);
      const br = bestResponse(fullR, colSup, vMe, 1, sol.value + 0.005, now() + doLeft() / 3);
      if (br && !R.includes(br)) { R.push(br); added = true; }
      const rowSup = R.map((r, i) => [r, sol.row[i] ?? 0]).filter(([, p]) => p > 0.01);
      const bo = bestResponse(fullC, rowSup, (o, r) => value(r, o), -1, sol.value - 0.005, now() + doLeft() / 2);
      if (bo && !C.includes(bo)) { C.push(bo); added = true; }
      if (!added) break;
      sol = solveMatrix(matrix());
    }
    // 4. model súpera: predpokladaná zmes = Nash posunutý k modelu; moja zmes = Nash posunutý k najlepšej
    //    odpovedi na ňu - o váhu modelu (max 0.5), takže proti silnému hráčovi ostáva polovica rovnováhy
    let mix = sol.row;
    if (useModel && sol.col.length === C.length) {
      const oppMana = s0.players[opp].mana;
      const sc = C.map(c => om.score(c, oppMana)), tot = sc.reduce((a, b) => a + b, 0) || 1;
      const lam = om.weight;
      const qmix = C.map((c, j) => (1 - lam) * sol.col[j] + lam * sc[j] / tot);
      const sup = C.map((c, j) => [c, qmix[j]]).filter(([, p]) => p > 0.005);
      const br = bestResponse(fullR, sup, vMe, 1, -Infinity, deadline);
      if (br) {
        let bi = R.indexOf(br);
        if (bi < 0) { R.push(br); bi = R.length - 1; }
        mix = R.map((r, k) => (1 - lam) * (sol.row[k] ?? 0) + (k === bi ? lam : 0));
      }
    }
    mix = avoidDeath(mix, R, C, sol.col, value);
    // prehraté proti dokonalému súperovi: hraj na šancu (človek zabijací ťah nemusí nájsť)
    const lost = hopeless(sol, R, C, value);
    if (lost) mix = playForChance(R, C, sol.col, value, [...seedOpp, ...po.all.slice(0, WIDE)]);
    let i;
    if (!baby) i = sampleMix(mix, rng);
    else {
      const q = babyPick(R, C, sol.col, value, s0, me, pm.all);
      i = R.indexOf(q);
      if (i < 0) { R.push(q); mix = [...R.map((r, k) => mix[k] ?? 0)]; i = R.length - 1; } // ležérna fronta mimo matice
    }
    debug?.({ R, C, sol, mix, value, s0, me, pick: i }); // tools/ai-explain.mjs - rozbor rozhodnutia
    const ms = now() - t0;
    if (ms > 50 && !budgetSims) rate = 0.7 * rate + 0.3 * ((stats.sims - sims0) / D / ms);
    log?.({ kind: "round", ms: Math.round(ms), R: R.length, C: C.length, pool: [myPool.length, oppPool.length], D,
      value: +sol.value.toFixed(3), pick: queueKey(R[i]), p: +mix[i].toFixed(2), sims: stats.sims - sims0, ...(lost ? { lost: true } : {}),
      ...(useModel ? { model: om.observations } : {}) });
    // zdôvodnenie ťahu (telemetria AI roomky → tools/bugs.mjs): čo bot zvažoval, čo čakal od súpera, čím by zomrel
    const r2 = (v) => Math.round(v * 100) / 100;
    const vsOpp = (r) => C.reduce((acc, c, j) => acc + (sol.col[j] ?? 0) * value(r, c), 0);
    lastWhy = {
      value: r2(sol.value), pick: queueKey(R[i]), p: r2(mix[i]), ...(lost ? { lost: true } : {}),
      top: R.map((r, k) => ({ r, p: mix[k] ?? 0 })).filter(x => x.p > 0.01).sort((a, b) => b.p - a.p).slice(0, 4)
        .map(x => ({ q: queueKey(x.r), p: r2(x.p), v: r2(vsOpp(x.r)) })),
      opp: C.map((c, j) => ({ c, p: sol.col[j] ?? 0 })).filter(x => x.p > 0.01).sort((a, b) => b.p - a.p).slice(0, 4)
        .map(x => ({ q: queueKey(x.c), p: r2(x.p) })),
      deadly: C.filter(c => value.dead(R[i], c)).slice(0, 3).map(queueKey),
      model: useModel ? om.observations : 0,
      ...(spy ? { spy: { slot: spy.idx + 1, a: actKey(spy.action), used: spied } } : {}),
    };
    // CHEATER: výpočet z plánovania si odlož - po odhalení akcie z neho refineRound len vyškrtne súperove fronty
    if (cheater && !spy) lastCtx = { key: roundKey(), value, vMe, R, fullR, C, oppRanked: [...po.all, ...oppPool.slice(sampleN)], oppAll: oppPool };
    return R[i];
  }

  // ---------- CHEATER: dopočet s odhalenou akciou nad výpočtom z plánovania ----------
  // Matica, hodnoty dvojíc front (cache v `value`) aj zoradené súperove fronty ostali z plného výpočtu počas
  // plánovania. Stĺpce = len súperove fronty s odhalenou akciou (doplnené z jeho zoradeného poolu na aspoň
  // CHEAT.MIN_COLS), nová rovnováha + double oracle v krátkom čase CHEAT.REFINE. Bez kontextu → null.
  function refineRound(spy) {
    const ctx = lastCtx;
    if (!ctx || ctx.key !== roundKey()) return null;
    const t0 = now(), deadline = t0 + budgetMs * CHEAT.REFINE, sims0 = stats.sims;
    const { value, vMe, fullR } = ctx;
    const fits = (q) => actKey(baseActions(q)[spy.idx]) === actKey(spy.action);
    // + zvyšok celého poolu: predvýber po termíne (a pri zhodných vektoroch proti sondám) fronty zahodil
    const ranked = [...new Set([...ctx.oppRanked, ...ctx.oppAll])].filter(fits);
    const C = ctx.C.filter(fits);
    for (const q of ranked) { if (C.length >= CHEAT.MIN_COLS) break; if (!C.includes(q)) C.push(q); }
    if (!C.length) return null;
    const fullC = [...C, ...ranked.filter(q => !C.includes(q))];
    let R = [...ctx.R];
    const matrix = () => {
      const M = [];
      for (const r of R) { M.push(C.map(c => value(r, c))); if (now() > deadline && M.length >= 4) break; }
      R = R.slice(0, M.length);
      return M;
    };
    let sol = solveMatrix(matrix());
    const left = () => deadline - now();
    for (let it = 0; it < 20 && left() > 0; it++) {
      let added = false;
      const colSup = C.map((c, j) => [c, sol.col[j]]).filter(([, p]) => p > 0.01);
      const br = bestResponse(fullR, colSup, vMe, 1, sol.value + 0.005, now() + left() / 3);
      if (br && !R.includes(br)) { R.push(br); added = true; }
      const rowSup = R.map((r, k) => [r, sol.row[k] ?? 0]).filter(([, p]) => p > 0.01);
      const bo = bestResponse(fullC, rowSup, (o, r) => value(r, o), -1, sol.value - 0.005, now() + left() / 2);
      if (bo && !C.includes(bo)) { C.push(bo); added = true; }
      if (!added) break;
      sol = solveMatrix(matrix());
    }
    // poistka (aj po termíne): odhalená akcia zúži súpera na pár desiatok front - zvolené riadky sa overia proti
    // VŠETKÝM sediacim, či niektorá z nich bota nezabije (double oracle to na pomalom VM nestihol: CHEATER videl
    // melee a aj tak čakal na rane - recharge, charge, melee). Zabijaci idú do matice a rovnováha sa prepočíta.
    const resolve = () => solveMatrix(R.map(r => C.map(c => value(r, c))));
    const safeEnd = now() + budgetMs * CHEAT.SAFE; // vlastný krátky čas poistky (CHEAT.SAFE z rozpočtu kola)
    for (let round = 0; round < 3; round++) {
      let dying = false;
      for (const [k, r] of R.entries()) {
        if ((sol.row[k] ?? 0) <= 0.01) continue;
        if (C.some(c => value.dead(r, c))) dying = true;
        for (const q of ranked.slice(0, CHEAT.CHECK)) {
          if (now() > safeEnd) break;
          if (!C.includes(q) && value.dead(r, q)) { C.push(q); dying = true; }
        }
      }
      if (!dying || now() > safeEnd) break;
      sol = resolve();
      // moja najlepšia odpoveď na novú zmes (z celého poolu, obmedzený počet - napr. štít krytý presne na to melee)
      const colSup = C.map((c, j) => [c, sol.col[j]]).filter(([, p]) => p > 0.01);
      const br = bestResponse(fullR, colSup, vMe, 1, sol.value + 0.005, safeEnd);
      if (!br || R.includes(br)) break;
      R.push(br); sol = resolve();
    }
    let mix = avoidDeath(sol.row, R, C, sol.col, value);
    if (hopeless(sol, R, C, value)) mix = playForChance(R, C, sol.col, value, ranked.slice(0, WIDE));
    const i = sampleMix(mix, rng);
    const r2 = (v) => Math.round(v * 100) / 100;
    log?.({ kind: "spy", ms: Math.round(now() - t0), R: R.length, C: C.length, fits: ranked.length, value: +sol.value.toFixed(3), pick: queueKey(R[i]), sims: stats.sims - sims0 });
    lastWhy = {
      value: r2(sol.value), pick: queueKey(R[i]), p: r2(mix[i]),
      opp: C.map((c, j) => ({ c, p: sol.col[j] ?? 0 })).filter(x => x.p > 0.01).sort((a, b) => b.p - a.p).slice(0, 4).map(x => ({ q: queueKey(x.c), p: r2(x.p) })),
      deadly: C.filter(c => value.dead(R[i], c)).slice(0, 3).map(queueKey),
      spy: { slot: spy.idx + 1, a: actKey(spy.action), used: true, refine: true },
    };
    return R[i];
  }
  let lastCtx = null;
  const roundKey = () => `${belief.view?.series?.gameIndex ?? 1}:${belief.view?.turn}`;

  // ---------- Baby bot (docs/AI_PLAN.md, „Obťažnosť BABY"): z ohodnotených front vyberá mäkko (softmax hodnoty
  // proti súperovej rovnovážnej zmesi), obranu dáva zriedka (max 1 za kolo, penalizovaná - dieťa ho musí vedieť
  // trafiť), démona nevolá, istú výhru často „prehliadne" a tlmí ho skryté vyrovnávanie: čím viac vedie na HP,
  // tým voľnejšie hrá, keď prehráva, pritvrdí (stále mäkko). Hlúpe fronty (o veľa horšie ako najlepšia) nehrá. ----------
  const STAND = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];
  const DEF_TYPES = new Set(["shield", "mirror", "golden_shield", "golden_mirror"]);
  const defs = (q) => q.filter(a => DEF_TYPES.has(a.type)).length;
  function babyPick(R, C, col, value, s0, me, ranked) {
    const lead = s0.players[me].hp - s0.players[other(me)].hp;
    const allowed = (q) => defs(q) <= 1 && !q.some(a => a.type === "last_stand");
    // ležérny ťah: náhodná fronta z lepšej časti predvýberu (priemerná, nie hlúpa) - tým častejšie, čím viac vedie
    if (rng() < clamp(BB.SLOP + BB.SLOP_LEAD * lead, BB.SLOP_MIN, BB.SLOP_MAX)) {
      const top = ranked.slice(0, Math.max(3, Math.ceil(ranked.length * BB.TOP))).filter(allowed);
      if (top.length) return top[Math.floor(rng() * top.length)];
    }
    // nepredvída: hodnota fronty je zmes „proti súperovej rovnováhe" a „proti súperovi, ktorý ostane stáť" (strieľa
    // tam, kde dieťa stojí teraz) - čím viac vedie, tým naivnejšie
    const a = clamp(BB.NAIVE + BB.NAIVE_LEAD * lead, BB.NAIVE_MIN, BB.NAIVE_MAX);
    const vs = R.map(r => (1 - a) * C.reduce((acc, c, j) => acc + (col[j] ?? 0) * value(r, c), 0) + a * value(r, STAND));
    let ok = R.map((r, k) => k).filter(k => allowed(R[k]));
    if (!ok.length) ok = R.map((r, k) => k);
    // istá výhra (zabije aspoň v polovici súperových možností) - s pravdepodobnosťou ju prehliadne
    const kills = (k) => C.filter(c => value.kill(R[k], c)).length >= C.length / 2;
    if (rng() < (lead >= 0 ? BB.MERCY : BB.MERCY_BEHIND)) { const rest = ok.filter(k => !kills(k)); if (rest.length) ok = rest; }
    const score = (k) => vs[k] - BB.DEF_PEN * defs(R[k]);
    const best = Math.max(...ok.map(score));
    ok = ok.filter(k => score(k) >= best - BB.SPREAD);
    const T = clamp(BB.T + BB.T_LEAD * lead, BB.T_MIN, BB.T_MAX);
    const w = ok.map(k => Math.exp((score(k) - best) / T)), tot = w.reduce((a, b) => a + b, 0);
    let r = rng() * tot;
    for (let n = 0; n < ok.length; n++) { r -= w[n]; if (r <= 0) return R[ok[n]]; }
    return R[ok[ok.length - 1]];
  }

  // ---------- citlivosť na smrť: fronta, po ktorej ma niektorý súperov plán v matici zabije, sa nehrá,
  // ak existuje bezpečná (útočná či obranná) fronta, ktorá je proti súperovej zmesi najviac o MARGIN horšia;
  // jej váha prejde na najlepšiu bezpečnú frontu ----------
  const DEATH = -0.99, MARGIN = 0.3;
  function avoidDeath(mix, R, C, col, value) {
    const dies = R.map(r => C.some(c => value.dead(r, c)));
    if (!mix.some((p, k) => p > 0 && dies[k])) return mix;
    const vs = R.map(r => C.reduce((s, c, j) => s + (col[j] ?? 0) * value(r, c), 0));
    let best = -1;
    for (let k = 0; k < R.length; k++) if (!dies[k] && (best < 0 || vs[k] > vs[best])) best = k;
    if (best < 0) return mix;
    const out = R.map((r, k) => mix[k] ?? 0);
    for (let k = 0; k < R.length; k++) {
      if (!dies[k] || !out[k] || vs[best] < vs[k] - MARGIN) continue;
      out[best] += out[k]; out[k] = 0;
    }
    return out;
  }

  // ---------- prehrané kolo: hra na šancu ----------
  // „Prehraté" = proti dokonalému súperovi zomriem: hodnota rovnováhy ~ −1, alebo (turnaj - prehra hry tam nie je −1)
  // každú moju frontu niektorá súperova v matici zabije. Rovnovážna zmes je vtedy bezcenná (všetky riadky sú rovnako
  // −1, regret matching vráti ľubovoľnú zmes a predtým priemer cez maticu - samé zabijacie stĺpce - vybral 1. riadok,
  // čo vyzeralo ako náhodný ťah). Človek zabijací ťah často nenájde → hraj frontu, ktorá je najlepšia proti ŠIROKEJ
  // vzorke rozumných súperových front (stĺpce matice + ľudské plány + najlepšie z predvýberu), aby súper musel trafiť
  // čo najpresnejšiu odpoveď. Remíza → lepšia proti rovnovážnej zmesi súpera.
  const WIDE = 24;
  function hopeless(sol, R, C, value) {
    if (!R.length || !C.length) return false;
    return sol.value <= -0.9 || R.every(r => C.some(c => value.dead(r, c)));
  }
  function playForChance(R, C, col, value, extra) {
    const cols = [...new Set([...C, ...extra])];
    const eq = (r) => C.reduce((acc, c, j) => acc + (col[j] ?? 0) * value(r, c), 0);
    let bi = 0, bv = -Infinity, be = -Infinity;
    R.forEach((r, k) => {
      const v = cols.reduce((acc, c) => acc + value(r, c), 0) / cols.length;
      if (v > bv + 1e-9 || (v > bv - 1e-9 && eq(r) > be)) { bv = v; bi = k; be = eq(r); }
    });
    return R.map((r, k) => (k === bi ? 1 : 0));
  }

  // ---------- THE WORLD (bot = Jotaro): súper je zmrazený → jednostranná optimalizácia ----------
  // Pohľad počas pauzy nenesie zvyšok kola (súperove zostávajúce akcie sú pre bota skryté, ako pre človeka):
  // aproximácia = skutočné THE WORLD v engine (zachytená súperova obrana platí na SÚČET zmrazených zásahov -
  // nabitý mirror odrazí celý súčet na Jotara, štít ho celý zablokuje) a zvyšok kola sa už neodohrá
  // (syntetický roundCtx s i = 3 → po obnovení času hneď finishRound). Predtým: kolo so skameneným súperom,
  // kde súperov mirror „spotreboval" už prvý zmrazený recharge a bot potom strieľal do zrkadla.
  function decideTimestop() {
    const t0 = now(), deadline = t0 + Math.min(budgetMs, 4000);
    const me = belief.mySlot, opp = other(me);
    const st = simState(belief, rng);
    const foe = st.players[opp];
    st.timestop = {
      slot: me, foeSlot: opp,
      foeShield: !!foe.shield, foeShieldGold: !!foe.shieldGold,
      foeMirror: !!foe.mirror, foeMirrorGold: !!foe.mirrorGold,
      hits: [], cloneEvents: [], shrekHits: [], mode: "waiting",
    };
    st.roundCtx = {
      tl: [], order: [me, opp], i: 3, slotIdx: 0, ended: false,
      stonedStep: { p1: false, p2: false }, tookStoned: { p1: false, p2: false },
      charInfo: {}, doomSlot: null, second: opp, emittedUpTo: 0,
    };
    const eng = tsSim.engine;
    const play = (q) => {
      eng.loadState(cloneData(st), seededRng(1));
      let ok = false;
      eng.timestopActions(me === "p1" ? "A" : "B", q, (r) => { ok = !!r?.ok; });
      return ok ? eng.game : null;
    };
    let best = null, bestV = -Infinity;
    const tried = new Set();
    // keď čas nestačí na všetky: najprv trojice so zásahom (útok / melee / Special 1)
    const dmg = (q) => q.some(x => x.type === "attack" || x.type === "melee" || x.type === "special1") ? 0 : 1;
    const all = shuffle(allFrozen(st, me)).sort((x, y) => dmg(x) - dmg(y));
    for (const q of all) {
      if (now() > deadline) break;
      tried.add(queueKey(q));
      const res = play(q);
      stats.sims++;
      if (!res) continue;
      const v = evaluate(res, me, weights);
      if (v > bestV) { bestV = v; best = q; }
    }
    log?.({ kind: "timestop", ms: Math.round(now() - t0), tried: tried.size, of: all.length, pick: best && queueKey(best) });
    return best || [{ type: "recharge" }, { type: "shield" }, { type: "move", dir: "up" }];
  }

  // ---------- výber postavy (slepý, ako pre človeka) ----------
  function decideCharacter() {
    const me = belief.mySlot;
    if (belief.view?.config?.format === "tournament" && belief.view.roster?.[me]) return decideMage();
    return pick(charPool());
  }
  // postavy, ktoré smiem hrať (moja strana, bez zakázaných - BANNED CHARACTERS sú verejné v configu)
  function charPool() {
    const me = belief.mySlot;
    const banned = belief.view?.config?.bans?.[me] || [];
    return [...CHARS, ...Object.keys(SIDE_CHARS).filter(k => SIDE_CHARS[k] === me)].filter(k => !banned.includes(k));
  }
  // turnajový draft: úplne náhodný tím (vlastník 2026-11-03)
  function decideTeam() {
    const pool = charPool(), team = [];
    while (team.length < TEAM_SIZE && pool.length) team.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return team;
  }
  // turnaj: ktorého maga nasadiť do hry (naslepo - súperov výber nevidím). Overená stratégia nie je (vlastník),
  // zlé možnosti áno: mág bez many do hry, ktorú otváram ako druhý (nemá ani na štít). Inak hodnota štartového
  // stavu proti každému súperovmu živému magovi (eval hry × sila tímov po nej - series.js): counter na súperove
  // postavy, veľa many, keď idem prvý a súperovi ostali mágovia s malou manou; čo najlepšia lavička.
  // Mierna náhoda (softmax), nech sa výber nedá prečítať.
  function decideMage() {
    const v = belief.view, me = belief.mySlot, opp = other(me);
    const banned = v.config?.bans?.[me] || [];
    const myHp = v.mageHp || v.rosterHp?.[me] || {}, myMana = v.mageMana || v.rosterMana?.[me] || {};
    let alive = v.roster[me].filter(k => (myHp[k] ?? 0) > 0 && !banned.includes(k));
    if (alive.length <= 1) return alive[0] ?? v.roster[me][0];
    const gameIndex = v.series?.gameIndex ?? 1;
    const starter = gameIndex % 2 === 1 ? "p1" : "p2";
    if (starter !== me) {
      const ok = alive.filter(k => (myMana[k] ?? 0) >= SHIELD_COST);
      if (ok.length) alive = ok;
    }
    const foes = (v.roster[opp] || []).filter(k => (v.rosterHp?.[opp]?.[k] ?? 0) > 0);
    const deploy = (p, k, hp, mana) => {
      p.char = k; p.hp = hp; p.mana = mana; p.pride = 0; p.moon = k === "werewolf" ? moonLevelFor(hp) : 0;
      p.worldUsed = false; p.clone = null; p.trap = null;
    };
    const score = alive.map(k => {
      let s = 0;
      for (const f of foes.length ? foes : [null]) {
        const st = simState(belief, rng);
        st.starter = starter; st.turn = 1;
        deploy(st.players[me], k, myHp[k], myMana[k] ?? 0);
        if (f) {
          deploy(st.players[opp], f, v.rosterHp[opp][f], v.rosterMana?.[opp]?.[f] ?? 5);
        }
        s += seriesValue(st, me, f ? evaluate(st, me, weights) : 0);
      }
      return s / (foes.length || 1);
    });
    const best = Math.max(...score), T = 0.04;
    const w = score.map(x => Math.exp((x - best) / T)), tot = w.reduce((a, b) => a + b, 0);
    let r = rng() * tot;
    for (let i = 0; i < alive.length; i++) { r -= w[i]; if (r <= 0) return alive[i]; }
    return alive[alive.length - 1];
  }

  function decide({ spy = null } = {}) {
    const kind = decisionKind(belief);
    if (!kind) return null;
    stats.decisions++;
    if (kind === "character") return { kind, char: decideCharacter() };
    if (kind === "team") return { kind, team: decideTeam() };
    if (kind === "timestop") return { kind, queue: decideTimestop() };
    lastWhy = null;
    // CHEATER s odhalenou akciou: dopočet nad výpočtom z plánovania; keď ho niet, celé kolo znova so zúžením
    const queue = cheater && spy ? (refineRound(spy) || decideRound(spy)) : decideRound(null);
    if (cheater && spy) lastCtx = null;
    return { kind, queue, ...(lastWhy ? { why: lastWhy } : {}) };
  }

  return {
    onYouAre: belief.onYouAre, onState: belief.onState, onNewGame: belief.onNewGame,
    decide, belief, stats, setLevel,
  };
}
