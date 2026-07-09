// Fire Wizard - reproducible P2 palette.
// P2 keeps the original sprite/effects, but recolors the brown hood/beard to black
// and the gold hood band to red. Fire effects and Charge.png stay unchanged.
// Run: node tools/sprites-fire/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const SRC = path.join(__dirname, "../../public/assets/fire");
const OUT = path.join(__dirname, "../../public/assets/fire_2");
fs.mkdirSync(OUT, { recursive: true });

const key = (r, g, b) => `${r},${g},${b}`;

const BLACK_PALETTE = new Map([
  // Brown hood / cloak / beard ramp -> black ramp, preserving sprite shading.
  ["66,36,51",  [  7,   7,  10]],
  ["91,49,56",  [ 16,  16,  20]],
  ["113,65,59", [ 34,  33,  39]],
]);

const RED_BAND_PALETTE = new Map([
  // Gold hood band -> red.
  ["249,163,27", [205,  24,  34]],
]);

const EFFECT_COLORS = new Set([
  "250,106,10", "255,213,65", "249,163,27",
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

function recolorActorSheet(png, options = {}) {
  const limitGoldToActor = !!options.limitGoldToActor;
  const frameSize = png.height;
  const frames = Math.round(png.width / frameSize);
  for (let f = 0; f < frames; f++) {
    const comp = componentMaskForFrame(png, f, frameSize);
    if (!comp) continue;
    const startX = f * frameSize;
    for (let y = 0; y < frameSize; y++) {
      for (let x = 0; x < frameSize; x++) {
        const [r, g, b, a] = getPixel(png, startX + x, y);
        if (a < 20) continue;
        const k = key(r, g, b);
        const inActor = comp.mask[y * frameSize + x] === 1;
        const nearActor = nearMask(comp.mask, x, y, frameSize, 2);
        const inActorBounds = x >= comp.minX - 2 && x <= comp.maxX + 2
          && y >= comp.minY - 2 && y <= comp.maxY + 2;

        if (BLACK_PALETTE.has(k)) setPixel(png, startX + x, y, BLACK_PALETTE.get(k));
        else if (RED_BAND_PALETTE.has(k) && (!limitGoldToActor || (nearActor && inActorBounds))) {
          setPixel(png, startX + x, y, RED_BAND_PALETTE.get(k));
        }
      }
    }
  }
}

for (const file of fs.readdirSync(SRC).filter(f => f.endsWith(".png"))) {
  const srcFile = path.join(SRC, file);
  const outFile = path.join(OUT, file);
  if (file === "Charge.png") {
    fs.copyFileSync(srcFile, outFile);
    continue;
  }

  const png = PNG.sync.read(fs.readFileSync(srcFile));
  recolorActorSheet(png, { limitGoldToActor: file === "Flame_jet.png" });
  fs.writeFileSync(outFile, PNG.sync.write(png));
}

console.log("P2 fire recolor -> assets/fire_2/");
