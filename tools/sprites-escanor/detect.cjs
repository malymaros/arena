// Detekcia animacnych pasov v ESCANOR.png (jednofarebne magenta pozadie 163,73,164).
// Projekcne profily: Y-pasma (strip vs. tenky label), v kazdom stripe X-frames podla prazdnych stlpcov.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const SRC = path.join(__dirname, "ESCANOR.png");
const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: W, height: H, data } = png;

const BG = [163, 73, 164];
function isBg(x, y) {
  const i = (y * W + x) * 4;
  if (data[i + 3] < 20) return true; // priehladne
  return Math.abs(data[i] - BG[0]) <= 12 && Math.abs(data[i + 1] - BG[1]) <= 12 && Math.abs(data[i + 2] - BG[2]) <= 12;
}

// --- Y projekcia: ktore riadky maju obsah
const rowHas = new Uint8Array(H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) { if (!isBg(x, y)) { rowHas[y] = 1; break; } }
}
// Y-pasma: run obsahu, oddelene >= YGAP prazdnymi riadkami
const YGAP = 5;
const yBands = [];
{
  let y = 0;
  while (y < H) {
    if (!rowHas[y]) { y++; continue; }
    let y0 = y, y1 = y;
    let blanks = 0;
    while (y < H && blanks <= YGAP) {
      if (rowHas[y]) { y1 = y; blanks = 0; } else blanks++;
      y++;
    }
    yBands.push({ y0, y1 });
  }
}

// --- pre kazde y-pasmo x-frames
const XGAP = 3;      // >= tolko prazdnych stlpcov oddeluje frame
const MIN_FR_W = 6;  // uzsie ignoruj (drobky/bodky pisma)
function framesIn(y0, y1) {
  const colHas = new Uint8Array(W);
  for (let x = 0; x < W; x++) {
    for (let y = y0; y <= y1; y++) { if (!isBg(x, y)) { colHas[x] = 1; break; } }
  }
  const frames = [];
  let x = 0;
  while (x < W) {
    if (!colHas[x]) { x++; continue; }
    let x0 = x, x1 = x, blanks = 0;
    while (x < W && blanks <= XGAP) {
      if (colHas[x]) { x1 = x; blanks = 0; } else blanks++;
      x++;
    }
    if (x1 - x0 + 1 < MIN_FR_W) continue;
    // orez y na skutocny obsah tohto frameu
    let fy0 = y1, fy1 = y0;
    for (let yy = y0; yy <= y1; yy++)
      for (let xx = x0; xx <= x1; xx++)
        if (!isBg(xx, yy)) { if (yy < fy0) fy0 = yy; if (yy > fy1) fy1 = yy; break; }
    frames.push({ x0, y0: fy0, x1, y1: fy1, w: x1 - x0 + 1, h: fy1 - fy0 + 1 });
  }
  return frames;
}

// klasifikacia pasma: strip (vysoke) vs label/text (nizke)
const bands = yBands.map((b, i) => {
  const h = b.y1 - b.y0 + 1;
  const frames = framesIn(b.y0, b.y1);
  return { i, y0: b.y0, y1: b.y1, h, frames, kind: h >= 30 ? "strip" : "label" };
});

// --- overview.png s ramcekmi + cislami pasiem
const FONT = {
  "0": ["111","101","101","101","111"], "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"], "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"], "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"], "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"], "9": ["111","101","111","001","111"],
  ".": ["000","000","000","000","010"], ":": ["000","010","000","010","000"],
  "L": ["100","100","100","100","111"], "S": ["111","100","111","001","111"],
};
const ov = new PNG({ width: W, height: H });
data.copy(ov.data);
function px(x, y, r, g, b) { if (x<0||y<0||x>=W||y>=H) return; const i=(y*W+x)*4; ov.data[i]=r;ov.data[i+1]=g;ov.data[i+2]=b;ov.data[i+3]=255; }
function rect(x0,y0,x1,y1,r,g,b){ for(let x=x0;x<=x1;x++){px(x,y0,r,g,b);px(x,y1,r,g,b);} for(let y=y0;y<=y1;y++){px(x0,y,r,g,b);px(x1,y,r,g,b);} }
function text(s,x,y,sc,r,g,b){ let cx=x; for(const ch of s){const gl=FONT[ch]; if(!gl){cx+=4*sc;continue;} for(let gy=0;gy<5;gy++)for(let gx=0;gx<3;gx++){if(gl[gy][gx]==="1")for(let sy=0;sy<sc;sy++)for(let sx=0;sx<sc;sx++)px(cx+gx*sc+sx,y+gy*sc+sy,r,g,b);} cx+=4*sc;} }

const out = [];
for (const b of bands) {
  const col = b.kind === "strip" ? [255,0,0] : [0,180,255];
  rect(0, b.y0, W-1, b.y1, ...col.map(c=>c===0?40:c)); // pasmo cez celu sirku slabo
  text(`${b.kind==="strip"?"S":"L"}${b.i}`, 2, b.y0+2, 3, 255,255,0);
  b.frames.forEach((f, fi) => {
    rect(f.x0, f.y0, f.x1, f.y1, ...col);
    if (b.kind === "strip") text(`${fi}`, f.x0+1, f.y0+1, 2, 255,255,0);
  });
  out.push({ i: b.i, kind: b.kind, y0: b.y0, y1: b.y1, h: b.h, nframes: b.frames.length, frames: b.frames });
}
fs.writeFileSync(path.join(__dirname, "overview.png"), PNG.sync.write(ov));
fs.writeFileSync(path.join(__dirname, "bands.json"), JSON.stringify(out, null, 1));
console.log(`bands: ${bands.length} (strips ${bands.filter(b=>b.kind==="strip").length}, labels ${bands.filter(b=>b.kind==="label").length})`);
for (const b of bands) console.log(`${b.kind==="strip"?"S":"L"}${b.i}: y=${b.y0}-${b.y1} h=${b.h} frames=${b.frames.length}`);
