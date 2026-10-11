// public/chars/naruto.js - klientské dáta postavy: Naruto - tieňový klon.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { SPECIAL_COST } from "../../shared/balance.js";

export default {
  key: "naruto",
  // Naruto: natívna p2 paleta (žltý kostým + zlatá čakra - paletový swap z kostýmov v sheete)
  meta: { name: "Naruto",           dir: "naruto/Naruto_1", dirP2: "naruto/Naruto_2" },
  specialAnim: { file: "Special.png",      fps: SPECIAL_FPS, loop: true }, // pečate rukami (summon tieňového klona)
  anims: {
    // Naruto: summon klona - po pečatiach hrá postava (aj kópie po bokoch) Special_2 (dýchanie)
    special2: { file: "Special_2.png", fps: 6, loop: true },
  },
  headCx: 0.5,
  headTop: 0.51,
  headCrop: { cx: 0.50, cy: 0.58, size: 0.26 }, // bojový postoj (Stance) - figúra centrovaná, bottom-anchor
  pairShift: 80,
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "👥" }, desc: "Self (must stand alone) - summons a shadow clone that copies his moves (up/down inverted), deals the same dmg as Naruto (double when stacked on his cell) and vanishes on any hit" },
  buttons: {
    // žiadny priamy dmg - musí stáť sám, prizve tieňového klona
    special: { title: `Special (−${SPECIAL_COST} mana) - must stand alone: summons a shadow clone that copies his moves (up/down inverted), deals the same dmg as Naruto (double when stacked on his cell) and vanishes on any hit`, cost: `−${SPECIAL_COST}{💧} 👥` },
  },
  // range self - summon tieňového klona na vlastnej bunke (musí na nej stáť sám)
  specialZone: ({ me }) => [[me.x, me.y]],
  // plánovanie: special prizve klona; s klonom akcia do steny nie je zbytočná (klonova figúra sa môže pohnúť/strieľať)
  planClone: true,
};
