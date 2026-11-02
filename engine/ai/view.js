// engine/ai/view.js - čo bot VIDÍ a ako z toho poskladá stav pre simuláciu (docs/AI_PLAN.md, fáza A1).
// Vstup sú VÝHRADNE payloady, ktoré server posiela klientovi bota (`state` = snapshotFor + redigovaná timeline,
// `you_are`) - nikdy engine.game. Belief si z nich priebežne pamätá to, čo by si pamätal pozorný človek
// (kto zaklial labyrint priamo = maze buff, či súper položil pascu, posledná známa poloha/mana skrytého
// súpera). simStates() z pohľadu + beliefu vyrobí K „determinizácií" - úplných vnútorných stavov enginu,
// kde je skrytá časť (pozícia lovca v labyrinte, súperova pasca a mana) navzorkovaná vlastným rng bota.
import { cloneData, MAX_MANA, START_MANA } from "../constants.js";
import {
  BASIC_COST, MELEE_COST, DASH_COST, RECHARGE_GAIN, SHIELD_COST, MIRROR_COST, SPECIAL_COST, PASS_MANA_COST,
  GOLDEN_COST, GOLDEN_MIRROR_COST, GOLDEN_MANA_GAIN,
} from "../../shared/balance.js";

const VAMP = new Set(["countess", "onre"]);
// odhad ceny súperovej akcie (len pre odhad skrytej many v labyrinte - presnosť netreba)
const COST = {
  move: 0, dash: DASH_COST, recharge: -RECHARGE_GAIN, attack: BASIC_COST, melee: MELEE_COST, special: SPECIAL_COST,
  special1: 4, shield: SHIELD_COST, mirror: MIRROR_COST, shield_breaker: SHIELD_COST, mirror_breaker: MIRROR_COST,
  pass: PASS_MANA_COST, golden_shield: GOLDEN_COST, golden_mirror: GOLDEN_MIRROR_COST, golden_mana: -GOLDEN_MANA_GAIN,
};
const other = (s) => (s === "p1" ? "p2" : "p1");
const clampMana = (m) => Math.max(0, Math.min(MAX_MANA, m));

export function createBelief() {
  const b = {
    mySlot: null,
    view: null,              // posledný root snapshot (state payload bez timeline)
    mazeBuff: { p1: false, p2: false },
    oppTrap: false,          // súper (Vampire/Onryō) má položenú pascu na neznámej bunke
    lastOpp: null,           // { x, y, mana } - posledné známe hodnoty súpera (pre labyrint)
    oppManaEst: null,        // odhad skrytej many súpera
    history: [],             // odhalené fronty súpera po kolách (model súpera, fáza A5)
  };

  function resetGame() {
    b.mazeBuff = { p1: false, p2: false };
    b.oppTrap = false; b.lastOpp = null; b.oppManaEst = null;
  }

  // jeden frame timeline / root snapshot z pohľadu bota
  function observeFrame(f, ctx) {
    const opp = other(b.mySlot);
    for (const e of f.effects || []) {
      if (e.kind === "action") {
        ctx.lastFrom = e.from;
        commitTrap(ctx);
        if (e.from === opp) {
          ctx.oppActions.push(e.action);
          const t = e.action?.type;
          // pasca padne, len ak cast nebol prečiarknutý (mana) ani skamenený - to človek vidí
          if (t === "special" && VAMP.has(f[opp]?.char ?? b.view?.[opp]?.char)) ctx.trapPending = true;
          if (b.oppManaEst !== null && t in COST) b.oppManaEst = clampMana(b.oppManaEst - COST[t]);
        }
      } else if ((e.kind === "invalid" || e.kind === "stoned") && e.target === opp) {
        ctx.trapPending = false;
      } else if (e.kind === "labyrinth") {
        // maze buff má len ten, kto labyrint zaklial PRIAMO (odraz mirrorom buff nedáva)
        b.mazeBuff[other(e.target)] = ctx.lastFrom === other(e.target);
      } else if (e.kind === "labyrinth_end") {
        b.mazeBuff = { p1: false, p2: false };
      } else if ((e.kind === "trap_trigger" || e.kind === "trap_break") && (e.from ?? e.owner ?? opp) === opp) {
        b.oppTrap = false;
      }
    }
    const o = f[opp];
    if (o && o.x !== null && o.x !== undefined) b.lastOpp = { x: o.x, y: o.y, mana: o.mana ?? b.lastOpp?.mana ?? START_MANA };
    if (o && o.mana !== null && o.mana !== undefined) b.oppManaEst = o.mana;
    if (o && (o.hp ?? 1) <= 0) b.oppTrap = false; // pasca zaniká smrťou castera
  }

  function commitTrap(ctx) {
    if (ctx.trapPending) { b.oppTrap = true; ctx.trapPending = false; }
  }

  b.onYouAre = ({ slot }) => { b.mySlot = slot; };
  b.onNewGame = () => resetGame();
  b.onState = (payload) => {
    if (!b.mySlot) return;
    const { timeline, ...root } = payload;
    if (root.turn === 1 && (!b.view || b.view.turn !== 1 || !root[b.mySlot]?.char)) {
      if (!timeline) resetGame(); // čerstvá hra (char-select / prvý plánovací snapshot)
    }
    const ctx = { lastFrom: null, oppActions: [] };
    if (timeline) for (const f of timeline) observeFrame(f, ctx);
    commitTrap(ctx);
    observeFrame({ ...root, effects: [] }, ctx);
    // pasca: súperova smrť / nová postava ju ruší; ak súper nie je upír, pasca nie je
    if (!VAMP.has(root[other(b.mySlot)]?.char)) b.oppTrap = false;
    if (timeline && ctx.oppActions.length) b.history.push({ turn: b.view?.turn ?? null, actions: ctx.oppActions });
    b.view = root;
  };
  return b;
}

// rozhoduje bot teraz? (bežné plánovanie kola alebo jeho THE WORLD zmrazené akcie)
export function decisionKind(b) {
  const v = b.view;
  if (!v || !b.mySlot || v.phase !== "playing") return null;
  if (!v.p1?.char || !v.p2?.char) return v[b.mySlot]?.char ? null : "character";
  if (v.timestop) return v.timestop.slot === b.mySlot ? "timestop" : null;
  if (v[b.mySlot].locked || v.myLock) return null;
  return "round";
}

// je v pohľade skrytá informácia, ktorú treba vzorkovať?
export function hasHidden(b) {
  const v = b.view, opp = other(b.mySlot);
  return b.oppTrap || v[opp]?.x === null || v[opp]?.mana === null;
}

const PLAYER_EXTRA = {
  prideHit: false, golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false,
  locked: false, queue: [],
};

function toPlayer(a, mazeBuff) {
  const { hunterHere, labPeek, ...rest } = a; // eslint-disable-line no-unused-vars
  return {
    ...cloneData(rest), ...PLAYER_EXTRA, queue: [],
    mazeBuff: !!mazeBuff, lastStandDoom: !!a.lastStandBuff,
    draft: { queue: [], golden: false, goldenMirror: false, goldenMana: false, lastStand: false, lastHope: false },
  };
}

// úplný vnútorný stav enginu z pohľadu bota; skryté hodnoty doplní rng (jedna determinizácia)
export function simState(b, rng) {
  const v = b.view, me = b.mySlot, opp = other(me);
  const board = { ...v.board };
  const players = { [me]: toPlayer(v[me], b.mazeBuff[me]), [opp]: toPlayer(v[opp], b.mazeBuff[opp]) };
  const o = players[opp];
  const cells = [];
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) cells.push({ x, y });
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (o.x === null || o.x === undefined) {
    // lovec v labyrinte: ožiarený na fakli (hunterHere) = istá bunka, inak náhodná bunka (nie moja - tam by ho videl)
    const lit = v[me].hunterHere?.[0];
    const c = lit ? { x: lit[0], y: lit[1] } : pick(cells.filter(c => !(c.x === v[me].x && c.y === v[me].y)));
    o.x = c.x; o.y = c.y;
  }
  if (o.mana === null || o.mana === undefined) {
    const est = b.oppManaEst ?? b.lastOpp?.mana ?? START_MANA;
    o.mana = clampMana(est + Math.floor(rng() * 5) - 2);
  }
  if (b.oppTrap && !o.trap) o.trap = pick(cells);
  // Shrek Swamp bez preview: skoky na ďalšie kolo nie sú verejné → 3 rôzne náhodné bunky
  const shrek = v.shrek ? cloneData(v.shrek) : null;
  if (shrek && !shrek.next) {
    const pool = cells.map(c => [c.x, c.y]);
    shrek.next = [];
    while (shrek.next.length < 3 && pool.length) shrek.next.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  const pending = v.pending ? cloneData(v.pending) : { ikMoves: (v.iks || []).map(c => ({ ...c })), spawns: [] };
  return {
    phase: "playing",
    config: cloneData(v.config),
    board,
    players: { p1: players.p1, p2: players.p2 },
    arena: v.arena,
    turn: v.turn,
    starter: v.starter,
    tiles: cloneData(v.tiles || []),
    portals: cloneData(v.portals || []),
    shrek,
    items: cloneData(v.items || []),
    iks: cloneData(v.iks || []),
    pending,
    seats: { p1: "A", p2: "B" },
    seriesWins: { A: 0, B: 0 },
    series: { gameIndex: 1, needed: 1, format: "single" },
    roster: null, mageHp: null, mageMana: null,
    roundCtx: null, timestop: null,
  };
}
