// engine/characters/portal-charge.js - Portal Realm: útočné efekty portálov prejdených Luffyho guľou:
// powerup = flat +2 za každý powerup portál. Def-breaker sa na guľu NEvzťahuje (platí len na strely basic
// útoku) a charge Vlkolaka/Vampíra/Onryō nedostávajú ani powerup - len efekty tela (balančná zmena 2026-10-29).
// Guľa stojí v strede výbuchu, takže zrkadlo ju trafí PRIAMO (žiadny odraz do steny - reflectVoid sa nepoužíva).
import { PORTAL_POWER_BONUS } from "../constants.js";

export function portalCharge(passes = []) {
  const power = passes.filter(p => p.type === "power").length * PORTAL_POWER_BONUS;
  return { power, opts: passes.length ? { portalBonus: power } : {} };
}
