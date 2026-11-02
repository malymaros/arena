// engine/ai/eval.js - hodnota stavu po kole z pohľadu bota (docs/AI_PLAN.md 3.3): výhra +1, prehra −1, inak
// tanh(w · features) ≈ odhad (2·P(výhra) − 1). Váhy sa ladia self-play-om (tools/ai-tune.mjs, fáza A3);
// DEFAULT_WEIGHTS sú ručný štart. Features sú generické (bez vetiev na mená postáv okrem jednorazových
// specialov), aby pokryli aj nové postavy.
const other = (s) => (s === "p1" ? "p2" : "p1");
const ONCE = new Set(["jotaro", "luffy"]); // jednorazový special za hru (worldUsed)

export const FEATURES = [
  "hp", "lowHp", "mana", "specialReady", "doom", "lastBuff", "mazeBuff", "hazard", "level", "clone", "stone",
  "cursed", "onceLeft", "nextStarter", "trap", "distance",
];

export const DEFAULT_WEIGHTS = {
  hp: 2.0, lowHp: -0.3, mana: 0.5, specialReady: 0.15, doom: -1.2, lastBuff: 0.3, mazeBuff: 0.3, hazard: -0.4,
  level: 0.25, clone: 0.25, stone: -0.25, cursed: -0.4, onceLeft: 0.3, nextStarter: 0.05, trap: 0.15, distance: 0,
  // Last Stand doom: o hre rozhodne jediné záverečné kolo (démon vs Last Hope) - bežné features tam neplatia;
  // hodnota pre hráča s doomom (tanh), ladí sa self-play-om
  doomBase: -0.6,
};

function hazard(state, p) {
  if (p.x === null || p.x === undefined) return 0;
  let h = 0;
  if (state.iks.some(c => c.x === p.x && c.y === p.y)) h += 1;
  if (state.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) h += 0.2;
  return h;
}

// rozdiel (ja − súper) pre každú feature, škála ~[-1, 1]
export function features(state, me) {
  const a = state.players[me], b = state.players[other(me)];
  const d = (fa, fb) => fa - fb;
  const lvl = (p) => (p.pride || 0) / 3 + (p.moon || 0) / 3;
  return {
    hp: d(a.hp, b.hp) / 10,
    lowHp: d(a.hp <= 4 ? 1 : 0, b.hp <= 4 ? 1 : 0),
    mana: d(a.mana, b.mana) / 10,
    specialReady: d(a.mana >= 5 ? 1 : 0, b.mana >= 5 ? 1 : 0),
    doom: d(a.lastStandDoom ? 1 : 0, b.lastStandDoom ? 1 : 0),
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
    distance: (a.x === null || b.x === null || a.x === undefined || b.x === undefined) ? 0 : (Math.abs(a.x - b.x) + Math.abs(a.y - b.y)) / 5,
  };
}

export function evaluate(state, me, w = DEFAULT_WEIGHTS) {
  const a = state.players[me], b = state.players[other(me)];
  if (b.hp <= 0 && a.hp > 0) return 1;
  if (a.hp <= 0 && b.hp > 0) return -1;
  if (a.hp <= 0 && b.hp <= 0) return 0;
  if (a.lastStandDoom !== b.lastStandDoom) return Math.tanh((w.doomBase || 0)) * (a.lastStandDoom ? 1 : -1);
  const f = features(state, me);
  let s = 0;
  for (const k of FEATURES) s += (w[k] || 0) * f[k];
  return Math.tanh(s);
}
