// Jotaro: special = THE WORLD (jednorazový time-stop, mechanika v engine - doJotaroWorld / runTimestopActions).
// Po ňom (worldUsed) je special natrvalo Special 2 = smerový (left/right) 8 dmg útok na JEDINÚ susednú bunku
// (x±1, y); cez obrany ako každý dmg special. Cast z krajného stĺpca von z plochy = wall-rule whiff.
import { JOTARO_S2_COST, JOTARO_S2_DMG, SPECIAL_BEAT_MS, SMALL_DELAY_MS, JOTARO_MELEE_DMG } from "../constants.js";
import * as G from "../../shared/geometry.js";

const lr = (dir) => dir === "left" || dir === "right";

export default {
  key: "jotaro",
  kit: { attack: "diag", mirrorSlot: "special1", meleeDmg: JOTARO_MELEE_DMG }, // diagonálny basic; v slote mirroru Special 1 (nemá mirror); slabší melee
  special: {
    // Special 2 (po THE WORLD) musí niesť smer left/right; THE WORLD je bez argumentov
    validate: (ctx, a, { worldUsed }) => !worldUsed || lr(a.dir),
    resolve(ctx, slot, tl, { dir }) {
      const { game } = ctx;
      const actor = game.players[slot];
      if (!actor.worldUsed) return ctx.doJotaroWorld(slot, tl); // THE WORLD (mana gate overený v doSpecial) - vracia PAUSE
      if (!lr(dir)) { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= JOTARO_S2_COST;
      const pBonus = ctx.powerBoost(slot, tl);
      const cells = G.jotaroS2Cells(game.board, actor, dir);
      if (!cells.length) { // susedná bunka mimo plochy → útok do steny (vykoná sa, mana preč, neprečiarkuje sa)
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: [], offboard: true }], SPECIAL_BEAT_MS);
        return;
      }
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
      const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
      if (inZone) ctx.revealLabyrinths(tl);
      ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells }], SPECIAL_BEAT_MS);
      const dmg = JOTARO_S2_DMG * ctx.dealMul(slot) + pBonus;
      if (inZone || cloneStruck) ctx.strikeZone(foeS, inZone, cloneStruck, dmg, tl, { kind: "special", bonus: pBonus });
      else ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
    },
  },
};
