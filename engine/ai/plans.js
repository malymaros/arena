// engine/ai/plans.js - rozumné plány kola „ako človek" (docs/AI_PLAN.md 9): z celého poolu front jedného hráča
// vyberie bez simulácie tie, ktoré by zvážil skúsený hráč - útočný, zabijácky (čo najviac dmg na súpera a bunky,
// kam môže ujsť), obranný (štít / mirror pri hrozbe), útek z dosahu, ekonomický (mana, políčka) a vyvážený.
// Hodnotí ich mapami zásahov z threat.js (čo kto komu vie dať z ktorej bunky). Bot ich vždy pridá do hry kola
// (za seba aj za súpera), aby mu nechýbali zjavné hrozby a odpovede; presné ohodnotenie urobí až simulácia.
import { actionHits, bestHit, reach } from "./threat.js";
import { actionCost } from "./candidates.js";
import { MAX_MANA, RECHARGE_GAIN } from "../../shared/balance.js";

const other = (s) => (s === "p1" ? "p2" : "p1");
const STEP = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const ATTACKS = new Set(["attack", "melee", "special", "special1", "dash"]);
const DEF = { shield: 0.8, mirror: 1, golden_shield: 0.8, golden_mirror: 1 };

function moveBy(state, c, dir, n) {
  const d = STEP[dir];
  if (!d) return c;
  let { x, y } = c;
  for (let i = 0; i < n; i++) {
    const nx = x + d[0], ny = y + d[1];
    if (nx < 0 || ny < 0 || nx >= state.board.w || ny >= state.board.h) break;
    x = nx; y = ny;
  }
  return { x, y };
}

const tileAt = (state, c, type) => state.tiles.some(t => t.type === type && t.x === c.x && t.y === c.y);
const ikAt = (state, c) => state.iks.some(t => t.x === c.x && t.y === c.y);

export function rankPlans(state, slot, pool) {
  const me = state.players[slot], foe = state.players[other(slot)];
  if (foe.x === null || foe.x === undefined || me.x === null || me.x === undefined || !me.char || !foe.char) return [];
  const w = state.board.w;
  const idx = (c) => c.y * w + c.x;
  // kde bude súper: 40 % ostane, zvyšok rovnomerne po bunkách, kam sa dostane
  const foeCells = reach(state, foe, foe.mana);
  const foeDist = new Map(foeCells.map(c => [idx(c), 0.6 / foeCells.length]));
  foeDist.set(idx(foe), (foeDist.get(idx(foe)) || 0) + 0.4);
  // čo mi súper vie dať na bunku c (pohyb + útok, jeho mana)
  const foeNear = reach(state, foe, foe.mana, false);
  const threatCache = new Map();
  const threatAt = (c) => {
    const k = idx(c);
    if (!threatCache.has(k)) threatCache.set(k, Math.max(0, ...foeNear.map(f => bestHit(state, other(slot), f, c, foe.mana))));
    return threatCache.get(k);
  };
  const foeMax = threatAt(me);
  const hp = Math.max(1, me.hp);

  const scored = [];
  for (const q of pool) {
    let pos = { x: me.x, y: me.y }, mana = me.mana;
    let out = 0, kill = 0, def = 0, tiles = 0, risk = 0, steps = 0;
    for (const a of q) {
      const t = a.type;
      if (t === "move") pos = moveBy(state, pos, a.dir, 1);
      if (ATTACKS.has(t)) {
        const hits = actionHits(state, slot, pos, a);
        if (hits) {
          let e = 0;
          for (const [k, p] of foeDist) e += p * hits[k];
          out += e; kill += hits[idx(foe)] * 0.6 + e * 0.4;
        }
      }
      if (t === "dash") pos = moveBy(state, pos, a.dir, 2);
      if (DEF[t]) def = Math.max(def, DEF[t] * Math.min(1, foeMax / hp));
      const c = actionCost(a, me.char);
      mana = t === "recharge" ? Math.min(MAX_MANA, mana + RECHARGE_GAIN) : Math.max(0, mana - Math.max(0, c));
      if (ikAt(state, pos)) tiles -= 10;
      else if (tileAt(state, pos, "dmg") && !(me.char === "fire" && mana >= 5)) tiles -= 1;
      if (tileAt(state, pos, "heal") && me.hp < 10 && me.char !== "werewolf") tiles += me.char === "lightning" ? (10 - me.hp) / 2 : 1;
      if (tileAt(state, pos, "mana")) tiles += mana < 5 ? 1 : 0.3;
      risk += threatAt(pos) / hp; steps++;
    }
    risk = (risk + 2 * threatAt(pos) / hp) / (steps + 2);
    const m = mana / MAX_MANA;
    scored.push({
      q,
      s: {
        balanced: out / hp * 0.6 - risk + def * 0.6 + m * 0.3 + tiles * 0.3,
        aggressive: out - risk * 2 + m * 0.5,
        killer: kill,
        defensive: def * 2 - risk + m * 0.5 + out * 0.1,
        flee: -risk * 2 + tiles * 0.3 + m * 0.3,
        eco: m + tiles * 0.5 - risk,
      },
    });
  }
  return scored;
}

// vyber `per` najlepších plánov každého štýlu (bez duplikátov), poradie: najprv vyvážené
export function seedPlans(state, slot, pool, per = 3) {
  const scored = rankPlans(state, slot, pool);
  if (!scored.length) return [];
  const out = [], seen = new Set();
  for (const style of ["balanced", "killer", "defensive", "flee", "aggressive", "eco"]) {
    const top = [...scored].sort((a, b) => b.s[style] - a.s[style]);
    let n = 0;
    for (const { q } of top) {
      if (n >= per) break;
      if (seen.has(q)) continue;
      seen.add(q); out.push({ q, style }); n++;
    }
  }
  return out;
}
