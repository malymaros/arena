// Luffy SPECIAL = pohyb-a-úder ako šachová figúra. Base = DÁMA (4 dmg, Special_7 roll-bounce), gear3 = VEŽA
// (8 dmg, balón + Special_2 impact). Cieľová bunka na platnej línii (aj vlastná); Luffy sa NA ňu dogúľa a dá
// dmg tomu, kto na nej stojí (súper / klon). Ide cez obrany ako každý dmg special.
import { SPECIAL_COST, SMALL_DELAY_MS, ANIM_SLOW } from "../constants.js";
import * as G from "../../shared/geometry.js";

const LUFFY_SPECIAL_DMG = { base: 4, gear3: 8 };
const LUFFY_BALL_FORM_MS = Math.round(900 * ANIM_SLOW); // gear3: STREDOVÁ premena na guľu + rotácia (Special_1: ~1.1s premena + viditeľné rolovanie; Luffy ešte stojí, guľa sa na doske rozgúľa až potom)
const LUFFY_ROLL_MS = Math.round(700 * ANIM_SLOW);   // gear3 balón roll
const LUFFY_TRAVEL_MS = Math.round(340 * ANIM_SLOW); // base: dogúľanie k bunke (run/roll)
const LUFFY_CHOMP_MS  = Math.round(340 * ANIM_SLOW); // base: cvaknutie NA bunke

const reaches = (ctx, fx, fy, c, form) =>
  !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && G.luffySpecialReaches(ctx.game.board, fx, fy, c.x, c.y, form);

export default {
  key: "luffy",
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
