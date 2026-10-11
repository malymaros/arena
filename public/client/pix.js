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
  el.appendChild(cvs);
}
export function hydratePix(root = document) {
  root.querySelectorAll(".pix-ico[data-emoji]").forEach(el => pixelizeEmoji(el));
}
