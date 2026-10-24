// public/client/fx-registry.js - inštancie klientskej choreografie postáv (public/chars/fx/<key>.js).
// Továrne dostanú klientský scope C (lenivé gettery v client.js) - client.js ich nainštaluje cez initCharFx(C)
// hneď po zostavení C; háčiky sa volajú až počas hry, takže ostatné moduly môžu CHAR_FX importovať vopred.
import { CHAR_FX_FACTORIES } from "/chars/fx/index.js";

// háčiky choreografie per postava (effect / boardAnim / centerCanvas / drawCenter - popis v public/chars/fx/index.js)
export const CHAR_FX = {};
export function initCharFx(C) {
  for (const [k, f] of Object.entries(CHAR_FX_FACTORIES)) CHAR_FX[k] = f(C);
}
// háčik volaný na KAŽDOM module fx, ktorý ho má (position / drawBoard / stateChar / resetActors / hud / roundIntro);
// vráti výsledky volaní (roundIntro → oneskorenie timeline v ms)
export const fxAll = (hook, ...args) => Object.values(CHAR_FX).filter(fx => fx[hook]).map(fx => fx[hook](...args));
// generický stredový overlay / casting póza efektu kind sa preskočí - choreografiu vlastní register fx (Jotaro)
export const fxOwnsCenter = (char, kind) => !!CHAR_FX[char]?.ownCenter?.includes(kind);
// koniec hry/medzihra: uprac vlastné overlaye postáv (napr. Luffyho stredová guľa a ruka), ktoré renderGrid nemaže
export const clearCharOverlays = () => Object.values(CHAR_FX).forEach(fx => fx.clearOverlays?.());
