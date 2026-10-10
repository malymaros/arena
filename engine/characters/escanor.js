// Escanor: smerový (left/right) dmg special; rozsah zóny podľa pride levelu 0-3 (8 dmg). Cez obrany ako
// ostatné dmg speciály. Hod slnka MIMO plochy (kotva von z dosky → prázdna zóna, aj pri pride 3) sa VYKONÁ
// ako útok do steny - mana preč, choreografia prebehne, OUT OF BOUNDS, akcia sa NEprečiarkuje.
import { SPECIAL_COST, SMALL_DELAY_MS, ESC_SPECIAL_MS } from "../constants.js";
import * as G from "../../shared/geometry.js";
import { SPECIAL_ZONE_DMG } from "./zone.js";

export default {
  key: "escanor",
  // Pride 0-3: koniec kola → použil obranu (shield/mirror aj golden - číta sa FRONTA, nie výsledok; obrana
  // zmarená BLOCK tile sa ráta) ALEBO dostal zásah od súpera → −1, inak +1 (len ±1, clamp 0-3).
  // Reset na 0 pri nasadení robí engine (spoločný reset stavu postáv).
  on: {
    hitTaken(ctx, p) { p.prideHit = true; }, // HP loss spôsobený súperom (aj odraz vlastného útoku); nie tiles/statusy
    roundStart: (ctx, p) => ({
      usedDefense: !!p.golden || !!p.goldenMirror || (p.queue || []).some(a => a && (a.type === "shield" || a.type === "mirror")),
    }),
    afterActions(ctx, p, info) {
      if (!info) return; // Escanor nasadený až počas kola (swap) - pride sa v tomto kole nemení
      p.pride = Math.max(0, Math.min(3, (p.pride || 0) + ((info.usedDefense || p.prideHit) ? -1 : 1)));
    },
  },
  special: {
    resolve(ctx, slot, tl, { dir }) {
      const { game } = ctx;
      const actor = game.players[slot];
      if (dir !== "left" && dir !== "right") { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= SPECIAL_COST;
      const pBonus = ctx.powerBoost(slot, tl); // POWER tile: +2 k slnku; spotreba pri použití - aj pri hode do autu
      const cells = G.escanorCells(game.board, actor, dir);
      if (!cells.length) {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells, offboard: true }], ESC_SPECIAL_MS);
        return;
      }
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
      const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
      if (inZone) ctx.revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
      // 1 special frame drží celú choreografiu (klient ju spustí); zásah dopadne až po nej (ESC_SPECIAL_MS)
      ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], ESC_SPECIAL_MS);
      const dmg = SPECIAL_ZONE_DMG.escanor; // 8
      if (inZone || cloneStruck) ctx.strikeZone(foeS, inZone, cloneStruck, dmg * ctx.dealMul(slot) + pBonus, tl, { kind: "special", bonus: pBonus });
      else ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
    },
  },
};
