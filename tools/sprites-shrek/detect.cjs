// Detekcia frame-ov v SHREK.png (rip A.J. Nitro: Shrek Reekin' Havoc + Hassle at the Castle).
// Pozadie je priehľadné; sprite = súvislý komponent nepriehľadných pixelov. Komponenty bez zelenej
// (čierny text popisov, rámčeky s kreditmi) sa zahodia; blízke kúsky (efekty, sud) sa zlúčia.
// Výstup: cells.json (riadky → boxy) + overview.png (boxy orámované, riadky striedavo farebne).
// Spustenie: node tools/sprites-shrek/detect.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, "SHREK.png")));
const { width: W, height: H, data } = png;
const opaque = (x, y) => data[(y * W + x) * 4 + 3] > 0;
const isGreen = (i) => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]) > 50; // farebný pixel (text je čiernobiely)

const label = new Int32Array(W * H).fill(-1);
const boxes = [];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (label[y * W + x] !== -1) continue;
  if (!opaque(x, y)) { label[y * W + x] = -2; continue; }
  const box = { x0: x, y0: y, x1: x, y1: y, count: 0, green: 0 };
  const id = boxes.length; boxes.push(box);
  const st = [y * W + x]; label[y * W + x] = id;
  while (st.length) {
    const cur = st.pop(), cx = cur % W, cy = (cur / W) | 0;
    box.count++; if (isGreen(cur * 4)) box.green++;
    box.x0 = Math.min(box.x0, cx); box.x1 = Math.max(box.x1, cx);
    box.y0 = Math.min(box.y0, cy); box.y1 = Math.max(box.y1, cy);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (label[ni] !== -1) continue;
      if (!opaque(nx, ny)) { label[ni] = -2; continue; }
      label[ni] = id; st.push(ni);
    }
  }
}

// zlúčenie blízkych kúskov (GAP px) — len medzi nie-textovými komponentmi
const GAP = 3;
let items = boxes.filter((b) => b.count >= 4);
let merged = true;
while (merged) {
  merged = false;
  outer: for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.x0 - GAP <= b.x1 && b.x0 - GAP <= a.x1 && a.y0 - GAP <= b.y1 && b.y0 - GAP <= a.y1) {
      a.x0 = Math.min(a.x0, b.x0); a.y0 = Math.min(a.y0, b.y0);
      a.x1 = Math.max(a.x1, b.x1); a.y1 = Math.max(a.y1, b.y1);
      a.count += b.count; a.green += b.green;
      items.splice(j, 1); merged = true; break outer;
    }
  }
}
items = items.filter((b) => b.green > 0);

items.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
const rows = [];
for (const it of items) {
  const cy = (it.y0 + it.y1) / 2;
  let row = rows.find((r) => Math.abs(r.side - (it.x0 > 820 ? 1 : 0)) === 0 && cy >= r.y0 - 4 && cy <= r.y1 + 4);
  if (!row) { row = { side: it.x0 > 820 ? 1 : 0, y0: it.y0, y1: it.y1, cells: [] }; rows.push(row); }
  row.y0 = Math.min(row.y0, it.y0); row.y1 = Math.max(row.y1, it.y1);
  row.cells.push(it);
}
rows.forEach((r) => r.cells.sort((a, b) => a.x0 - b.x0));
fs.writeFileSync(path.join(__dirname, "cells.json"), JSON.stringify(rows.map((r, i) => ({
  row: i, side: r.side, y0: r.y0, y1: r.y1,
  cells: r.cells.map((c) => [c.x0, c.y0, c.x1 - c.x0 + 1, c.y1 - c.y0 + 1]),
})), null, 1));

const ov = new PNG({ width: W, height: H });
data.copy(ov.data);
const COLS = [[255, 0, 0], [0, 0, 255], [255, 0, 255], [0, 160, 160]];
rows.forEach((r, ri) => r.cells.forEach((c) => {
  const col = COLS[ri % COLS.length];
  const put = (x, y) => { const i = (y * W + x) * 4; ov.data[i] = col[0]; ov.data[i + 1] = col[1]; ov.data[i + 2] = col[2]; ov.data[i + 3] = 255; };
  for (let x = c.x0 - 1; x <= c.x1 + 1; x++) { put(x, c.y0 - 1); put(x, c.y1 + 1); }
  for (let y = c.y0 - 1; y <= c.y1 + 1; y++) { put(c.x0 - 1, y); put(c.x1 + 1, y); }
}));
fs.writeFileSync(path.join(__dirname, "overview.png"), PNG.sync.write(ov));
rows.forEach((r, i) => console.log(i, r.side ? "R" : "L", r.y0 + "-" + r.y1, r.cells.length, r.cells.map((c) => `${c.x0},${c.y0} ${c.x1 - c.x0 + 1}x${c.y1 - c.y0 + 1}`).join(" | ")));
