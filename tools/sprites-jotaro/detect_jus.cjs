// Detekcia buniek v JUS sheete (kolaz na jednofarebnom pozadi): node detect_jus.cjs <sp|jotaro>
// Connected components -> merge blizkych boxov -> riadky -> ocislovany overview + cells json
// (prevzate z tools/sprites-naruto/detect.js)
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./jus_sheets.cjs");

const cfg = SHEETS[process.argv[2] || "sp"];
if (!cfg) { console.error("neznamy sheet:", process.argv[2]); process.exit(1); }

const png = PNG.sync.read(fs.readFileSync(cfg.src));
const { width: W, height: H, data } = png;
const [BR, BG_, BB] = cfg.bg;

function isBg(i) {
  const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
  if (a < 10) return true;
  return Math.abs(r-BR) <= 6 && Math.abs(g-BG_) <= 6 && Math.abs(b-BB) <= 6;
}

const label = new Int32Array(W * H).fill(-1);
const boxes = [];
const stack = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const idx = y * W + x;
  if (label[idx] !== -1) continue;
  if (isBg(idx * 4)) { label[idx] = -2; continue; }
  const id = boxes.length;
  const box = { x0: x, y0: y, x1: x, y1: y, count: 0 };
  boxes.push(box);
  stack.length = 0; stack.push(idx); label[idx] = id;
  while (stack.length) {
    const cur = stack.pop();
    const cx = cur % W, cy = (cur / W) | 0;
    box.count++;
    if (cx < box.x0) box.x0 = cx; if (cx > box.x1) box.x1 = cx;
    if (cy < box.y0) box.y0 = cy; if (cy > box.y1) box.y1 = cy;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (label[ni] !== -1) continue;
      if (isBg(ni * 4)) { label[ni] = -2; continue; }
      label[ni] = id; stack.push(ni);
    }
  }
}

const GAP = 4;
let items = boxes.filter(b => b.count >= 30);
let merged = true;
while (merged) {
  merged = false;
  outer:
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.x0 - GAP <= b.x1 && b.x0 - GAP <= a.x1 && a.y0 - GAP <= b.y1 && b.y0 - GAP <= a.y1) {
      a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
      a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
      a.count += b.count;
      items.splice(j, 1); merged = true; break outer;
    }
  }
}

// vyhod velky artwork a napis (boxy zacinajuce za maxX alebo obrie)
items = items.filter(b => b.x0 <= cfg.maxX && (b.x1 - b.x0) < 400 && (b.y1 - b.y0) < 400);

items.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
const rows = [];
for (const it of items) {
  const cy = (it.y0 + it.y1) / 2;
  let row = rows.find(r => cy >= r.y0 && cy <= r.y1 + 10);
  if (!row) { row = { y0: it.y0, y1: it.y1, cells: [] }; rows.push(row); }
  row.y0 = Math.min(row.y0, it.y0); row.y1 = Math.max(row.y1, it.y1);
  row.cells.push(it);
}
rows.sort((a, b) => a.y0 - b.y0);
rows.forEach(r => r.cells.sort((a, b) => a.x0 - b.x0));

const FONT = {
  "0": ["111","101","101","101","111"], "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"], "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"], "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"], "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"], "9": ["111","101","111","001","111"],
  ".": ["000","000","000","000","010"],
};
const ov = new PNG({ width: W, height: H });
data.copy(ov.data);
function px(x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4; ov.data[i] = r; ov.data[i+1] = g; ov.data[i+2] = b; ov.data[i+3] = 255;
}
function rect(b) {
  for (let x = b.x0; x <= b.x1; x++) { px(x, b.y0, 255, 0, 0); px(x, b.y1, 255, 0, 0); }
  for (let y = b.y0; y <= b.y1; y++) { px(b.x0, y, 255, 0, 0); px(b.x1, y, 255, 0, 0); }
}
function text(s, x, y, scale) {
  let cx = x;
  for (const ch of s) {
    const glyph = FONT[ch]; if (!glyph) { cx += 4 * scale; continue; }
    for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 3; gx++)
      if (glyph[gy][gx] === "1") for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++)
        px(cx + gx * scale + sx, y + gy * scale + sy, 255, 255, 0);
    cx += 4 * scale;
  }
}
const cellsOut = [];
rows.forEach((row, ri) => {
  row.cells.forEach((c, ci) => {
    rect(c);
    text(`${ri}.${ci}`, c.x0 + 1, c.y0 + 1, 2);
    cellsOut.push({ id: `${ri}.${ci}`, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, w: c.x1 - c.x0 + 1, h: c.y1 - c.y0 + 1 });
  });
});
fs.writeFileSync(path.join(__dirname, cfg.overview), PNG.sync.write(ov));
fs.writeFileSync(path.join(__dirname, cfg.cells), JSON.stringify(cellsOut, null, 1));
console.log(`rows: ${rows.length}, cells: ${cellsOut.length}`);
console.log(rows.map((r, i) => `row ${i}: y=${r.y0}-${r.y1}, ${r.cells.length} cells`).join("\n"));
