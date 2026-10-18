// P2 "zlty kostym" paleta: kostymove frames su identicke pozy s vymenenou paletou,
// takze z dvojice oranzovy (1.0) vs zlty (1.3) kostym vypocitame presnu mapu farieb
// a prefarbime nou vsetky pasy v out/ -> out/p2/. Charge (modra cakra) sa prefarbi hue-shiftom na zlatu.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = PNG.sync.read(fs.readFileSync(path.join(__dirname, "NARUTO.png")));
const OUT = path.join(__dirname, "out");
const P2 = path.join(OUT, "p2");
fs.mkdirSync(P2, { recursive: true });

function isMagenta(r, g, b) { return r > 180 && b > 180 && g < 80; }
function isGray(r, g, b) { return Math.abs(r - 206) <= 4 && Math.abs(g - 213) <= 4 && Math.abs(b - 223) <= 4; }

// obidva kostymy: rovnake boxy 45x75 (1.0 oranzovy x30-74, 1.3 zlty x300-344, y15-89)
const ORANGE = { x: 30, y: 15 }, YELLOW = { x: 300, y: 15 }, CW = 45, CH = 75;
const map = new Map(); // orangeRGB -> {farba: pocet}
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
  const oi = ((ORANGE.y + y) * SRC.width + (ORANGE.x + x)) * 4;
  const yi = ((YELLOW.y + y) * SRC.width + (YELLOW.x + x)) * 4;
  const or = SRC.data[oi], og = SRC.data[oi + 1], ob = SRC.data[oi + 2];
  const yr = SRC.data[yi], yg = SRC.data[yi + 1], yb = SRC.data[yi + 2];
  if (isMagenta(or, og, ob) || isGray(or, og, ob)) continue;
  if (isMagenta(yr, yg, yb) || isGray(yr, yg, yb)) continue; // pozy by mali sediet; nesuhlas preskoc
  const key = (or << 16) | (og << 8) | ob, val = (yr << 16) | (yg << 8) | yb;
  if (!map.has(key)) map.set(key, new Map());
  const m = map.get(key);
  m.set(val, (m.get(val) || 0) + 1);
}
// vyhodnotenie: majoritna cielova farba per zdrojova; konflikty vypis
const colorMap = new Map();
let changed = 0;
for (const [key, vals] of map) {
  const sorted = [...vals.entries()].sort((a, b) => b[1] - a[1]);
  const [winner, wCount] = sorted[0];
  const total = [...vals.values()].reduce((a, b) => a + b, 0);
  if (winner !== key) {
    colorMap.set(key, winner);
    changed++;
    const hex = n => "#" + n.toString(16).padStart(6, "0");
    const conf = sorted.length > 1 ? `  (konflikt: ${sorted.slice(1).map(([v, c]) => hex(v) + "x" + c).join(", ")})` : "";
    console.log(`${hex(key)} -> ${hex(winner)}  ${wCount}/${total}px${conf}`);
  }
}
console.log(`mapa: ${changed} zmenenych farieb z ${map.size} celkovo\n`);

// hue-shift modrej cakry na zlatu (pre Charge/Rasengan)
function goldify(r, g, b) {
  // RGB -> HSL
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min;
  let h = 0;
  if (d) {
    if (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  const l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (h < 160 || h > 280) return [r, g, b]; // nie je modra -> nechaj
  const nh = 42; // zlata
  // HSL -> RGB
  const c = (1 - Math.abs(2 * l - 1)) * s, xx = c * (1 - Math.abs((nh / 60) % 2 - 1)), m = l - c / 2;
  const [r2, g2, b2] = [c, xx, 0]; // nh=42 je v [0,60)
  return [Math.round((r2 + m) * 255), Math.round((g2 + m) * 255), Math.round((b2 + m) * 255)];
}

const GOLD_FILES = new Set(["Charge.png", "Rasengan.png"]); // cakrove efekty -> zlate
for (const f of fs.readdirSync(OUT).filter(f => f.endsWith(".png") && !f.startsWith("_"))) {
  const png = PNG.sync.read(fs.readFileSync(path.join(OUT, f)));
  for (let i = 0; i < png.width * png.height; i++) {
    if (!png.data[i * 4 + 3]) continue;
    const r = png.data[i * 4], g = png.data[i * 4 + 1], b = png.data[i * 4 + 2];
    if (GOLD_FILES.has(f)) {
      const [nr, ng, nb] = goldify(r, g, b);
      png.data[i * 4] = nr; png.data[i * 4 + 1] = ng; png.data[i * 4 + 2] = nb;
    } else {
      const key = (r << 16) | (g << 8) | b;
      if (colorMap.has(key)) {
        const v = colorMap.get(key);
        png.data[i * 4] = v >> 16; png.data[i * 4 + 1] = (v >> 8) & 255; png.data[i * 4 + 2] = v & 255;
      }
    }
  }
  fs.writeFileSync(path.join(P2, f), PNG.sync.write(png));
}
console.log("out/p2/: " + fs.readdirSync(P2).length + " suborov");
