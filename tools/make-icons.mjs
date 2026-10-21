// tools/make-icons.mjs - ikony aplikácie (PWA manifest, apple-touch-icon) z prvého framu Idle spritu Fire maga.
// Pixel art sa zväčší celočíselne (nearest neighbor) na tmavé pozadie s oranžovým rámom; postava ostáva
// vnútri bezpečnej zóny maskable ikony (Android ju môže orezať do kruhu).
//   node tools/make-icons.mjs   → public/icons/icon-{180,192,512}.png
import pngjs from "pngjs";
import fs from "node:fs";
import path from "node:path";
const { PNG } = pngjs;

const SRC = "public/assets/fire/Idle.png";
const OUT = "public/icons";
const BG = [18, 19, 21], FRAME = [255, 179, 0], EDGE = [0, 0, 0];

const sheet = PNG.sync.read(fs.readFileSync(SRC));
const fh = sheet.height; // framy sú štvorcové
// bbox nepriehľadných pixelov prvého framu
let x0 = fh, y0 = fh, x1 = -1, y1 = -1;
for (let y = 0; y < fh; y++) for (let x = 0; x < fh; x++) {
  if (sheet.data[(y * sheet.width + x) * 4 + 3] > 20) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
}
const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

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
  // postava do max. 78 % výšky (bezpečná zóna maskable = vnútorných 80 %)
  const k = Math.max(1, Math.floor((size * 0.78) / Math.max(bw, bh)));
  const ox = Math.round((size - bw * k) / 2), oy = Math.round((size - bh * k) / 2);
  for (let y = 0; y < bh * k; y++) for (let x = 0; x < bw * k; x++) {
    const si = ((y0 + Math.floor(y / k)) * sheet.width + (x0 + Math.floor(x / k))) * 4;
    const a = sheet.data[si + 3] / 255;
    if (!a) continue;
    const di = ((oy + y) * size + (ox + x)) * 4;
    for (let c = 0; c < 3; c++) img.data[di + c] = Math.round(sheet.data[si + c] * a + img.data[di + c] * (1 - a));
  }
  const f = path.join(OUT, `icon-${size}.png`);
  fs.writeFileSync(f, PNG.sync.write(img));
  console.log(f, `(postava ${bw}×${bh} ×${k})`);
}
