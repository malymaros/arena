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
import { act } from "/chars/common.js";

// dmg basic strely podľa vzdialenosti 1..3 (engine: max(1, BASIC_DMG_MAX - vzdialenosť)) → „3/2/1"
const basicFalloff = [1, 2, 3].map(d => Math.max(1, BASIC_DMG_MAX - d)).join("/");

// label = štítok nad tlačidlom na telefóne (touch-label.js): len cena a účinok, bez popisu. {emoji} = pixelová
// ikona, {💧}N = cena many, +N{💧} = zisk, {☠️}N = ZÁKLADNÝ dmg (bez násobičov Last Stand / Last Hope / maze),
// slovo = účinok bez dmg. Môže byť funkcia (ui) → reťazec (ui = buttonUi()). Postava ho prebíja v buttons.<slot>.label.
const LAST_HOPE_HP = 1; // Last Hope zhodí HP na 1 (pravidlo, nie balans)
const fall = basicFalloff.split("/").join(" / ");
// act(name, cena, text) → { title (tooltip na PC), info (okno pri podržaní na dotyku, client/peek.js) } - jeden text
export const BUTTON_TEXT = {
  move:     { ...act("MOVE", "free", "Step 1 cell in a direction.", "free") },
  attack:   { ...act("RANGE ATTACK", `{💧}${BASIC_COST}`, `Shoots in a direction and hits the first opponent in its path. Damage by distance: ${fall}. Never hits your own cell.`), cost: `−${BASIC_COST}{💧} ?{☠️}`, label: `{💧}${BASIC_COST} {☠️}${basicFalloff}` },
  dash:     { ...act("DASH", `{💧}${DASH_COST}`, "Move up to 2 cells in one direction."), cost: `−${DASH_COST}{💧}`, label: `{💧}${DASH_COST}` },
  melee:    { ...act("MELEE", `{💧}${MELEE_COST} {☠️}${MELEE_DMG}`, "Hits only an opponent standing on your cell."), cost: `−${MELEE_COST}{💧} ${MELEE_DMG}{☠️}`, label: `{💧}${MELEE_COST} {☠️}${MELEE_DMG}` },
  special:  { title: `Special (−${SPECIAL_COST} mana)`, cost: `−${SPECIAL_COST}{💧}`, label: `{💧}${SPECIAL_COST}` },
  shield:   { ...act("SHIELD", `{💧}${SHIELD_COST}`, "Blocks all damage of the opponent's next action. It's used up by that action, even if it deals no damage."), cost: `−${SHIELD_COST}{💧}`, label: `{💧}${SHIELD_COST} BLOCK` },
  mirror:   { ...act("MIRROR", `{💧}${MIRROR_COST}`, "Reflects all damage of the opponent's next action back at them. It's used up by that action, even if it deals no damage."), cost: `−${MIRROR_COST}{💧}`, label: `{💧}${MIRROR_COST} REFLECT` },
  recharge: { ...act("RECHARGE", `+${RECHARGE_GAIN}{💧}`, `Gain mana (max ${MAX_MANA}).`), cost: `+${RECHARGE_GAIN}{💧}`, label: `+${RECHARGE_GAIN}{💧}` },
  goldenShield: { ...act("GOLDEN SHIELD", `{💧}${GOLDEN_COST}`, "Extra action before the round starts. Only when you go second. Works like Shield."), cost: `−${GOLDEN_COST}{💧}`, label: `{💧}${GOLDEN_COST} BLOCK` },
  goldenMirror: { ...act("GOLDEN MIRROR", `{💧}${GOLDEN_MIRROR_COST}`, "Extra action before the round starts. Only when you go second. Works like Mirror."), cost: `−${GOLDEN_MIRROR_COST}{💧}`, label: `{💧}${GOLDEN_MIRROR_COST} REFLECT` },
  goldenMana:   { ...act("GOLDEN MANA", `+${GOLDEN_MANA_GAIN}{💧} for {❤️}`, "Extra action after the round ends. Costs 1 HP, then 2, 3… each use this game. Not allowed if it would kill you or your mana is full.", `+${GOLDEN_MANA_GAIN} mana for HP`), cost: `+${GOLDEN_MANA_GAIN}{💧}`,
    label: (ui) => `+${GOLDEN_MANA_GAIN}{💧} −${(ui.st?.manaRefills ?? 0) + 1}{❤️}` },
  lastStand:    { ...act("LAST STAND", `−${START_HP}{❤️}`, `The demon kills you and revives you at full HP and mana. Next round is your last: you deal ${LAST_STAND_DEAL_MUL}× damage and take ½. If the opponent survives it, you die. Only one player can summon the demon.`), cost: `−${START_HP}{❤️}`, label: `−${START_HP}{❤️}` },
  demon:        { ...act("DEMON ATTACK", `{💧}${DEMON_COST} {☠️}${DEMON_DMG}`, "Only in your final round. Hits every cell except yours. Counts as one of your 3 actions."), cost: `−${DEMON_COST}{💧}`, label: `{💧}${DEMON_COST} {☠️}${DEMON_DMG}` },
  lastHope:     { ...act("LAST HOPE", "{❤️} → {💧}", `Only in the opponent's final round. Drop to ${LAST_HOPE_HP} HP, refill mana to ${MAX_MANA}, deal ${LAST_HOPE_DEAL_MUL}× damage and take ½ for the rest of the round. Resolves before everything else.`, "HP → mana"), label: `{❤️} → {💧}` }, // ako odznak na PC: HP za manu, bez čísel
  lock:         { ...act("LOCK IN", "", "Plan 3 actions, each type once per round. Players take turns action by action. Not enough mana = the action is crossed out and refunded. An action into a wall still costs its mana.") },
  undo:         { ...act("UNDO", "", "Remove the last planned action.") },
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
  ["#move-btn", "move", null],
  ["#lock", "lock", null],
  ["#undo", "undo", null],
];
// kľúč textu statického tlačidla (okno pri podržaní - client/peek.js); null = tlačidlo nie je v zozname
export const staticKeyOf = (el) => STATIC.find(([sel]) => el.matches?.(sel))?.[1] ?? null;
for (const [sel, key, costSel] of STATIC) {
  const btn = document.querySelector(sel);
  if (!btn) continue;
  const t = BUTTON_TEXT[key];
  btn.title = t.title;
  const costEl = costSel && btn.querySelector(costSel);
  if (costEl && t.cost) { costEl.innerHTML = costMarkup(t.cost); hydratePix(costEl); }
}
