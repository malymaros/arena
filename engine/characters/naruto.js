// Naruto: special nedáva dmg - TIEŇOVÝ KLON. Range self: nedá sa blokovať ani odraziť, ale Naruto musí
// stáť na bunke SÁM (bez súpera; vlastný klon nevadí). Recast s aktívnym klonom: starý klon najprv zmizne
// ako po zásahu, potom beží bežný summon. Klon vzniká na Narutovej bunke.
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS, CLONE_SUMMON_MS } from "../constants.js";

export default {
  key: "naruto",
  special: {
    resolve(ctx, slot, tl) {
      const { game } = ctx;
      const actor = game.players[slot];
      const foe = game.players[ctx.other(slot)];
      // summon vyžaduje bunku bez súpera - súper stojaci na Narutovej bunke je JEDINÝ spôsob, ako special
      // zablokovať; mana sa minie aj tak. Starý klon zaniká VŽDY (recast aj blok) ešte PRED pečaťami.
      actor.mana -= SPECIAL_COST;
      ctx.killClone(slot, tl);
      if (foe && foe.x === actor.x && foe.y === actor.y) {
        for (let r = 0; r < SPECIAL_REPEAT; r++)
          ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
        ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "not_alone");
        return;
      }
      // pečate (Special.png) v rovnakej kadencii ako ostatné speciály; zóna = vlastná bunka
      for (let r = 0; r < SPECIAL_REPEAT; r++) {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells: [[actor.x, actor.y]] }], SPECIAL_BEAT_MS);
      }
      // summon choreografia: Naruto + kópia na tej istej bunke tvárou v tvár hrajú Special_2, potom klon vznikne
      ctx.pushStateFrame(tl, [{ kind: "clone_summon", from: slot, cell: [actor.x, actor.y] }], CLONE_SUMMON_MS);
      actor.clone = { x: actor.x, y: actor.y };
      ctx.pushStateFrame(tl, [{ kind: "clone_born", from: slot, cell: [actor.x, actor.y] }], SMALL_DELAY_MS);
    },
  },
};
