// engine/characters/portal-charge.js - Portal Realm: útočné efekty portálov prejdených behom (charge Vlkolaka,
// Vampíra/Onryō, Luffyho guľa): powerup = flat +2 za každý powerup portál. Def-breaker sa na beh NEvzťahuje
// (platí len na strely basic útoku - balančná zmena 2026-10-29), beh ním portál len spáli.
// Útočník stojí pri cieli, takže zrkadlo ho trafí PRIAMO (žiadny odraz do steny - reflectVoid sa nepoužíva).
import { PORTAL_POWER_BONUS } from "../constants.js";

export function portalCharge(passes = []) {
  const power = passes.filter(p => p.type === "power").length * PORTAL_POWER_BONUS;
  return { power, opts: passes.length ? { portalBonus: power } : {} };
}
