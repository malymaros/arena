// public/chars/fire.js - klientské dáta postavy: Fire Wizard - special zasiahne celý riadok (na Damage dlaždici ±1 riadok).
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "fire",
  meta: { name: "Fire Wizard",      dir: "fire", dirP2: "fire_2" },
  specialAnim: { file: "Flame_jet.png",    fps: SPECIAL_FPS, loop: true },
  headCx: 0.43,
  headTop: 0.48,
  headCrop: { cx: 0.40, cy: 0.55, size: 0.26 },
  teleportDir: "Fire",
  teleportCount: 6,
  teleportFx: { scale: 1.0, anchor: "feet" }, // oheň horí od zeme, zmestí sa do políčka
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: 5, desc: `Boost range ±1 row from <span class="pix-ico mini" data-pix="flame"></span> tiles<br>Range: whole row` },
};
