// public/chars/soldier.js - klientské dáta postavy: Soldier - snajperský lúč na zvolenú bunku.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "soldier",
  // Vojak: p2 = soldier_2 (uniforma prefarbená na čiernu - tools/sprites-soldier); Charge.png = kotúľajúci sa granát
  meta: { name: "Soldier",          dir: "soldier", dirP2: "soldier_2" },
  specialAnim: { file: "Shot_2.png",       fps: SPECIAL_FPS, loop: true }, // loop len pre victory/preview - pri caste NECYKLÍ: mierenie (frame 0 + laser sight) → jeden výšľah → lúč (SOLDIER_AIM/FIRE)
  anims: {
    // Vojak: vlastná póza pri recharge (ostatné postavy hrajú len auru v idle); loop - neslučkové anims
    // sa kreslia absolútnym časom (držali by len posledný frame), slučka sa pri frameHold ~1s prehrá raz
    recharge: { file: "Recharge.png", fps: 12, loop: true },
  },
  spriteAlias: {
    // Vojak (prefix chytí aj soldier_2): basic útok = hod granátom, melee = výstrel zblízka (Shot_1)
    soldier: { "Attack_1.png": "Grenade.png", "Attack_2.png": "Shot_1.png" },
  },
  headCx: 0.47,
  headTop: 0.48,
  headCrop: { cx: 0.46, cy: 0.555, size: 0.22 }, // hlava namerané z Idle.png riadky 62–82 (stred x ≈ 0.46) - telo sa nakláňa doprava, hlava je nad ľavou nohou
  pairShift: 70,
  // Vojak: cieľová bunka je voľba hráča - náhľad ukazuje príkladový cieľ (target), nie odvodenú zónu
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: 10, target: { x: 2, y: 0 }, desc: "Pick any cell except your own and the foe's current one - a sniper beam strikes it, so the foe is hit only if they move onto it" },
};
