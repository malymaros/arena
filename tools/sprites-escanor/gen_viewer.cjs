// Zloz z ESCANOR.png + bands.json filmstripy (uniformne bunky) a vygeneruj viewer.html.
// Postavy: zarovnane na zemnu liniu pasu (baseline = band.y1), horizontalne centrovane.
// Efekty: centrovane v oboch osiach.
const fs = require("fs");
const path = require("path");
const { PNG } = require("pngjs");

const src = PNG.sync.read(fs.readFileSync(path.join(__dirname, "ESCANOR.png")));
const { width: SW, data: SD } = src;
const bands = require("./bands.json");
const bandById = id => bands.find(b => b.i === id);

const BG = [163, 73, 164];
function isBg(x, y) {
  const i = (y * SW + x) * 4;
  if (SD[i + 3] < 20) return true;
  return Math.abs(SD[i] - BG[0]) <= 14 && Math.abs(SD[i + 1] - BG[1]) <= 14 && Math.abs(SD[i + 2] - BG[2]) <= 14;
}

// Definicia animacii: kazda odkazuje na frames z jedneho/viacerych pasiem (band + slice).
// slice [from,to] inkluzivne; vynechane => cely pas.
const S = (band, from, to) => ({ band, from, to });
const ANIMS = [
  // --- Postoj a pohyb ---
  { name: "Stand",        src: [S(1, 0, 4)],  fps: 7,  loop: true,  sec: "move", note: "základný postoj (idle)" },
  { name: "Crouch",       src: [S(1, 5, 6)],  fps: 6,  loop: true,  sec: "move", note: "prikrčenie" },
  { name: "Turn",         src: [S(1, 7, 8)],  fps: 8,  loop: false, sec: "move", note: "otočenie" },
  { name: "Walk",         src: [S(3, 0, 7)],  fps: 10, loop: true,  sec: "move", note: "chôdza" },
  { name: "Dash",         src: [S(3, 8, 9)],  fps: 10, loop: true,  sec: "move", note: "výpad / dash" },
  { name: "Jump",         src: [S(5)],        fps: 10, loop: false, sec: "move", note: "skok" },
  { name: "GuardStand",   src: [S(7, 0, 1)],  fps: 8,  loop: false, sec: "move", note: "blok v stoji" },
  { name: "GuardAir",     src: [S(7, 2, 3)],  fps: 8,  loop: false, sec: "move", note: "blok vo vzduchu" },
  { name: "GuardCrouch",  src: [S(7, 4, 5)],  fps: 8,  loop: false, sec: "move", note: "blok v prikrčení" },

  // --- Pozemné útoky ---
  { name: "Attack1",  src: [S(9)],  fps: 12, loop: false, sec: "atk", note: "útok 1" },
  { name: "Attack2",  src: [S(11)], fps: 12, loop: false, sec: "atk", note: "útok 2" },
  { name: "Attack3",  src: [S(13)], fps: 12, loop: false, sec: "atk", note: "útok 3" },
  { name: "Attack4",  src: [S(15)], fps: 12, loop: false, sec: "atk", note: "útok 4 (široký sek)" },
  { name: "Attack5",  src: [S(17)], fps: 12, loop: false, sec: "atk", note: "útok 5" },
  { name: "Attack6",  src: [S(19)], fps: 12, loop: false, sec: "atk", note: "útok 6" },
  { name: "Attack7",  src: [S(20)], fps: 12, loop: false, sec: "atk", note: "útok 7 (veľký zlatý oblúk)" },
  { name: "Attack8",  src: [S(22)], fps: 12, loop: false, sec: "atk", note: "útok 8" },
  { name: "Attack9",  src: [S(24)], fps: 12, loop: false, sec: "atk", note: "útok 9" },
  { name: "Attack10", src: [S(32)], fps: 12, loop: false, sec: "atk", note: "útok 10" },

  // --- Vzdušné útoky ---
  { name: "AirAttack1", src: [S(26)], fps: 12, loop: false, sec: "air", note: "vzdušný útok 1" },
  { name: "AirAttack2", src: [S(28)], fps: 12, loop: false, sec: "air", note: "vzdušný útok 2" },
  { name: "AirAttack3", src: [S(30)], fps: 12, loop: false, sec: "air", note: "vzdušný útok 3" },

  // --- Špeciály ---
  { name: "Super1",   src: [S(34)], fps: 11, loop: false, sec: "super", note: "super 1" },
  { name: "CruelSun", src: [S(35), S(36)], fps: 11, loop: false, sec: "super", note: "Cruel Sun — dobíjací super (2 riadky = 1 dej)" },

  // --- Reakcie ---
  { name: "Damage", src: [S(38)],       fps: 10, loop: false, sec: "react", note: "inkasovaný zásah" },
  { name: "GetUp",  src: [S(39)],       fps: 8,  loop: false, sec: "react", note: "vstávanie zo zeme" },

  // --- Intro / Win ---
  { name: "Intro",  src: [S(40)], fps: 10, loop: false, sec: "intro", note: "nástup 1 (hod mečom)" },
  { name: "Intro2", src: [S(42)], fps: 10, loop: false, sec: "intro", note: "nástup 2" },
  { name: "Win",    src: [S(44)], fps: 8,  loop: false, sec: "intro", note: "víťazná póza" },

  // --- Efekty ---
  { name: "SunGrow",    src: [S(46)], fps: 10, loop: true,  sec: "fx", fx: true, note: "rast slnka (malé → veľké)" },
  { name: "SunBurst",   src: [S(47)], fps: 10, loop: true,  sec: "fx", fx: true, note: "slnečný výbuch / prstence" },
  { name: "SunFade",    src: [S(48)], fps: 8,  loop: true,  sec: "fx", fx: true, note: "dohasínajúce prstence" },
  { name: "Flames",     src: [S(49)], fps: 10, loop: true,  sec: "fx", fx: true, note: "plamienky (pás)" },
];

function collectFrames(a) {
  const out = [];
  for (const s of a.src) {
    const B = bandById(s.band);
    const from = s.from ?? 0, to = s.to ?? B.frames.length - 1;
    for (let k = from; k <= to; k++) out.push({ f: B.frames[k], baseY: B.y1 });
  }
  return out;
}

function buildStrip(a) {
  const frames = collectFrames(a);
  const cw = Math.max(...frames.map(o => o.f.w)) + 2;
  let ch;
  if (a.fx) ch = Math.max(...frames.map(o => o.f.h)) + 2;
  else ch = Math.max(...frames.map(o => o.baseY - o.f.y0)) + 3; // baseline zarovnanie
  const N = frames.length;
  const strip = new PNG({ width: cw * N, height: ch });
  strip.data.fill(0); // transparentne
  frames.forEach((o, k) => {
    const { f, baseY } = o;
    const dx0 = k * cw + Math.round((cw - f.w) / 2);
    const dy0 = a.fx ? Math.round((ch - f.h) / 2) : (ch - 2 - (baseY - f.y0));
    for (let yy = f.y0; yy <= f.y1; yy++) {
      for (let xx = f.x0; xx <= f.x1; xx++) {
        if (isBg(xx, yy)) continue;
        const si = (yy * SW + xx) * 4;
        const dx = dx0 + (xx - f.x0), dy = dy0 + (yy - f.y0);
        if (dx < 0 || dy < 0 || dx >= strip.width || dy >= ch) continue;
        const di = (dy * strip.width + dx) * 4;
        strip.data[di] = SD[si]; strip.data[di+1] = SD[si+1]; strip.data[di+2] = SD[si+2]; strip.data[di+3] = SD[si+3] || 255;
      }
    }
  });
  a.frames = N; a.cw = cw; a.ch = ch;
  a.data = "data:image/png;base64," + PNG.sync.write(strip).toString("base64");
}

ANIMS.forEach(buildStrip);

const SECTIONS = [
  { key: "move",  title: "Postoj a pohyb" },
  { key: "atk",   title: "Pozemné útoky" },
  { key: "air",   title: "Vzdušné útoky" },
  { key: "super", title: "Špeciály" },
  { key: "react", title: "Reakcie" },
  { key: "intro", title: "Intro / Víťazstvo" },
  { key: "fx",    title: "Efekty" },
];

const cards = sec => ANIMS.filter(a => a.sec === sec).map(a => {
  const dispW = Math.min(Math.round(a.cw * 2.2), 260), dispH = Math.round(a.ch / a.cw * dispW);
  return `
    <figure class="card" data-name="${a.name}">
      <div class="stage${a.fx ? " fx" : ""}"><canvas width="${a.cw}" height="${a.ch}" style="width:${dispW}px;height:${dispH}px"></canvas></div>
      <figcaption>
        <div class="row"><span class="name">${a.name}</span><span class="mode ${a.loop?"loop":"once"}">${a.loop?"loop":"1×"}</span></div>
        <div class="meta">${a.frames} frames · ${a.fps} fps · ${a.cw}×${a.ch}</div>
        <div class="note">${a.note}</div>
      </figcaption>
    </figure>`;
}).join("");

const sections = SECTIONS.map(s => {
  const n = ANIMS.filter(a => a.sec === s.key).length;
  return `<h2>${s.title} <span class="cnt">${n}</span></h2>\n  <div class="grid">${cards(s.key)}</div>`;
}).join("\n  ");

const html = `<title>Escanor — extrahované animácie</title>
<style>
  :root{ --bg:#14120d; --panel:#211d15; --panel2:#2b261b; --line:#3a3324; --ink:#f0e9d6; --mut:#a8977a; --acc:#f0a828; --blue:#e8c15f; }
  html{ background:var(--bg); } body{ font:15px/1.5 "Segoe UI",system-ui,sans-serif; color:var(--ink); margin:0; padding:28px 20px 60px; }
  .wrap{ max-width:1180px; margin:0 auto; }
  header{ display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 18px; }
  h1{ font-size:22px; margin:0; } h1 b{ color:var(--acc); font-weight:600; }
  .sub{ color:var(--mut); font-size:13px; }
  .controls{ display:flex; gap:10px; align-items:center; margin:16px 0 26px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px; position:sticky; top:10px; z-index:5; box-shadow:0 4px 18px rgba(0,0,0,.5); }
  .controls .lbl{ color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.09em; margin-right:6px; }
  button{ font:13px "Consolas",monospace; color:var(--ink); background:var(--panel2); border:1px solid var(--line); border-radius:7px; padding:5px 12px; cursor:pointer; }
  button:hover{ border-color:var(--acc); } button.on{ background:var(--acc); border-color:var(--acc); color:#181205; font-weight:700; }
  .sep{ width:1px; height:22px; background:var(--line); }
  h2{ font-size:12px; text-transform:uppercase; letter-spacing:.14em; color:var(--mut); font-weight:600; margin:30px 0 12px; display:flex; align-items:center; gap:12px; }
  h2::after{ content:""; flex:1; height:1px; background:var(--line); } h2 .cnt{ color:var(--acc); }
  .grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:14px; }
  .card{ margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .stage{ display:flex; justify-content:center; align-items:flex-end; min-height:170px; background:repeating-conic-gradient(#1a1710 0% 25%,#151109 0% 50%) 50%/18px 18px; border-bottom:1px solid var(--line); padding:14px 0 0; }
  .stage.fx{ align-items:center; padding:14px 0; }
  .stage canvas{ image-rendering:pixelated; }
  figcaption{ padding:10px 13px 12px; }
  .row{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .name{ font:600 14px "Consolas",monospace; }
  .mode{ font:11px "Consolas",monospace; padding:1px 8px; border-radius:99px; }
  .mode.loop{ color:var(--blue); border:1px solid color-mix(in srgb,var(--blue) 45%,transparent); }
  .mode.once{ color:var(--acc); border:1px solid color-mix(in srgb,var(--acc) 45%,transparent); }
  .meta{ font:12px "Consolas",monospace; color:var(--mut); margin-top:3px; }
  .note{ font-size:12.5px; color:var(--mut); margin-top:6px; }
</style>
<div class="wrap">
  <header>
    <h1>Escanor — extrahované animácie <b>${ANIMS.length} pásov</b></h1>
    <span class="sub">z Downloads/ESCANOR.png · klikni kartu pre pauzu · rýchlosť dole</span>
  </header>
  <div class="controls">
    <div class="lbl">Rýchlosť</div>
    <button data-speed="0.25">0.25×</button><button data-speed="0.5">0.5×</button><button data-speed="1" class="on">1×</button><button data-speed="2">2×</button>
    <div class="sep"></div><button id="pause">⏸ Pauza</button>
  </div>
  ${sections}
</div>
<script>
const ANIMS = ${JSON.stringify(ANIMS.map(({ name, data, frames, fps, loop, cw, ch }) => ({ name, data, frames, fps, loop, cw, ch })))};
let speed = 1, paused = false; const HOLD_MS = 700;
const players = [];
for (const a of ANIMS) {
  const card = document.querySelector('.card[data-name="' + a.name + '"]');
  const ctx = card.querySelector("canvas").getContext("2d"); ctx.imageSmoothingEnabled = false;
  const img = new Image(); img.src = a.data;
  const p = { a, ctx, img, t: 0, last: performance.now() };
  players.push(p);
  card.addEventListener("click", () => { p.solo = !p.solo; card.style.outline = p.solo ? "2px solid var(--acc)" : "none"; });
}
function tick(now) {
  for (const p of players) {
    const dt = (now - p.last) * speed; p.last = now;
    if (!paused && !p.solo) p.t += dt;
    const { frames, fps, loop, cw, ch } = p.a; let f = 0;
    if (frames > 1) {
      const durMs = frames * 1000 / fps;
      if (loop) f = Math.floor(p.t / 1000 * fps) % frames;
      else { const cyc = p.t % (durMs + HOLD_MS); f = Math.min(frames - 1, Math.floor(cyc / 1000 * fps)); }
    }
    if ((f !== p.f || !p.drawn) && p.img.complete && p.img.naturalWidth) {
      p.f = f; p.drawn = true; p.ctx.clearRect(0, 0, cw, ch);
      p.ctx.drawImage(p.img, f * cw, 0, cw, ch, 0, 0, cw, ch);
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => { speed = +b.dataset.speed; document.querySelectorAll("[data-speed]").forEach(x => x.classList.toggle("on", x === b)); }));
const pb = document.getElementById("pause"); pb.addEventListener("click", () => { paused = !paused; pb.textContent = paused ? "▶ Spusti" : "⏸ Pauza"; pb.classList.toggle("on", paused); });
</script>`;
fs.writeFileSync(path.join(__dirname, "viewer.html"), html);
console.log("viewer.html", (fs.statSync(path.join(__dirname, "viewer.html")).size / 1024).toFixed(0) + " KB, " + ANIMS.length + " animacii");
