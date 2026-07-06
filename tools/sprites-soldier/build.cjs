// Soldier — asset pipeline (reprodukovateľné):
//   1) vygeneruje public/assets/soldier/Charge.png — kotúľajúci sa granát (8 rotačných framov 64×64,
//      klient ho cez CHARGE_ANIM cyklí počas letu = granát sa točí „po zemi")
//   2) prefarbí uniformu na ČIERNU do public/assets/soldier_2/ (P2 paleta): nízkosaturované
//      hnedo-olivové tóny uniformy → tmavé šedé; koža/puška/oči/výbuchy (výrazne oranžové, r−b>60)
//      a úplne tmavé pixely ostávajú. Explosion.png sa kopíruje bez zmeny (oheň je spoločný).
// Spustenie: node tools/sprites-soldier/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const SRC = path.join(__dirname, "../../public/assets/soldier");
const OUT2 = path.join(__dirname, "../../public/assets/soldier_2");
fs.mkdirSync(OUT2, { recursive: true });

/* ---------- 1) Charge.png — granát (8 framov rotácie po 45°) ---------- */
// predloha 16×16: vajcový granát s kovovou hlavičkou a páčkou; . = priehľadné
const PAL = {
  o: [86, 94, 56],    // telo — olivová
  d: [58, 64, 38],    // telo — tieň
  h: [126, 134, 84],  // telo — odlesk
  m: [128, 128, 134], // kov (hlavička)
  k: [70, 70, 76],    // kov — tieň
  l: [176, 148, 60],  // páčka (mosadz)
};
const BASE = [
  "................",
  "......mm........",
  ".....mkkl.......",
  "......mm.ll.....",
  ".....hoo..l.....",
  "....hooood......",
  "...hooooood.....",
  "...hooooood.....",
  "...oooooordd....".replace("r", "o"),
  "...ooooooodd....",
  "....oooooddd....",
  "....ooooddd.....",
  ".....ooddd......",
  "......ddd.......",
  "................",
  "................",
];
function buildCharge() {
  const S = 16, CELL = 64, N = 8;
  const png = new PNG({ width: CELL * N, height: CELL });
  const px = (gx, gy) => { const ch = (BASE[gy] || "")[gx]; return ch && PAL[ch] ? PAL[ch] : null; };
  for (let f = 0; f < N; f++) {
    const ang = f * Math.PI / 4; // granát sa kotúľa doprava → rotácia po 45°
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      // 64×64 canvas → vzorkuj predlohu v rotovanej sústave (nearest neighbour, pixel-art look)
      const u = (x + 0.5) / CELL - 0.5, v = (y + 0.5) / CELL - 0.5;
      const ru = u * cos - v * sin, rv = u * sin + v * cos;
      const gx = Math.floor((ru + 0.5) * S), gy = Math.floor((rv + 0.5) * S);
      const c = gx >= 0 && gy >= 0 && gx < S && gy < S ? px(gx, gy) : null;
      if (!c) continue;
      const i = ((y * png.width) + (f * CELL + x)) * 4;
      png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(SRC, "Charge.png"), PNG.sync.write(png));
  console.log("Charge.png (granát, 8 framov) -> assets/soldier/");
}

/* ---------- 2) P2 recolor — uniforma na čiernu ---------- */
// pravidlo per pixel: ponechaj priehľadné, výrazne oranžové (koža/drevo pušky/oči/úsťový plameň:
// r − b > 60) a veľmi svetlé (>200 luminancie, np. jadro výbuchu); zvyšok (uniforma, helma, vesta,
// rukavice) → grayscale × 0.55 = uhľovo čierna so zachovaným tieňovaním
function recolorBlack(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 20) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r - b > 60) continue;                       // koža / puška / oheň
    const lum = 0.3 * r + 0.55 * g + 0.15 * b;
    if (lum > 200) continue;                        // jadro záblesku
    const v = Math.round(lum * 0.55);
    data[i] = v; data[i + 1] = v; data[i + 2] = v;
  }
}
function buildP2() {
  for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".png"))) {
    const png = PNG.sync.read(fs.readFileSync(path.join(SRC, file)));
    if (file !== "Explosion.png") recolorBlack(png.data); // výbuch je oheň — rovnaký pre obe palety
    fs.writeFileSync(path.join(OUT2, file), PNG.sync.write(png));
  }
  console.log("P2 recolor -> assets/soldier_2/ (" + fs.readdirSync(OUT2).length + " files)");
}

buildCharge();
buildP2();
