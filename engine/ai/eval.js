// engine/ai/eval.js - hodnota stavu po kole z pohľadu bota (docs/AI_PLAN.md 3.3): výhra +1, prehra −1, inak
// tanh(w · features) ≈ odhad (2·P(výhra) − 1). Váhy (engine/ai/weights.js) ladí self-play tools/ai-tune.mjs
// logistickou regresiou na výsledkoch zápasov. Features sú rozdiely (ja − súper): všeobecné (HP, mana,
// statusy…) + per postava (bias postavy a jej vzťah k súperovej polohe - rovnaký riadok / stĺpec / bunka,
// diagonálny / ortogonálny sused, vzdialenosť), lebo hodnota polohy závisí od kitu.
import { CHARS, SIDE_CHARS } from "../constants.js";
import { WEIGHTS } from "./weights.js";

const other = (s) => (s === "p1" ? "p2" : "p1");
const ONCE = new Set(["jotaro", "luffy"]); // jednorazový special za hru (worldUsed)
export const ALL_CHARS = [...CHARS, ...Object.keys(SIDE_CHARS)];
const REL = ["row", "col", "cell", "diag", "ortho", "dist"];

const BASE = [
  "hp", "hp2", "lowHp", "mana", "specialReady", "lastBuff", "mazeBuff", "hazard", "level", "clone", "stone",
  "cursed", "onceLeft", "nextStarter", "trap", "distance",
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
  if (state.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) h += 0.2;
  return h;
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
