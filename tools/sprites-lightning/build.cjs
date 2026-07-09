// Lightning Mage - reproducible P2 palette.
// P2 keeps the old CSS-filter feel for skin (very pale), but uses hand-picked sprite colors:
//   hood -> dark emerald green, dress -> emerald green, hair -> red.
// Lightning effects stay blue/yellow/white so the ability remains readable.
// Run: node tools/sprites-lightning/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const SRC = path.join(__dirname, "../../public/assets/lightning");
const OUT = path.join(__dirname, "../../public/assets/lightning_2");
fs.mkdirSync(OUT, { recursive: true });

const key = (r, g, b) => `${r},${g},${b}`;

const PALETTE = new Map([
  // Hood / upper robe: red -> dark emerald green.
  ["70,4,20",    [  4,  42,  32]],
  ["115,23,45",  [  8,  82,  60]],
  ["114,23,45",  [  8,  82,  60]],
  ["173,47,69",  [ 18, 126,  88]],
  ["171,47,69",  [ 16, 120,  84]],
  ["173,48,70",  [ 18, 126,  88]],
  ["169,47,69",  [ 14, 114,  80]],

  // Dress: brown -> emerald green, preserving shading.
  ["29,16,19",   [  8,  54,  42]],
  ["30,16,20",   [ 10,  60,  46]],
  ["59,32,39",   [ 22, 112,  82]],
  ["58,12,23",   [ 12,  88,  62]],
  ["66,36,51",   [ 34, 142, 104]],
  ["67,36,51",   [ 34, 142, 104]],
  ["68,37,51",   [ 36, 148, 108]],
  ["68,38,53",   [ 38, 152, 112]],
  ["113,65,59",  [ 86, 214, 164]],
  ["112,65,59",  [ 86, 214, 164]],
  ["111,64,58",  [ 78, 202, 154]],
  ["114,53,53",  [ 58, 178, 132]],
  ["125,56,51",  [ 66, 190, 142]],

  // Pale face/skin, close to the current P2 CSS-filter brightness.
  ["233,181,163", [244, 220, 218]],
  ["171,81,48",   [226, 178, 170]],
  ["169,81,48",   [224, 176, 168]],

  // Hair uses the same beige ramp as skin in the source sheet; geometry below separates it.
]);

const EFFECT_COLORS = new Set([
  "255,240,137", "248,197,58", "255,255,255", "138,161,246", "241,242,255",
]);
const HAIR_COLORS = new Set(["244,210,156", "160,134,98"]);
const SKIN_HAIR_COLORS = new Set(["244,210,156", "160,134,98"]);
const HAIR_PALETTE = new Map([
  ["244,210,156", [170,  64,  46]],
  ["160,134,98",  [ 92,  36,  32]],
]);
const SKIN_FALLBACK = new Map([
  ["244,210,156", [252, 239, 232]],
  ["160,134,98",  [204, 184, 178]],
]);
const HEAD_SKIN_SHADOW = new Map([
  ["114,53,53", [210, 178, 176]],
  ["125,56,51", [220, 188, 184]],
]);
const LOWER_BLACK_STRIP = new Map([
  ["171,81,48", [  6,  62,  48]],
  ["169,81,48", [  6,  62,  48]],
]);
const BOOT_COLORS = new Map([
  ["66,36,51", [  4,   4,   5]],
  ["67,36,51", [  4,   4,   5]],
  ["68,37,51", [  4,   4,   5]],
  ["68,38,53", [  4,   4,   5]],
]);

function getPixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

function setPixel(png, x, y, rgb) {
  const i = (y * png.width + x) * 4;
  png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2];
}

function componentMaskForFrame(png, fx, frameSize) {
  const startX = fx * frameSize;
  const total = frameSize * frameSize;
  const seen = new Uint8Array(total);
  let best = null;

  const isAnchor = (x, y) => {
    const [r, g, b, a] = getPixel(png, startX + x, y);
    if (a < 20) return false;
    return !EFFECT_COLORS.has(key(r, g, b));
  };

  for (let sy = 0; sy < frameSize; sy++) {
    for (let sx = 0; sx < frameSize; sx++) {
      const pos = sy * frameSize + sx;
      if (seen[pos] || !isAnchor(sx, sy)) continue;
      const stack = [[sx, sy]];
      const pixels = [];
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      seen[pos] = 1;
      while (stack.length) {
        const [x, y] = stack.pop();
        pixels.push([x, y]);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= frameSize || ny >= frameSize) continue;
          const ni = ny * frameSize + nx;
          if (seen[ni] || !isAnchor(nx, ny)) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      const score = maxY * 1000 + pixels.length;
      if (!best || score > best.score) best = { pixels, minX, maxX, minY, maxY, score };
    }
  }

  if (!best) return null;
  const mask = new Uint8Array(total);
  for (const [x, y] of best.pixels) mask[y * frameSize + x] = 1;
  best.mask = mask;
  return best;
}

function nearMask(mask, x, y, frameSize, radius) {
  for (let yy = Math.max(0, y - radius); yy <= Math.min(frameSize - 1, y + radius); yy++) {
    for (let xx = Math.max(0, x - radius); xx <= Math.min(frameSize - 1, x + radius); xx++) {
      if (mask[yy * frameSize + xx]) return true;
    }
  }
  return false;
}

function recolorActorSheet(png) {
  const frameSize = png.height;
  const frames = Math.round(png.width / frameSize);
  for (let f = 0; f < frames; f++) {
    const comp = componentMaskForFrame(png, f, frameSize);
    if (!comp) continue;
    const startX = f * frameSize;
    const headBottom = comp.minY + Math.min(54, Math.ceil((comp.maxY - comp.minY + 1) * 0.50));
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const [r, g, b, a] = getPixel(png, startX + x, y);
        if (a < 20) continue;
        const k = key(r, g, b);
        const inActor = comp.mask[y * frameSize + x] === 1;
        const inHeadSpace = y >= comp.minY - 8 && y <= Math.min(headBottom, comp.minY + 24)
          && x >= comp.minX - 12 && x <= comp.maxX + 12;
        const inHairRegion = HAIR_COLORS.has(k) && inHeadSpace
          && (SKIN_HAIR_COLORS.has(k) || nearMask(comp.mask, x, y, frameSize, 3));

        if (inHairRegion) setPixel(png, startX + x, y, HAIR_PALETTE.get(k));
        else if (inActor && inHeadSpace && HEAD_SKIN_SHADOW.has(k)) setPixel(png, startX + x, y, HEAD_SKIN_SHADOW.get(k));
        else if (inActor && y >= comp.maxY - 4 && BOOT_COLORS.has(k)) setPixel(png, startX + x, y, BOOT_COLORS.get(k));
        else if (inActor && y >= comp.minY + 29 && LOWER_BLACK_STRIP.has(k)) setPixel(png, startX + x, y, LOWER_BLACK_STRIP.get(k));
        else if (inActor && SKIN_FALLBACK.has(k)) setPixel(png, startX + x, y, SKIN_FALLBACK.get(k));
        else if (inActor && PALETTE.has(k)) setPixel(png, startX + x, y, PALETTE.get(k));
      }
    }
  }
}

for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".png"))) {
  const png = PNG.sync.read(fs.readFileSync(path.join(SRC, file)));
  if (file !== "Charge.png") recolorActorSheet(png);
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(png));
}

console.log("P2 lightning recolor -> assets/lightning_2/");
