// public/client/tome.js - „živá kniha" menu (schválený návrh public/dev/book-menu.html): pixel-art kniha s očami
// (sprite public/assets/book/book.png z tools/sprites-book/build.mjs) namiesto ☰ a kresby okna menu (menu.js):
// oko pri nadpise, oko na každej knihe-položke, koža s kovaním, krv, zuby z ľavého dolného rohu, jazyk obtočený
// okolo CODEXU. Všetko sa kreslí do malých canvasov (1 umelecký pixel = 3 px, kniha 4 px), CSS ich zväčší pixelated.
// Výkon: plátna sa kreslia len kým sú viditeľné; rozmery a polohy z DOM sa čítajú len pri prestavbe (nie každý frame).
import { perf } from "/client/perf.js";

const rnd = Math.random;
let SW = 0, SH = 0, base = null, EYES = [], ring = [[], []];

// ======================= sprite + oči =======================
export const tomeReady = new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    SW = img.width; SH = img.height;
    const c = document.createElement("canvas"); c.width = SW; c.height = SH; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
    base = x.getImageData(0, 0, SW, SH);
    const at = (xx, yy) => { const i = (yy * SW + xx) * 4; return base.data.slice(i, i + 4); };
    const isEye = ([r, g, b, a]) => a && r > 90 && (b > 60 || r > 150) && !(r > 90 && g > 70 && b < 60 && r < 150);
    // oči (rámčeky z mapy spritu): okolo každého sa spočíta farba viečka, dúhovka a jej stred
    EYES = [[22, 3, 27, 7], [11, 9, 17, 12], [12, 15, 17, 18], [27, 18, 32, 21], [12, 26, 17, 27]].map(([x0, y0, x1, y1]) => {
      const px = [], iris = []; let lid = [0, 0, 0], n = 0;
      for (let yy = y0 - 1; yy <= y1 + 1; yy++) for (let xx = x0 - 1; xx <= x1 + 1; xx++) {
        const col = at(xx, yy); if (!col[3]) continue;
        if (yy >= y0 && yy <= y1 && xx >= x0 && xx <= x1 && isEye(col)) { px.push([xx, yy]); if (col[0] > 150) iris.push([xx, yy]); }
        else if (col[0] + col[1] + col[2] < 165) { lid[0] += col[0]; lid[1] += col[1]; lid[2] += col[2]; n++; }
      }
      lid = lid.map(v => Math.round(v / Math.max(1, n)));
      const cx = iris.reduce((s, p) => s + p[0], 0) / (iris.length || 1), cy = iris.reduce((s, p) => s + p[1], 0) / (iris.length || 1);
      return { x0, y0, x1, y1, px, iris, cx, cy, lid };
    });
    // obrys pre auru (vzdialenosť 1 a 2 od nepriehľadných pixelov)
    const op = (xx, yy) => xx >= 0 && yy >= 0 && xx < SW && yy < SH && at(xx, yy)[3] > 0;
    for (let yy = -2; yy < SH + 2; yy++) for (let xx = -2; xx < SW + 2; xx++) {
      if (op(xx, yy)) continue;
      let d = 9; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (op(xx + dx, yy + dy)) d = Math.min(d, Math.max(Math.abs(dx), Math.abs(dy)));
      if (d <= 2) ring[d - 1].push([xx, yy]);
    }
    resolve();
  };
  img.onerror = () => resolve(); // bez spritu sa kniha jednoducho nenakreslí
  img.src = "/assets/book/book.png";
});

// sprite s očami podľa stavu: eyes[i] = { open 0..1, lx, ly, glow }
function spriteFrame(eyes) {
  const im = new ImageData(new Uint8ClampedArray(base.data), SW, SH), d = im.data;
  const set = (x, y, r, g, b) => { const i = (y * SW + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; };
  EYES.forEach((E, k) => {
    const s = eyes[k], h = E.y1 - E.y0 + 1;
    if (s.glow) for (const [x, y] of E.px) { const i = (y * SW + x) * 4; d[i] = Math.min(255, d[i] + 50 * s.glow); d[i + 2] = Math.min(255, d[i + 2] + 35 * s.glow); }
    // zrenička: tmavý pixel v dúhovke posunutý smerom pohľadu
    if (s.open > .35 && E.iris.length) {
      const tx = Math.round(E.cx + s.lx), ty = Math.round(E.cy + s.ly);
      let best = E.iris[0], bd = 99; for (const [x, y] of E.iris) { const dd = Math.abs(x - tx) + Math.abs(y - ty); if (dd < bd) { bd = dd; best = [x, y]; } }
      set(best[0], best[1], 24, 4, 10);
    }
    // viečka: zatvárajú sa zhora aj zdola k stredu; zatvorené = fialová linka s riasami
    const cut = (1 - s.open) / 2;
    for (const [x, y] of E.px) { const rel = (y - E.y0 + .5) / h; if (rel < cut || rel > 1 - cut) set(x, y, ...E.lid); }
    if (s.open < .2) {
      const my = Math.round(E.y0 + (h - 1) / 2), row = E.px.filter(([, y]) => y === my); for (const [x, y] of row) set(x, y, 138, 64, 180);
      if (row.length > 2) { const xs = row.map(p => p[0]).sort((a, b) => a - b); for (const x of [xs[1], xs[xs.length - 2]]) if (my + 1 < SH) set(x, my + 1, 96, 40, 130); }
    }
  });
  return im;
}

// poloha ukazovateľa (oči sa za ním pozerajú)
const pointer = { x: -1e4, y: -1e4 };
document.addEventListener("pointermove", (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });

// ======================= kniha - tlačidlo menu (animácia PREBÚDZANIE) =======================
// Spí so zatvorenými očami a dýchajúcou fialovou aurou; pri prejdení myšou sa oči otvárajú jedno po druhom a sledujú
// kurzor. Vracia tick(t).
const AW = 48, AH = 56, OX = 2, OY = 3; // plátno knihy: miesto na vznášanie, kvapky a tieň
export function bookButton(canvas, host) {
  canvas.width = AW; canvas.height = AH;
  const ctx = canvas.getContext("2d"), sp = document.createElement("canvas"); sp.width = SW; sp.height = SH; const sctx = sp.getContext("2d");
  const st = { hover: false, hoverAt: 0, leaveAt: -1e9, mx: 0, my: 0, drips: [], nextDrip: 1500, lastDraw: 0,
    eyes: EYES.map(() => ({ open: 0, lx: 0, ly: 0, glow: 0, next: 2000 + rnd() * 3000, blinkT: -1 })) };
  host.addEventListener("mouseenter", () => { st.hover = true; st.hoverAt = performance.now(); });
  host.addEventListener("mouseleave", () => { st.hover = false; st.leaveAt = performance.now(); });
  host.addEventListener("mousemove", (e) => { const r = canvas.getBoundingClientRect(); st.mx = (e.clientX - r.left) / r.width * AW; st.my = (e.clientY - r.top) / r.height * AH; });
  let last = 0;
  const tick = (t) => {
    if (!base) return;
    const awake = st.hover;
    // v pokoji stačí pár snímok za sekundu (dýchanie aury), prebudená / úsporná grafika podľa toho
    const every = awake ? 33 : perf.lite ? 200 : 100;
    if (t - st.lastDraw < every && st.drips.length === 0) return;
    st.lastDraw = t;
    const dt = Math.min(120, t - last); last = t;
    const bob = Math.round(Math.sin(t / 700));
    const shake = 0;
    st.eyes.forEach((e, k) => {
      const E = EYES[k], ref = awake ? st.hoverAt : st.leaveAt;
      let target = awake ? 1 : 0; if (t - ref < k * 130) target = awake ? 0 : 1; // jedno po druhom
      if (target > .5 && t > e.next) { e.blinkT = t; e.next = t + 2200 + rnd() * 3500; }
      const bt = t - e.blinkT, blink = e.blinkT >= 0 && bt >= 0 && bt < 180 ? 1 - Math.abs(bt - 90) / 90 : 0;
      e.open += ((target * (1 - blink)) - e.open) * Math.min(1, dt / (blink ? 25 : 90));
      const dx = st.mx - (OX + E.cx), dy = st.my - (OY + E.cy);
      e.lx = Math.abs(dx) > 3 ? Math.sign(dx) : 0; e.ly = Math.abs(dy) > 3 ? Math.sign(dy) : 0;
      e.glow = awake ? .8 : 0;
    });
    if (t > st.nextDrip) { const s = [[14, 44], [15, 42], [19, 47], [16, 45]][Math.floor(rnd() * 4)]; st.drips.push({ x: s[0] + OX, y: s[1] + OY + bob, vy: 0 }); st.nextDrip = t + 4000 * (awake ? .4 : 1) * (.6 + rnd() * .8); }
    ctx.clearRect(0, 0, AW, AH);
    const sw = 13 + (bob > 0 ? 1 : 0);
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fillRect(AW / 2 - sw, AH - 3, sw * 2, 2); ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(AW / 2 - sw + 3, AH - 4, sw * 2 - 6, 1);
    // dýchajúca fialová aura (pri prebudení silnejšia)
    const auraA = .35 + .25 * Math.sin(t / 600) + (awake ? .35 : 0);
    ring.forEach((pts, i) => { ctx.fillStyle = `rgba(160,80,255,${Math.min(1, auraA * (i ? .6 : 1.1))})`; for (const [x, y] of pts) if ((x + y + Math.floor(t / 250)) % (i ? 2 : 1) === 0) ctx.fillRect(x + OX + shake, y + OY + bob, 1, 1); });
    sctx.putImageData(spriteFrame(st.eyes), 0, 0);
    ctx.drawImage(sp, OX + shake, OY + bob);
    for (const d of st.drips) { d.vy += dt * .00012; d.y += d.vy * dt; }
    st.drips = st.drips.filter(d => d.y < AH - 3 || (d.splat = (d.splat || 0) + dt) < 300);
    for (const d of st.drips) { if (d.y >= AH - 3) { ctx.fillStyle = "#7a0c18"; ctx.fillRect(Math.round(d.x) - 1, AH - 3, 3, 1); } else { ctx.fillStyle = "#7a0c18"; ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 2); ctx.fillStyle = "#c0283a"; ctx.fillRect(Math.round(d.x), Math.round(d.y), 1, 1); } }
  };
  return tick;
}

// ======================= kresby okna menu =======================
// oko (výrez oka E3 zo spritu): host = null → stále otvorené a žmurká (nadpis); host = prvok → zatvorené,
// pri prejdení myšou po ňom sa otvorí a sleduje kurzor (knihy menu, CODEX)
function eyeWidget(c, host = null) {
  const E = EYES[2]; const w = E.x1 - E.x0 + 3, h = E.y1 - E.y0 + 3; c.width = w; c.height = h;
  const ctx = c.getContext("2d"), tmp = document.createElement("canvas"); tmp.width = SW; tmp.height = SH; const tctx = tmp.getContext("2d");
  const e = { next: 1200 + rnd() * 1500, blinkT: -1, open: host ? 0 : 1, last: 0, rect: null, rectAt: -1e9, key: "" };
  return (t) => {
    if (!c.isConnected) return;
    const dt = Math.min(50, t - e.last); e.last = t;
    const hov = host ? host.matches(":hover") : true;
    if (hov && t > e.next) { e.blinkT = t; e.next = t + 2500 + rnd() * 3500; }
    const bt = t - e.blinkT, blink = bt >= 0 && bt < 160 ? 1 - Math.abs(bt - 80) / 80 : 0;
    e.open += ((hov ? 1 - blink : 0) - e.open) * Math.min(1, dt / (blink ? 25 : 70));
    if (t - e.rectAt > 500) { e.rect = c.getBoundingClientRect(); e.rectAt = t; } // poloha oka - nie každý frame
    const r = e.rect, dx = pointer.x - (r.left + r.width / 2), dy = pointer.y - (r.top + r.height / 2);
    const lx = Math.abs(dx) > 24 ? Math.sign(dx) : 0, ly = Math.abs(dy) > 16 ? Math.sign(dy) : 0, open = Math.round(e.open * 20) / 20;
    const key = `${open}|${lx}|${ly}|${hov}`; if (key === e.key) return; e.key = key; // kresli len pri zmene
    const eyes = EYES.map(() => ({ open: 1, lx: 0, ly: 0, glow: 0 }));
    eyes[2] = { open, lx, ly, glow: host && hov ? .8 : .5 };
    tctx.putImageData(spriteFrame(eyes), 0, 0); ctx.clearRect(0, 0, w, h); ctx.drawImage(tmp, E.x0 - 1, E.y0 - 1, w, h, 0, 0, w, h);
  };
}

// zuby trčiace z ľavého dolného rohu okna - zo spodnej aj z ľavej hrany, jeden šikmo z rohu (plátno je za obalom,
// roh okna je v bode (C, C) plátna, korene zubov sú schované pod obalom); statické
function teethWidget(c) {
  const N = 34, C = 14, ctx = c.getContext("2d"); c.width = N; c.height = N;
  const OUT = "#120d08", BONE = "#e8dcc0", BSH = "#b8a47a", GUM = "#5a0c18";
  function fang(x, y, dx, dy, len, w) { // koreň (x, y), smer (dx, dy), dĺžka, šírka koreňa
    const px = dy !== 0 ? 1 : 0, py = dx !== 0 && dy === 0 ? 1 : 0;
    for (let i = 0; i < len; i++) {
      const ww = Math.max(1, Math.round(w * (1 - i / len))), off = Math.floor((w - ww) / 2);
      const bx = x + dx * i + px * off, by = y + dy * i + py * off;
      ctx.fillStyle = OUT; ctx.fillRect(bx - px, by - py, px ? ww + 2 : 1, py ? ww + 2 : 1);
      ctx.fillStyle = BONE; ctx.fillRect(bx, by, px ? ww : 1, py ? ww : 1);
      if (ww > 1) { ctx.fillStyle = BSH; ctx.fillRect(bx + px * (ww - 1), by + py * (ww - 1), 1, 1); }
    }
    ctx.fillStyle = OUT; ctx.fillRect(x + dx * len + px * Math.floor(w / 2), y + dy * len + py * Math.floor(w / 2), 1, 1);
  }
  ctx.clearRect(0, 0, N, N);
  fang(C + 1, C, 0, 1, 11, 5); fang(C + 7, C, 0, 1, 8, 4); fang(C + 12, C, 0, 1, 5, 3);   // zo spodnej hrany dole
  fang(C - 1, C - 7, -1, 0, 11, 5); fang(C - 1, C - 13, -1, 0, 7, 4);                     // z ľavej hrany doľava
  const row = (i) => { const ww = Math.max(1, Math.round(5 * (1 - i / 8))); return [C - 1 - i - Math.floor(ww / 2), C - 1 + i, ww]; };
  for (let i = 0; i < 8; i++) { const [x, y, ww] = row(i); ctx.fillStyle = OUT; ctx.fillRect(x - 1, y - 1, ww + 2, 3); }
  for (let i = 0; i < 8; i++) { const [x, y, ww] = row(i); ctx.fillStyle = BONE; ctx.fillRect(x, y, ww, 1); if (ww > 1) { ctx.fillStyle = BSH; ctx.fillRect(x + ww - 1, y, 1, 1); } }
  ctx.fillStyle = OUT; const [tx, ty] = row(7); ctx.fillRect(tx - 1, ty + 1, 1, 1);
  ctx.fillStyle = GUM; ctx.fillRect(C - 3, C - 2, 3, 2); ctx.fillRect(C - 1, C - 14, 1, 15); ctx.fillRect(C - 1, C, 15, 1); // ďasno cez korene
  return null;
}

// jazyk ako liana: vynorí sa spoza CODEXU, 2× sa obtočí okolo knihy (vpredu šikmo cez chrbát, vzadu schovaný),
// potom pri pravej hrane visí pod okno so stočenou špičkou; po visiacej časti steká slina a odkvapne.
// Výška závitov je stála (TONGUE_WRAP) - na nižšej knihe (bez FULL SCREEN) vyzerá rovnako.
const TONGUE_WRAP = 30;
function tongueWrapWidget(c) {
  const win = c.closest(".ui-modal"), book = win.querySelector(".rbook"), ctx = c.getContext("2d");
  const TOUT = "#2a0508", BODY = "#8a2a30", MID = "#a83a3a", HI = "#d06050", GROOVE = "#5a1018", SHADE = "#6a1a22", BACK = "#4a1016";
  let key = "", img = null, tail = [], W = 0, H = 0; const drops = []; let next = 900;
  function build() {
    const oh = win.offsetHeight;
    // rozmery v CSS px okna (okno môže byť zmenšené cez --ui-k - offset* to ignorujú)
    const bl = book.offsetLeft + book.offsetParent.offsetLeft, bt = book.offsetTop + book.offsetParent.offsetTop, bw = book.offsetWidth, bh = book.offsetHeight;
    const PAD = 4, topPx = bt + bh - (TONGUE_WRAP + 6) * 3, leftPx = bl - PAD * 3;
    W = Math.round(bw / 3) + PAD * 2 + 6; H = Math.round((oh - topPx + 66) / 3);
    c.style.left = leftPx + "px"; c.style.top = topPx + "px"; c.style.width = W * 3 + "px"; c.style.height = H * 3 + "px"; c.width = W; c.height = H;
    const sl = PAD, sw = Math.round(bw / 3), sr = sl + sw, cx = sl + sw / 2, R = sw / 2 + 1.5;
    const y0 = 3, y1 = Math.round((bt + bh) / 3 - topPx / 3) - 3, winB = Math.round((oh - topPx) / 3);
    const pts = [], A0 = Math.PI, A1 = 4.5 * Math.PI;
    for (let a = A0; a <= A1; a += .02) pts.push({ x: cx + R * Math.sin(a), y: y0 + (y1 - y0) * (a - A0) / (A1 - A0), front: Math.cos(a) > 0 });
    const ex = cx + R, tl = [[ex, y1], [ex + .5, winB + 2], [ex - 1, winB + 6], [ex - 4, winB + 8]];
    for (let i = 0; i < tl.length - 1; i++) { const [xa, ya] = tl[i], [xb, yb] = tl[i + 1], n = Math.ceil(Math.max(Math.abs(xb - xa), Math.abs(yb - ya)) * 2);
      for (let j = 0; j < n; j++) pts.push({ x: xa + (xb - xa) * j / n, y: ya + (yb - ya) * j / n, front: true, tail: true }); }
    const back = new Uint8Array(W * H), front = new Uint8Array(W * H), n = pts.length;
    pts.forEach((p, i) => { const r = p.tail ? (i > n - 6 ? 2 : i > n - 16 ? 2.6 : 3.2) : 3.2, msk = p.front ? front : back;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= r * r) { const xx = Math.round(p.x) + dx, yy = Math.round(p.y) + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) msk[yy * W + xx] = 1; } });
    for (let y = 0; y < H; y++) for (let x = sl; x < sr; x++) back[y * W + x] = 0; // zadná časť je za knihou
    img = ctx.createImageData(W, H);
    const put = (x, y, hex) => { const i = (y * W + x) * 4, v = parseInt(hex.slice(1), 16); img.data[i] = v >> 16; img.data[i + 1] = (v >> 8) & 255; img.data[i + 2] = v & 255; img.data[i + 3] = 255; };
    const layer = (msk, dark) => { const m = (x, y) => x >= 0 && y >= 0 && x < W && y < H && msk[y * W + x];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (!m(x, y)) continue;
        const edge = !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);
        put(x, y, edge ? TOUT : dark ? BACK : !m(x, y - 2) ? HI : !m(x, y - 3) ? MID : !m(x, y + 2) ? SHADE : BODY); } };
    layer(back, true); layer(front, false);
    pts.forEach((p, i) => { if (p.front && i % 5 && i < n - 18) { const x = Math.round(p.x), y = Math.round(p.y); if (front[y * W + x] && front[(y - 2) * W + x] && front[(y + 2) * W + x]) put(x, y, GROOVE); } });
    tail = pts.filter(p => p.tail).map(p => [Math.round(p.x), Math.round(p.y)]);
  }
  return (t) => {
    if (!c.isConnected) return;
    const k2 = win.offsetWidth + "x" + win.offsetHeight; if (k2 !== key) { key = k2; build(); }
    ctx.putImageData(img, 0, 0);
    if (t > next) { drops.push({ i: 0, v: 0, hang: 0, fy: 0 }); next = t + 1800 + rnd() * 2400; }
    const last = tail.length - 1;
    for (const d of drops) {
      if (d.i < last) { d.v = Math.min(.12, d.v + .002); d.i += d.v * 14; }
      else if (d.hang < 45) { d.hang++; d.i = last; }
      else { d.v += .03; d.fy += d.v * 3; }
      const [x, yy] = tail[Math.min(last, Math.round(d.i))], y = yy + Math.round(d.fy) + (d.hang ? 2 : 0);
      ctx.fillStyle = "#b8d8ea"; ctx.fillRect(x, y, 2, d.hang > 20 ? 3 : 2); ctx.fillStyle = "#ffffff"; ctx.fillRect(x, y, 1, 1);
    }
    while (drops.length && drops[0].fy > H) drops.shift();
  };
}

const GLYPHS = [[[1, 0], [1, 1], [1, 2], [0, 1], [2, 1]], [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
  [[1, 0], [0, 1], [2, 1], [1, 2]], [[0, 0], [0, 1], [0, 2], [1, 1], [2, 0], [2, 2]], [[0, 2], [1, 1], [2, 0], [1, 0], [1, 2]]];

// chrbát CODEXU ako tajný grimoár: tmavá zrnitá koža, zlaté kovanie s nitmi, vypuklé pásy, zámok s kľúčovou dierkou,
// po bokoch runy, ktoré tlejú fialovo (pri prejdení myšou sa rozžiaria); nápis na stred, ale medzi zámok a jazyk
function grimoireWidget(c) {
  const book = c.parentElement, ctx = c.getContext("2d"); let W = 0, H = 0, img = null;
  const L0 = "#1e1519", L1 = "#271c21", L2 = "#30242a", LHI = "#46363e", IRON = "#b8862b", IHI = "#f2c14e", ILO = "#6a4a10", OUT = "#0a0708";
  function build() {
    W = Math.round(book.clientWidth / 3); H = Math.round(book.clientHeight / 3); c.width = W; c.height = H;
    const g = document.createElement("canvas"); g.width = W; g.height = H; const x = g.getContext("2d"), px = (a, b, w, h, col) => { x.fillStyle = col; x.fillRect(a, b, w, h); };
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const e = Math.min(xx, W - 1 - xx), v = (xx * 7 + yy * 13 + xx * yy) % 17;
      px(xx, yy, 1, 1, e < 1 ? OUT : e < 3 ? L0 : v < 3 ? L0 : v > 14 ? L2 : L1); }
    const band = (yy) => { px(1, yy, W - 2, 1, LHI); px(1, yy + 1, W - 2, 1, L2); px(1, yy + 2, W - 2, 1, OUT); };
    band(13); band(H - 16);
    const cap = (yy, down) => { for (let i = 0; i < 4; i++) { const w = 6 - i, ry = down ? yy - i : yy + i; px(0, ry, w, 1, IRON); px(W - w, ry, w, 1, IRON); }
      px(0, yy, W, 1, down ? ILO : IHI); px(1, down ? yy - 1 : yy + 1, 1, 1, IHI); px(W - 2, down ? yy - 1 : yy + 1, 1, 1, IHI); };
    cap(0, false); cap(H - 1, true);
    const ky = 18, kx = Math.round((W - 6) / 2); // zámok
    px(kx - 1, ky - 1, 8, 10, OUT); px(kx, ky, 6, 8, IRON); px(kx, ky, 6, 1, IHI); px(kx, ky + 7, 6, 1, ILO);
    px(kx + 2, ky + 2, 2, 2, OUT); px(kx + 2, ky + 4, 2, 2, OUT); px(kx + 1, ky + 1, 1, 1, IHI); px(kx + 4, ky + 6, 1, 1, IHI);
    img = x.getImageData(0, 0, W, H);
  }
  let lastRune = -1e9;
  return (t) => {
    if (!c.isConnected) return;
    const span = book.querySelector("span"), sk = book.clientWidth + "x" + book.clientHeight + "x" + span.offsetHeight; // aj po načítaní fontu
    if (sk !== c.dataset.k) {
      c.dataset.k = sk;
      const lockBottom = (18 + 9) * 3, tongueTop = book.clientHeight - (TONGUE_WRAP + 3) * 3 + 6;
      span.style.fontSize = ""; span.style.letterSpacing = "";
      const tight = tongueTop - lockBottom < span.offsetHeight + 30;
      if (tight) {
        // nízka kniha (telefón): nápis na stred medzi zámok a horný okraj jazyka (celý viditeľný); keď sa nevojde, menšie písmo
        const room = tongueTop - 6 - lockBottom;
        for (const [fs, ls] of [["", ""], ["", "1px"], ["10px", "1px"], ["8px", "1px"]]) {
          span.style.fontSize = fs; span.style.letterSpacing = ls;
          if (span.offsetHeight + 8 <= room) break;
        }
        span.style.top = Math.round(lockBottom + (room - span.offsetHeight) / 2) + "px";
      } else {
        span.style.top = Math.max(lockBottom + 2, Math.min(Math.round((book.clientHeight - span.offsetHeight) / 2), tongueTop - span.offsetHeight - 2)) + "px";
      }
      build(); lastRune = -1e9;
    }
    const hov = book.matches(":hover");
    if (t - lastRune < (perf.lite ? 120 : 50)) return; lastRune = t; // runy stačí prekresliť ~20× za sekundu
    ctx.putImageData(img, 0, 0);
    for (let i = 0, yy = 17; yy + 3 <= H - 17; i++, yy += 5) for (const side of [0, 1]) { // runy až po spodný pás
      const gl = GLYPHS[(i * 3 + side * 2) % GLYPHS.length], xx = side ? W - 5 : 2;
      const a = (hov ? .55 : .18) + (hov ? .45 : .32) * Math.max(0, Math.sin(t / 500 - i * .7 - side));
      ctx.fillStyle = `rgba(170,90,255,${a.toFixed(2)})`; for (const [gx, gy] of gl) ctx.fillRect(xx + gx, yy + gy, 1, 1);
    }
  };
}

// krv na knihách menu: na niektorých nepravidelný pás krvi z hornej hrany (pri chrbte a/alebo pred okom) so
// stekajúcimi kvapkami; z najdlhšej občas odkvapne a padá pod knihu. Rozloženie podľa poradia knihy v okne (seed).
function bloodWidget(c, seed) {
  const host = c.parentElement, ctx = c.getContext("2d"); let W = 0, H = 0, bands = [], longest = null;
  const D = "#4a0810", M = "#7a0c18", L = "#a81c28";
  const r = (n) => { const v = Math.sin(seed * 91.7 + n * 37.3) * 43758.5453; return v - Math.floor(v); };
  const drops = []; let next = 1500 + r(9) * 3000, drawn = false;
  const P = (x, y, w2, h2, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, w2, h2); };
  return (t) => {
    if (!c.isConnected) return;
    const w = Math.round(host.clientWidth / 3), h = Math.round(host.clientHeight / 3);
    if (w !== W || h !== H) { W = w; H = h; c.width = W; c.height = H + 9; c.style.height = (H + 9) * 3 + "px"; drawn = false;
      bands = []; let n = 20;
      const band = (x0, len) => { const b = { x0, len, drips: [] }; for (let x = x0 + 1; x < x0 + len - 1; x++) if (r(n++) < .32) b.drips.push({ x, len: 1 + Math.floor(Math.pow(r(n++), 1.6) * (H * .55)) }); bands.push(b); };
      if (seed % 3 !== 2) band(1, 6 + Math.floor(r(1) * 9));                               // pri chrbte
      if (seed % 2 === 1) band(W - 33 + Math.floor(r(3) * 3), 6 + Math.floor(r(4) * 7));    // pred okom (nezakrýva ho)
      longest = null; for (const b of bands) for (const d of b.drips) if (!longest || d.len > longest.len) longest = d;
    }
    if (longest && t > next) { drops.push({ x: longest.x, y: longest.len + 6, v: 0 }); next = t + 2500 + rnd() * 4000; }
    if (drawn && !drops.length) return; // bez padajúcej kvapky sa nič nemení
    drawn = true;
    ctx.clearRect(0, 0, W, c.height);
    for (const b of bands) {
      for (let x = b.x0; x < b.x0 + b.len; x++) { const edge = x === b.x0 || x === b.x0 + b.len - 1, th = edge ? 1 : 2 + (Math.sin(x * 1.7 + seed) > .3 ? 1 : 0);
        P(x, 1, 1, th, M); P(x, 1 + th - 1, 1, 1, D); if (!edge && (x + seed) % 3 === 0) P(x, 1, 1, 1, L); }
      for (const d of b.drips) { const y1 = 3 + d.len; P(d.x, 3, 1, d.len, M); P(d.x, y1, 2, 2, M); P(d.x + 1, y1 + 1, 1, 1, D); P(d.x, y1, 1, 1, L); }
    }
    for (const d of drops) { d.v += .025; d.y += d.v; P(d.x, Math.round(d.y), 2, 2, M); P(d.x + 1, Math.round(d.y) + 1, 1, 1, D); P(d.x, Math.round(d.y), 1, 1, L); }
    while (drops.length && drops[0].y > c.height) drops.shift();
  };
}

// kniha-položka = grimoár ako CODEX, len vodorovne: zrnitá koža, pásy pri oboch koncoch (pravý = deliaca čiara pred
// okom), kovanie s nitmi na rohoch. Farba kože podľa typu položky; admin strana a ADMIN tlačidlo majú rubínové kovanie.
const LEATHER = { "": ["#1e1519", "#271c21", "#30242a", "#46363e"], report: ["#5e440a", "#6e520e", "#7e5e12", "#a8841e"],
  danger: ["#2a0a0e", "#36101a", "#421620", "#5e2430"], "menu-data": ["#121e0e", "#1a2a14", "#22341a", "#344a28"], maint: ["#24190a", "#2e2210", "#382a14", "#4e3c20"] };
function itemArtWidget(c) {
  const book = c.parentElement, ctx = c.getContext("2d");
  const isAdm = book.classList.contains("menu-admin"), ruby = isAdm || !!book.closest(".menu-page.adm");
  const kind = isAdm ? "" : ["report", "danger", "menu-data", "maint"].find(k => book.classList.contains(k)) || "";
  const [L0, L1, L2, LHI] = LEATHER[kind], OUT = "#0a0708", admOn = isAdm && book.classList.contains("on");
  const [IRON, IHI, ILO] = !ruby ? ["#5a5e66", "#8a909a", "#2a2c31"] : admOn ? ["#b0203a", "#ff5a74", "#5a0816"] : ["#6a1424", "#9a2a40", "#34060e"];
  let key = "";
  return () => {
    if (!c.isConnected) return;
    const W = Math.round(book.clientWidth / 3), H = Math.round(book.clientHeight / 3), k = W + "x" + H;
    if (k === key || !W) return; key = k; // statické - prekreslí sa len pri zmene rozmerov
    c.width = W; c.height = H;
    const px = (a, b, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(a, b, w, h); };
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const e = Math.min(yy, H - 1 - yy), v = (xx * 7 + yy * 13 + xx * yy) % 17;
      px(xx, yy, 1, 1, e < 1 ? OUT : e < 3 ? L0 : v < 3 ? L0 : v > 14 ? L2 : L1); }
    const band = (xx) => { px(xx, 1, 1, H - 2, LHI); px(xx + 1, 1, 1, H - 2, L2); px(xx + 2, 1, 1, H - 2, OUT); };
    band(5); band(isAdm ? W - 8 : W - 17);
    const cap = (xx, right) => { for (let i = 0; i < 4; i++) { const h = 6 - i, rx = right ? xx - i : xx + i; px(rx, 0, 1, h, IRON); px(rx, H - h, 1, h, IRON); }
      px(xx, 0, 1, H, right ? ILO : IHI); px(right ? xx - 1 : xx + 1, 1, 1, 1, IHI); px(right ? xx - 1 : xx + 1, H - 2, 1, 1, IHI); };
    cap(0, false); cap(W - 1, true);
  };
}

// všetky kresby v okne menu → zoznam tick(t) funkcií (statické vracajú null)
export function tomeWidgets(root) {
  if (!base) return [];
  const q = (s) => [...root.querySelectorAll(s)];
  return [
    ...q("canvas.eye").map(c => eyeWidget(c)),
    ...q("canvas.ieye").map(c => eyeWidget(c, c.closest("button"))),
    ...q("canvas.teeth").map(teethWidget),
    ...q("canvas.rb-art").map(grimoireWidget),
    ...q("canvas.ib-art").map(itemArtWidget),
    ...q("canvas.blood").map(c => bloodWidget(c, q("canvas.blood").indexOf(c) + 1)),
    ...q("canvas.tongue2").map(tongueWrapWidget), // po CODEXe (potrebuje polohu jeho nápisu)
  ].filter(Boolean);
}
