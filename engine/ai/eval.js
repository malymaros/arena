// engine/ai/eval.js - hodnota stavu po kole z pohľadu bota (docs/AI_PLAN.md 3.3): výhra +1, prehra −1, inak
// tanh(w · features) ≈ odhad (2·P(výhra) − 1). Váhy (engine/ai/weights.js) ladí self-play tools/ai-tune.mjs
// logistickou regresiou na výsledkoch zápasov. Features sú rozdiely (ja − súper): všeobecné (HP, mana,
// statusy…) + per postava (bias postavy a jej vzťah k súperovej polohe - rovnaký riadok / stĺpec / bunka,
// diagonálny / ortogonálny sused, vzdialenosť), lebo hodnota polohy závisí od kitu.
import { CHARS, SIDE_CHARS } from "../constants.js";
import { WEIGHTS } from "./weights.js";
import { bestHit, reach } from "./threat.js";

const other = (s) => (s === "p1" ? "p2" : "p1");
const ONCE = new Set(["jotaro", "luffy"]); // jednorazový special za hru (worldUsed)
export const ALL_CHARS = [...CHARS, ...Object.keys(SIDE_CHARS)];
const REL = ["row", "col", "cell", "diag", "ortho", "dist"];

const BASE = [
  "hp", "hp2", "lowHp", "mana", "specialReady", "lastBuff", "mazeBuff", "hazard", "level", "clone", "stone",
  "cursed", "onceLeft", "nextStarter", "trap", "distance",
  // taktika budúceho kola (docs/AI_PLAN.md 9): hrozba, smrteľnosť, zásahy do smrti, dosah, únik, políčka
  "threat", "lethal", "hits", "coverage", "safe", "pickup", "manaOpt", "starterPress",
];
export const FEATURES = [
  ...BASE,
  ...ALL_CHARS.map(c => "char:" + c),
  ...ALL_CHARS.flatMap(c => REL.map(r => `${r}:${c}`)),
];
// Last Stand doom: o hre rozhodne jediné záverečné kolo (démon vs Last Hope) - bežné features tam neplatia;
// vlastný malý model z pohľadu hráča s doomom
export const DOOM_FEATURES = ["doomBase", "doomOppHp", "doomOppMana", "doomSameCell"];

function hazard(state, p) {
  if (p.x === null || p.x === undefined) return 0;
  let h = 0;
  if (state.iks.some(c => c.x === p.x && c.y === p.y)) h += 1;
  // dmg políčko: súper vie, že sa musím pohnúť (čitateľnosť) - okrem Fira so specialom (políčko mu rozšíri zónu)
  if (state.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y) && !(p.char === "fire" && p.mana >= 5)) h += 0.5;
  return h;
}

const hidden = (p) => p.x === null || p.x === undefined;
const SPECIAL_MANA = 5;

// zlá bunka na ďalšie kolo: IK alebo dmg políčko (Fire so specialom ho chce)
function badCell(state, c, p) {
  if (state.iks.some(t => t.x === c.x && t.y === c.y)) return true;
  return state.tiles.some(t => t.type === "dmg" && t.x === c.x && t.y === c.y) && !(p.char === "fire" && p.mana >= SPECIAL_MANA);
}

// pohľad hráča `a` (slot sa) proti súperovi `b` na budúce kolo (docs/AI_PLAN.md 9)
// pozičná časť (bez dlaždíc) - cache podľa postáv, levelov, buniek a many oboch (eval beží tisíckrát za ťah)
const posCache = new Map();
function positional(state, sa, a, b) {
  const key = `${sa}|${a.char}|${a.pride || 0}|${a.moon || 0}|${a.worldUsed ? 1 : 0}|${a.x},${a.y},${a.mana}|${b.x},${b.y},${b.mana}|${state.board.w}x${state.board.h}`;
  let v = posCache.get(key);
  if (v) return v;
  const near = reach(state, a, a.mana, false);         // odkiaľ útočím (pohyb + útok)
  let onFoe = 0, kit = 0;
  for (const c of near) {
    onFoe = Math.max(onFoe, bestHit(state, sa, c, b, a.mana));
    for (let y = 0; y < state.board.h; y++) for (let x = 0; x < state.board.w; x++)
      kit = Math.max(kit, bestHit(state, sa, c, { x, y }, a.mana));
  }
  const foeReach = reach(state, b, b.mana);
  const cover = foeReach.filter(c => bestHit(state, sa, a, c, a.mana) > 0).length / foeReach.length;
  v = { onFoe, kit: Math.max(1, kit), cover };
  if (posCache.size > 200000) posCache.clear();
  posCache.set(key, v);
  return v;
}

function sideView(state, sa, a, b) {
  const far = reach(state, a, a.mana);                 // kam uniknem (aj dash)
  const safe = far.filter(c => !badCell(state, c, a)).length;
  return { ...positional(state, sa, a, b), safe, far };
}

// cena políčka na dosah podľa potreby (heal: posunie ma o zásah ďalej od smrti; Lightning sa lieči do plna;
// Werewolf heal nechce - malé HP = vyšší dmg; mana: hlavne pri malej mane)
function pickupValue(state, p, foeKit, cells) {
  let best = 0;
  for (const t of state.tiles) {
    const c = cells.find(r => r.x === t.x && r.y === t.y);
    if (!c) continue;
    let need = 0;
    if (t.type === "heal" && p.hp < 10) {
      if (p.char === "lightning") need = Math.min(1, (10 - p.hp) / 5);
      else if (p.char !== "werewolf") need = Math.ceil((p.hp + 1) / foeKit) > Math.ceil(p.hp / foeKit) ? 1 : 0.25;
    } else if (t.type === "mana" && p.mana < 10) need = p.mana < SPECIAL_MANA ? 0.3 + (SPECIAL_MANA - p.mana) / SPECIAL_MANA * 0.7 : 0.1;
    else if (t.type === "power" && p.mana >= 1) need = 0.3;
    best = Math.max(best, need * (c.cost === 2 ? 0.6 : 1));
  }
  return best;
}

const manaTiers = (m) => ((m >= 1) + (m >= 2) + (m >= 4) + (m >= 5)) / 4;

function tactical(state, me) {
  const op = other(me), a = state.players[me], b = state.players[op];
  const z = { threat: 0, lethal: 0, hits: 0, coverage: 0, safe: 0, pickup: 0 };
  if (hidden(a) || hidden(b) || !a.char || !b.char) return z;
  const A = sideView(state, me, a, b), B = sideView(state, op, b, a);
  const hitsA = Math.ceil(a.hp / B.kit), hitsB = Math.ceil(b.hp / A.kit); // koľko zásahov do smrti
  return {
    threat: Math.min(1, A.onFoe / b.hp) - Math.min(1, B.onFoe / a.hp),
    lethal: (A.onFoe >= b.hp ? 1 : 0) - (B.onFoe >= a.hp ? 1 : 0),
    hits: Math.max(-1, Math.min(1, (hitsA - hitsB) / 3)),
    coverage: A.cover - B.cover,
    safe: (Math.min(4, A.safe) - Math.min(4, B.safe)) / 4,
    pickup: pickupValue(state, a, B.kit, A.far) - pickupValue(state, b, A.kit, B.far),
  };
}

// vzťah polôh dvoch figúr (symetrický) - null, ak je niektorá skrytá
function relation(a, b) {
  if (a.x === null || b.x === null || a.x === undefined || b.x === undefined) return null;
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return {
    row: dy === 0 ? 1 : 0, col: dx === 0 ? 1 : 0, cell: dx === 0 && dy === 0 ? 1 : 0,
    diag: dx === 1 && dy === 1 ? 1 : 0, ortho: dx + dy === 1 ? 1 : 0, dist: (dx + dy) / 5,
  };
}

// rozdiel (ja − súper) pre každú feature, škála ~[-1, 1]
export function features(state, me) {
  const a = state.players[me], b = state.players[other(me)];
  const d = (fa, fb) => fa - fb;
  const lvl = (p) => (p.pride || 0) / 3 + (p.moon || 0) / 3;
  const rel = relation(a, b);
  const f = {
    hp: d(a.hp, b.hp) / 10,
    hp2: d(a.hp * a.hp, b.hp * b.hp) / 100,
    lowHp: d(a.hp <= 4 ? 1 : 0, b.hp <= 4 ? 1 : 0),
    mana: d(a.mana, b.mana) / 10,
    specialReady: d(a.mana >= 5 ? 1 : 0, b.mana >= 5 ? 1 : 0),
    lastBuff: d(a.lastStandBuff || a.lastHopeBuff ? 1 : 0, b.lastStandBuff || b.lastHopeBuff ? 1 : 0),
    mazeBuff: d(a.mazeBuff ? 1 : 0, b.mazeBuff ? 1 : 0),
    hazard: d(hazard(state, a), hazard(state, b)),
    level: d(lvl(a), lvl(b)),
    clone: d(a.clone ? 1 : 0, b.clone ? 1 : 0),
    stone: d(a.stone || 0, b.stone || 0) / 2,
    cursed: d(a.labyrinth ? 1 : 0, b.labyrinth ? 1 : 0),
    onceLeft: d(ONCE.has(a.char) && !a.worldUsed ? 1 : 0, ONCE.has(b.char) && !b.worldUsed ? 1 : 0),
    nextStarter: state.starter === me ? 1 : -1,
    trap: d(a.trap ? 1 : 0, b.trap ? 1 : 0),
    distance: rel ? rel.dist : 0,
    ...tactical(state, me),
    manaOpt: d(manaTiers(a.mana), manaTiers(b.mana)),
    starterPress: (state.starter === me && b.mana < 4 ? 1 : 0) - (state.starter !== me && a.mana < 4 ? 1 : 0),
  };
  for (const c of ALL_CHARS) {
    const sa = a.char === c ? 1 : 0, sb = b.char === c ? 1 : 0;
    f["char:" + c] = sa - sb;
    for (const r of REL) f[`${r}:${c}`] = rel && sa !== sb ? (sa - sb) * rel[r] : 0;
  }
  return f;
}

// features doom stavu z pohľadu hráča s doomom
export function doomFeatures(state, doomSlot) {
  const a = state.players[doomSlot], b = state.players[other(doomSlot)];
  const rel = relation(a, b);
  return { doomBase: 1, doomOppHp: b.hp / 10, doomOppMana: b.mana / 10, doomSameCell: rel?.cell ? 1 : 0 };
}

export function evaluate(state, me, w = WEIGHTS) {
  const a = state.players[me], b = state.players[other(me)];
  if (b.hp <= 0 && a.hp > 0) return 1;
  if (a.hp <= 0 && b.hp > 0) return -1;
  if (a.hp <= 0 && b.hp <= 0) return 0;
  if (a.lastStandDoom !== b.lastStandDoom) {
    const ds = a.lastStandDoom ? me : other(me), df = doomFeatures(state, ds);
    let s = 0;
    for (const k of DOOM_FEATURES) s += (w[k] || 0) * df[k];
    return Math.tanh(s) * (ds === me ? 1 : -1);
  }
  const f = features(state, me);
  let s = 0;
  for (const k of FEATURES) s += (w[k] || 0) * f[k];
  return Math.tanh(s);
}
