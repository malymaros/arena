// public/chars/medusa.js - klientské dáta postavy: Medusa - smerové skamenenie (bez dmg).
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "medusa",
  // Medúza: pravá strana (p2) má NATÍVNU tmavú paletu (Medusa2) namiesto CSS alt-color filtra;
  // Charge.png = prefarbený fire fireball (zeleno-žltý / fialový) vygenerovaný per paleta
  meta: { name: "Medusa",           dir: "medusa/Medusa", dirP2: "medusa/Medusa2" },
  specialAnim: { file: "Special.png",      fps: SPECIAL_FPS, loop: true },
  portraitScale: 0.85,
  headCx: 0.47,
  headTop: 0.4,
  headCrop: { cx: 0.45, cy: 0.48, size: 0.30 }, // namerané z Idle.png (hlava+hady riadky ~51–73)
  pairShift: 80,
  // dmg: null = bez dmg - stats ukážu efekt (effect.num/emoji); zóna Medúzy sa kreslí pre smer doprava
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, dir: "right", effect: { num: "2×", emoji: "🗿" }, desc: "Own cell + everything one way (row ±1). No damage - petrifies: target skips 2 actions" },
};
