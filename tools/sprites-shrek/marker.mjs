// Ikona Shrekových ohlásených skokov (marks) z fotky odznaku tools/sprites-shrek/marker-src.jpg:
// biele pozadie sa odstráni flood-fillom od okrajov (biele oči vnútri obrysu ostanú), okraj dostane mäkkú alfu,
// výsledok sa oreže a zmenší. JPG dekóduje headless Chrome (canvas), PNG zapíše pngjs.
// Výstup: public/assets/shrek/Mark.png (hladká).
// Spustenie: node tools/sprites-shrek/marker.mjs
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
const { PNG } = createRequire(import.meta.url)("pngjs");

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../../public/assets/shrek");
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(fs.existsSync);

// 1) JPG → RGBA cez canvas (data: URL obrázok canvas nezašpiní)
const b64 = fs.readFileSync(path.join(here, "marker-src.jpg")).toString("base64");
const html = `<img id=i src="data:image/jpeg;base64,${b64}"><script>
i.onload = () => { const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight;
  const x = c.getContext("2d"); x.drawImage(i, 0, 0); document.body.innerHTML = "<pre>" + c.toDataURL("image/png") + "</pre>"; };
</script>`;
const tmp = path.join(os.tmpdir(), "shrek-marker.html");
fs.writeFileSync(tmp, html);
const dom = execFileSync(CHROME, ["--headless=new", "--disable-gpu", "--virtual-time-budget=5000", "--dump-dom", "file:///" + tmp.split(path.sep).join("/")], { maxBuffer: 64 << 20 }).toString();
const png = PNG.sync.read(Buffer.from(dom.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1], "base64"));
const { width: W, height: H, data } = png;

// 2) pozadie: flood fill od okrajov cez „biele" pixely (svetlé a nesýte)
const whiteness = (i) => { const r = data[i], g = data[i + 1], b = data[i + 2]; return Math.min(r, g, b) - (Math.max(r, g, b) - Math.min(r, g, b)); };
const bg = new Uint8Array(W * H), stack = [];
for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
while (stack.length) {
  const p = stack.pop();
  if (bg[p] || whiteness(p * 4) < 175) continue;
  bg[p] = 1;
  const x = p % W, y = (p / W) | 0;
  if (x > 0) stack.push(p - 1); if (x < W - 1) stack.push(p + 1);
  if (y > 0) stack.push(p - W); if (y < H - 1) stack.push(p + W);
}
// mäkký okraj: pixel susediaci s pozadím dostane alfu podľa toho, aký je svetlý (antialias do bielej)
for (let p = 0; p < W * H; p++) {
  if (bg[p]) { data[p * 4 + 3] = 0; continue; }
  const x = p % W, y = (p / W) | 0;
  const edge = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1]) || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
  if (edge) data[p * 4 + 3] = Math.max(0, Math.min(255, Math.round((255 - whiteness(p * 4)) * 1.6)));
}
// 3) orez na obsah
let x0 = W, y0 = H, x1 = 0, y1 = 0;
for (let p = 0; p < W * H; p++) if (data[p * 4 + 3] > 20) { const x = p % W, y = (p / W) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }

// zmenšenie plošným priemerom (premultiplied alfa) do štvorca size×size (zarovnané na stred)
function scaled(size) {
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.max(bw, bh) / size;
  const ox = (size - bw / k) / 2, oy = (size - bh / k) / 2;
  const out = new PNG({ width: size, height: size });
  for (let ty = 0; ty < size; ty++) for (let tx = 0; tx < size; tx++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    const sx0 = x0 + (tx - ox) * k, sy0 = y0 + (ty - oy) * k;
    for (let sy = Math.floor(sy0); sy < sy0 + k; sy++) for (let sx = Math.floor(sx0); sx < sx0 + k; sx++) {
      n++;
      if (sx < x0 || sy < y0 || sx > x1 || sy > y1) continue;
      const i = (sy * W + sx) * 4, al = data[i + 3] / 255;
      r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al;
    }
    const o = (ty * size + tx) * 4;
    if (a > 0) { out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; }
    out.data[o + 3] = n ? Math.round(255 * a / n) : 0;
  }
  return out;
}
const smooth = scaled(128);
fs.writeFileSync(path.join(OUT, "Mark.png"), PNG.sync.write(smooth));
console.log(`zdroj ${W}×${H}, obsah ${x1 - x0 + 1}×${y1 - y0 + 1} → Mark.png 128`);
