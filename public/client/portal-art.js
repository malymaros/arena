// public/client/portal-art.js - Portal Realm: schválený vizuál portálov (docs/PORTAL_PLAN.md 2.14, náhľad
// public/dev/portal-realm.html). Farby typov, runy párov („spellbook"), pixel trhlina so ZAPEČENOU žiarou
// (snímka sa vykreslí raz do canvasu a cachuje ako dataURL - v DOM je len <img> s animovanou opacity, žiadny
// CSS filter nad meniacim sa obsahom) a ikona Damage dlaždice s 2 ohníkmi. Čisté UI pomôcky bez herného stavu.
import { pixSvg } from "/client/pix.js";

// farba = typ; klasický má farbu fialových plameňov arény. icon = pixel ikona v strede trhliny (pix.js)
export const PORTAL_TYPES = {
  classic: { en: "Classic",     pc: "#c04dff", pc2: "#f2c9ff", icon: null },
  hp:      { en: "HP",          pc: "#2e9e54", pc2: "#b4f0c6", icon: "heart" }, // zelená = rovnaká ako heal tile
  mana:    { en: "Mana",        pc: "#2f8bff", pc2: "#b9dcff", icon: "drop" },
  power:   { en: "Power-up",    pc: "#ffc400", pc2: "#fff3c0", icon: "sword" },
  nodef:   { en: "Def-breaker", pc: "#f4f4f4", pc2: "#ffffff", icon: "shieldx" },
};
export const PORTAL_ORDER = ["classic", "hp", "power", "mana", "nodef"]; // poradie v lobby (2 stĺpce po riadkoch)

// SVG z pixel riadkov (znak = farba z palety, bodka = priehľadné), ľubovoľná veľkosť
function pixRows(rows, pal, w, h) {
  let r = "";
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = pal[row[x]]; if (c) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; } });
  return `<svg viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

// Damage dlaždica v portal realm dáva 2 dmg → 2 ohníky vedľa seba (16×8)
const FLAME = ["....a...", "...aa...", "..aaaa..", "..aaaa..", ".aabbaa.", ".abbbba.", ".abbbba.", "..aaaa.."];
export const FLAME2_SVG = pixRows(FLAME.map(r => r + r), { a: "#ff7043", b: "#ffd54f" }, 16, 8);

// runy párov (7×7) - oba konce páru nesú rovnaký znak; id páru A–G
const GLYPHS = {
  A: [".a.....", ".a..a..", ".a.a...", ".aa..a.", ".a.aa..", ".a.....", ".a....."],   // Fehu
  B: ["...a...", "..a.a..", "..a.a..", ".a.a.a.", ".a...a.", "a.....a", "aaaaaaa"],   // oko v trojuholníku
  C: ["aaaaaaa", ".a...a.", "..a.a..", "...a...", "..a.a..", ".a...a.", "aaaaaaa"],   // presýpacie hodiny
  D: ["..aaa..", ".a.....", "a......", "a...a..", "a......", ".a.....", "..aaa.."],   // polmesiac s bodkou
  E: ["a..a..a", "a..a..a", "a..a..a", ".aaaaa.", "...a...", "...a...", "..aaa.."],   // trojzubec
  F: ["aaaaaa.", "a....a.", "a.aa.a.", "a.a..a.", "a.aaaa.", "a......", "aaaaaaa"],   // špirála
  G: ["...a...", "a..a..a", ".a.a.a.", "..aaa..", ".a.a.a.", "a..a..a", "...a..."],   // hviezdna pečať
};
export const glyphSvg = (id, color) => GLYPHS[id] ? pixRows(GLYPHS[id], { a: color }, 7, 7) : "";
export const typeIconSvg = (type) => PORTAL_TYPES[type]?.icon ? pixSvg(PORTAL_TYPES[type].icon) : "";

// pixel trhlina: zubatá šošovka z 4px pixelov (tmavý okraj / farba typu / svetlá / biele jadro), snímka `frame`
// (0–2 = iné zúbkovanie, strieda sa ako „praskanie"). Vracia dataURL obrázka s okrajom RIFT_PAD pre žiaru.
export const RIFT_PAD = 14;
const riftCache = new Map();
const darken = (hex, k) => "#" + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
export function riftDataUrl(len, h, type, frame) {
  const T = PORTAL_TYPES[type] || PORTAL_TYPES.classic;
  const key = [len, h, type, frame].join("|");
  if (riftCache.has(key)) return riftCache.get(key);
  const PX = 4, N = Math.round(len / PX), M = Math.round(h / PX), c = M / 2;
  let seed = 7 + frame * 131;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const dark = darken(T.pc, 0.45);
  const pix = document.createElement("canvas"); pix.width = N; pix.height = M;
  const px = pix.getContext("2d");
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N, base = Math.pow(Math.sin(Math.PI * t), 0.75) * c;
    const half = Math.max(0, base + (rnd() < 0.3 ? -1 : rnd() > 0.75 ? 1 : 0) * (base > 1.2 ? 1 : 0));
    if (half < 0.5) continue;
    const yShift = rnd() < 0.2 ? (rnd() < 0.5 ? -1 : 1) : 0; // trhlina mierne „kľukatí"
    for (let y = 0; y < M; y++) {
      const d = Math.abs(y + 0.5 - c - yShift) / half;
      if (d > 1) continue;
      px.fillStyle = d > 0.72 ? dark : d > 0.42 ? T.pc : (d > 0.16 || half < 1.6) ? T.pc2 : "#ffffff";
      px.fillRect(i, y, 1, 1);
    }
  }
  const out = document.createElement("canvas");
  out.width = len + RIFT_PAD * 2; out.height = h + RIFT_PAD * 2;
  const o = out.getContext("2d");
  o.imageSmoothingEnabled = false;
  o.shadowColor = T.pc;
  for (const blur of [12, 5]) { o.shadowBlur = blur; o.drawImage(pix, RIFT_PAD, RIFT_PAD, len, h); }
  o.shadowBlur = 0; o.drawImage(pix, RIFT_PAD, RIFT_PAD, len, h);
  const url = out.toDataURL();
  riftCache.set(key, url);
  return url;
}
