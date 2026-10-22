// public/client/last-stand.js - vizuál Last Stand / Last Hope riadený timeline zo servera: démon v strede a za postavou,
// hmla, golden stav, banish, Last Hope postava. Každá fáza je samostatný frame (delayMs = trvanie efektu).
import { state } from "/client/session.js";
import { cellToPx, TILE_W, TILE_H } from "/client/dom.js";
import { pairShift, computeFacing } from "/client/placement.js";
import { ACTOR_W, ACTOR_H } from "/client/sprites.js";
import { HEAD_CX } from "/chars/index.js";
import { deathFog, deathCenter, hopeFog, hopeCenter, deathBehind } from "/client/overlays.js";
import { DEATH_SEQ } from "/client/demon-sprites.js";
import { appSize } from "/client/viewport.js";
import { perf } from "/client/perf.js";

// VÝKON (docs/PERF_PLAN.md etapa 5): rozmazanie (filter blur) veľkého stredového canvasu a hmly je na mobile drahé.
// V úspornom režime (perf.lite) nástup/odchod hrá len opacity + scale a hmla je samotný radiálny gradient bez blur.
// Po nástupe sa filter pripne na "none" (nie blur(0px)) - vizuálne rovnaké, ale bez trvalého filtra na canvase.
const blur = (px) => (perf.lite ? {} : { filter: `blur(${px}px)` });
// hmla: blur len vo full; po dobehnutí puffu sa schová (display none), nech neostane neviditeľne v strome vrstiev
function fogPuff(el, keyframes, ms, easing) {
  el.style.display = "block";
  el.style.filter = perf.lite ? "none" : "blur(28px)";
  const a = el.animate(keyframes, { duration: ms, easing });
  a.onfinish = () => { if (!el.getAnimations().some(x => x !== a && x.playState === "running")) el.style.display = "none"; };
}

/* ---------- Last Stand - vizuál (démon v strede + za postavou, golden stav); riadené serverom cez timeline ---------- */

// základná pozícia anjela „za postavou" pre daný SLOT: stred anjela = stred TELA postavy (headDx + flip
// podľa toho-ktorého slotu, nie napevno p1), päty na spodok bunky; canvas je ACTOR-veľký, scale z transform-origin center
function computeDeathBound(slot) {
  const tgt = state?.[slot];
  if (!tgt || tgt.x == null) return { left: 0, top: 0 };
  const { left, top } = cellToPx(tgt.x, tgt.y);
  const shift = pairShift(slot);
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[tgt.char] ?? 0.5) - 0.5);
  const bodyCx = left + TILE_W / 2 + shift + headDx;
  return { left: bodyCx - ACTOR_W / 2, top: top - (ACTOR_H - TILE_H) };
}

// hmlový puff v strede (in = nábeh, out = reverz)
function _deathFogPuff(ms, dir) {
  const a = dir === "in"
    ? [{ opacity: 0, transform: "translate(-50%,-50%) scale(.35)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .55 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" }]
    : [{ opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .45 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(.35)" }];
  fogPuff(deathFog, a, ms, dir === "in" ? "ease-out" : "ease-in");
}

/* ---------- Last Stand - napojenie na server timeline ---------- */
// Stredový démon (hmlový nábeh/zmiznutie) ako flourish summon/banish; HP/manu riadi server cez frames.
// Trvalý golden stav (žiara + aura + démon za postavou) riadi raf podľa state[slot].lastStandBuff.
// WAAPI hygiena stredových overlayov (deathCenter/hopeCenter): fill-forwards animácia po dobehnutí
// NESMIE ostať na elemente visieť - neskorší cancel (hideDeathCenter na konci hry / ďalšia choreografia)
// by mohol odkryť staršiu fill animáciu držiacu opacity 1 a démon by sa VRÁTIL na plochu (reprodukované:
// banish smrť po démon útoku - na obrazovke porazeného ostal démon visieť v strede cez GAME OVER).
// Preto sa koncový stav po dobehnutí zapíše do inline štýlu a animácia sa hneď zruší.
function pinOnFinish(el, anim, styles) {
  anim.onfinish = () => { Object.assign(el.style, styles); anim.cancel(); };
}

export function lsCenterAppear() {
  const { w, h } = appSize(), cx = w / 2, cy = h / 2;
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathCenter.style.left = cx + "px"; deathCenter.style.top = cy + "px";
  deathFog.style.left = cx + "px"; deathFog.style.top = cy + "px";
  _deathFogPuff(1400, "in");
  const a = deathCenter.animate([
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "1", filter: "none", transform: "translate(-50%,-50%) scale(1)" });
}
export function lsCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "0" });
}

// Démon útok - veľký démon v strede (100 % väčší než summon = scale 2); zvyšok kreslí raf do deathCenter
export function demonCenterAppear() {
  const { w, h } = appSize(), cx = w / 2, cy = h / 2;
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathCenter.style.left = cx + "px"; deathCenter.style.top = cy + "px";
  deathFog.style.left = cx + "px"; deathFog.style.top = cy + "px";
  _deathFogPuff(1000, "in");
  const a = deathCenter.animate([
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(1.1)" },
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(2)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "1", filter: "none", transform: "translate(-50%,-50%) scale(2)" });
}
export function demonCenterDisappear() {
  _deathFogPuff(700, "out");
  const a = deathCenter.animate([
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(2)" },
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(1.4)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(deathCenter, a, { opacity: "0" });
}

// Last Hope - červená „hope" postava v strede (analógia k lsCenterAppear, len červená hmla a hope sprite)
function _hopeFogPuff(ms, dir) {
  const a = dir === "in"
    ? [{ opacity: 0, transform: "translate(-50%,-50%) scale(.35)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .55 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" }]
    : [{ opacity: 0, transform: "translate(-50%,-50%) scale(1.5)" },
       { opacity: .85, transform: "translate(-50%,-50%) scale(1.05)", offset: .45 },
       { opacity: 0, transform: "translate(-50%,-50%) scale(.35)" }];
  fogPuff(hopeFog, a, ms, dir === "in" ? "ease-out" : "ease-in");
}
export function hopeCenterAppear() {
  const { w, h } = appSize(), cx = w / 2, cy = h / 2;
  hopeCenter.getAnimations().forEach(a => a.cancel());
  hopeCenter.style.left = cx + "px"; hopeCenter.style.top = cy + "px";
  hopeFog.style.left = cx + "px"; hopeFog.style.top = cy + "px";
  _hopeFogPuff(1400, "in");
  const a = hopeCenter.animate([
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(.55)" },
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(1)" },
  ], { duration: 700, easing: "ease-out", fill: "forwards" });
  pinOnFinish(hopeCenter, a, { opacity: "1", filter: "none", transform: "translate(-50%,-50%) scale(1)" });
}
export function hopeCenterDisappear() {
  _hopeFogPuff(700, "out");
  const a = hopeCenter.animate([
    { opacity: 1, ...blur(0),  transform: "translate(-50%,-50%) scale(1)" },
    { opacity: 0, ...blur(18), transform: "translate(-50%,-50%) scale(.55)" },
  ], { duration: 700, easing: "ease-in", fill: "forwards" });
  pinOnFinish(hopeCenter, a, { opacity: "0" });
}
export function hideHopeCenter() {
  hopeCenter.getAnimations().forEach(a => a.cancel());
  hopeFog.getAnimations().forEach(a => a.cancel());
  hopeCenter.style.opacity = "0";
  hopeFog.style.opacity = "0";
  hopeFog.style.display = "none";
}

// (dev demo klávesy R/T odstránené - Last Stand sa hrá cez tlačidlo a riadi server)
// tvrdo schovaj stredového démona (koniec hry / nová hra / char-select - nech nevisí na ploche)
export function hideDeathCenter() {
  deathCenter.getAnimations().forEach(a => a.cancel());
  deathFog.getAnimations().forEach(a => a.cancel());
  deathCenter.style.opacity = "0";
  deathFog.style.opacity = "0";
  deathFog.style.display = "none";
}
// tvrdo schovaj démona ZA postavou (koniec hry / nová hra) - bežne ho uprace fill-forwards animácia
// banishu (onfinish) a raf cleanup pri prvom stave bez buffu, ale tie majú okná (race s koncom hry);
// POZOR: nevolať počas plánovania final kola - tam démon za buffnutou postavou MÁ visieť (0.25)
export function hideDeathBehind() {
  deathBehind.getAnimations().forEach(a => a.cancel());
  deathBehind.style.opacity = "0";
}
// umiestni démona za postavu (slot) podľa bunky + ladiace offsety (nemení opacity/scale)
export function placeDeathBehind(slot) {
  const tgt = state?.[slot];
  if (!tgt || !tgt.char) return;
  const b = computeDeathBound(slot);
  deathBehind.style.left = (b.left + DEATH_SEQ.behindOffsetX) + "px";
  deathBehind.style.top  = (b.top  + DEATH_SEQ.behindOffsetY) + "px";
  deathBehind.style.transform = `scale(${DEATH_SEQ.behindRatio})`;
}
