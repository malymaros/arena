// public/client/anim.js - animácie figúr: klientske časovanie (MOVE_MS, POSE_TAIL_MS, NEW_ROUND_MS - CSS premenné
// --move-ms/--charge-ms), texty nevykonaných akcií (INVALID_MSG), fade figúry pri teleporte a stav animácie
// (setAnim/currentAnim nad actors.animState).
import { ANIM_SLOW, CHARGE_STEP_MS } from "/shared/timing.js";
import { actorP1, actorP2 } from "/client/dom.js";
import { ANIM_DEF } from "/client/sprites.js";
import { actors } from "/client/actors.js";

// === Timing ===
export const MOVE_MS = Math.round(700 * ANIM_SLOW); // pohyb na boarde; CSS číta --move-ms (nastavené nižšie)
// POZN.: neslučkové animácie (attack/attack2/hurt/dead) sa kvôli drawSprite(t=now) reálne neprehrávajú
// frame po frame - len držia poslednú pózu. Preto ich NEdržíme fixný čas (predtým 2400 ms = vizuálny „drag“),
// ale presne po dobu daného timeline frame-u (frame.delayMs), aby póza zmizla keď začne ďalšia akcia.
// special/melee tým ostávajú dlhé (ich beaty majú delayMs 1350 ms), basic/hurt sa skrátia na svoj frame.
export const POSE_TAIL_MS = 300; // o koľko dlhšie strelec „pozerá“ v smere streľby, nech otočenie vydrží po dopad

// každá nevykonaná akcia povie PREČO - dôvod zo servera → [text floatu, CSS trieda]; default = všeobecné odmietnutie
export const INVALID_MSG = {
  mana:      ["⚠️ LOW MANA",  "lowmana-float"],
  mana_full: ["✨ MANA FULL",  "golden-float"],
  hp_low:    ["🙏 LOW HP",     "lowmana-float"],
  offboard:  ["🚫 OFF-BOARD",  "lowmana-float"],
  no_demon:  ["✗ DEMON TAKEN", "dmg-float"], // druhý Last Stand v kole - démon je len jeden
  already_stone: ["🗿 ALREADY STONE", "lowmana-float"], // Medúzin special na už skamenenú postavu - bez efektu
  already_lost: ["🌀 ALREADY LOST", "lowmana-float"],   // Minotaurov special na už blúdiaceho - bez efektu
  not_alone: ["🚫 NOT ALONE", "lowmana-float"],         // Narutov summon vyžaduje bunku bez súpera
  blocked_shield: ["🛡️ SHIELD BLOCKED", "lowmana-float"], // BLOCK tile: obrana sa na ňom nedá castnúť (bez ceny)
  blocked_mirror: ["🪞 MIRROR BLOCKED", "lowmana-float"], // BLOCK tile: obrana sa na ňom nedá castnúť (bez ceny)
};
export const INVALID_MSG_DEFAULT = ["🚫 NO EFFECT", "lowmana-float"];
export const NEW_ROUND_MS = 1900; // „ROUND N" animácia medzi kolami (musí sedieť s CSS .round-banner.show)
document.documentElement.style.setProperty("--move-ms", MOVE_MS + "ms"); // drž CSS pohyb v sync so spomalením

// Projektil
document.documentElement.style.setProperty("--charge-ms", CHARGE_STEP_MS + "ms"); // plynulý sklz projektilu (CSS .projectile)

// teleport (výmena maga): postava fade-uje plynulo (WAAPI, inšpirované démonom) - ref na bežiacu fade animáciu
let _teleAnim = { p1:null, p2:null };
export function fadeActor(slot, from, to, dur) {
  const el = slot === "p1" ? actorP1 : actorP2;
  if (_teleAnim[slot]) { try { _teleAnim[slot].cancel(); } catch {} }
  _teleAnim[slot] = el.animate(
    [{ opacity: from }, { opacity: to }],
    { duration: Math.max(150, dur || 600), easing: to > from ? "ease-out" : "ease-in", fill: "forwards" }
  );
}
export function resetActorFade() {
  for (const slot of ["p1", "p2"]) {
    if (_teleAnim[slot]) { try { _teleAnim[slot].cancel(); } catch {} _teleAnim[slot] = null; }
    (slot === "p1" ? actorP1 : actorP2).style.opacity = "";
  }
}

/* ---------- animation state ---------- */
export function setAnim(slot, key, durationMs = 0) {
  const def = ANIM_DEF[key] ?? ANIM_DEF.idle;
  actors.animState[slot].key = key;
  actors.animState[slot].start = performance.now(); // pre animácie s loopFrom (hrajú od frame 0, potom cyklia chvost)
  if (durationMs && durationMs > 0) {
    actors.animState[slot].until = performance.now() + durationMs;
  } else if (!def.loop) {
    actors.animState[slot].until = performance.now() + 600;
  } else {
    actors.animState[slot].until = 0;
  }
}
export function currentAnim(slot) {
  const now = performance.now();
  const st  = actors.animState[slot];
  const def = ANIM_DEF[st.key] ?? ANIM_DEF.idle;
  if (st.until && now > st.until) {
    if (st.key !== "dead") {
      actors.animState[slot].key = "idle";
      actors.animState[slot].until = 0;
      return ANIM_DEF.idle;
    }
  }
  return def;
}
