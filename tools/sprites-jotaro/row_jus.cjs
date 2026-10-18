// Nahlad riadku JUS sheetu v 2x zvacseni: node row_jus.cjs <sp|jotaro> <row> -> row_jus.png
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");
const SHEETS = require("./jus_sheets.cjs");

const cfg = SHEETS[process.argv[2] || "sp"];
const row = process.argv[3];
const cells = require("./" + cfg.cells);
const sel = cells.filter(c => c.id.startsWith(row + "."));
if (!sel.length) { console.log("ziadne bunky"); process.exit(1); }

const png = PNG.sync.read(fs.readFileSync(cfg.src));
const [BR, BG_, BB] = cfg.bg;
const S = 2, PAD = 6;
const maxH = Math.max(...sel.map(c => c.h));
const W = sel.reduce((a, c) => a + c.w * S + PAD, PAD);
const H = maxH * S + 20;
const out = new PNG({ width: W, height: H });
for (let i = 0; i < out.data.length; i += 4) { out.data[i]=24; out.data[i+1]=24; out.data[i+2]=32; out.data[i+3]=255; }

const FONT = {
  "0": ["111","101","101","101","111"], "1": ["010","110","010","010","111"],
  "2": ["111","001","111","100","111"], "3": ["111","001","111","001","111"],
  "4": ["101","101","111","001","001"], "5": ["111","100","111","001","111"],
  "6": ["111","100","111","101","111"], "7": ["111","001","010","010","010"],
  "8": ["111","101","111","101","111"], "9": ["111","101","111","001","111"],
  ".": ["000","000","000","000","010"],
};
function px(x,y,r,g,b){ if(x<0||y<0||x>=W||y>=H)return; const i=(y*W+x)*4; out.data[i]=r;out.data[i+1]=g;out.data[i+2]=b;out.data[i+3]=255; }
function text(s,x,y){ let cx=x; for(const ch of s){const g=FONT[ch]; if(!g){cx+=4;continue;} for(let gy=0;gy<5;gy++)for(let gx=0;gx<3;gx++) if(g[gy][gx]==="1")px(cx+gx,y+gy,255,255,0); cx+=4;} }

let ox = PAD;
for (const c of sel) {
  text(c.id, ox, 1);
  for (let y = 0; y < c.h * S; y++) for (let x = 0; x < c.w * S; x++) {
    const sx = c.x0 + (x / S | 0), sy = c.y0 + (y / S | 0);
    const si = (sy * png.width + sx) * 4;
    const r=png.data[si],g=png.data[si+1],b=png.data[si+2],a=png.data[si+3];
    if (a < 10 || (Math.abs(r-BR)<=6 && Math.abs(g-BG_)<=6 && Math.abs(b-BB)<=6)) continue;
    px(ox + x, 8 + (maxH * S - c.h * S) + y, r, g, b);
  }
  ox += c.w * S + PAD;
}
fs.writeFileSync(path.join(__dirname, "row_jus.png"), PNG.sync.write(out));
console.log("row_jus.png", sel.length, "cells, maxH", maxH);
