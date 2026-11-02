// engine/ai/candidates.js - všetky rozumné fronty jedného hráča v danom stave (docs/AI_PLAN.md 3.2).
// Postavy nepozná: tvar argumentov každej akcie (bez argumentu / smer / bunka) zistí cez engine validQueue,
// takže nové postavy a akcie pokryje automaticky. Odfiltruje fronty, ktoré by si nemohli dovoliť manu
// (akcia by sa prečiarkla - vždy horšia než tá istá fronta bez nej), pass (stojí manu, nič nerobí) a akcie
// „do steny" (pohyb / dash / útok / special mimo dosky - engine ich vykoná ako náraz bez účinku; pre človeka
// vyzerajú hlúpo a útok či special pri tom minie manu). Náraz sa zisťuje simuláciou jednej akcie z danej bunky
// (efekt wall_bump alebo offboard), výsledok sa cachuje podľa bunky a akcie.
import {
  BASIC_COST, MELEE_COST, DASH_COST, RECHARGE_GAIN, SHIELD_COST, MIRROR_COST, SPECIAL_COST,
  GOLDEN_COST, GOLDEN_MIRROR_COST, DEMON_COST, JOTARO_S1_COST, LUFFY_S1_COST, MAX_MANA,
} from "../../shared/balance.js";
import { DEFENSE_SLOT, cloneData, seededRng } from "../constants.js";

const DIRS = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];
const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror", "special1", "shield_breaker", "mirror_breaker", "demon"];
const COST = {
  move: 0, dash: DASH_COST, recharge: -RECHARGE_GAIN, attack: BASIC_COST, melee: MELEE_COST, special: SPECIAL_COST,
  shield: SHIELD_COST, mirror: MIRROR_COST, shield_breaker: SHIELD_COST, mirror_breaker: MIRROR_COST, demon: DEMON_COST,
};
const S1_COST = { jotaro: JOTARO_S1_COST, luffy: LUFFY_S1_COST };

// varianty argumentov jednej akcie, ktoré engine pripustí (na začiatku fronty, zvyšok pass)
export function actionOptions(sim, state, slot, prefix, cells) {
  const fill = (a) => {
    const q = [...prefix, a];
    while (q.length < 3) q.push({ type: "pass" });
    return q;
  };
  const opts = [];
  for (const type of TYPES) {
    if (sim.valid(state, slot, fill({ type }))) { opts.push({ type }); continue; }
    const dirs = DIRS.filter(dir => sim.valid(state, slot, fill({ type, dir })));
    if (dirs.length) { for (const dir of dirs) opts.push({ type, dir }); continue; }
    // cieľová bunka: platnosť závisí od pozície v čase akcie → ponúkni všetky, celú frontu overí validQueue
    if (cells.some(cell => sim.valid(state, slot, fill({ type, cell })))) for (const cell of cells) opts.push({ type, cell });
  }
  return opts;
}

export const actionCost = (a, char) => (a.type === "special1" ? (S1_COST[char] ?? 4) : (COST[a.type] ?? 0));

// stačí mana na každú akciu v poradí? (golden predťah platí pred frontou)
function affordable(q, mana, char, pre = 0) {
  let m = mana - pre;
  if (m < 0) return false;
  for (const a of q) {
    if (a.type === "stoned") continue;
    const c = actionCost(a, char);
    if (c > 0 && m < c) return false;
    m = Math.min(MAX_MANA, m - c);
  }
  return true;
}

const keyOf = (a) => a.type + (a.dir ? ":" + a.dir : "") + (a.cell ? `@${a.cell.x},${a.cell.y}` : "");

// sonda: jedna akcia z bunky (x, y) → { wall, x, y } (náraz do steny? kde figúra skončí); súper len čaká
function makeProbe(sim, state, slot) {
  const cache = new Map(), opp = slot === "p1" ? "p2" : "p1";
  const oppStone = Math.min(3, state.players[opp].stone || 0);
  const oppQ = Array.from({ length: 3 }, (_, i) => ({ type: i < oppStone ? "stoned" : "pass" }));
  return (x, y, a) => {
    const key = `${x},${y},${keyOf(a)}`;
    if (cache.has(key)) return cache.get(key);
    const st = cloneData(state), me = st.players[slot];
    me.x = x; me.y = y; me.mana = MAX_MANA; me.stone = 0; me.clone = null; // len hlavná figúra
    const res = sim.play(st, { [slot]: [a, { type: "pass" }, { type: "pass" }], [opp]: oppQ }, seededRng(1));
    let out = { wall: false, x, y };
    if (res) {
      const wall = sim.lastTimeline().some(f => (f.effects || []).some(e => e.from === slot
        && ((e.kind === "wall_bump" && !e.clone) || e.offboard)));
      out = { wall, x: res.players[slot].x, y: res.players[slot].y };
    }
    cache.set(key, out);
    return out;
  };
}

// základné fronty (3 akcie, bez golden doplnkov)
export function baseQueues(sim, state, slot) {
  const p = state.players[slot];
  const stone = Math.min(3, p.stone || 0);
  const prefix = Array.from({ length: stone }, () => ({ type: "stoned" }));
  if (stone >= 3) return [prefix];
  const cells = [];
  for (let y = 0; y < state.board.h; y++) for (let x = 0; x < state.board.w; x++) cells.push({ x, y });
  const opts = actionOptions(sim, state, slot, prefix, cells);
  const probe = makeProbe(sim, state, slot);
  const out = [];
  const free = 3 - stone;
  const rec = (q, used, x, y) => {
    if (q.length === free) {
      const full = [...prefix, ...q];
      if (affordable(q, p.mana, p.char) && sim.valid(state, slot, full)) out.push(full);
      return;
    }
    for (const a of opts) {
      if (used.has(a.type) || (DEFENSE_SLOT[a.type] && used.has("def:" + DEFENSE_SLOT[a.type]))) continue;
      const r = probe(x, y, a);
      if (r.wall) continue; // akcia do steny z tejto bunky
      const u = new Set(used); u.add(a.type); if (DEFENSE_SLOT[a.type]) u.add("def:" + DEFENSE_SLOT[a.type]);
      rec([...q, a], u, r.x, r.y);
    }
  };
  rec([], new Set(), p.x, p.y);
  return out;
}

// golden doplnky k základnej fronte: predťah (golden shield/mirror, len nie-startér), last_hope (final kolo),
// koncová golden mana / last stand - vráti len platné a zaplatiteľné varianty (bez samotnej základnej fronty)
export function extraVariants(sim, state, slot, base) {
  const p = state.players[slot];
  const out = [];
  const pres = [[null, 0], [{ type: "golden_shield" }, GOLDEN_COST], [{ type: "golden_mirror" }, GOLDEN_MIRROR_COST]];
  const tails = [null, { type: "golden_mana" }, { type: "last_stand" }];
  const hopes = [null, { type: "last_hope" }];
  for (const hope of hopes) for (const [pre, preCost] of pres) for (const tail of tails) {
    if (!hope && !pre && !tail) continue;
    // golden mana stojí (refills + 1) HP - nesmie zabiť (engine by ju odmietol)
    if (tail?.type === "golden_mana" && p.hp <= (p.manaRefills || 0) + 1) continue;
    const q = [...(hope ? [hope] : []), ...(pre ? [pre] : []), ...base, ...(tail ? [tail] : [])];
    // Last Hope dá 10 many pred golden predťahom
    const mana = hope ? MAX_MANA : p.mana;
    if (!affordable(base, mana, p.char, preCost)) continue;
    if (sim.valid(state, slot, q)) out.push(q);
  }
  return out;
}

// stabilný kľúč fronty (deduplikácia, model súpera)
export const queueKey = (q) => q.map(a => a.type + (a.dir ? ":" + a.dir : "") + (a.cell ? `@${a.cell.x},${a.cell.y}` : "")).join(" ");
