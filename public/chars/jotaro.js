// public/chars/jotaro.js - klientské dáta postavy: Jotaro + Star Platinum - THE WORLD; viazaný na p2.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "jotaro",
  meta: { name: "Jotaro",  dir: "jotaro", dirP2: "jotaro" },
  side: "p2",
  specialAnim: { file: "Special_2_P.png",  fps: SPECIAL_FPS, loop: true }, // Star Platinum úder (stred castu; F5 doladí per special1/2 + THE WORLD)
  portraitScale: 0.66,
  headCx: 0.47,
  headTop: 0.45,
  headCrop: { cx: 0.51, cy: 0.30, size: 0.31 }, // namerané z Idle.png (144² frame): figúra x38–105 y24–135, hlava pás y24–57 x52–95 → stred hlavy vysoko vo frame
  pairShift: 78,
  // Jotaro je hrateľný, ale kartu kreslíme preview štýlom (Idle + hover = Star Platinum „menace" Special_3_P,
  // správne zarovnané nohy cez PREVIEW_OFF_Y); dead-mag stav rieši drawCharSelectFrame PRED touto vetvou
  previewCast: { file: "Special_3_P.png", frames: 4, fps: 6, loopFrom: 3, fill: 1.31 * 160 / 144 },
  // Jotaro: THE WORLD (jednorazový time-stop) - bez konkrétnych čísel v texte (cost badge nesie 5).
  // Zóna náhľadu = celá doska (THE WORLD blik); effect ikona ⏱.
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, effect: { num: "", emoji: "⏱" }, desc: "THE WORLD (once/game): stop time, take 3 free actions - all effects resolve when time restarts." },
};
