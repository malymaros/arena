// Postavy so zónovým dmg specialom bez vlastných pravidiel (fire / lightning / wanderer).
// Rozdiel je len v tvare zóny (shared/geometry zoneCells) a dmg (SPECIAL_ZONE_DMG).
import { zoneSpecial } from "./zone.js";

const zoneChar = (key, kit = {}) => ({ key, kit, special: { resolve: zoneSpecial } });

export const fire = zoneChar("fire");           // celý riadok; na Damage dlaždici riadky ±1 (dlaždicu skonzumuje)
export const lightning = zoneChar("lightning", { healTile: "full" }); // všetky bunky opačnej šachovej farby; heal dlaždica lieči do plna
export const wanderer = zoneChar("wanderer");   // diagonálne susedné bunky
