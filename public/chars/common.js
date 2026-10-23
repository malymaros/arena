// public/chars/common.js - spoločné konštanty klientských dát postáv (importuje ich aj client.js)
import { BASIC_COST, BASIC_DMG_MAX } from "../../shared/balance.js";
import { VAMP_SHOT_RANGE } from "../../shared/geometry.js";
export const SPECIAL_FPS = 6; // fps efektových spritov specialu (SPECIAL_ANIMS)

// Vysvetlenie tlačidla akcie z jedného textu: okno pri podržaní tlačidla na dotyku (client/peek.js) aj tooltip
// na PC. name = názov, cost = cena vo formáte štítku ({💧}N cena many, +N{💧} zisk, {☠️}N dmg, −N{❤️} HP; prázdne
// = bez ceny), text = 1–3 vety. plain = vlastná cena do tooltipu (inak sa odvodí z cost).
export function act(name, cost, text, plain = plainCost(cost)) {
  return { title: `${name}${plain ? ` (${plain})` : ""} - ${text}`, info: { name, cost, text } };
}
function plainCost(cost) {
  return (cost || "").split(/\s+/).filter(Boolean).map(p => p
    .replace(/^\+(.+?)\{💧\}$/u, "+$1 mana").replace(/^\{💧\}(.+)$/u, "−$1 mana")
    .replace(/^\{☠️\}(.+)$/u, "$1 dmg").replace(/^−(.+?)\{❤️\}$/u, "−$1 HP")).join(", ");
}

// diagonálna strela s odrazom (Vampire, Onryō, Jotaro, Luffy v Base) - jeden text pre všetkých
const fall = [1, 2, 3].map(d => Math.max(1, BASIC_DMG_MAX - d)).join(" / ");
export const DIAG_SHOT = act("RANGE ATTACK", `{💧}${BASIC_COST}`,
  `Shoots diagonally and bounces once off a wall (a corner ends it). Range ${VAMP_SHOT_RANGE}, damage ${fall} by distance.`);
