// engine/ai/weights.js - váhy hodnotiacej funkcie AI bota (engine/ai/eval.js). Ručný štart; prepisuje ho
// tools/ai-tune.mjs (self-play + logistická regresia) - nevkladať ručne čísla, ktoré už raz prepísalo ladenie.
export const WEIGHTS = {
  hp: 2.0, lowHp: -0.3, mana: 0.5, specialReady: 0.15, lastBuff: 0.3, mazeBuff: 0.3, hazard: -0.4,
  level: 0.25, clone: 0.25, stone: -0.25, cursed: -0.4, onceLeft: 0.3, nextStarter: 0.05, trap: 0.15,
  doomBase: -0.6,
};
