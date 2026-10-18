// public/client/arena-bg.js - pozadie arény: vrstvy z /arenas/<key>/ renderované do low-res canvasov
// (ARENA_RES), ktoré CSS roztiahne s image-rendering: pixelated.

const arenaEl = document.getElementById("arena");

/* ---------- arena ---------- */
// interné rozlíšenie pozadia - vrstvy sa zmenšia sem a CSS ich roztiahne s pixelated,
// čím vzniknú skutočné veľké pixely (menšie čísla = hrubší pixel art)
const ARENA_RES = { w: 320, h: 180 };
export function renderArenaLayers(arenaKey, layerFiles) {
  arenaEl.innerHTML = "";
  if (!arenaKey || !Array.isArray(layerFiles) || !layerFiles.length) return;
  layerFiles.forEach((file, i) => {
    const cvs = document.createElement("canvas");
    cvs.className = "layer";
    cvs.width = ARENA_RES.w; cvs.height = ARENA_RES.h;
    cvs.style.zIndex = String(i);
    const img = new Image();
    img.onload = () => {
      const ctx = cvs.getContext("2d");
      // cover: vyplň celý canvas, prebytok orež - rovnaká logika ako object-fit: cover
      const s  = Math.max(ARENA_RES.w / img.width, ARENA_RES.h / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (ARENA_RES.w - dw) / 2, (ARENA_RES.h - dh) / 2, dw, dh);
    };
    img.src = `/arenas/${arenaKey}/${file}`;
    arenaEl.appendChild(cvs);
  });
}
