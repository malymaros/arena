// public/client/pix.js - pixel-art ikony (tiles, tlačidlá, HUD): 8×8 SVG ikony z knižnice PIX
// a pixelizované emoji (hydratePix). Čisté UI pomôcky bez herného stavu.

/* ---------- pixel-art ikony (tiles, tlačidlá, HUD) ---------- */
// 8×8 mriežka, znak = farba z palety, bodka = priehľadné; kreslí sa ako SVG rect-y (crispEdges)
const PIX = {
  flame: { pal: { a: "#ff7043", b: "#ffd54f" }, rows: [
    "....a...",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aabbaa.",
    ".abbbba.",
    ".abbbba.",
    "..aaaa..",
  ]},
  heart: { pal: { a: "#e53935", b: "#ff8a80" }, rows: [
    "........",
    ".aa..aa.",
    "abaaaaaa",
    "aaaaaaaa",
    "aaaaaaaa",
    ".aaaaaa.",
    "..aaaa..",
    "...aa...",
  ]},
  drop: { pal: { a: "#1e88e5", b: "#82c4ff" }, rows: [
    "...a....",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aaaaaa.",
    ".baaaaa.",
    ".baaaaa.",
    "..aaaa..",
  ]},
  skull: { pal: { a: "#e8e8e8", b: "#1a1a1a" }, rows: [
    "..aaaa..",
    ".aaaaaa.",
    ".abaaba.",
    ".abaaba.",
    ".aaaaaa.",
    "..abba..",
    "..aaaa..",
    "..a..a..",
  ]},
  // POWER tile - zlatý meč (útok z tejto bunky dostane +2 dmg, tile sa spotrebuje)
  sword: { pal: { a: "#ffd54f", b: "#b26a00" }, rows: [
    "...aa...",
    "...aa...",
    "...aa...",
    "...aa...",
    ".bbaabb.",
    "...bb...",
    "...bb...",
    "........",
  ]},
  // BLOCK tile - sivý štít s červeným ✕ (na tejto bunke sa nedá castnúť shield/mirror)
  shieldx: { pal: { a: "#9aa0a8", b: "#e53935" }, rows: [
    ".aaaaaa.",
    ".abaaba.",
    ".aabbaa.",
    ".aabbaa.",
    ".abaaba.",
    "..aaaa..",
    "...aa...",
    "........",
  ]},
  boot: { pal: { a: "#e0e0e0", b: "#8d6e63" }, rows: [
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaaa..",
    "..aaaaa.",
    ".bbbbbb.",
    "........",
  ]},
  chevrons: { pal: { a: "#ffffff" }, rows: [
    "aa..aa..",
    ".aa..aa.",
    "..aa..aa",
    ".aa..aa.",
    "aa..aa..",
    "........",
    "........",
    "........",
  ]},
  plus: { pal: { a: "#82c4ff" }, rows: [
    "...aa...",
    "...aa...",
    ".aaaaaa.",
    ".aaaaaa.",
    "...aa...",
    "...aa...",
    "........",
    "........",
  ]},
  shield: { pal: { a: "#00363d", b: "#b2ebf2" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbbba.",
    ".abbbba.",
    "..abba..",
    "..abba..",
    "...aa...",
    "........",
  ]},
  mirror: { pal: { a: "#d4a017", b: "#b2ebf2", c: "#ffffff" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbcba.",
    ".abcbba.",
    ".acbbba.",
    ".abbbba.",
    ".aaaaaa.",
    "........",
  ]},
  arrow: { pal: { a: "#fff3c4" }, rows: [
    "........",
    ".....a..",
    "......a.",
    "aaaaaaaa",
    "......a.",
    ".....a..",
    "........",
    "........",
  ]},
  star: { pal: { a: "#e1bee7", b: "#ffffff" }, rows: [
    "...aa...",
    "..aaaa..",
    ".aabbaa.",
    "aabbbbaa",
    ".aabbaa.",
    "..aaaa..",
    "...aa...",
    "........",
  ]},
  // séria - vyhratá hra: plná zlatá koruna s gemmami
  crown: { pal: { a: "#ffcf3f", b: "#c98a17", c: "#ff5a5a" }, rows: [
    ".a.aa.a.",
    ".a.aa.a.",
    ".aaaaaa.",
    ".acaaca.",
    ".abaaba.",
    ".aaaaaa.",
    "........",
    "........",
  ]},
  // séria - nezískaná hra: len obrys koruny (tlmená zlatá)
  crown_outline: { pal: { o: "#7d6526" }, rows: [
    ".o.oo.o.",
    ".o.oo.o.",
    ".oo..oo.",
    ".o....o.",
    ".o....o.",
    ".oooooo.",
    "........",
    "........",
  ]},
  // tournament - ešte neprehraná hra: len tlmený obrys lebky
  skull_outline: { pal: { o: "#5a5a5a" }, rows: [
    "..oooo..",
    ".o....o.",
    ".o.oo.o.",
    ".o.oo.o.",
    ".o....o.",
    "..oooo..",
    "..o..o..",
    "..o..o..",
  ]},
};
export function pixSvg(name) {
  const def = PIX[name];
  if (!def) return "";
  let rects = "";
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = def.pal[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
// malá inline ikonka do cost riadkov - pixelizované emoji, hydratuje hydratePix()
export const miniPix = (emoji) => `<span class="pix-ico mini" data-emoji="${emoji}"></span>`;
// špeciálne políčka mapujú na ikony knižnice
const TILE_TO_PIX = { dmg: "flame", heal: "heart", mana: "drop", ik: "skull", power: "sword", block: "shieldx" };
export function tileSvg(type) { return pixSvg(TILE_TO_PIX[type] || type); }

// jemná pixelizácia emoji: nakreslí sa do malého canvasu a CSS ho roztiahne s pixelated
export function pixelizeEmoji(el, res) {
  if (el.dataset.done) return;
  el.dataset.done = "1";
  el.innerHTML = "";
  res = res || (el.classList.contains("mini") ? 10 : 20);
  const cvs = document.createElement("canvas");
  cvs.width = res; cvs.height = res;
  const ctx = cvs.getContext("2d");
  ctx.font = `${res - 3}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.dataset.emoji, res / 2, res / 2 + 1);
  if (el.dataset.tone === "noir") noirTone(ctx, res);
  el.appendChild(cvs);
}
// tón „noir" (ikona breakera): zlaté/teplé pixely (rám zrkadla) → ebenovo čierna s jemným leskom,
// ostatné → čiernobielo so zvýšeným kontrastom (starý film). Po pixeloch - CSS filter by nevedel zmeniť len rám.
function noirTone(ctx, res) {
  const img = ctx.getImageData(0, 0, res, res), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    const warm = r > b + 40 && g > b + 10 && r - b > (Math.max(r, g, b) - Math.min(r, g, b)) * 0.6;
    if (warm) { d[i] = 16 + L * 0.16; d[i + 1] = 11 + L * 0.12; d[i + 2] = 9 + L * 0.1; }
    else { const v = Math.max(0, Math.min(255, (L - 128) * 1.35 + 110)); d[i] = d[i + 1] = d[i + 2] = v; }
  }
  ctx.putImageData(img, 0, 0);
}
// Shield/Mirror Breaker: ikona obrany v tóne „noir" (čiernobielo, rám zrkadla ebenový) - spolu s farbou tlačidla
export const breakerIco = (emoji, cls = "") => `<span class="brk-ico ${cls}"><span class="pix-ico" data-emoji="${emoji}" data-tone="noir"></span></span>`;
export function hydratePix(root = document) {
  root.querySelectorAll(".pix-ico[data-emoji]").forEach(el => pixelizeEmoji(el));
}

// odznaky Last Stand / Last Hope (lišta kola, záznam akcií)
export const LS_BADGE_IMG = '<img class="ls-badge" src="/assets/last_stand.png" alt="Last Stand">'; // ikona Last Standu (zmenšenina démona) do lišty/záznamu
export const LH_BADGE_IMG = '<img class="lh-badge" src="/assets/last_hope.png" alt="Last Hope">'; // ikona Last Hope do lišty
