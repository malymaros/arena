// public/client/overlays.js - overlaye Last Stand / Last Hope: démon v strede obrazovky (deathCenter) a za postavou
// (deathBehind), hmla (deathFog), Last Hope postava (hopeCenter) a jej hmla (hopeFog). Elementy sa tu len
// vytvoria; do DOM ich pripája client.js na pôvodnom mieste (za figúrami z registra fx), poradie vrstiev ostáva.
import { TILE_H } from "/client/dom.js";
import { ACTOR_W, ACTOR_H } from "/client/sprites.js";
import { DEATH_SCALE, DEATH_FRAME, HOPE_FRAME } from "/client/demon-sprites.js";

// Viditeľnosť stredových overlayov (nastavuje last-stand.js pri nástupe/odchode/skrytí) - raf kreslí sprite len do
// viditeľného canvasu (výkon: inak by sa démon aj Last Hope kreslili celú hru do neviditeľných canvasov).
export const overlayVis = new WeakMap();

// DEATH summon - screen-space overlay (fixed, mimo stacking contextu .stage, aby bolo vidno v každej fáze).
// Veľkosť medzi fázami riešime CSS transformom scale(); canvas má základnú „stredovú" veľkosť.
export const deathCenter = document.createElement("canvas");
deathCenter.id = "death-center";
{
  const px = Math.round(TILE_H * DEATH_SCALE);
  // backing = rozmer zdrojového framu (kreslí sa 1:1), CSS ho zväčší s image-rendering: pixelated - rovnaký
  // výsledok, menej pixelov na vyplnenie
  deathCenter.width = DEATH_FRAME; deathCenter.height = DEATH_FRAME;
  deathCenter.style.width = px + "px"; deathCenter.style.height = px + "px";
  deathCenter.style.position = "fixed";
  deathCenter.style.left = "50%"; deathCenter.style.top = "50%";
  deathCenter.style.transform = "translate(-50%, -50%)";
  deathCenter.style.transformOrigin = "center";
  deathCenter.style.pointerEvents = "none";
  deathCenter.style.imageRendering = "pixelated";
  deathCenter.style.opacity = "0"; // štartuje skrytý, sekvencia ho zobrazí
  deathCenter.style.zIndex = "999999";
}

// „za postavou" - board-space canvas v #actors so z-indexom pod sprite-om postavy (.sprite-actor = 3)
export const deathBehind = document.createElement("canvas");
deathBehind.id = "death-behind";
{
  // rovnaký rozmer canvasu ako postava → kreslíme identicky a prekryjeme sa presne
  deathBehind.width = ACTOR_W; deathBehind.height = ACTOR_H;
  deathBehind.style.width = ACTOR_W + "px"; deathBehind.style.height = ACTOR_H + "px";
  deathBehind.style.position = "absolute";
  deathBehind.style.zIndex = "2"; // pod postavou (z-index 3), nad gridom
  deathBehind.style.pointerEvents = "none";
  deathBehind.style.imageRendering = "pixelated";
  deathBehind.style.transformOrigin = "center"; // scale ostane centrovaný na postavu
  deathBehind.style.transition = "opacity .45s ease-out"; // plynulé stmievanie (revive 0→1, settle 1→0.25); left/top sa nehýbe transition-om (sleduje per-frame)
  deathBehind.style.opacity = "0";
}

// hmlový oblak za sprite-om (radiálny gradient + blur) - „zaujímavý mlžný efekt" pri zjavení
export const deathFog = document.createElement("div");
deathFog.id = "death-fog";
Object.assign(deathFog.style, {
  position: "fixed", left: "50%", top: "50%", width: "560px", height: "560px",
  transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "999998",
  borderRadius: "50%", display: "none", filter: "blur(28px)", opacity: "0",
  background: "radial-gradient(circle at center, rgba(214,190,255,.55), rgba(150,120,220,.28) 45%, rgba(120,90,200,0) 70%)",
});

// Last Hope - stredový „hope" overlay (analógia k deathCenter), vlastný canvas nech sa nebije s démonom
export const hopeCenter = document.createElement("canvas");
hopeCenter.id = "hope-center";
{
  // canvas v pomere framu (768×512 = 1.5:1) a poriadne veľký, nech hope postava vyplní priestor (nie letterbox)
  const ch = Math.round(TILE_H * 3.4);
  const cw = Math.round(ch * 768 / 512);
  hopeCenter.width = HOPE_FRAME.w; hopeCenter.height = HOPE_FRAME.h; // backing 1:1 so zdrojovým framom (viď deathCenter)
  hopeCenter.style.width = cw + "px"; hopeCenter.style.height = ch + "px";
  hopeCenter.style.position = "fixed";
  hopeCenter.style.left = "50%"; hopeCenter.style.top = "50%";
  hopeCenter.style.transform = "translate(-50%, -50%)";
  hopeCenter.style.transformOrigin = "center";
  hopeCenter.style.pointerEvents = "none";
  hopeCenter.style.imageRendering = "pixelated";
  hopeCenter.style.opacity = "0";
  hopeCenter.style.zIndex = "999999";
}

// červený hmlový oblak pre Last Hope (analógia k deathFog, len červený)
export const hopeFog = document.createElement("div");
hopeFog.id = "hope-fog";
Object.assign(hopeFog.style, {
  position: "fixed", left: "50%", top: "50%", width: "560px", height: "560px",
  transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "999998",
  borderRadius: "50%", display: "none", filter: "blur(28px)", opacity: "0",
  background: "radial-gradient(circle at center, rgba(255,120,120,.55), rgba(220,60,60,.28) 45%, rgba(200,40,40,0) 70%)",
});
