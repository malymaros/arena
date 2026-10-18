// Postavy so zónovým dmg specialom bez vlastných pravidiel (fire / lightning / wanderer).
// Rozdiel je len v tvare zóny (shared/geometry zoneCells) a dmg (SPECIAL_ZONE_DMG).
import { zoneSpecial } from "./zone.js";
import { MAX_MANA, WANDERER_MANA_REGEN, SMALL_DELAY_MS } from "../constants.js";

const zoneChar = (key, kit = {}, on = {}) => ({ key, kit, on, special: { resolve: zoneSpecial } });

export const fire = zoneChar("fire");           // celý riadok; na Damage dlaždici riadky ±1 (dlaždicu skonzumuje)
export const lightning = zoneChar("lightning", { healTile: "full" }); // všetky bunky opačnej šachovej farby; heal dlaždica lieči do plna
// diagonálne susedné bunky; pasívne +WANDERER_MANA_REGEN many na konci kola - len ak žije a v tomto kole NEpoužil
// mirror (obyčajný ani golden; číta sa FRONTA - mirror zmarený BLOCK tile regen tiež ruší). Čierna recharge animácia.
export const wanderer = zoneChar("wanderer", {}, {
  roundStart: (ctx, p) => ({ usedMirror: !!p.goldenMirror || (p.queue || []).some(a => a && a.type === "mirror") }),
  roundEndFx(ctx, p, slot, info, tl) {
    if (p.hp <= 0) return;
    if (info?.usedMirror) {
      // použil mirror → žiadna pasívna mana; oznám hráčovi dôvod (float „MIRROR USED")
      ctx.pushStateFrame(tl, [{ kind: "wanderer_no_regen", target: slot }], SMALL_DELAY_MS);
      return;
    }
    const gain = Math.min(MAX_MANA - p.mana, WANDERER_MANA_REGEN);
    if (gain > 0) {
      p.mana += gain;
      ctx.pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gain, dark: true }], SMALL_DELAY_MS);
    }
  },
});
