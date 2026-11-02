// engine/ai/threat.js - „čo mi súper vie dať" (docs/AI_PLAN.md 9): mapy zásahov postáv zistené sondami na engine.
// Postavy nepozná: pre útočníka na bunke `from` odsimuluje každú útočnú akciu (attack / melee / special / special1 /
// dash = charge) proti obrancovi na každej bunke a zapíše dmg + cenu many. Status (kameň, labyrint) sa ráta ako
// dmg-ekvivalent. Bunka, na ktorú sa nedá mieriť, kým na nej súper stojí (Soldier), sa skúsi aj so súperom, ktorý
// na ňu práve vkročí. Výsledok sa cachuje podľa postavy + levelov (pride / mesiac / worldUsed) a bunky - globálne,
// lebo nezávisí od zápasu (čistá doska bez dlaždíc). Sondy sa nerátajú do rozpočtu simulácií bota.
import { createSim } from "./sim.js";
import { actionOptions, actionCost } from "./candidates.js";
import { cloneData, seededRng } from "../constants.js";
import { RECHARGE_GAIN, MAX_MANA } from "../../shared/balance.js";

const ATTACKS = new Set(["attack", "melee", "special", "special1", "dash"]);
const STATUS_DMG = 3; // kameň / labyrint ≈ 3 dmg (súper príde o akcie / o prehľad)
const ORTHO = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const other = (s) => (s === "p1" ? "p2" : "p1");

let sim = null;
const maps = new Map(), acts = new Map();
export const actKey = (a) => a.type + (a.dir ? ":" + a.dir : "") + (a.cell ? `@${a.cell.x},${a.cell.y}` : "");

const levelKey = (p) => `${p.char}|${p.pride || 0}|${p.moon || 0}|${p.worldUsed ? 1 : 0}`;

// čistá doska: bez dlaždíc, portálov, Shreka, itemov; obaja plné HP/mana, bez statusov a obrán
function cleanState(state, slot, from) {
  const st = cloneData(state);
  st.tiles = []; st.iks = []; st.items = []; st.portals = []; st.shrek = null;
  st.pending = { ikMoves: [], spawns: [] };
  st.roundCtx = null; st.timestop = null;
  st.seats = { p1: "A", p2: "B" }; // sim.js hrá p1 = A, p2 = B
  for (const s of ["p1", "p2"]) {
    const p = st.players[s];
    Object.assign(p, {
      hp: 10, mana: MAX_MANA, stone: 0, clone: null, trap: null, labyrinth: false, labReveal: false, mazeBuff: false,
      thread: [], threadMark: null, shield: false, shieldGold: false, mirror: false, mirrorGold: false,
      lastStandBuff: false, lastStandDoom: false, lastHopeBuff: false, down: false, prideHit: false,
    });
  }
  st.players[slot].x = from.x; st.players[slot].y = from.y;
  return st;
}

function measure(st, slot, a, def, defQ) {
  const opp = other(slot);
  const res = sim.play(st, { [slot]: [a, { type: "pass" }, { type: "pass" }], [opp]: defQ }, seededRng(1));
  if (!res) return null;
  const d = res.players[opp], me = res.players[slot];
  let dmg = Math.max(0, 10 - d.hp);
  const petrified = sim.lastTimeline().some(f => (f.effects || []).some(e => e.kind === "petrify" && e.target === opp));
  if (petrified || d.labyrinth) dmg += STATUS_DMG;
  return { dmg, cost: actionCost(a, me.char), def };
}

// mapa zásahov: pole podľa indexu bunky (y * w + x) → [{ dmg, cost }] (len akcie s dmg > 0)
export function hitMap(state, slot, from) {
  const p = state.players[slot];
  const { w, h } = state.board;
  const key = `${levelKey(p)}|${slot}|${w}x${h}|${from.x},${from.y}`;
  const hit = maps.get(key);
  if (hit) return hit;
  sim ??= createSim();
  const opp = other(slot);
  const cells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push({ x, y });
  const base = cleanState(state, slot, from);
  // obranca mimo dosahu pri zisťovaní tvaru akcií (bunka najďalej od útočníka)
  const far = cells.reduce((b, c) => (Math.abs(c.x - from.x) + Math.abs(c.y - from.y) > Math.abs(b.x - from.x) + Math.abs(b.y - from.y) ? c : b));
  base.players[opp].x = far.x; base.players[opp].y = far.y;
  const opts = actionOptions(sim, base, slot, [], cells).filter(a => ATTACKS.has(a.type));
  const pass3 = [{ type: "pass" }, { type: "pass" }, { type: "pass" }];
  const out = cells.map(() => []);
  const byAct = new Map(opts.map(a => [actKey(a), new Array(cells.length).fill(0)]));
  for (const t of cells) {
    const best = new Map(); // cena → max dmg (stačí najlepší zásah za každú cenu)
    const add = (r) => { if (r && r.dmg > 0 && (best.get(r.cost) ?? 0) < r.dmg) best.set(r.cost, r.dmg); };
    for (const a of opts) {
      const st = cloneData(base);
      st.players[opp].x = t.x; st.players[opp].y = t.y;
      st.starter = slot;
      const r = measure(st, slot, a, t, pass3);
      if (r) { add(r); byAct.get(actKey(a))[t.y * w + t.x] = r.dmg; continue; }
      // akcia neplatná, kým tam súper stojí → súper na bunku práve vkročí (začína kolo)
      for (const [dir, [dx, dy]] of Object.entries(ORTHO)) {
        const nx = t.x - dx, ny = t.y - dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const s2 = cloneData(base);
        s2.players[opp].x = nx; s2.players[opp].y = ny;
        s2.starter = opp;
        const r2 = measure(s2, slot, a, t, [{ type: "move", dir }, { type: "pass" }, { type: "pass" }]);
        if (r2) { add(r2); byAct.get(actKey(a))[t.y * w + t.x] = r2.dmg; break; }
      }
    }
    out[t.y * w + t.x] = [...best].map(([cost, dmg]) => ({ cost, dmg })).sort((a, b) => b.dmg - a.dmg);
  }
  maps.set(key, out);
  acts.set(key, byAct);
  return out;
}

// dmg jednej konkrétnej útočnej akcie z `from` podľa cieľovej bunky (pole podľa indexu bunky) alebo null
export function actionHits(state, slot, from, a) {
  const { w, h } = state.board;
  const key = `${levelKey(state.players[slot])}|${slot}|${w}x${h}|${from.x},${from.y}`;
  if (!acts.has(key)) hitMap(state, slot, from);
  return acts.get(key).get(actKey(a)) || null;
}

// najväčší dmg za danú manu (zásah z `from` na bunku `to`); mana s dobitím v tom istom kole = váha 0.7
export function bestHit(state, slot, from, to, mana) {
  const list = hitMap(state, slot, from)[to.y * state.board.w + to.x];
  let v = 0;
  for (const { cost, dmg } of list) {
    if (cost <= mana) { v = Math.max(v, dmg); break; }
    if (cost <= Math.min(MAX_MANA, mana + RECHARGE_GAIN)) v = Math.max(v, 0.7 * dmg);
  }
  return v;
}

// bunky, kam sa figúra dostane v ďalšom kole: pohyb (1) a s manou dash (2, zastaví ho okraj) aj kombinácie
export function reach(state, p, mana, withDash = true) {
  const { w, h } = state.board;
  const key = (x, y) => y * w + x;
  const out = new Map([[key(p.x, p.y), { x: p.x, y: p.y, cost: 0 }]]);
  const step = (c, n) => {
    const res = [];
    for (const [dx, dy] of Object.values(ORTHO)) {
      let x = c.x, y = c.y;
      for (let i = 0; i < n; i++) {
        if (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= h) break;
        x += dx; y += dy;
      }
      if (x !== c.x || y !== c.y) res.push({ x, y });
    }
    return res;
  };
  const put = (c, cost) => { const k = key(c.x, c.y); if (!out.has(k) || out.get(k).cost > cost) out.set(k, { ...c, cost }); };
  const moves = step(p, 1);
  for (const c of moves) put(c, 1);
  if (withDash && mana >= 4) {
    for (const c of step(p, 2)) put(c, 2);
    for (const c of moves) for (const d of step(c, 2)) put(d, 2);
    for (const c of step(p, 2)) for (const d of step(c, 1)) put(d, 2);
  }
  return [...out.values()];
}
