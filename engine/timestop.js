// engine/timestop.js - Jotarov THE WORLD (time-stop): pauza kola, zmrazené akcie, kumulatívny dopad po obnovení času.
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js): stav hry (E.game) a funkcie
// ostatných sekcií. Vracia svoje funkcie; engine ich zverejní cez E a destrukturuje pre vlastný kód.
import {
  WORLD_COST, MOVE_DIRS, SMALL_DELAY_MS, ACTION_GAP_MS, MIRROR_BEAM_MS, TIMESTOP_CAST_MS,
  TIMESTOP_END_MS,
} from "./constants.js";

export function timestopModule(E) {
// sentinel z doAction hore do runRoundLoop: kolo sa pozastaví a čaká na klientove timestop_actions
const PAUSE = Symbol("timestop_pause");

// beží zamrazená trojica Jotarových akcií? (súper zmrznutý, jeho zásahy sa len OHLASujú a kumulujú)
function frozenActive() { return E.game.timestop?.mode === "frozen"; }

// zmrazený zásah na súpera - NEmeň HP, len ohlás label (ts_hit / ts_mirror ak je nabitý mirror) a zaeviduj raw;
// dmg dopadne kumulatívne (jeden hit s parts) pri obnovení času (applyTimestopResume). raw už obsahuje dealMul (D11).
function noteFrozenHit(tl, targetSlot, raw, kind) {
  const ts = E.game.timestop;
  if (!ts) return;
  ts.hits.push({ raw, kind });
  E.pushStateFrame(tl, [{ kind: ts.foeMirror ? "ts_mirror" : "ts_hit", target: targetSlot, dmg: raw, atk: kind }], SMALL_DELAY_MS);
}

// zmrazený zásah na súperovho tieňového klona - odlož clone_die na obnovenie času (žiadny okamžitý poof)
function noteFrozenClone(ownerSlot) {
  const ts = E.game.timestop; const o = E.game.players[ownerSlot];
  if (ts && o?.clone) ts.cloneEvents.push({ ownerSlot, cell: [o.clone.x, o.clone.y] });
}

// Jotaro THE WORLD: 3 nové zmrazené akcie (kvázi nové kolo, všetky typy nanovo). Povolené:
// move|dash|recharge|attack|melee|shield|shield_breaker|special1 (štít a jeho breaker sa vylučujú). Zakázané: special (THE WORLD beží / Special 2 ešte
// nie je), golden akcie, swap, stoned. Mana sa NEvaliduje tvrdo (nedostatok = invalid pri vykonaní).
function validTimestopQueue(queue, slot) {
  if (!Array.isArray(queue) || queue.length !== 3) return false;
  const allowed = new Set(["move", "dash", "recharge", "attack", "melee", "shield", "shield_breaker", "special1"]);
  const types = queue.map(a => a && a.type);
  if (types.some(t => !allowed.has(t))) return false;
  if (new Set(types).size !== types.length) return false; // každý typ max 1×
  if (types.includes("shield") && types.includes("shield_breaker")) return false; // slot štítu: obrana XOR breaker
  const char = E.game.players[slot]?.char; // tvar basicu podľa kitu (Jotaro strieľa diagonálne)
  for (const a of queue) {
    if ((a.type === "move" || a.type === "dash") && !MOVE_DIRS.has(a.dir)) return false;
    if (a.type === "attack" && !E.attackDirOk(char, a.dir)) return false;
    if (a.type === "special1" && !E.special1ArgsOk(char, a)) return false;
  }
  return true;
}

// THE WORLD (Jotarov special pred prvým použitím) - jednorazový time-stop. Cast + zachytenie súperovej
// nabitej obrany, potom PAUZA (runRoundLoop pošle čiastočnú timeline a čaká na klientove timestop_actions).
// Mana gate (5) overil doSpecial. Vracia PAUSE sentinel.
function doJotaroWorld(slot, tl) {
  const actor = E.game.players[slot];
  const foeS = E.other(slot);
  const foe = E.game.players[foeS];
  actor.mana -= WORLD_COST;
  actor.worldUsed = true; // po THE WORLD sa special button natrvalo mení na Special 2 (prežíva swap)
  // cast: Star Platinum „menace" + celoplošný blik (ako Minotaur) + invert flash (globálny - vidia obaja);
  // nedá sa blokovať/odraziť. Po tomto frame plocha prestane blikať a čas sa zastaví (timestop_wait).
  const castCells = [];
  for (let y = 0; y < E.game.board.h; y++) for (let x = 0; x < E.game.board.w; x++) castCells.push([x, y]);
  E.pushStateFrame(tl, [{ kind: "timestop_start", from: slot, cells: castCells }], TIMESTOP_CAST_MS);
  // zachyť súperovu NABITÚ obranu (armed PRED castom) - NEspotrebuje sa castom (runRoundLoop preskočí
  // consumption), platí cez celé zamrazenie a vyhodnotí sa kumulatívne pri obnovení času (applyTimestopResume)
  E.game.timestop = {
    slot, foeSlot: foeS,
    foeShield: !!foe?.shield, foeShieldGold: !!foe?.shieldGold,
    foeMirror: !!foe?.mirror, foeMirrorGold: !!foe?.mirrorGold,
    hits: [], cloneEvents: [], shrekHits: [], mode: "waiting",
  };
  return PAUSE;
}

// zmrazené vykonanie 3 nových Jotarových akcií (frozen mode), potom obnovenie času a kumulatívna aplikácia
function runTimestopActions(queue) {
  const ts = E.game.timestop, ctx = E.game.roundCtx, tl = ctx.tl;
  ts.mode = "frozen";
  const slot = ts.slot;
  // pasce sa počas zamrazenia netriggerujú (D4) - resolveTrapsAfterAction sa nevolá; prejdené bunky (actionSteps)
  // slúžia len na zber itemov v Shrek Swamp (Jotaro sa hýbe naživo); trackSteps niť labyrintu pletie ďalej (D5)
  for (const act of queue) {
    E.actionSteps = { p1: [], p2: [], p1c: [], p2c: [] };
    // frozen:true - klient túto akciu NEzaráta do round-scriptu (kurzor ostáva na THE WORLD), len ju animuje
    E.beginAct(slot); // labyrint peek: aj zmrazená akcia z bunky prekliateho sa mu odhalí
    E.pushStateFrame(tl, [{ kind: "action", from: slot, action: { type: act.type, dir: act.dir || null }, frozen: true }], 250);
    E.doAction(slot, act, tl); // frozen: zásah na súpera sa cez guardy v apply* len ohlási (ts_hit/ts_mirror)
    E.pickupItems(E.actionSteps, tl);
    E.actionSteps = null;
    E.pushStateFrame(tl, [], ACTION_GAP_MS);
    E.endAct();
  }
  applyTimestopResume();
  // resume mohol niekoho zabiť (kumulatívny zásah / mirror odraz na Jotara) - prvá smrť končí hru
  if (E.winnerNow()) { ctx.ended = true; return E.finishRound(); }
  E.runRoundLoop(); // pokračuj zvyškom kola od uloženej pozície (ctx.i / ctx.slotIdx)
}

// obnovenie času: reveal (ak zásah + labyrint), timestop_end, potom JEDEN kumulatívny beat
// (block / mirror odraz / hit s parts / nič) podľa súperovej nabitej obrany a súčtu zmrazených zásahov.
function applyTimestopResume() {
  const ts = E.game.timestop, ctx = E.game.roundCtx, tl = ctx.tl;
  ts.mode = "applying"; // vypni frozen (frozenActive() false) - reveal/endLabyrinths a kumulatívny zásah bežia naživo
  const jslot = ts.slot, foeS = ts.foeSlot;
  const jo = E.game.players[jslot], foe = E.game.players[foeS];
  const anyEvent = ts.hits.length > 0 || ts.cloneEvents.length > 0;
  // istý zásah počas zamrazenia + beží labyrint → reveal PRED aplikačnými frame-ami (hra nesmie skončiť v hmle)
  if (anyEvent) E.revealLabyrinths(tl);
  E.pushStateFrame(tl, [{ kind: "timestop_end", from: jslot }], TIMESTOP_END_MS);
  // Portal Realm: portály použité počas zamrazenia - efekt na telo (každý pár raz) a zatvorenie až teraz
  E.resumeFrozenPortals(tl);

  // odložené klonové úmrtia (decoy/absorb) - poof pri obnovení
  for (const ev of ts.cloneEvents) {
    const o = E.game.players[ev.ownerSlot];
    if (o?.clone) { E.pushStateFrame(tl, [{ kind: "clone_die", target: ev.ownerSlot, cell: [o.clone.x, o.clone.y] }], SMALL_DELAY_MS); o.clone = null; }
  }

  if (ts.hits.length === 0) {
    // žiadny zásah na hráča (nanajvýš zomrel decoy klon) → nabitá obrana OSTÁVA (D1), labyrint (ak decoy) NEkončí
    E.shrekResume(ts, tl);
    E.game.timestop = null;
    return;
  }
  const parts = ts.hits.map(h => E.recvDmg(ts.foeShield ? foeS : (ts.foeMirror ? jslot : foeS), h.raw));
  const total = parts.reduce((a, b) => a + b, 0);
  const rawTotal = ts.hits.reduce((a, h) => a + h.raw, 0);

  if (ts.foeShield) {
    // shield platil cez celé zamrazenie: jeden block, 0 dmg, spotrebuj
    E.pushStateFrame(tl, [{ kind: "block", target: foeS, gold: ts.foeShieldGold }], SMALL_DELAY_MS);
    foe.shield = false; foe.shieldGold = false;
  } else if (ts.foeMirror) {
    // mirror: foe nezraniteľný + JEDEN kumulatívny odraz celého súčtu späť na Jotara
    E.pushStateFrame(tl, [{ kind: "mirror", target: foeS, dmg: rawTotal, atk: "special", gold: ts.foeMirrorGold }], MIRROR_BEAM_MS);
    foe.mirror = false; foe.mirrorGold = false;
    if (jo.shield) {
      // Jotaro si počas zamrazenia nabil štít → odraz mu ho ZNIČÍ namiesto zásahu (jeden block, 0 dmg)
      E.pushStateFrame(tl, [{ kind: "block", target: jslot, gold: jo.shieldGold }], SMALL_DELAY_MS);
      jo.shield = false; jo.shieldGold = false;
    } else {
      jo.hp = Math.max(0, jo.hp - total);
      E.notePrideHit(jslot);
      E.pushStateFrame(tl, [{ kind: "hit", target: jslot, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
    }
  } else {
    // bez obrany: jeden kombinovaný hit s parts (súčet naraz, jeden hurt)
    foe.hp = Math.max(0, foe.hp - total);
    E.notePrideHit(foeS);
    E.pushStateFrame(tl, [{ kind: "hit", target: foeS, dmg: total, ...(parts.length > 1 ? { parts } : {}) }], SMALL_DELAY_MS);
  }
  E.endLabyrinths(tl); // aspoň jeden zásah/blok/odraz dopadol → labyrint končí (aj blokovaný/odrazený)
  if (!E.winnerNow()) E.shrekResume(ts, tl); // Shrek Swamp: zamrazené zásahy Shreka až po súperovi
  E.game.timestop = null;
}

return { PAUSE, frozenActive, noteFrozenHit, noteFrozenClone, validTimestopQueue, doJotaroWorld, runTimestopActions, applyTimestopResume };
}
