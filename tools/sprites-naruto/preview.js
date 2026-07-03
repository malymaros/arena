// Kontaktny nahlad zadanych pasov (argumenty = subory v out/) pod sebou na tmavom pozadi
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const files = process.argv.slice(2);
const strips = files.map(f => ({ f, png: PNG.sync.read(fs.readFileSync(path.join(__dirname, "out", f))) }));
const W = Math.max(...strips.map(s => s.png.width));
const H = strips.reduce((a, s) => a + s.png.height + 4, 0);
const prev = new PNG({ width: W, height: H });
for (let i = 0; i < W * H; i++) { prev.data[i * 4] = 30; prev.data[i * 4 + 1] = 30; prev.data[i * 4 + 2] = 38; prev.data[i * 4 + 3] = 255; }
let oy = 0;
for (const s of strips) {
  for (let y = 0; y < s.png.height; y++) for (let x = 0; x < s.png.width; x++) {
    const i2 = (y * s.png.width + x) * 4;
    if (!s.png.data[i2 + 3]) continue;
    s.png.data.copy(prev.data, ((oy + y) * W + x) * 4, i2, i2 + 4);
  }
  oy += s.png.height;
  for (let x = 0; x < W; x++) { const di = ((oy + 1) * W + x) * 4; prev.data[di] = 90; prev.data[di + 1] = 90; prev.data[di + 2] = 110; }
  oy += 4;
}
fs.writeFileSync(path.join(__dirname, "out", "_preview2.png"), PNG.sync.write(prev));
console.log("out/_preview2.png " + W + "x" + H);
