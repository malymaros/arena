// Export všetkých herných sprite sheetov Escanora do public/assets/escanor/ (+ P2 recolor do escanor_2/).
// Postavy = štvorcová bunka 226×226 feet-anchor (ako collect.cjs); projektil = 64×64 pulzujúce slnko.
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");
const SRC = PNG.sync.read(fs.readFileSync(path.join(__dirname, "ESCANOR.png")));
const { width: SW, data: SD } = SRC;
const bands = require("./bands.json"), bandById = id => bands.find(b => b.i === id);
const OUT1 = path.join(__dirname, "../../public/assets/escanor");
const OUT2 = path.join(__dirname, "../../public/assets/escanor_2");
fs.mkdirSync(OUT1, { recursive: true }); fs.mkdirSync(OUT2, { recursive: true });
const BG = [163, 73, 164];
const isBg = (x, y) => { const i = (y * SW + x) * 4; if (SD[i + 3] < 20) return true; return Math.abs(SD[i]-BG[0])<=14 && Math.abs(SD[i+1]-BG[1])<=14 && Math.abs(SD[i+2]-BG[2])<=14; };
function trimTop(f){const LH=16,GAP=4;let y=f.y0;const rh=y=>{for(let x=f.x0;x<=f.x1;x++)if(!isBg(x,y))return true;return false;};while(y<=f.y1&&!rh(y))y++;let r0=y;while(y<=f.y1&&rh(y))y++;let r1=y-1;let g=y;while(g<=f.y1&&!rh(g))g++;if((r1-r0+1)<=LH&&(g-r1-1)>=GAP&&g<=f.y1)return g;return f.y0;}
const feetX = f => { const k=Math.min(14,f.y1-f.y0+1);let mn=1e9,mx=-1e9;for(let y=f.y1-k+1;y<=f.y1;y++)for(let x=f.x0;x<=f.x1;x++)if(!isBg(x,y)){if(x<mn)mn=x;if(x>mx)mx=x;}return mx<0?(f.x0+f.x1)/2:(mn+mx)/2; };
// zemná línia framu = najnižší pixel v okolí nôh (±12px od feetX) — ignoruje meč/oblúk trčiaci nabok
const feetY = f => { const cx=Math.round(feetX(f)); let mx=-1; for(let y=f.y0;y<=f.y1;y++){ for(let x=Math.max(f.x0,cx-12);x<=Math.min(f.x1,cx+12);x++){ if(!isBg(x,y)){ if(y>mx)mx=y; break; } } } return mx<0?f.y1:mx; };
const R = (band, from, to) => { const B=bandById(band),a=[]; for(let k=from;k<=to;k++)a.push({B,f:B.frames[k]}); return a; };
const BXi = (band, x0,y0,x1,y1) => ({ B: bandById(band), f:{x0,y0,x1,y1} });

const S = 226, CX = S / 2; // štvorcová bunka; každý frame kotvený svojím NAJNIŽŠÍM pixelom na spodok (belowFeet=0)
function buildChar(list, file) {
  const items = list.map(({ B, f: f0 }) => { const f = { ...f0, y0: trimTop(f0) }; return { f, fx: feetX(f) }; });
  // per-frame kotvenie podľa NAJNIŽŠIEHO pixelu framu (f.y1): neorezáva výpady/melee a funguje aj pre viac-bandové
  // sheety (IntroStand/Transform sú z bandov na rôznych y v zdroji — spoločná max-baseline by ich odhodila mimo rám)
  const N = items.length, strip = new PNG({ width: S * N, height: S }); strip.data.fill(0);
  items.forEach((o, k) => { const { f, fx } = o, dx0 = k*S + Math.round(CX-(fx-f.x0)), dy0 = (S-1)-(f.y1-f.y0);
    for (let yy=f.y0; yy<=f.y1; yy++) for (let xx=f.x0; xx<=f.x1; xx++) { if (isBg(xx,yy)) continue; const si=(yy*SW+xx)*4, dx=dx0+(xx-f.x0), dy=dy0+(yy-f.y0); if (dx<0||dy<0||dx>=strip.width||dy>=S) continue; const di=(dy*strip.width+dx)*4; strip.data[di]=SD[si];strip.data[di+1]=SD[si+1];strip.data[di+2]=SD[si+2];strip.data[di+3]=SD[si+3]||255; } });
  fs.writeFileSync(path.join(OUT1, file), PNG.sync.write(strip));
  console.log(file, N + "f", strip.width + "x" + S);
}
// Charge = najmenšie slnko (band46 f0) pulzujúci/rotujúci 64×64 (ako collect.cjs makeCharge)
function buildCharge() {
  const b = bandById(46).frames[0], sw=b.x1-b.x0+1, sh=b.y1-b.y0+1, cx=(sw-1)/2, cy=(sh-1)/2, M=10, C=64, BASEs=2.6;
  const strip = new PNG({ width: C*M, height: C }); strip.data.fill(0);
  for (let k=0;k<M;k++){ const ang=k*(Math.PI*2/M), sc=BASEs*(1+0.14*Math.sin(ang)), br=1+0.12*Math.sin(ang), ca=Math.cos(-ang), sa=Math.sin(-ang);
    for (let dy=0;dy<C;dy++) for (let dx=0;dx<C;dx++){ const X=dx-C/2, Y=dy-C/2, rx=X*ca-Y*sa, ry=X*sa+Y*ca, sX=Math.round(rx/sc+cx), sY=Math.round(ry/sc+cy);
      if (sX<0||sY<0||sX>=sw||sY>=sh) continue; const gx=b.x0+sX, gy=b.y0+sY; if (isBg(gx,gy)) continue; const si=(gy*SW+gx)*4, di=(dy*strip.width+k*C+dx)*4;
      strip.data[di]=Math.min(255,SD[si]*br); strip.data[di+1]=Math.min(255,SD[si+1]*br); strip.data[di+2]=Math.min(255,SD[si+2]*br); strip.data[di+3]=255; } }
  fs.writeFileSync(path.join(OUT1, "Charge.png"), PNG.sync.write(strip));
  console.log("Charge.png", M + "f", strip.width + "x" + C);
}

// --- herná sada ---
const b1=bandById(1), b42=bandById(42);
buildChar(R(1,0,4), "Idle.png");                                   // Stand = silný idle
buildChar([0,1,2,1].map(k=>({B:b42,f:b42.frames[k]})), "WeakIdle.png"); // slabý idle (ping-pong)
buildChar([...R(42,0,7), ...R(40,0,8)], "Transform.png");          // premena (weak → chytí sekeru), 17f, hrá sa raz
buildChar(R(3,0,7), "Run.png");                                    // Walk
buildChar(R(17,0,bandById(17).frames.length-1), "Attack_1.png");   // Attack5 = BASIC
buildChar(R(9,0,bandById(9).frames.length-1), "Attack_2.png");     // Attack1 = MELEE
buildChar(R(38,0,2), "Hurt.png");
buildChar(R(38,0,5), "Dead.png");
buildChar(R(44,0,3), "Win.png");                                   // víťazná/cast póza (special malá postava)
buildChar([...R(42,0,7), ...R(40,0,8), ...R(1,0,4)], "IntroStand.png"); // char-select hover: premena → chytí sekeru → Stand loop
buildCharge();

// --- P2 paleta: zelené oblečenie -> červené (recolor všetkých práve zapísaných PNG) ---
for (const file of fs.readdirSync(OUT1)) {
  const p = PNG.sync.read(fs.readFileSync(path.join(OUT1, file))); const d = p.data;
  for (let i=0;i<d.length;i+=4){ if (d[i+3]<20) continue; const r=d[i],g=d[i+1],b=d[i+2];
    if (g>r+6 && g>b+6){ d[i]=g; d[i+1]=Math.round(r*0.55); d[i+2]=Math.round(b*0.40); } }
  fs.writeFileSync(path.join(OUT2, file), PNG.sync.write(p));
}
console.log("P2 recolor -> escanor_2/ (" + fs.readdirSync(OUT2).length + " files)");
