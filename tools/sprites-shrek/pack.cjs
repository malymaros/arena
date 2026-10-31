// Zloženie animačných pásov zo SHREK.png podľa cells.json (najprv node detect.cjs).
// Formát ako ostatné postavy: štvorcové frames v horizontálnom páse (počet = šírka/výška),
// kotva = spodok boxu (nohy) + x-ťažisko zelených pixelov (telo) → efekty/sud netrasú postavou.
// Výstup: public/assets/shrek/<Anim>.png + anims.json (snímky, veľkosť, fps, slučka - číta public/client/shrek.js).
// Spustenie: node tools/sprites-shrek/pack.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const src = PNG.sync.read(fs.readFileSync(path.join(__dirname, "SHREK.png")));
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, "cells.json"), "utf8"));
const OUT = path.join(__dirname, "../../public/assets/shrek");
fs.mkdirSync(OUT, { recursive: true });

// riadok cells.json → výber boxov (index od..do, vrátane); src = ktorá hra
const R = (row, from = 0, to) => rows[row].cells.slice(from, to === undefined ? undefined : to + 1);
const ANIMS = [
  // Shrek Reekin' Havoc (ľavá časť sheetu)
  { name: "Idle", cells: R(0, 0, 4), fps: 6, loop: true },
  { name: "Walk", cells: R(5), fps: 10, loop: true },
  { name: "JumpKick", cells: R(7), fps: 10 },
  { name: "Punch", cells: R(9), fps: 10 },
  { name: "CrouchKick", cells: R(11), fps: 9 },
  { name: "PowerUp", cells: R(13), fps: 12, loop: true },
  { name: "Tackle", cells: R(16), fps: 14 },
  { name: "HurtDead", cells: R(18), fps: 8 },
  { name: "Climb", cells: R(20), fps: 8, loop: true },
  { name: "InOut", cells: R(22), fps: 4 },
  { name: "Victory", cells: R(24), fps: 6, loop: true },
  { name: "PickUp", cells: R(25), fps: 8 },
  { name: "Push", cells: R(26, 0, 5), fps: 9, loop: true },
  { name: "Roar", cells: [...R(27), ...R(28), ...R(29)], fps: 12 },
  { name: "SpecialMoves", cells: R(30, 0, 6).concat(R(30, 8, 8)), fps: 10 },
  // Shrek: Hassle at the Castle (pravá časť — iný štýl)
  { name: "H_Idle", cells: R(1, 0, 3), fps: 6, loop: true, hassle: true },
  { name: "H_Walk", cells: R(4), fps: 10, loop: true, hassle: true },
  { name: "H_Row6", cells: R(6), fps: 8, loop: true, hassle: true },
  { name: "H_Row8", cells: R(8), fps: 10, hassle: true },
  { name: "H_Row10", cells: R(10), fps: 8, hassle: true },
  { name: "H_Row12", cells: R(12), fps: 6, hassle: true },
  { name: "H_Row14", cells: R(14), fps: 9, hassle: true },
  { name: "H_Club", cells: R(15), fps: 10, hassle: true },
  { name: "H_Row17", cells: R(17), fps: 8, loop: true, hassle: true },
  { name: "H_Roar", cells: R(19, 0, 1), fps: 6, loop: true, hassle: true },
  { name: "H_Row21", cells: R(21), fps: 10, hassle: true },
  { name: "H_Row23", cells: R(23), fps: 10, hassle: true },
];

const W = src.width;
const isBody = (i) => src.data[i + 3] > 0 && src.data[i + 1] > 100 && src.data[i + 1] > src.data[i] && src.data[i + 1] > src.data[i + 2] + 40;
function bodyX([x0, y0, w, h]) {
  let s = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (isBody((y * W + x) * 4)) { s += x; n++; }
  return n ? s / n : x0 + w / 2;
}

const meta = [];
for (const a of ANIMS) {
  const anchors = a.cells.map((c) => ({ c, ax: bodyX(c), bottom: c[1] + c[3] }));
  let left = 0, right = 0, up = 0;
  for (const { c, ax, bottom } of anchors) {
    left = Math.max(left, ax - c[0]); right = Math.max(right, c[0] + c[2] - ax); up = Math.max(up, bottom - c[1]);
  }
  const half = Math.ceil(Math.max(left, right)) + 2;
  const S = Math.max(2 * half, up + 4);
  const out = new PNG({ width: S * anchors.length, height: S });
  anchors.forEach(({ c, ax, bottom }, f) => {
    const ox = f * S + Math.round(S / 2 - ax), oy = S - 2 - bottom;
    for (let y = c[1]; y < c[1] + c[3]; y++) for (let x = c[0]; x < c[0] + c[2]; x++) {
      const si = (y * W + x) * 4;
      if (!src.data[si + 3]) continue;
      const dx = x + ox, dy = y + oy;
      if (dx < f * S || dx >= (f + 1) * S || dy < 0 || dy >= S) continue;
      const di = (dy * out.width + dx) * 4;
      src.data.copy(out.data, di, si, si + 4);
    }
  });
  fs.writeFileSync(path.join(OUT, a.name + ".png"), PNG.sync.write(out));
  meta.push({ name: a.name, frames: anchors.length, size: S, fps: a.fps, loop: !!a.loop, hassle: !!a.hassle });
}
fs.writeFileSync(path.join(OUT, "anims.json"), JSON.stringify(meta, null, 1));

console.log(meta.map((m) => `${m.name} ${m.frames}f ${m.size}px`).join("\n"));
