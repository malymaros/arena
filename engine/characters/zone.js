// Zónový dmg special (fire / lightning / wanderer): zóna zo shared/geometry podľa postavy, 3 nádychy,
// zásah súpera aj jeho klona v jednom beate (strikeZone). Fire na Damage dlaždici: zóna ±1 riadok
// a dlaždica sa po nádychoch SKONZUMUJE (aj keď special minul / bol blokovaný).
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS, SOLDIER_SPECIAL_DMG } from "../constants.js";
import * as G from "../../shared/geometry.js";

// raw dmg zónových speciálov (aj pre odraz pri zásahu klona)
export const SPECIAL_ZONE_DMG = { fire: 5, lightning: 3, wanderer: 8, escanor: 8, soldier: SOLDIER_SPECIAL_DMG };

export function zoneSpecial(ctx, slot, tl) {
  const { game } = ctx;
  const actor = game.players[slot];
  actor.mana -= SPECIAL_COST;
  // POWER tile: +2 k zóne; spotreba pri použití - aj keď zóna minie
  const pBonus = ctx.powerBoost(slot, tl);

  // vyhodnotenie zásahu je deterministické už pred nádychmi (pozície sa počas nich nemenia) -
  // istý zásah odhalí prípadný labyrint ešte PRED animáciou špeciálu
  const foeS = ctx.other(slot);
  const foe = game.players[foeS];
  const onDmg = ctx.fireOnDmgTile(actor);
  const inZone = (x, y) => G.zoneHas(game.board, actor, x, y, onDmg);
  const ownerHit = !!(foe && inZone(foe.x, foe.y));
  // súperov tieňový klon v zóne - zomiera spolu so zásahom hráča (zóna zasahuje oboch naraz)
  const cloneStruck = !!(foe?.clone && inZone(foe.clone.x, foe.clone.y));
  if (ownerHit) ctx.revealLabyrinths(tl);

  // 3× „nádych" (caster animuje špeciál; klient bliká rozsah)
  for (let r = 0; r < SPECIAL_REPEAT; r++) {
    ctx.pushStateFrame(tl, [{ kind: "special", from: slot }], SPECIAL_BEAT_MS);
  }
  // Fire: spotreba Damage dlaždice AŽ PO nádychoch (animácia dokončená) - krátky flare na klientovi
  if (onDmg) {
    game.tiles = game.tiles.filter(t => !(t.type === "dmg" && t.x === actor.x && t.y === actor.y));
    ctx.pushStateFrame(tl, [{ kind: "tile_consume", from: slot, cell: [actor.x, actor.y] }], SMALL_DELAY_MS);
  }
  // Naruto + jeho klon = tá istá postava so zdieľanou obranou → ak zóna zasiahne oboch, block/odraz/hit idú NARAZ;
  // zóna minula súpera, ale trafila jeho klona → klon reaguje sám (POWER bonus nesie aj tento zásah)
  if (ownerHit || cloneStruck) {
    ctx.strikeZone(foeS, ownerHit, cloneStruck, (SPECIAL_ZONE_DMG[actor.char] || 0) * ctx.dealMul(slot) + pBonus, tl, { kind: "special", bonus: pBonus });
  } else {
    ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
  }
}
