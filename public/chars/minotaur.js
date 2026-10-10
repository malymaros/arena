// public/chars/minotaur.js - klientské dáta postavy: Minotaur - labyrint na celú dosku.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "minotaur",
  // Minotaur: natívna p2 paleta (Minotaur_2, hnedý so sekerou); Charge.png = prefarbený fire fireball per paleta
  meta: { name: "Minotaur",         dir: "minotaur/Minotaur_1", dirP2: "minotaur/Minotaur_2" },
  specialAnim: { file: "Walk.png",         fps: SPECIAL_FPS, loop: true }, // bez vlastného fx spritu - cast = veľký kráčajúci Minotaur (blúdenie labyrintom)
  spriteAlias: {
    "minotaur/": { "Run.png": "Walk.png", "Attack_1.png": "Attack.png", "Attack_2.png": "Attack.png" },
  },
  portraitScale: 0.7,
  headCx: 0.46,
  headTop: 0.29,
  headCrop: { cx: 0.46, cy: 0.40, size: 0.30, cxP2: 0.51, cyP2: 0.43 }, // namerané z Idle.png (rohy+hlava riadky ~36–74); cxP2/cyP2 = korekcia na posunutú figúru v Minotaur_2
  pairShift: 70,
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "🌀" }, desc: "Whole board, no dmg - banishes the foe into the labyrinth until any hit lands, where you hunt with 2× dmg. Their steps weave a thread; stepping on it reveals your silhouette" },
};
