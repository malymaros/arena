// public/client/teleport.js - teleport pri výmene maga v turnaji: dvojfázová explózia (starý mág zmizne, nový sa
// objaví) - sprite FX z registra postáv (teleport/teleportCount).
import { TELEPORT_DIR, TELEPORT_COUNT, TELEPORT_FX, HEAD_CX } from "/chars/index.js";
import { state } from "/client/session.js";
import { TILE_W, TILE_H, cellToPx, actorsEl } from "/client/dom.js";
import { ACTOR_W, ACTOR_H } from "/client/sprites.js";
import { pairShift, computeFacing } from "/client/placement.js";

/* ---------- Teleport (výmena maga v turnaji) - dvojfázová explózia ---------- */
// framy sú JEDNOTLIVÉ číslované PNG (nie horizontálny strip ako ostatné sprity) → vlastný loader/prehrávač
const _teleFrames = {}; // char -> Promise<HTMLImageElement[]>
function ensureTeleportFrames(char) {
  if (_teleFrames[char]) return _teleFrames[char];
  const dir = TELEPORT_DIR[char], n = TELEPORT_COUNT[char] || 0;
  if (!dir || !n) return (_teleFrames[char] = Promise.resolve([]));
  const imgs = [], proms = [];
  for (let i = 1; i <= n; i++) {
    const img = new Image();
    proms.push(new Promise(res => { img.onload = res; img.onerror = res; }));
    img.src = `/assets/Teleport/${dir}/Explosion_${i}.png`;
    imgs.push(img);
  }
  return (_teleFrames[char] = Promise.all(proms).then(() => imgs));
}
const TORSO_FRAC = 0.66; // stred torza ako zlomok výšky actor boxu (0 = hore, 1 = päty)
// prehraj explóziu CENTROVANÚ na POSTAVU daného slotu (char = ktorého maga framy); durationMs = trvanie (= frame.delayMs)
// opacity: vždy 0.75 (obe fázy teleportu rovnako semi-transparentné)
export function playTeleportExplosion(slot, char, durationMs, opacity, onDone) {
  const st = state?.[slot];
  if (!st) { onDone && onDone(); return; }
  const { x, y } = st;
  ensureTeleportFrames(char).then(imgs => {
    if (!imgs.length) { onDone && onDone(); return; }
    const fx = TELEPORT_FX[char] || { scale: 1.3, anchor: "torso" };
    const scale = fx.scale;
    const anchorBottom = fx.anchor === "feet";
    const boxW = Math.round(TILE_W * scale), boxH = Math.round(TILE_H * scale);
    const cvs = document.createElement("canvas");
    cvs.width = boxW; cvs.height = boxH;
    cvs.className = "teleport-fx";
    cvs.style.opacity = String(opacity ?? 1);
    // horizontálne = stred TELA postavy (sprite je vo frame mimo stredu - rovnaký HEAD_CX + flip vzor
    // ako „YOU" vlajka a anjel); vertikálne = kotvenie feet/torso + per-mág dy posun nadol
    const { left, top } = cellToPx(x, y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const shift = pairShift(slot);
    const bodyDx = (computeFacing(state?.p1, state?.p2)[slot] || 1) * ACTOR_W * ((HEAD_CX[char] ?? 0.5) - 0.5);
    const cx = px + ACTOR_W / 2 + shift + bodyDx; // stred tela postavy
    cvs.style.left = Math.round(cx - boxW / 2) + "px";
    const dyPx = Math.round(TILE_H * (fx.dy || 0));
    if (anchorBottom) {
      const feetY = py + ACTOR_H;                              // päty postavy (= spodok bunky)
      cvs.style.top = Math.round(feetY - boxH + dyPx) + "px";  // spodok canvasu = päty (oheň od zeme)
    } else {
      const torsoY = py + ACTOR_H * TORSO_FRAC;                // stred torza
      cvs.style.top = Math.round(torsoY - boxH / 2 + dyPx) + "px";
    }
    // vlož NA KONIEC #actors (DOM poradie) → explózia je PRED mágom (navrchu)
    actorsEl.appendChild(cvs);
    const ctx = cvs.getContext("2d");
    const start = performance.now();
    const dur = Math.max(200, durationMs || 600);
    (function stepFx() {
      const t = performance.now() - start;
      const idx = Math.min(imgs.length - 1, Math.floor(t / dur * imgs.length));
      const img = imgs[idx];
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      ctx.imageSmoothingEnabled = false;
      if (img && img.naturalWidth) {
        const sc = Math.min(cvs.width / img.naturalWidth, cvs.height / img.naturalHeight);
        const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
        // horizontálne centrovať; vertikálne: "feet" ukotviť dole (oheň od zeme), "torso" centrovať
        // bottomTrim posunie kresbu nižšie o priehľadný spodný okraj PNG, aby viditeľný obsah sadol na päty
        const dy = anchorBottom ? (cvs.height - dh + dh * (fx.bottomTrim || 0)) : (cvs.height - dh) / 2;
        ctx.drawImage(img, (cvs.width - dw) / 2, dy, dw, dh);
      }
      if (t < dur) requestAnimationFrame(stepFx);
      else { cvs.remove(); onDone && onDone(); }
    })();
  }).catch(() => onDone && onDone());
}
