// public/client/arena-bg.js - pozadie arény: vrstvy z /arenas/<key>/ renderované do low-res canvasov
// (ARENA_RES), ktoré CSS roztiahne s image-rendering: pixelated. Portal Realm je maľba (nie pixel-art) - kreslí
// sa v PLNOM rozlíšení (plynulé škálovanie) a nad ňou beží „živé pozadie" (ohne, vír, runy, kruh, svetielka -
// animuje len opacity/transform; pri úspornej grafike html.perf-lite len lite variant, styles.css).

const arenaEl = document.getElementById("arena");

/* ---------- arena ---------- */
// interné rozlíšenie pozadia - vrstvy sa zmenšia sem a CSS ich roztiahne s pixelated,
// čím vzniknú skutočné veľké pixely (menšie čísla = hrubší pixel art)
const ARENA_RES = { w: 320, h: 180 };
// arény kreslené v plnom rozlíšení (maľba) + rozmer originálu pre súradnice živých efektov
const HD_ARENAS = { "portal-realm": { w: 1672, h: 941, fx: portalRealmFx } };
let fxWrap = null, fxSize = null;

export function renderArenaLayers(arenaKey, layerFiles) {
  arenaEl.innerHTML = "";
  fxWrap = null; fxSize = null;
  if (!arenaKey || !Array.isArray(layerFiles) || !layerFiles.length) return;
  const hd = HD_ARENAS[arenaKey];
  if (hd) {
    layerFiles.forEach((file, i) => {
      const img = document.createElement("img");
      img.className = "layer hd";
      img.alt = "";
      img.style.zIndex = String(i);
      img.src = `/arenas/${arenaKey}/${file}`;
      arenaEl.appendChild(img);
    });
    // živé pozadie: vrstva v súradniciach originálu, zmenšená rovnakým „cover" ako obrázok
    fxWrap = document.createElement("div");
    fxWrap.id = "arena-fx";
    fxWrap.style.width = hd.w + "px"; fxWrap.style.height = hd.h + "px";
    hd.fx(fxWrap);
    arenaEl.appendChild(fxWrap);
    fxSize = hd;
    layoutFx();
    return;
  }
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

// vrstvu efektov polož presne na „cover" obrázka (object-fit: cover = vyplní arénu, prebytok orezaný na stred)
function layoutFx() {
  if (!fxWrap || !fxSize) return;
  const W = arenaEl.clientWidth || 1, H = arenaEl.clientHeight || 1;
  const k = Math.max(W / fxSize.w, H / fxSize.h);
  fxWrap.style.transform = `translate(${(W - fxSize.w * k) / 2}px, ${(H - fxSize.h * k) / 2}px) scale(${k})`;
}
window.addEventListener("resize", layoutFx);

/* ---------- Portal Realm: živé pozadie (súradnice v pixeloch originálu 1672×941) ---------- */
function portalRealmFx(root) {
  const add = (cls, x, y, w, h, vars = {}) => {
    const el = document.createElement("div");
    el.className = cls;
    el.style.left = x + "px"; el.style.top = y + "px";
    if (w) { el.style.width = w + "px"; el.style.height = (h ?? w) + "px"; }
    for (const [n, v] of Object.entries(vars)) el.style.setProperty(n, v);
    root.appendChild(el);
    return el;
  };
  // vír na oblohe (dve vrstvy proti sebe; lite = jedna)
  add("afx-vortex", 830, 18, 520, 520).innerHTML = "<i></i><i></i>";
  add("afx-halo afx-glow", 830, 30, 640, 260);
  // ohne v miskách (vľavo, vpravo dole) + iskry (lite = 3 na misku)
  for (const [x, y] of [[74, 596], [1597, 596]]) {
    add("afx-halo afx-glow", x, y + 10, 330, 330);
    add("afx-fire afx-glow", x, y, 120, 140);
    for (let i = 0; i < 7; i++) add("afx-ember" + (i >= 3 ? " afx-heavy" : ""), x - 18 + (i * 7) % 36, y - 4, 0, 0,
      { "--d": (1.8 + (i % 4) * 0.45) + "s", "--dl": (i * 0.37) + "s", "--dx": ((i % 2 ? 1 : -1) * (8 + i * 3)) + "px" });
  }
  // runy na pilieroch a na podlahe (postupne sa rozžiaria)
  [[405, 66], [1278, 66], [380, 258], [835, 207], [1285, 258], [218, 425], [1453, 425], [290, 605], [835, 685], [1385, 605], [835, 412]]
    .forEach(([x, y], i) => add("afx-rune", x, y, 0, 0, { "--dl": (i * 0.53) + "s" }));
  // magický kruh v strede podlahy
  add("afx-circle", 835, 420, 390, 262);
  // svetielka v prázdnote po okrajoch (lite = polovica)
  [[40, 600], [120, 780], [260, 880], [520, 900], [1150, 905], [1420, 880], [1560, 760], [1640, 560], [30, 420], [1650, 420],
    [300, 60], [1380, 60], [620, 40], [1040, 40], [90, 150], [1590, 150]]
    .forEach(([x, y], i) => add("afx-mote" + (i % 2 ? " afx-heavy" : ""), x, y, 0, 0,
      { "--d": (7 + (i % 5) * 1.6) + "s", "--dl": (i * 0.9) + "s", "--dx": ((i % 2 ? 1 : -1) * (15 + (i % 4) * 12)) + "px", "--dy": (-40 - (i % 3) * 30) + "px" }));
}
