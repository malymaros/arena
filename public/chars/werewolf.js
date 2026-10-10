// public/chars/werewolf.js - klientské dáta postavy: Werewolf - charge v 8 smeroch, dmg podľa fázy mesiaca.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";

export default {
  key: "werewolf",
  // Vlkolak: natívna p2 paleta (Werewolf_2, teplejší odtieň); Charge.png = prefarbený fire fireball per paleta
  // (P1 mesačná modrá, P2 krvavá červená) - tools/sprites-werewolf
  meta: { name: "Werewolf",         dir: "Werewolf_1", dirP2: "Werewolf_2" },
  specialAnim: { file: "Run+Attack.png",   fps: SPECIAL_FPS, loop: true }, // rozbeh charge - veľký stredový sprite hrá LEN Run+Attack (Attack_2 seknutie je na malej figúre pri dopade)
  anims: {
    // Vlkolak: beh charge specialu (Run+Attack) + seknutie na bunke terča (WolfStrike.png → alias Attack_2.png);
    // neloopové → raf ho kreslí relatívnym časom od setAnim (drawT), inak by viselo na poslednom frame
    wolfrun: { file: "Run+Attack.png", fps: 12, loop: true },
    wolfstrike: { file: "WolfStrike.png", fps: 5, loop: false },
  },
  spriteAlias: {
    // Vlkolak (prefix chytí Werewolf_1 aj _2): melee = Attack_3; natívny Attack_2 je rezervovaný pre
    // seknutie charge specialu (kľúč wolfstrike žiada fiktívny WolfStrike.png → mapuje sa naň)
    Werewolf_: { "Attack_2.png": "Attack_3.png", "WolfStrike.png": "Attack_2.png" },
  },
  headCx: 0.5,
  headTop: 0.55,
  headCrop: { cx: 0.73, cy: 0.62, size: 0.24, cxP2: 0.72 }, // zhrbený vlk hľadí doprava - hlava vpredu vpravo (bbox po recentrovaní x27–102, y71–127)
  pairShift: 110,
  // Vlkolak: charge - náhľad ukazuje príkladovú dráhu doprava (bez súpera = po okraj); dmg podľa fázy
  // mesiaca cykluje pod mini-doskou (moonCycle - ako Escanorov pride náhľad), preto žiadny effect/stats riadok
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: null, dir: "right", moonCycle: true, desc: "Charge in one of 8 directions - stops at the first foe in his path (or the edge). The lower his HP, the fuller the moon and the higher the dmg" },
};
