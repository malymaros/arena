// engine/ai/weights.js - váhy hodnotiacej funkcie AI bota (engine/ai/eval.js). Ručný štart; prepisuje ho
// tools/ai-tune.mjs (self-play + logistická regresia) - nevkladať ručne čísla, ktoré už raz prepísalo ladenie.
// Taktické váhy (threat … starterPress) podľa toho, ako hru hrá vlastník (docs/AI_PLAN.md 9).
export const WEIGHTS = {
  hp: 1.6, lowHp: -0.2, mana: 0.3, specialReady: 0.1, lastBuff: 0.3, mazeBuff: 0.3, hazard: -0.3,
  level: 0.25, clone: 0.25, stone: -0.25, cursed: -0.4, onceLeft: 0.3, nextStarter: 0.05, trap: 0.15,
  threat: 0.35, lethal: 0.5, hits: 0.5, coverage: 0.25, safe: 0.3, pickup: 0.25, manaOpt: 0.3, starterPress: 0.1,
  doomBase: -0.6,
};
