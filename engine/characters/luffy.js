// Luffy SPECIAL = pohyb-a-úder ako šachová figúra. Base = DÁMA (4 dmg, Special_7 roll-bounce), gear3 = VEŽA
// (8 dmg, balón + Special_2 impact). Cieľová bunka na platnej línii (aj vlastná); Luffy sa NA ňu dogúľa a dá
// dmg tomu, kto na nej stojí (súper / klon). Ide cez obrany ako každý dmg special.
import { SPECIAL_COST, SMALL_DELAY_MS, ANIM_SLOW, BASIC_COST, BASIC_DMG_MAX, CLONE_DMG, MOVE_DELAY_MS, MAX_MANA, RECHARGE_GAIN } from "../constants.js";
import * as G from "../../shared/geometry.js";

const LUFFY_SPECIAL_DMG = { base: 4, gear3: 8 };
const LUFFY_BALL_FORM_MS = Math.round(900 * ANIM_SLOW); // gear3: STREDOVÁ premena na guľu + rotácia (Special_1: ~1.1s premena + viditeľné rolovanie; Luffy ešte stojí, guľa sa na doske rozgúľa až potom)
const LUFFY_ROLL_MS = Math.round(700 * ANIM_SLOW);   // gear3 balón roll
const LUFFY_TRAVEL_MS = Math.round(340 * ANIM_SLOW); // base: dogúľanie k bunke (run/roll)
const LUFFY_CHOMP_MS  = Math.round(340 * ANIM_SLOW); // base: cvaknutie NA bunke

const reaches = (ctx, fx, fy, c, form) =>
  !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && G.luffySpecialReaches(ctx.game.board, fx, fy, c.x, c.y, form);

// Luffy GEAR 3 basic = Giant Pistol s priťiahnutím súpera. Luffy STOJÍ; naťahovacia ruka letí ortogonálne
// po prvú figúru súpera (klon-návnada / hráč). Pri zásahu dmg (falloff ako base 3/2/1) + PRIŤIAHNE súpera
// na bunku hneď vedľa Luffyho (pos+dir). Obrana (shield/mirror) blokuje dmg AJ priťiahnutie.
const GP_WINDUP_MS = Math.round(360 * ANIM_SLOW); // nafúknutie pästí (Recharge2)
const GP_REACH_MS  = Math.round(320 * ANIM_SLOW); // naťahovanie ruky (L_GiantPunch)
function doLuffyGear3Basic(ctx, slot, dir, tl) {
  const me = ctx.game.players[slot];
  const opS = ctx.other(slot);
  const op  = ctx.game.players[opS];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { ctx.pushInvalid(tl, slot); return; }
  if (me.mana < BASIC_COST) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= BASIC_COST;
  const pBonus = ctx.powerBoost(slot, tl);

  // scan po prvú figúru súpera (hráč / klon) alebo okraj. Klon STACKNUTÝ na majiteľovej bunke = "stacked":
  // pohltí len CLONE_DMG, zvyšok prejde na Naruta (rovnaké pravidlo ako basic/melee/werewolf charge) - nie
  // plný bait ako klon-návnada mimo majiteľovej bunky.
  let x = me.x, y = me.y, dist = 0, hit = false, cloneDecoy = false, stacked = false;
  while (ctx.inBounds(x + delta[0], y + delta[1])) {
    x += delta[0]; y += delta[1]; dist++;
    const cloneHere  = !!(op?.clone && op.clone.x === x && op.clone.y === y);
    const playerHere = !!(op && op.x === x && op.y === y);
    if (cloneHere && playerHere) { hit = true; stacked = true; break; }
    if (playerHere) { hit = true; break; }
    if (cloneHere) { hit = true; cloneDecoy = true; break; }
  }
  const target = [x, y];

  // nafúknutie pästí + naťahovanie ruky (FX na klientovi kreslí gumu + L_GiantPunch podľa origin/target/dir)
  ctx.pushStateFrame(tl, [{ kind: "luffy_gp", phase: "windup", from: slot, dir, ms: GP_WINDUP_MS }], GP_WINDUP_MS);
  ctx.pushStateFrame(tl, [{ kind: "luffy_gp", phase: "reach", from: slot, dir, origin: [me.x, me.y], target, hit, ms: GP_REACH_MS }], GP_REACH_MS);

  if (!hit) { ctx.pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS); return; }

  const dmg = Math.max(1, BASIC_DMG_MAX - dist) * ctx.dealMul(slot) * ctx.labyrinthMul(slot) + pBonus;

  // klon-návnada (mimo majiteľovej bunky): pohltí úder, žiadny pull
  if (cloneDecoy) {
    ctx.strikeCell(opS, "clone", dmg, tl, { kind: "luffy_gp" });
    ctx.pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS);
    return;
  }

  // reálny hráč (aj stacknutý pár s klonom): istý zásah → odhaľ labyrint pred úderom; obrana v resolveStrike
  ctx.revealLabyrinths(tl);
  const defended = op.shield || op.mirror; // shield/mirror blokuje dmg AJ pull
  // stacknutý pár: so zdieľanou obranou reaguje ako jedna postava, bez nej klon pohltí CLONE_DMG a zvyšok
  // prejde na Naruta - potom (ak žije) pull
  ctx.strikeCell(opS, stacked ? "stacked" : "player", dmg, tl, { kind: "luffy_gp", bonus: pBonus });

  // PRIŤIAHNUTIE: len keď zásah dopadol (nebránený) a súper žije - na bunku hneď vedľa Luffyho.
  // Inak (obrana / smrť / už stojí vedľa) sa ruka len STIAHNE späť - klient tak vždy korektne uzavrie
  // súvislú naťahovaciu ruku (žiadne visiace držanie po zásahu).
  if (!defended && op.hp > 0) {
    const px = me.x + delta[0], py = me.y + delta[1];
    if (px !== op.x || py !== op.y) {
      const from = [op.x, op.y];
      op.x = px; op.y = py;
      ctx.pushStateFrame(tl, [{ kind: "luffy_pull", from: slot, foe: opS, fromCell: from, toCell: [px, py], dir }], MOVE_DELAY_MS);
      return;
    }
  }
  ctx.pushStateFrame(tl, [{ kind: "luffy_gp", phase: "retract", from: slot, dir }], SMALL_DELAY_MS);
}

export default {
  key: "luffy",
  // basic v gear3 = Giant Pistol (vráti true = vyriešené), v base bežný diagonálny basic enginu
  basic(ctx, slot, dir, tl) {
    if (ctx.game.players[slot].form !== "gear3") return false;
    doLuffyGear3Basic(ctx, slot, dir, tl);
    return true;
  },
  // recharge = jeho „glitch" akcia: doplní manu (ak nie je plná) A VŽDY prepne mód (base↔gear3), aj pri plnej mane
  recharge(ctx, slot, tl) {
    const a = ctx.game.players[slot];
    const before = a.mana;
    a.mana = Math.min(MAX_MANA, a.mana + RECHARGE_GAIN);
    const gained = a.mana - before;
    a.form = a.form === "gear3" ? "base" : "gear3";
    const cells = a.clone ? [[a.x, a.y], [a.clone.x, a.clone.y]] : [[a.x, a.y]];
    // dlhší frame, nech sa prepínacia póza (Recharge2 base→gear3 / Special_3 gear3→base) stihne prehrať
    ctx.pushStateFrame(tl, [{ kind: "recharge", from: slot, cells, amount: gained, luffyForm: a.form }], Math.round(700 * ANIM_SLOW));
    return true;
  },
  kit: { attack: "luffy" }, // basic diagonálny v base, ortogonálny (len ←/→) v gear3 - recharge prepína formu
  special: {
    // cieľ na platnej línii (dáma base / veža gear3) z GHOST pozície a formy v čase specialu
    validate: (ctx, a, { x, y, form }) => reaches(ctx, x, y, a.cell, form),
    resolve(ctx, slot, tl, { cell }) {
      const { game } = ctx;
      const me = game.players[slot];
      const opS = ctx.other(slot);
      const op = game.players[opS];
      if (!reaches(ctx, me.x, me.y, cell, me.form)) { ctx.pushInvalid(tl, slot); return; }
      me.mana -= SPECIAL_COST;
      const pBonus = ctx.powerBoost(slot, tl);
      const gear3 = me.form === "gear3";
      const dmg = LUFFY_SPECIAL_DMG[gear3 ? "gear3" : "base"] * ctx.dealMul(slot) * ctx.labyrinthMul(slot) + pBonus;

      const foeOnTarget = !!(op && op.x === cell.x && op.y === cell.y);
      const cloneOnCell = !!(op?.clone && op.clone.x === cell.x && op.clone.y === cell.y);
      const stacked = foeOnTarget && cloneOnCell;            // Naruto + klon na cieľovej bunke
      const cloneDecoyOnTarget = cloneOnCell && !foeOnTarget; // klon-návnada sám na bunke

      if (foeOnTarget) ctx.revealLabyrinths(tl); // istý zásah reálneho hráča (aj stacknutý) → odhaľ pred rolovaním

      const willHit = foeOnTarget || cloneOnCell; // na cieľovej bunke stojí súper/klon (aj keď má štít/mirror)
      const path = G.luffyLinePath(me.x, me.y, cell.x, cell.y);
      if (gear3) {
        // gear3: najprv STREDOVÁ premena na guľu + rotácia, POTOM sa guľa na doske dogúľa k cieľu, potom VÝBUCH
        ctx.pushStateFrame(tl, [{ kind: "luffy_ball_form", from: slot }], LUFFY_BALL_FORM_MS);
        me.x = cell.x; me.y = cell.y;
        ctx.pushStateFrame(tl, [{ kind: "luffy_roll", from: slot, form: "gear3", target: [cell.x, cell.y], ...ctx.trackSteps(slot, path) }], LUFFY_ROLL_MS);
        ctx.pushStateFrame(tl, [{ kind: "luffy_explode", from: slot, target: [cell.x, cell.y], hit: willHit }], LUFFY_CHOMP_MS);
      } else {
        // base: najprv DOGÚĽANIE (beh/kotúľ) k bunke, potom CVAKNUTIE zubami NA bunke (hit=zastaví na cvaknutí)
        me.x = cell.x; me.y = cell.y;
        ctx.pushStateFrame(tl, [{ kind: "luffy_roll", from: slot, form: "base", target: [cell.x, cell.y], ...ctx.trackSteps(slot, path) }], LUFFY_TRAVEL_MS);
        ctx.pushStateFrame(tl, [{ kind: "luffy_chomp", from: slot, target: [cell.x, cell.y], hit: willHit }], LUFFY_CHOMP_MS);
      }

      // stacknutý pár / hráč / klon-návnada na cieľovej bunke (rovnaké pravidlo ako basic/melee/werewolf charge)
      const who = stacked ? "stacked" : foeOnTarget ? "player" : cloneDecoyOnTarget ? "clone" : null;
      if (who) ctx.strikeCell(opS, who, dmg, tl, { kind: "luffy_special", bonus: pBonus });
      // miss = čistý presun (roll/chomp frame už odohral)
    },
  },
};
