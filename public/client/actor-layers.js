// public/client/actor-layers.js - canvasy figúr na doske: veľkosť hráčskych canvasov, ghost (náhľad vlastnej pozície),
// siluety lovca v labyrinte (+ preblik na niti), canvasy tieňových klonov a ghost klona. Pridávajú sa do
// #actors pri načítaní - PRED figúrami z registra fx (fxAll("init") v client.js), poradie vrstiev ostáva.
import { actorP1, actorP2, actorsEl, figuresEl, cellToPx, TILE_W, TILE_H } from "/client/dom.js";
import { ACTOR_W, ACTOR_H, ensureSpriteMeta, charDirFor, ANIM_DEF, drawSprite } from "/client/sprites.js";

/* ---------- Figúry na doske: canvasy postáv, ghost, siluety, klony ---------- */
[actorP1, actorP2].forEach(c => {
  c.width = ACTOR_W; c.height = ACTOR_H;
  c.style.width = ACTOR_W + "px"; c.style.height = ACTOR_H + "px";
});

// ghost - poloprehľadný náhľad vlastnej pozície po naplánovaných movoch vo fronte
export const actorGhost = document.createElement("canvas");
actorGhost.id = "actor-ghost";
actorGhost.className = "sprite-actor sprite-ghost";
actorGhost.width = ACTOR_W; actorGhost.height = ACTOR_H;
actorGhost.style.width = ACTOR_W + "px"; actorGhost.style.height = ACTOR_H + "px";
actorGhost.style.display = "none";
actorsEl.appendChild(actorGhost);

// obrys súpera na Ariadninej nití (labyrint) - čierna silueta na bunke posledného vstupu na niť.
// Dva canvasy: [0] = breadcrumb / prvá lovcova figúra, [1] = druhá lovcova figúra - lovec a jeho tieňový
// klon môžu stáť na dvoch fakľových bunkách (moja + klonova) naraz (hunterHere nesie až 2 bunky)
export const actorSilhouettes = [0, 1].map(i => {
  const el = document.createElement("canvas");
  el.id = "actor-silhouette" + (i ? "-2" : "");
  el.className = "sprite-actor sprite-silhouette";
  el.width = ACTOR_W; el.height = ACTOR_H;
  el.style.width = ACTOR_W + "px"; el.style.height = ACTOR_H + "px";
  // necháme ho VŽDY display:block a riadime len opacity - inak by CSS fade (vynorenie/strata v hmle) z display:none neprešlo
  el.style.display = "block";
  el.style.opacity = "0";
  actorsEl.appendChild(el);
  return el;
});

// transient preblik obrysu na prejdenej niťovej bunke - lovec prechádza niťou → na KAŽDEJ bunke, kde je,
// krátko preblikne jeho čierny obrys (nie len na poslednej). Vlastný canvas, po flash animácii sa odstráni.
export function spawnSilhouetteFlash(cell, oppChar, oppS) {
  if (!oppChar || !Array.isArray(cell)) return;
  const el = document.createElement("canvas");
  // preblik na cudzej bunke = VŽDY čierny obrys (brightness(0)) - žiadny alt-color, ten by paletou
  // prebil čiernu (napr. pri labyrinte cez mirror, kde je lovec nenatívna postava na p2)
  el.className = "sprite-actor sprite-silhouette silh-flash-el";
  el.width = ACTOR_W; el.height = ACTOR_H;
  el.style.width = ACTOR_W + "px"; el.style.height = ACTOR_H + "px";
  const { left, top } = cellToPx(cell[0], cell[1]);
  el.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
  el.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
  actorsEl.appendChild(el);
  ensureSpriteMeta(charDirFor(oppChar, oppS), ANIM_DEF.idle.file)
    .then(meta => drawSprite(el.getContext("2d"), meta, ANIM_DEF.idle, 0, ACTOR_W, ACTOR_H))
    .catch(() => {});
  setTimeout(() => el.remove(), 550);
}

// tieňové klony (Narutov special) - sprite klona per strana; pozíciu rieši positionActors,
// kreslí raf zo state[slot].clone (na bunke majiteľa sa klon nekreslí - vidno len jednu postavu)
export const cloneEls = { p1: null, p2: null };
for (const _slot of ["p1", "p2"]) {
  const c = document.createElement("canvas");
  c.id = "actor-clone-" + _slot;
  c.className = "sprite-actor sprite-clone";
  c.width = ACTOR_W; c.height = ACTOR_H;
  c.style.width = ACTOR_W + "px"; c.style.height = ACTOR_H + "px";
  c.style.display = "none";
  figuresEl.appendChild(c);
  cloneEls[_slot] = c;
}
// ghost klona - pri plánovaní ukáže budúcu pozíciu vlastného klona (vertikálne inverznú k mojim smerom)
export const cloneGhost = document.createElement("canvas");
cloneGhost.id = "actor-clone-ghost";
cloneGhost.className = "sprite-actor sprite-ghost";
cloneGhost.width = ACTOR_W; cloneGhost.height = ACTOR_H;
cloneGhost.style.width = ACTOR_W + "px"; cloneGhost.style.height = ACTOR_H + "px";
cloneGhost.style.display = "none";
actorsEl.appendChild(cloneGhost);

// YOU značka nad vlastnou figúrou - vytvorí sa tu, ale do #actors ju pripája client.js až po figúrach z registra
// fx (fxAll("init")), aby leželo nad nimi ako doteraz
export const youMarker = document.createElement("div");
youMarker.className = "you-marker";
youMarker.innerHTML = `<div class="you-marker-bob"><span class="you-tag">YOU</span><span class="you-tip"></span></div>`;
youMarker.style.display = "none";

// zelená šípka pod round-script lištou - počas animácie ukazuje na práve vykonávaný beat (pripája renderQueue)
export const qCursor = document.createElement("div");
qCursor.className = "q-cursor";
