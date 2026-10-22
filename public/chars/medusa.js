// public/chars/medusa.js - klientské dáta postavy: Medusa - smerové skamenenie (bez dmg).
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { MELEE_COST, MEDUSA_MELEE_DMG, SPECIAL_COST, STONE_ACTIONS } from "../../shared/balance.js";

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
  abilityPreview: { caster: { x: 1, y: 1 }, dmg: null, dir: "right", effect: { num: `${STONE_ACTIONS}×`, emoji: "🗿" }, desc: `Own cell + everything one way (row ±1). No damage - petrifies: target skips ${STONE_ACTIONS} actions` },
  buttons: {
    // širší dosah melee (diagonály) za nižší dmg
    melee: { title: `Melee (−${MELEE_COST} mana, ${MEDUSA_MELEE_DMG} dmg, hits your cell + all diagonal neighbours)`, cost: `−${MELEE_COST}{💧} ${MEDUSA_MELEE_DMG}{☠️}`, label: `{💧}${MELEE_COST} {☠️}${MEDUSA_MELEE_DMG}` },
    // žiadny dmg - skamenenie na 2 akcie (smer sa volí v pickeri)
    special: { title: `Special (−${SPECIAL_COST} mana) - petrifying gaze: choose a direction; a hit opponent skips their next ${STONE_ACTIONS} actions`, cost: `−${SPECIAL_COST}{💧} ${STONE_ACTIONS}×🗿`, label: `{💧}${SPECIAL_COST} PETRIFY ${STONE_ACTIONS}` },
  },
  specialTarget: "dir", // smerový special (left/right picker)
  // vlastné políčko + všetko striktne zvoleným smerom v riadkoch ±1
  specialZone: ({ G, board, me, dir }) => G.medusaCells(board, me, dir),
  // melee = šľah celým telom (Attack_1), basic strela = Attack_2
  actionAnims: { melee: "attack1_loop", shot: "attack2" },
  // ⚠ pri plánovaní: súper je pri tejto akcii ešte socha (kameň ubúda až na konci kroku jeho posledného skameneného ťahu)
  planSpecialWarn: ({ i, foe }) => (foe?.stone || 0) > i ? "Opponent is still petrified at this point - petrify has no effect" : null,
};
