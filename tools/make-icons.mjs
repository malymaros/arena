// tools/make-icons.mjs - ikony aplikácie (PWA manifest, apple-touch-icon): výsek HLAVY Fire wizarda z prvého framu
// Idle spritu. Výrez vychádza z headCrop v public/chars/fire.js (HUD hlavy v turnaji), zúžený na samotnú hlavu. Pixel art sa zväčší
// celočíselne (nearest neighbor) na tmavé pozadie s oranžovým rámom; hlava ostáva vnútri bezpečnej zóny maskable
// ikony (Android ju môže orezať do kruhu).
//   node tools/make-icons.mjs   → public/icons/icon-{180,192,512}.png
import pngjs from "pngjs";
import fs from "node:fs";
import path from "node:path";
import fire from "../public/chars/fire.js";
const { PNG } = pngjs;

const SRC = "public/assets/fire/Idle.png";
const OUT = "public/icons";
const BG = [18, 19, 21], FRAME = [255, 179, 0], EDGE = [0, 0, 0];

const sheet = PNG.sync.read(fs.readFileSync(SRC));
const fh = sheet.height; // framy sú štvorcové, berieme frame 0
// headCrop zahŕňa aj ramená (HUD hlavy) - pre ikonu ho zúžime na kapucňu s tvárou: 60 % strany,
// stred posunutý hore k tvári (namerané z výsledku, Fire Idle frame 0)
const { cx, cy, size: cs } = fire.headCrop;
const full = cs * fh, side = Math.round(full * 0.6);
const sx0 = Math.round(cx * fh - full / 2 + full * 0.43 - side / 2);
const sy0 = Math.round(cy * fh - full / 2 + full * 0.44 - side / 2);
const px = (x, y) => {
  if (x < 0 || y < 0 || x >= fh || y >= fh) return [0, 0, 0, 0];
  const i = (y * sheet.width + x) * 4;
  return [sheet.data[i], sheet.data[i + 1], sheet.data[i + 2], sheet.data[i + 3]];
};

fs.mkdirSync(OUT, { recursive: true });
for (const size of [180, 192, 512]) {
  const img = new PNG({ width: size, height: size });
  const border = Math.max(2, Math.round(size / 40));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(x, y, size - 1 - x, size - 1 - y);
    const c = d < border ? EDGE : d < border * 3 ? FRAME : BG;
    const i = (y * size + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
  }
  // hlava do max. 76 % strany (bezpečná zóna maskable = vnútorných 80 %), celočíselný násobok = ostré pixely
  const k = Math.max(1, Math.floor((size * 0.76) / side));
  const o = Math.round((size - side * k) / 2);
  for (let y = 0; y < side * k; y++) for (let x = 0; x < side * k; x++) {
    const [r, g, b, a8] = px(sx0 + Math.floor(x / k), sy0 + Math.floor(y / k));
    const a = a8 / 255;
    if (!a) continue;
    const di = ((o + y) * size + (o + x)) * 4;
    img.data[di] = Math.round(r * a + img.data[di] * (1 - a));
    img.data[di + 1] = Math.round(g * a + img.data[di + 1] * (1 - a));
    img.data[di + 2] = Math.round(b * a + img.data[di + 2] * (1 - a));
  }
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, PNG.sync.write(img));
  console.log(f, `(hlava ${side}×${side} px ×${k})`);
}
