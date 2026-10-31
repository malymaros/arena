// Medúza: special nedáva dmg - súpera v zóne SKAMENÍ (preskočí najbližšie 2 základné akcie).
// Zóna má smer (left/right), v labyrinte sa zúži na jej vlastné políčko; zásah ide cez obrany (shield blokuje, mirror odrazí kameň na Medúzu).
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS, MEDUSA_MELEE_DMG } from "../constants.js";
import * as G from "../../shared/geometry.js";

export default {
  key: "medusa",
  kit: { meleeDmg: MEDUSA_MELEE_DMG }, // melee chvostom aj na diagonálne susedné bunky (G.meleeCells) za nižší dmg
  special: {
    resolve(ctx, slot, tl, { dir }) {
      const { game } = ctx;
      const actor = game.players[slot];
      // stratená v labyrinte smer nevolí (a ak sa stratila až po naplánovaní, smer sa ignoruje)
      if (actor.labyrinth) dir = null;
      else if (dir !== "left" && dir !== "right") { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= SPECIAL_COST;
      const cells = G.medusaCells(game.board, actor, dir); // bez smeru = len vlastné políčko
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
      // súperov tieňový klon v zóne skamenenie nezvládne - zmizne (zóna zasahuje hráča aj klona naraz)
      const cloneInZone = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
      // istý zásah (aj do štítu/zrkadla) - prípadný labyrint sa odhalí ešte PRED nádychmi
      if (inZone && !(foe.stone > 0)) ctx.revealLabyrinths(tl);
      for (let r = 0; r < SPECIAL_REPEAT; r++) {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], SPECIAL_BEAT_MS);
      }
      ctx.shrekPetrify(cells, tl); // Shrek Swamp: Shrek v zóne skamenie (nemá obrany)
      if (!inZone && !cloneInZone) {
        ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
        return;
      }
      const foeStruck = inZone && !(foe.stone > 0);
      if (inZone) {
        // už skamenený súper: útok bez efektu, žiadny refresh countera
        if (foe.stone > 0) ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "already_stone");
        else ctx.applyPetrify(foeS, tl);
      }
      if (cloneInZone) ctx.applyStatusOnClone(foeS, tl, "petrify", foeStruck);
    },
  },
};
