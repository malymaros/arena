// public/chars/onre.js - klientské dáta postavy: Onryō (interný kľúč onre) - skrytá pasca, charge, drain many; viazaná na p2.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { DASH_COST, VAMP_CHARGE_DMG, VAMP_CHARGE_BONUS, SPECIAL_COST, VAMP_TRAP_DMG } from "../../shared/balance.js";

export default {
  key: "onre",
  meta: { name: "Onryō",   dir: "Onre", dirP2: "Onre" },
  side: "p2",
  vamp: 1,
  specialAnim: { file: "Scream.png",       fps: SPECIAL_FPS, loop: true }, // kladenie pasce - prízračný výkrik
  anims: {
    // Onreho trigger úder (Attack_1) a výkrik pri zjavení na bunke pasce; neloopové → relatívny čas (VAMP_ONESHOT_KEYS)
    vattack1: { file: "Attack_1.png", fps: 10, loop: false }, // Onre trap úder: 6f = 600 ms
    scream: { file: "Scream.png",   fps: 8,  loop: false }, // 7f = 875 ms (zmestí sa do TELEPORT_IN)
  },
  spriteAlias: {
    // Onryō: Charge.png generuje tools/sprites-countess-onre (prízračný recolor); seknutie charge = Attack_3
    Onre: { "VampStrike.png": "Attack_3.png" },
  },
  portraitScale: 0.93,
  headCx: 0.5,
  headTop: 0.45,
  headCrop: { cx: 0.50, cy: 0.52, size: 0.19 }, // úzka prízračná figúra s rohom (bbox y od 58/128)
  pairShift: 60,
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: VAMP_TRAP_DMG, bonus: "💧", target: { x: 2, y: 0 }, desc: "A hidden trap on ANY cell - when the foe enters or crosses it, she teleports there and strikes. Charge and trap hits drain the foe's mana; mirrors are mere shields against her" },
  buttons: {
    // dash slot = charge (fialový „???" skin aj na pickeri), diagonálny basic s odrazom
    dash: {
      skin: "vamp-charge",
      title: `Charge - rush in a direction; stops at the first foe and strikes for ${VAMP_CHARGE_DMG} dmg. A landed hit drains up to ${VAMP_CHARGE_BONUS} mana into yours (blocked = nothing)`,
      cost: `−${DASH_COST}{💧} ${VAMP_CHARGE_DMG}{☠️}{💧}`,
    },
    attack: { title: "Range Attack - a diagonal shot that bounces once off a wall (corners end it); damage falls off with distance" },
    // pasca - teleport + bezplatný úder pri súperovom vstupe/prechode
    special: {
      title: `Special (−${SPECIAL_COST} mana, ${VAMP_TRAP_DMG} dmg) - set a hidden trap on ANY cell (even the foe's current one). When the foe crosses it, you teleport there and strike for free; a landed hit drains the foe's mana into yours. Only one trap - recasting replaces it`,
      cost: `−${SPECIAL_COST}{💧} ${VAMP_TRAP_DMG}{☠️}{💧}`,
    },
  },
  // mini mapa BEZ blokovaných buniek; cast bliká celou plochou (server posiela cells), cieľ sa nezvýrazní - pasca je tajná
  specialTarget: "trap",
  // úzky diagonálny projektil - čistá rotácia (base = doprava), nie scaleX zrkadlenie
  projectile: { orient: "rotate" },
};
