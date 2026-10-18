// public/chars/countess.js - klientské dáta postavy: Vampire (interný kľúč countess) - skrytá pasca, charge, liečenie z krvi; viazaná na p1.
// Polia a ich význam: public/chars/index.js (skladá z nich tabuľky, ktoré používa client.js).
import { SPECIAL_FPS } from "./common.js";
// čísla balansu - jediný zdroj (relatívna cesta funguje v prehliadači aj v Node)
import { DASH_COST, VAMP_CHARGE_DMG, VAMP_CHARGE_BONUS, SPECIAL_COST, VAMP_TRAP_DMG } from "../../shared/balance.js";

export default {
  key: "countess",
  // Hidden stránka (easter egg): postavy viazané na stranu - Vampire VÝHRADNE P1, Onryō VÝHRADNE P2
  // (karty per strana skrýva CSS cez data-side; hrateľné len v single/bo3, turnaj Hidden stránku nepustí).
  // Onre hrá vždy vpravo vo svojej natívnej palete → dirP2 = ten istý priečinok (žiadny albino filter).
  meta: { name: "Vampire", dir: "Countess_Vampire" },
  side: "p1",
  vamp: 1,
  specialAnim: { file: "A5.png",           fps: SPECIAL_FPS, loop: true }, // kladenie pasce - celá útočná sekvencia A1–A4 (17f); pri caste sa hrá RAZ od frame 0 (server drží jeden dlhý VAMP_CAST_MS frame), loop len pre victory/preview. Cieľová bunka sa NEzvýrazňuje, pasca je tajná
  anims: {
    // Countess/Onre: beh melee-charge (Run) + seknutie na bunke terča (VampStrike.png → alias Attack_4/Attack_3);
    // neloopové seknutie kreslí raf relatívnym časom (drawT) ako wolfstrike
    vamprun: { file: "Run.png", fps: 12, loop: true },
    vampstrike: { file: "VampStrike.png", fps: 8, loop: false },
    // Countess melee/pasca (podľa vampire_attack_guide): úder = A1 (krvavý bolt zapečený vo framoch),
    // po dopadnutom dmg liečivé beaty A2→A3→A4 a až po nich +HP - jednotné pre charge melee, center
    // melee aj trigger pasce. Onreho trigger úder ostáva Attack_1; na bunke pasce sa zjavuje s výkrikom
    // (Scream). Všetko neloopové → kreslené relatívnym časom (VAMP_ONESHOT_KEYS), inak by viseli na
    // poslednom frame. fps ladené tak, aby sa švih prehral CELÝ v rámci svojho beatu
    // (VAMP_TRAP_STRIKE/WOLF_STRIKE 900 ms, VAMP_HEAL_BEAT 810 ms)
    va1: { file: "A1.png", fps: 7, loop: false }, // úder + bolt: 6f = 857 ms
    va2: { file: "A2.png", fps: 4, loop: false }, // heal beat 1 (kvapky): 3f = 750 ms
    va3: { file: "A3.png", fps: 3, loop: false }, // heal beat 2 (véčko): 2f = 667 ms
    va4: { file: "A4.png", fps: 8, loop: false }, // heal beat 3 (vlna): 6f = 750 ms
  },
  spriteAlias: {
    // Vampire: Charge.png generuje tools/sprites-countess-onre (centrovaná červená strela);
    // VampStrike sa u nej už nepoužíva (úder = A1), alias ostáva pre istotu
    Countess_Vampire: { "VampStrike.png": "Attack_4.png" },
  },
  portraitScale: 0.93,
  headCx: 0.49,
  headTop: 0.45,
  headCrop: { cx: 0.49, cy: 0.52, size: 0.19 }, // blond drdol (bbox y od 58/128) - hlava nad širokou sukňou
  pairShift: 80,
  // Countess/Onre: pasca - náhľad ukazuje príkladovú cieľovú bunku (target) ako Vojak
  // bonus ikona (heal/drain) sa ukazuje v stats riadku pri dmg (3☠️❤️ / 3☠️💧), nie v texte popisu
  abilityPreview: { caster: { x: 0, y: 1 }, dmg: VAMP_TRAP_DMG, bonus: "❤️", target: { x: 2, y: 0 }, desc: "A hidden trap on ANY cell - when the foe enters or crosses it, she teleports there and strikes. Charge and trap hits feed on blood; mirrors are mere shields against her" },
  buttons: {
    // dash slot = charge (fialový „???" skin aj na pickeri), diagonálny basic s odrazom
    dash: {
      skin: "vamp-charge",
      title: `Charge - rush in a direction; stops at the first foe and strikes for ${VAMP_CHARGE_DMG} dmg. A landed hit heals up to ${VAMP_CHARGE_BONUS} HP (blocked = nothing)`,
      cost: `−${DASH_COST}{💧} ${VAMP_CHARGE_DMG}{☠️}{❤️}`,
    },
    attack: { title: "Range Attack - a diagonal shot that bounces once off a wall (corners end it); damage falls off with distance" },
    // pasca - teleport + bezplatný úder pri súperovom vstupe/prechode
    special: {
      title: `Special (−${SPECIAL_COST} mana, ${VAMP_TRAP_DMG} dmg) - set a hidden trap on ANY cell (even the foe's current one). When the foe crosses it, you teleport there and strike for free; a landed hit heals you. Only one trap - recasting replaces it`,
      cost: `−${SPECIAL_COST}{💧} ${VAMP_TRAP_DMG}{☠️}{❤️}`,
    },
  },
  // mini mapa BEZ blokovaných buniek; cast bliká celou plochou (server posiela cells), cieľ sa nezvýrazní - pasca je tajná
  specialTarget: "trap",
  // úzky diagonálny projektil - čistá rotácia (base = doprava), nie scaleX zrkadlenie
  projectile: { orient: "rotate" },
};
