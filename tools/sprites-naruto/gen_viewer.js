// Vygeneruje viewer.html — prehliadac extrahovanych Naruto animacii (pasy embednute ako data URI)
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "out");

const SECTIONS = [
  { key: "ingame",  title: "Postava v hre (assets/naruto/Naruto_1 + _2)" },
  { key: "special", title: "Ďalší kandidáti na special" },
  { key: "akcie",   title: "Ďalšie akcie postavy" },
  { key: "kyubi",   title: "Kyubi mód a žaba" },
  { key: "fx",      title: "Efekty a projektily" },
];
const ANIMS = [
  // finalne mapovanie postavy — subory v assets/naruto/Naruto_1 (P1) a Naruto_2 (P2 zlty)
  { file: "Stance.png",   name: "Idle",      fps: 6,  loop: true,  sec: "ingame", note: "Idle.png — bojový postoj so stuhami" },
  { file: "Run.png",      name: "Run",       fps: 12, loop: true,  sec: "ingame", note: "Run.png — akýkoľvek pohyb (move/dash)" },
  { file: "Punch.png",    name: "Attack_1",  fps: 10, loop: false, sec: "ingame", note: "Attack_1.png — základný útok (úderové kombo)" },
  { file: "Attack_2.png", name: "Attack_2",  fps: 10, loop: false, sec: "ingame", note: "Attack_2.png — melee (kick combo)" },
  { file: "Hurt.png",     name: "Hurt",      fps: 10, loop: false, sec: "ingame", note: "Hurt.png — inkasovaný zásah" },
  { file: "Dead.png",     name: "Dead",      fps: 7,  loop: false, sec: "ingame", note: "Dead.png — smrť" },
  { file: "Charge.png",   name: "Charge",    fps: 12, loop: true,  sec: "ingame", note: "Charge.png — projektil útoku (P2 zlatý)" },
  { file: "Seals.png",    name: "Special",   fps: 8,  loop: true,  sec: "ingame", note: "Special.png — pečate rukami (cast specialu)" },
  { file: "Idle.png",     name: "Special_2", fps: 6,  loop: true,  sec: "ingame", note: "Special_2.png — dýchanie (rezerva na special 2)" },

  { file: "Clones.png",   fps: 8,  loop: true,  sec: "special", note: "trojitý tieňový klon" },
  { file: "CloneDuo.png", fps: 8,  loop: true,  sec: "special", note: "dvojklon — nabíjanie Rasenganu" },
  { file: "Victory.png",  fps: 6,  loop: true,  sec: "special", note: "víťazná póza" },
  { file: "Dash.png",     fps: 12, loop: true,  sec: "special", note: "šprint s blur — napr. swap/útek" },

  { file: "Costumes.png",   fps: 2,  loop: true,  sec: "akcie", note: "4 farebné varianty (statické pózy)" },
  { file: "GetUp.png",      fps: 10, loop: false, sec: "akcie", note: "vstávanie zo zeme kotúľom" },
  { file: "Uppercut.png",   fps: 10, loop: false, sec: "akcie", note: "vyskočený zvedák s plameňom" },
  { file: "Jump.png",       fps: 10, loop: false, sec: "akcie", note: "skok / salto" },
  { file: "Combo.png",      fps: 10, loop: false, sec: "akcie", note: "kombo prechody" },
  { file: "KunaiSlash.png", fps: 10, loop: false, sec: "akcie", note: "skok + sek kunaiom (oranžový oblúk)" },
  { file: "Jabs.png",       fps: 10, loop: false, sec: "akcie", note: "rýchle jaby" },
  { file: "Lunge.png",      fps: 10, loop: false, sec: "akcie", note: "výpad / tackle" },
  { file: "Dodge.png",      fps: 8,  loop: false, sec: "akcie", note: "úhyb a štart šprintu" },
  { file: "Leap.png",       fps: 10, loop: false, sec: "akcie", note: "dlhý skok" },
  { file: "PalmJump.png",   fps: 10, loop: false, sec: "akcie", note: "skok s úderom dlaňou" },
  { file: "PalmDash.png",   fps: 10, loop: false, sec: "akcie", note: "dash s vystrčenou dlaňou" },
  { file: "Dive.png",       fps: 10, loop: false, sec: "akcie", note: "strmhlavý let" },
  { file: "FlyKick.png",    fps: 10, loop: false, sec: "akcie", note: "letiaci kop nahor" },
  { file: "ChakraDash.png", fps: 12, loop: true,  sec: "akcie", note: "beh s čakrovými pazúrmi" },

  { file: "KyubiCloak.png", fps: 10, loop: true,  sec: "kyubi", note: "jednochvostý plášť — beh/dash" },
  { file: "KyubiSpin.png",  fps: 10, loop: false, sec: "kyubi", note: "rotácia v čakrovej guli + výskok" },
  { file: "KyubiBeast.png", fps: 8,  loop: true,  sec: "kyubi", note: "plná beštia (najväčšie frames, 256px)" },
  { file: "Frog.png",       fps: 8,  loop: false, sec: "kyubi", note: "gag premena na žabu" },

  { file: "Rasengan.png",  fps: 1, loop: true,  sec: "fx", note: "čakrový prstenec 128×128 — materiál na special" },
  { file: "Kunai.png",     fps: 1, loop: true,  sec: "fx", note: "vrhacia ihla — alternatívny projektil" },
  { file: "WindSlash.png", fps: 1, loop: true,  sec: "fx", note: "veterný sek" },
  { file: "Blood.png",     fps: 1, loop: true,  sec: "fx", note: "krvavý strek" },
  { file: "Debris.png",    fps: 10, loop: false, sec: "fx", note: "kamenná suť (3 fázy)" },
  { file: "SwirlBits.png", fps: 1, loop: true,  sec: "fx", note: "drobné čakrové víry (klaster)" },
  { file: "Waves.png",     fps: 1, loop: true,  sec: "fx", note: "vodné vlny (klaster)" },
];
for (const a of ANIMS) {
  const buf = fs.readFileSync(path.join(OUT, a.file));
  a.data = "data:image/png;base64," + buf.toString("base64");
  a.data2 = "data:image/png;base64," + fs.readFileSync(path.join(OUT, "p2", a.file)).toString("base64");
  const png = require("pngjs").PNG.sync.read(buf);
  a.size = png.height;
  a.frames = png.width / png.height;
  if (!a.name) a.name = a.file.replace(".png", "");
}

const cards = sec => ANIMS.filter(a => a.sec === sec).map(a => {
  const disp = Math.min(Math.round(a.size * 1.5), 260);
  return `
    <figure class="card" data-name="${a.name}">
      <div class="stage${a.sec === "fx" || a.name === "Charge" ? " stage-fx" : ""}"><canvas width="${a.size}" height="${a.size}" style="width:${disp}px;height:${disp}px"></canvas></div>
      <figcaption>
        <div class="row"><span class="name">${a.name}.png</span><span class="mode ${a.loop ? "loop" : "once"}">${a.frames === 1 ? "1 frame" : a.loop ? "loop" : "1×"}</span></div>
        <div class="meta">${a.frames} × ${a.size}px · ${a.frames === 1 ? "statický" : a.fps + " fps"}</div>
        <div class="note">${a.note}</div>
      </figcaption>
    </figure>`;
}).join("");

const sections = SECTIONS.map(s => {
  const n = ANIMS.filter(a => a.sec === s.key).length;
  return `<h2>${s.title} <span class="cnt">${n}</span></h2>\n  <div class="grid">${cards(s.key)}</div>`;
}).join("\n  ");

const html = `<title>Naruto — extrahované animácie</title>
<style>
  :root{
    --bg:#14161d; --panel:#1c1f29; --panel2:#232735; --line:#2e3344;
    --ink:#e9e7de; --mut:#8b93a8; --acc:#f08c28; --blue:#5fb2e8;
  }
  html{ background:var(--bg); }
  body{ font:15px/1.5 "Segoe UI",system-ui,sans-serif; color:var(--ink); margin:0; padding:28px 20px 48px; }
  .wrap{ max-width:1180px; margin:0 auto; }
  header{ display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 18px; margin-bottom:6px; }
  h1{ font-size:22px; margin:0; letter-spacing:.2px; }
  h1 b{ color:var(--acc); font-weight:600; }
  .sub{ color:var(--mut); font-size:13px; }
  .controls{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:16px 0 26px;
    background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 14px;
    position:sticky; top:10px; z-index:5; box-shadow:0 4px 18px rgba(0,0,0,.45); }
  .controls .grp{ display:flex; gap:4px; align-items:center; }
  .controls .lbl{ color:var(--mut); font-size:11px; text-transform:uppercase; letter-spacing:.09em; margin-right:6px; }
  button{ font:13px "Consolas",monospace; color:var(--ink); background:var(--panel2); border:1px solid var(--line);
    border-radius:7px; padding:5px 12px; cursor:pointer; }
  button:hover{ border-color:var(--acc); }
  button:focus-visible{ outline:2px solid var(--acc); outline-offset:1px; }
  button.on{ background:var(--acc); border-color:var(--acc); color:#181205; font-weight:700; }
  .sep{ width:1px; height:22px; background:var(--line); }
  h2{ font-size:12px; text-transform:uppercase; letter-spacing:.14em; color:var(--mut); font-weight:600;
    margin:30px 0 12px; display:flex; align-items:center; gap:12px; }
  h2::after{ content:""; flex:1; height:1px; background:var(--line); }
  h2 .cnt{ color:var(--acc); }
  .grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(226px,1fr)); gap:14px; }
  .card{ margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .stage{ display:flex; justify-content:center; align-items:flex-end; min-height:150px; background:
      linear-gradient(#181b24,#151820 82%, #10131b 82%, #181b24);
    border-bottom:1px solid var(--line); padding:14px 0 0; }
  .stage canvas{ image-rendering:pixelated; }
  .stage-fx{ align-items:center; padding:14px 0; }
  body.p2 .stage canvas{ filter:saturate(.22) brightness(1.4); }
  figcaption{ padding:10px 13px 12px; }
  .row{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
  .name{ font:600 14px "Consolas",monospace; }
  .mode{ font:11px "Consolas",monospace; padding:1px 8px; border-radius:99px; white-space:nowrap; }
  .mode.loop{ color:var(--blue); border:1px solid color-mix(in srgb, var(--blue) 45%, transparent); }
  .mode.once{ color:var(--acc); border:1px solid color-mix(in srgb, var(--acc) 45%, transparent); }
  .meta{ font:12px "Consolas",monospace; color:var(--mut); margin-top:3px; font-variant-numeric:tabular-nums; }
  .note{ font-size:12.5px; color:var(--mut); margin-top:6px; }
</style>
<div class="wrap">
  <header>
    <h1>Naruto — extrahované animácie <b>public/assets/naruto/</b></h1>
    <span class="sub">${ANIMS.length} pásov · herná sada 128×128, efekty podľa obsahu · fps hernej sady podľa ANIM_DEF</span>
  </header>
  <div class="controls">
    <div class="grp"><span class="lbl">Rýchlosť</span>
      <button data-speed="0.25">0.25×</button><button data-speed="0.5">0.5×</button><button data-speed="1" class="on">1×</button><button data-speed="2">2×</button>
    </div>
    <div class="sep"></div>
    <div class="grp"><span class="lbl">Paleta</span>
      <button data-pal="p1" class="on">P1 (originál)</button><button data-pal="p2">P2 (žltý kostým)</button><button data-pal="filter">alt-color filter</button>
    </div>
    <div class="sep"></div>
    <div class="grp"><button id="pause">⏸ Pauza</button></div>
  </div>
  ${sections}
</div>
<script>
const ANIMS = ${JSON.stringify(ANIMS.map(({ name, data, data2, frames, fps, loop, size }) => ({ name, data, data2, frames, fps, loop, size })))};
let speed = 1, paused = false;
const HOLD_MS = 650; // pauza na poslednom frame pri 1x animaciach pred replayom
const players = [];
for (const a of ANIMS) {
  const card = document.querySelector('.card[data-name="' + a.name + '"]');
  const cvs = card.querySelector("canvas"), ctx = cvs.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const img = new Image(); img.src = a.data;          // P1 original
  const img2 = new Image(); img2.src = a.data2;       // P2 zlty kostym (predkodovane, prepnutie bez blikania)
  players.push({ a, cvs, ctx, img, img2, useP2: false, t: 0, last: performance.now() });
}
function tick(now) {
  for (const p of players) {
    const dt = (now - p.last) * speed; p.last = now;
    if (!paused) p.t += dt;
    const { frames, fps, loop, size } = p.a;
    let f = 0;
    if (frames > 1) {
      const durMs = frames * 1000 / fps;
      if (loop) f = Math.floor(p.t / 1000 * fps) % frames;
      else { const cyc = p.t % (durMs + HOLD_MS); f = Math.min(frames - 1, Math.floor(cyc / 1000 * fps)); }
    }
    const src = p.useP2 ? p.img2 : p.img;
    if (f !== p.f || !p.drawn) {
      if (src.complete && src.naturalWidth) {
        p.f = f; p.drawn = true;
        p.ctx.clearRect(0, 0, size, size);
        p.ctx.drawImage(src, f * size, 0, size, size, 0, 0, size, size);
      }
    }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
  speed = +b.dataset.speed;
  document.querySelectorAll("[data-speed]").forEach(x => x.classList.toggle("on", x === b));
}));
document.querySelectorAll("[data-pal]").forEach(b => b.addEventListener("click", () => {
  const mode = b.dataset.pal;
  document.body.classList.toggle("p2", mode === "filter");
  for (const p of players) { p.useP2 = mode === "p2"; p.drawn = false; } // prekresli aktualnym zdrojom
  document.querySelectorAll("[data-pal]").forEach(x => x.classList.toggle("on", x === b));
}));
const pauseBtn = document.getElementById("pause");
pauseBtn.addEventListener("click", () => { paused = !paused; pauseBtn.textContent = paused ? "▶ Spusti" : "⏸ Pauza"; pauseBtn.classList.toggle("on", paused); });
</script>
`;
fs.writeFileSync(path.join(__dirname, "viewer.html"), html);
console.log("viewer.html", (fs.statSync(path.join(__dirname, "viewer.html")).size / 1024).toFixed(0) + " KB, " + ANIMS.length + " animacii");
