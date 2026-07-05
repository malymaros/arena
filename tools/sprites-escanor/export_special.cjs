// Export special-fázových sheetov Escanora (WinSun, CruelSunHold, SunBurst, SunFade) do public/assets/escanor/
// (+ P2 recolor). Kompozity sa PADUJÚ na ŠTVOREC (engine odvodí počet frameov = šírka/výška).
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");
const SRC = PNG.sync.read(fs.readFileSync(path.join(__dirname, "ESCANOR.png")));
const { width: SW, data: SD } = SRC;
const bandById = id => require("./bands.json").find(b => b.i === id);
const OUT1 = path.join(__dirname, "../../public/assets/escanor");
const OUT2 = path.join(__dirname, "../../public/assets/escanor_2");
const BG = [163, 73, 164];
const isBg = (x, y) => { const i = (y * SW + x) * 4; if (SD[i + 3] < 20) return true; return Math.abs(SD[i]-BG[0])<=14 && Math.abs(SD[i+1]-BG[1])<=14 && Math.abs(SD[i+2]-BG[2])<=14; };
const feetX = f => { const k=Math.min(14,f.y1-f.y0+1);let mn=1e9,mx=-1e9;for(let y=f.y1-k+1;y<=f.y1;y++)for(let x=f.x0;x<=f.x1;x++)if(!isBg(x,y)){if(x<mn)mn=x;if(x>mx)mx=x;}return mx<0?(f.x0+f.x1)/2:(mn+mx)/2; };

// zloz strip z callbacku, kde cb(strip, k, W, H) vykreslí frame k do (k*W..)×(0..H); potom PADuj na štvorec
function writeSquare(file, N, W, H, cb) {
  const raw = new PNG({ width: W * N, height: H }); raw.data.fill(0);
  for (let k = 0; k < N; k++) cb(raw, k, W, H);
  const S = Math.max(W, H), out = new PNG({ width: S * N, height: S }); out.data.fill(0);
  const ox = Math.round((S - W) / 2), oy = Math.round((S - H) / 2);
  for (let k = 0; k < N; k++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const si = (y * raw.width + k * W + x) * 4; if (raw.data[si + 3] < 20) continue;
    const di = ((oy + y) * out.width + k * S + ox + x) * 4;
    out.data[di] = raw.data[si]; out.data[di+1] = raw.data[si+1]; out.data[di+2] = raw.data[si+2]; out.data[di+3] = 255;
  }
  fs.writeFileSync(path.join(OUT1, file), PNG.sync.write(out));
  console.log(file, N + "f", out.width + "x" + S);
}
const blit = (strip, f, dx0, dy0, k, W, H) => { for (let yy=f.y0; yy<=f.y1; yy++) for (let xx=f.x0; xx<=f.x1; xx++){ if(isBg(xx,yy))continue; const si=(yy*SW+xx)*4, dx=dx0+(xx-f.x0), dy=dy0+(yy-f.y0); if(dx<0||dy<0||dx>=W||dy>=H)continue; const di=(dy*strip.width+k*W+dx)*4; strip.data[di]=SD[si];strip.data[di+1]=SD[si+1];strip.data[di+2]=SD[si+2];strip.data[di+3]=255; } };
const blitSun = (strip, f, cx, bottomY, sc, k, W, H) => { const sw=f.x1-f.x0+1, sh=f.y1-f.y0+1, dw=Math.round(sw*sc), dh=Math.round(sh*sc), dx0=Math.round(cx-dw/2), dy0=bottomY-dh; for(let dyy=0;dyy<dh;dyy++)for(let dxx=0;dxx<dw;dxx++){ const sx=f.x0+Math.min(sw-1,Math.floor(dxx/sc)), sy=f.y0+Math.min(sh-1,Math.floor(dyy/sc)); if(isBg(sx,sy))continue; const si=(sy*SW+sx)*4, dx=dx0+dxx, dy=dy0+dyy; if(dx<0||dy<0||dx>=W||dy>=H)continue; const di=(dy*strip.width+k*W+dx)*4; strip.data[di]=SD[si];strip.data[di+1]=SD[si+1];strip.data[di+2]=SD[si+2];strip.data[di+3]=255; } };
const blitCenter = (strip, f, k, W, H) => { const w=f.x1-f.x0+1, h=f.y1-f.y0+1, dx0=Math.round((W-w)/2), dy0=Math.round((H-h)/2); blit(strip, f, dx0, dy0, k, W, H); };

// --- WinSun: veľký cast sprite (Escanor drží rastúce slnko) ---
{
  const WB = bandById(44), winBase = WB.y1, S46 = bandById(46);
  const sun = [S46.frames[0], {x0:60,y0:4508,x1:91,y1:4537}, {x0:92,y0:4494,x1:149,y1:4551}, S46.frames[2], S46.frames[3], S46.frames[4], S46.frames[5], S46.frames[6]];
  const CW=226, CH=300, BASE=292, CX=CW/2, OVER=-30, SC=1.2;
  const winMap=[0,1,2,3,2,3,2,3], sunMap=[0,1,2,3,4,5,6,7];
  writeSquare("WinSun.png", 8, CW, CH, (strip,k,W,H) => { const wf=WB.frames[winMap[k]], fx=feetX(wf), axeTop=BASE-(winBase-wf.y0);
    blit(strip, wf, Math.round(CX-(fx-wf.x0)), BASE-(winBase-wf.y0), k, W, H); blitSun(strip, sun[sunMap[k]], CX, axeTop+OVER, SC, k, W, H); });
}
// --- CruelSunHold: malá postava fáza 2 (Escanor nesie veľké slnko nad sebou) ---
{
  const B35=bandById(35), B36=bandById(36), B46=bandById(46);
  const base=[...[0,1,2,3,4,5].map(k=>({f:B35.frames[k],baseY:B35.y1})),
    {f:{x0:670,y0:3323,x1:773,y1:3421},baseY:B35.y1},{f:{x0:774,y0:3324,x1:885,y1:3421},baseY:B35.y1},{f:{x0:886,y0:3323,x1:992,y1:3421},baseY:B35.y1},
    ...[0,1,2,3].map(k=>({f:B36.frames[k],baseY:B36.y1}))];
  const bigSuns=[B46.frames[3],B46.frames[4],B46.frames[5],B46.frames[6]];
  const CW=260, CH=330, BASE=322, CX=CW/2, OFF=-25, SC=1.3;
  writeSquare("CruelSunHold.png", base.length, CW, CH, (strip,k,W,H) => { const {f,baseY}=base[k], fx=feetX(f), escTop=BASE-(baseY-f.y0);
    blit(strip, f, Math.round(CX-(fx-f.x0)), BASE-(baseY-f.y0), k, W, H); blitSun(strip, bigSuns[k%bigSuns.length], CX, escTop+OFF, SC, k, W, H); });
}
// --- SunBurst / SunFade: výbuch a dohasnutie na cieľovej bunke (centrované) ---
{
  const B47=bandById(47); const fw=Math.max(...B47.frames.map(f=>f.x1-f.x0+1)), fh=Math.max(...B47.frames.map(f=>f.y1-f.y0+1));
  writeSquare("SunBurst.png", B47.frames.length, fw+4, fh+4, (strip,k,W,H) => blitCenter(strip, B47.frames[k], k, W, H));
}
{
  const B48=bandById(48); const fw=Math.max(...B48.frames.map(f=>f.x1-f.x0+1)), fh=Math.max(...B48.frames.map(f=>f.y1-f.y0+1));
  writeSquare("SunFade.png", B48.frames.length, fw+4, fh+4, (strip,k,W,H) => blitCenter(strip, B48.frames[k], k, W, H));
}

// P2 recolor (zelené oblečenie -> červené; slnká bez zelene ostanú)
for (const file of ["WinSun.png","CruelSunHold.png","SunBurst.png","SunFade.png"]) {
  const p = PNG.sync.read(fs.readFileSync(path.join(OUT1, file))); const d = p.data;
  for (let i=0;i<d.length;i+=4){ if(d[i+3]<20)continue; const r=d[i],g=d[i+1],b=d[i+2]; if(g>r+6&&g>b+6){ d[i]=g; d[i+1]=Math.round(r*0.55); d[i+2]=Math.round(b*0.40); } }
  fs.writeFileSync(path.join(OUT2, file), PNG.sync.write(p));
}
console.log("P2 recolor -> escanor_2/ (special)");
