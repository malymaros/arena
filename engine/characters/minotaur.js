// Minotaur: special nedáva dmg - CELOPLOŠNÝ (zasiahne súpera vždy), prenesie ho do LABYRINTU:
// súper nevidí board (len vlastnú bunku + svoju niť), kým jeden hráč nezasiahne druhého.
// Ide cez obrany ako petrify (shield blokuje, mirror odrazí - v labyrinte skončí sám Minotaur).
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS } from "../constants.js";
import * as G from "../../shared/geometry.js";

export default {
  key: "minotaur",
  special: {
    resolve(ctx, slot, tl) {
      const { game } = ctx;
      const actor = game.players[slot];
      actor.mana -= SPECIAL_COST;
      const cells = G.allCells(game.board);
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      // istý zásah - kasterov prípadný VLASTNÝ labyrint (mirror match) sa odhalí ešte pred nádychmi
      if (foe && !foe.labyrinth) ctx.revealLabyrinths(tl);
      for (let r = 0; r < SPECIAL_REPEAT; r++) {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SPECIAL_BEAT_MS);
      }
      if (!foe) { ctx.pushStateFrame(tl, [], SMALL_DELAY_MS); return; }
      // súper už blúdi v labyrinte: útok bez efektu, niť sa neresetuje
      if (foe.labyrinth) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "already_lost"); return; }
      ctx.applyLabyrinth(foeS, tl);
      // celoplošný special zasiahne aj súperovho tieňového klona (obrana ho kryje - už sa ukázala vyššie)
      ctx.applyStatusOnClone(foeS, tl, "labyrinth", true);
    },
  },
};
