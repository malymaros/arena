// engine/laststand.js - Last Stand / Last Hope / démon: násobiče dmg a choreografia (frame-driven).
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js): stav hry (E.game) a funkcie
// ostatných sekcií. Vracia svoje funkcie; engine ich zverejní cez E a destrukturuje pre vlastný kód.
import {
  START_HP, MAX_MANA, DEMON_COST, DEMON_DMG, SMALL_DELAY_MS, SPECIAL_REPEAT,
  SPECIAL_BEAT_MS, LS_APPEAR_MS, LS_DRAIN_MS, LS_KILL_MS, LS_REVIVE_MS, LS_RISE_MS,
  LS_SETTLE_MS, LS_B_LEAVE_MS, LS_B_CENTER_MS, LS_B_DRAIN_MS, LS_B_KILL_MS, LH_APPEAR_MS,
  LH_DRAIN_MS, LH_SETTLE_MS,
} from "./constants.js";
import * as G from "../shared/geometry.js";

export function lastStandModule(E) {
// Výstupný násobič dmg: Last Hope ultra mód = 4×, Last Stand buff = 2×, inak 1×.
// Prijatý dmg sa zaokrúhľuje na floor(½) pri Last Stand aj Last Hope (½ chráni 1-HP Last Hope hráča pred dmg tile).
function dealMul(slot)      { const p = E.game.players[slot]; return p.lastHopeBuff ? 4 : p.lastStandBuff ? 2 : 1; }

function recvDmg(slot, dmg) { const p = E.game.players[slot]; return (p.lastStandBuff || p.lastHopeBuff) ? Math.floor(dmg / 2) : dmg; }

// Démon útok (len buffnutý hráč v poslednom kole): veľký démon v strede sa animuje ako special,
// blikajú cieľové bunky (všetky okrem kasterovej) a potom dá 10 dmg súperovi, ak na niektorej stojí.
function doDemon(slot, tl) {
  const me  = E.game.players[slot];
  const opS = E.other(slot);
  const op  = E.game.players[opS];

  if (me.mana < DEMON_COST) { E.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DEMON_COST;
  // POWER tile: aj démon je akcia s okamžitým dmg → +2 (10 → 12); spotreba pri použití
  const pBonus = E.powerBoost(slot, tl);

  // dosah = všetky políčka okrem toho, na ktorom kaster stojí (jediná „bezpečná" bunka pre súpera)
  const cells = G.allCells(E.game.board, me);

  // zásah: súper dostane dmg, ak NESTOJÍ na kasterovej bunke; cez shield/mirror (resolveStrike) - bez 2× buffu (10 = istá smrť)
  const inRange = op && !(op.x === me.x && op.y === me.y);
  // istý zásah - prípadný labyrint sa odhalí ešte pred vynorením démona
  if (inRange) E.revealLabyrinths(tl);

  // démon sa vynorí veľký v strede + bliká cieľové bunky v rovnakej kadencii ako special (ultimatka)
  E.pushStateFrame(tl, [{ kind: "demon_summon", from: slot }], LS_APPEAR_MS);
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    E.pushStateFrame(tl, [{ kind: "demon_attack", from: slot, cells }], SPECIAL_BEAT_MS);
  }

  // ak súper bráni (shield alebo mirror), démon nech najprv zmizne zo stredu, nech je block/odraz animácia viditeľná
  const defended = inRange && (op.shield || op.mirror);
  if (defended) E.pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS);
  // súperov tieňový klon v zóne (všade okrem kasterovej bunky) - zomiera/bráni SPOLU so súperom v jednom beate
  const cloneInRange = !!(op?.clone && !(op.clone.x === me.x && op.clone.y === me.y));
  if (inRange || cloneInRange) {
    E.strikeZone(opS, inRange, cloneInRange, DEMON_DMG + pBonus, tl, { kind: "demon", bonus: pBonus });
  } else {
    E.pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
  if (!defended) E.pushStateFrame(tl, [{ kind: "demon_center_out", from: slot }], SMALL_DELAY_MS); // inak démon zmizne až po zásahu
}

// pomocné: plynulé prepísanie HP+many cez zopár frame-ov (HUD sa hýbe zo snapshotov)
function lsTweenFrames(slot, toHp, toMana, totalMs, kind, tl) {
  const p = E.game.players[slot];
  const fromHp = p.hp, fromMana = p.mana, steps = 4;
  for (let s = 1; s <= steps; s++) {
    p.hp   = Math.round(fromHp   + (toHp   - fromHp)   * (s / steps));
    p.mana = Math.round(fromMana + (toMana - fromMana) * (s / steps));
    E.pushStateFrame(tl, [{ kind, target: slot }], Math.round(totalMs / steps));
  }
  p.hp = toHp; p.mana = toMana;
}

// summon: démon v strede → odčerpá HP/manu na 0 → smrť → objaví sa za postavou → zlaté dvíhanie na 10 → usadenie.
// buff+doom (a tým golden stav na klientovi) sa zapnú až vo fáze „revive" (po smrti), nie počas umierania.
function resolveLastStandSummon(slot, tl) {
  const p = E.game.players[slot];
  E.pushStateFrame(tl, [{ kind: "last_stand_summon", from: slot }], LS_APPEAR_MS); // démon v strede (HP ešte plné)
  lsTweenFrames(slot, 0, 0, LS_DRAIN_MS, "last_stand_drain", tl);                 // HP+mana → 0
  p.down = true;                                                                  // hráč padá mŕtvy (leží až do settle)
  E.pushStateFrame(tl, [{ kind: "last_stand_kill", from: slot }], LS_KILL_MS);     // smrť + démon zmizne zo stredu
  E.killClone(slot, tl);                                                           // Naruto zomrel → klon zaniká HNEĎ pri smrti (pred vzkriesením)
  E.breakTrap(slot, tl);                                                           // pasca zaniká smrťou castera (aj touto rituálnou - deštrukciu vidia obaja)
  p.lastStandBuff = true; p.lastStandDoom = true;                                 // od TERAZ golden stav + buff/doom
  E.pushStateFrame(tl, [{ kind: "last_stand_revive", from: slot }], LS_REVIVE_MS); // démon sa objaví za postavou (0→1)
  lsTweenFrames(slot, START_HP, MAX_MANA, LS_RISE_MS, "last_stand_rise", tl);     // HP+mana 0 → 10 (zlaté), hráč stále leží
  p.down = false;                                                                 // pri 10/10 hráč vstane
  E.pushStateFrame(tl, [{ kind: "last_stand_settle", from: slot }], LS_SETTLE_MS); // démon → 0.25, hráč vstane
}

// Last Hope summon: červená „hope" postava v strede → HP padne na 1, mana sa naplní na 10 → postava zmizne, ultra mód (4×) ostáva.
function resolveLastHopeSummon(slot, tl) {
  const p = E.game.players[slot];
  p.lastHopeBuff = true;                                                          // ultra mód HNEĎ → mana začne pulzovať červeno ešte pred doplnením
  E.pushStateFrame(tl, [{ kind: "last_hope_summon", from: slot }], LH_APPEAR_MS); // hope postava v strede (mana už červená)
  lsTweenFrames(slot, 1, MAX_MANA, LH_DRAIN_MS, "last_hope_drain", tl);          // až POTOM HP→1, mana→10 (pulzuje červeno počas dopĺňania)
  E.pushStateFrame(tl, [{ kind: "last_hope_settle", from: slot }], LH_SETTLE_MS);  // postava zmizne, červený mód zostáva
}

// banish: golden OFF → duch zosilnie a odíde z postavy → objaví sa v strede → odčerpá HP/manu na 0 → smrť.
function resolveLastStandBanish(slot, tl) {
  const p = E.game.players[slot];
  E.pushStateFrame(tl, [{ kind: "last_stand_banish", from: slot }], LS_B_LEAVE_MS);         // golden off + duch odíde
  E.pushStateFrame(tl, [{ kind: "last_stand_banish_center", from: slot }], LS_B_CENTER_MS); // duch v strede
  lsTweenFrames(slot, 0, 0, LS_B_DRAIN_MS, "last_stand_drain", tl);                        // HP+mana → 0 (smrť; bez záverečného „hit" → žiadne červené bliknutie/−10 HP)
  p.down = true;                                                                           // hráč padá mŕtvy
  E.killClone(slot, tl);                                                                     // Naruto zomrel (doom) → klon zaniká
  E.pushStateFrame(tl, [{ kind: "last_stand_banish_kill", from: slot }], LS_B_KILL_MS);     // démon zmizne, hráč leží mŕtvy
}

return { dealMul, recvDmg, doDemon, lsTweenFrames, resolveLastStandSummon, resolveLastHopeSummon, resolveLastStandBanish };
}
