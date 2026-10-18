// public/client/balance-ui.js - texty spoločných akčných tlačidiel (tooltip + cenovka) zostavené z čísel
// v shared/balance.js. Pri načítaní ich zapíše do statických tlačidiel z index.html (HTML nesie len kostru,
// žiadne čísla), controls.js z nich berie bežný vzhľad tlačidiel, ktoré postava môže preskinovať (BTN_BASE).
// Cenovka: {emoji} = pixelová mini ikona (rovnaký formát ako buttons.* v public/chars/<key>.js).
import {
  BASIC_COST, BASIC_DMG_MAX, MELEE_COST, MELEE_DMG, DASH_COST, RECHARGE_GAIN, SHIELD_COST, MIRROR_COST, SPECIAL_COST,
  GOLDEN_COST, GOLDEN_MIRROR_COST, GOLDEN_MANA_GAIN, START_HP, MAX_MANA, LAST_STAND_DEAL_MUL, LAST_HOPE_DEAL_MUL,
  DEMON_COST, DEMON_DMG,
} from "/shared/balance.js";
import { miniPix, hydratePix } from "/client/pix.js";

// dmg basic strely podľa vzdialenosti 1..3 (engine: max(1, BASIC_DMG_MAX - vzdialenosť)) → „3/2/1"
const basicFalloff = [1, 2, 3].map(d => Math.max(1, BASIC_DMG_MAX - d)).join("/");

export const BUTTON_TEXT = {
  attack:   { title: `Range Attack - choose a direction (−${BASIC_COST} mana, damage by distance: ${basicFalloff}, can't hit your own cell)`, cost: `−${BASIC_COST}{💧} ?{☠️}` },
  dash:     { title: `Dash - move up to 2 cells in a direction (−${DASH_COST} mana)`, cost: `−${DASH_COST}{💧}` },
  melee:    { title: `Melee (−${MELEE_COST} mana, ${MELEE_DMG} dmg, hits only an opponent on your cell)`, cost: `−${MELEE_COST}{💧} ${MELEE_DMG}{☠️}` },
  special:  { title: `Special (−${SPECIAL_COST} mana)`, cost: `−${SPECIAL_COST}{💧}` },
  shield:   { title: `Shield (−${SHIELD_COST} mana, blocks all damage of the opponent's next action)`, cost: `−${SHIELD_COST}{💧}` },
  mirror:   { title: `Mirror (−${MIRROR_COST} mana, reflects all damage of the opponent's next action back at them)`, cost: `−${MIRROR_COST}{💧}` },
  recharge: { title: `Recharge (+${RECHARGE_GAIN} mana)`, cost: `+${RECHARGE_GAIN}{💧}` },
  goldenShield: { title: `Golden Shield (−${GOLDEN_COST} mana) - extra action resolved before the round starts. Available only when you go second.`, cost: `−${GOLDEN_COST}{💧}` },
  goldenMirror: { title: `Golden Mirror (−${GOLDEN_MIRROR_COST} mana) - extra action resolved before the round starts; reflects the damage back. Available only when you go second.`, cost: `−${GOLDEN_MIRROR_COST}{💧}` },
  goldenMana:   { title: `Golden Mana Refill (+${GOLDEN_MANA_GAIN} mana for HP, cost grows each use) - extra action resolved after the round ends.`, cost: `+${GOLDEN_MANA_GAIN}{💧}` },
  lastStand:    { title: `Last Stand (−${START_HP} HP) - the demon kills you and revives you at full HP/mana. Next round is your LAST: you deal ${LAST_STAND_DEAL_MUL}× damage and take ½, but if you don't kill the opponent you die. The demon is shared - only one player can summon it. Locks this gold button for both next round.`, cost: `−${START_HP}{❤️}` },
  demon:        { title: `Demon Attack (−${DEMON_COST} mana) - ${DEMON_DMG} damage to every cell except the one you stand on. Counts as one of your 3 actions; only in your FINAL ROUND.`, cost: `−${DEMON_COST}{💧}` },
  lastHope:     { title: `Last Hope (FINAL ROUND) - lose all HP but 1, refill mana to ${MAX_MANA}, deal ${LAST_HOPE_DEAL_MUL}× damage for the rest of the round. Resolves before everything else.` },
};

// cenovka z registra/tabuľky: {emoji} → pixelová mini ikona
export const costMarkup = (cost) => cost.replace(/\{(.+?)\}/gu, (_, e) => miniPix(e));

// statické tlačidlá z index.html: selektor tlačidla, kľúč textu, selektor cenovky v ňom (null = bez cenovky)
const STATIC = [
  ["#attack-btn", "attack", ".cost"],
  ["#dash-btn", "dash", ".cost"],
  ["#melee-btn", "melee", ".cost"],
  ["#special-btn", "special", ".cost"],
  ['.btn.act.shield[data-act="shield"]', "shield", ".cost"],
  ["#mirror-btn", "mirror", ".cost"],
  ['.btn.act.mana[data-act="recharge"]', "recharge", ".cost"],
  [".golden-half.shield-half", "goldenShield", ".cost"],
  [".golden-half.mirror-half", "goldenMirror", ".cost"],
  [".golden-half.gm-half", "goldenMana", ".cost.gm-gain"],
  [".golden-half.ls-half", "lastStand", ".cost"],
  ["#demon-btn", "demon", ".cost"],
  ["#last-hope-btn", "lastHope", null],
];
for (const [sel, key, costSel] of STATIC) {
  const btn = document.querySelector(sel);
  if (!btn) continue;
  const t = BUTTON_TEXT[key];
  btn.title = t.title;
  const costEl = costSel && btn.querySelector(costSel);
  if (costEl && t.cost) { costEl.innerHTML = costMarkup(t.cost); hydratePix(costEl); }
}
