// engine/characters/portal-charge.js - Portal Realm: útočné efekty portálov prejdených behom (charge Vlkolaka,
// Vampíra/Onryō, Luffyho guľa): powerup = flat +2 za každý powerup portál, Def-breaker = súperova obrana sa minie.
// Útočník stojí pri cieli, takže zrkadlo ho trafí PRIAMO (žiadny odraz do steny - reflectVoid sa nepoužíva).
import { PORTAL_POWER_BONUS } from "../constants.js";

export function portalCharge(passes = []) {
  const power = passes.filter(p => p.type === "power").length * PORTAL_POWER_BONUS;
  const defBreak = passes.some(p => p.type === "nodef");
  return { power, opts: passes.length ? { defBreak, portalBonus: power } : {} };
}
