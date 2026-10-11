// public/client/explosion.js - výbuch (Vojakov Explosion.png): dopad snajperského lúča aj koniec letu granátu;
// volajú ho aj moduly fx (C.spawnExplosionAt).
import { charDirFor, ensureSpriteMeta, drawSprite } from "/client/sprites.js";
import { cellToPx, TILE_H, TILE_W, actorsEl } from "/client/dom.js";

/* ---------- výbuch (Vojakov Explosion.png): dopad snajperského lúča aj koniec letu granátu ---------- */
// prehrá sa raz na bunke (lúč a mierenie: public/chars/fx/soldier.js)
export function spawnExplosionAt(cell, slot, sizeMul = 1.4, fps = 12) {
  if (!Array.isArray(cell)) return;
  const dir = charDirFor("soldier", slot);
  const { left, top } = cellToPx(cell[0], cell[1]);
  const size = Math.round(TILE_H * sizeMul);
  const el = document.createElement("canvas");
  el.width = size; el.height = size; el.className = "explosion-fx";
  // Explosion.png je v sheete ukotvený k SPODKU framu (rastie od zeme hore) → spodok canvasu
  // sadá na spodok bunky, inak ohnivá guľa trčí pod políčkom
  Object.assign(el.style, { position: "absolute", left: (left + TILE_W / 2 - size / 2) + "px", top: (top + TILE_H - size) + "px", pointerEvents: "none", zIndex: 7, imageRendering: "pixelated" });
  actorsEl.appendChild(el);
  const ctx = el.getContext("2d"); ctx.imageSmoothingEnabled = false;
  ensureSpriteMeta(dir, "Explosion.png").then(m => {
    const dur = m.frames * 1000 / fps, t0 = performance.now();
    const step = () => {
      if (!el.isConnected) return;
      const t = performance.now() - t0;
      if (t < dur) { drawSprite(ctx, m, { file: "Explosion.png", frames: m.frames, frameIndex: Math.min(m.frames - 1, Math.floor(t / 1000 * fps)) }, 0, size, size); requestAnimationFrame(step); }
      else el.remove();
    };
    requestAnimationFrame(step);
  }).catch(() => el.remove());
}
