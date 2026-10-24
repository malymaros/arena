// Jotaro: special = THE WORLD (jednorazový time-stop, mechanika v engine - doJotaroWorld / runTimestopActions).
// Po ňom (worldUsed) je special natrvalo Special 2 = smerový (left/right) 8 dmg útok na JEDINÚ susednú bunku
// (x±1, y); cez obrany ako každý dmg special. Cast z krajného stĺpca von z plochy = wall-rule whiff.
// Special 1 (mirror slot) = 4 dmg na OBE diagonálne bunky zvolenej strany.
import { JOTARO_S1_COST, JOTARO_S1_DMG, JOTARO_S2_COST, JOTARO_S2_DMG, SPECIAL_BEAT_MS, SMALL_DELAY_MS, JOTARO_MELEE_DMG } from "../constants.js";
import * as G from "../../shared/geometry.js";

export const lr = (dir) => dir === "left" || dir === "right";

// smerový úder na zónu cells (Jotaro Special 1 / Special 2, Luffyho Special 2): mana, POWER tile, cast frame
// a zásah súpera aj jeho klona v zóne (strikeZone). Prázdna zóna (útok z krajného stĺpca von) = wall-rule
// whiff - akcia sa vykoná, mana je preč, neprečiarkuje sa. kind = efekt cast frame-u (special / special1).
export function zoneStrike(ctx, slot, tl, { dir, cells, cost, dmg, kind }) {
  const { game } = ctx;
  const actor = game.players[slot];
  actor.mana -= cost;
  const pBonus = ctx.powerBoost(slot, tl); // POWER tile: +2; spotreba pri použití (aj whiff/block/odraz)
  if (!cells.length) {
    ctx.pushStateFrame(tl, [{ kind, from: slot, dir, cells: [], offboard: true }], SPECIAL_BEAT_MS);
    return;
  }
  const foeS = ctx.other(slot);
  const foe = game.players[foeS];
  const inZone = !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y));
  const cloneStruck = !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y));
  if (inZone) ctx.revealLabyrinths(tl); // istý zásah odhalí prípadný labyrint pred animáciou
  ctx.pushStateFrame(tl, [{ kind, from: slot, dir, cells }], SPECIAL_BEAT_MS);
  const raw = dmg * ctx.dealMul(slot) + pBonus;
  if (inZone || cloneStruck) ctx.strikeZone(foeS, inZone, cloneStruck, raw, tl, { kind: "special", bonus: pBonus });
  else ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
}

export default {
  key: "jotaro",
  kit: { attack: "diag", mirrorSlot: "special1", meleeDmg: JOTARO_MELEE_DMG }, // diagonálny basic; v slote mirroru Special 1 (nemá mirror); slabší melee
  // Special 1 (mirror slot): smer left/right, 4 dmg na obe diagonálne bunky strany
  special1: {
    args: "dir",
    resolve(ctx, slot, tl, { dir }) {
      const actor = ctx.game.players[slot];
      if (!lr(dir)) { ctx.pushInvalid(tl, slot); return; }
      if (actor.mana < JOTARO_S1_COST) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
      zoneStrike(ctx, slot, tl, { dir, cells: G.jotaroS1Cells(ctx.game.board, actor, dir), cost: JOTARO_S1_COST, dmg: JOTARO_S1_DMG, kind: "special1" });
    },
  },
  special: {
    // Special 2 (po THE WORLD) musí niesť smer left/right; THE WORLD je bez argumentov
    validate: (ctx, a, { worldUsed }) => !worldUsed || lr(a.dir),
    resolve(ctx, slot, tl, { dir }) {
      const actor = ctx.game.players[slot];
      if (!actor.worldUsed) return ctx.doJotaroWorld(slot, tl); // THE WORLD (mana gate overený v doSpecial) - vracia PAUSE
      if (!lr(dir)) { ctx.pushInvalid(tl, slot); return; }
      zoneStrike(ctx, slot, tl, { dir, cells: G.jotaroS2Cells(ctx.game.board, actor, dir), cost: JOTARO_S2_COST, dmg: JOTARO_S2_DMG, kind: "special" });
    },
  },
};
