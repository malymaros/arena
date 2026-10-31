// public/client/shrek.js - Shrek Swamp (docs/SWAMP_PLAN.md): Shrek na doske (sprite canvas medzi figúrami, HP lišta
// nad hlavou), ohlásené skoky 1/2/3 a smrad v bunkách (renderShrek z renderGrid) a choreografia jeho efektov
// z timeline (shrekEffect): skok, rev (kríž okolo dopadu), zásah, sud, punch, PowerUp + tackle + návrat, pád, smrad.
// Stav nesie server v state.shrek (verejný - aj prekliatemu v labyrinte); klient len prehráva. Sprity sú pásy
// z tools/sprites-shrek (public/assets/shrek/*.png + anims.json).
import { state } from "/client/session.js";
import { cellToPx, TILE_W, TILE_H, gridEl, actorsEl, figuresEl, rowZ } from "/client/dom.js";
import { spawnFloat, spawnCellFloat, spawnManaFloat } from "/client/board-fx.js";
import { pixSvg } from "/client/pix.js";
import { perf } from "/client/perf.js";
import { SHREK_RAGE_HP } from "/shared/balance.js";

const DIR = "/assets/shrek/";
const K = 3.2;                       // mierka sprite-u (75 % pôvodných 4,3: ~45 px Shrek → ~145 px)
const CW = Math.round(96 * K), CH = CW; // canvas: najväčší pás (88 px) + rezerva
const SIDE = 62;                     // odsun Shreka nabok, keď s ním na políčku stojí hráč (hráča odsúva pairShift)
const META = {};
let ready = false;
fetch(DIR + "anims.json").then(r => r.json()).then(list => Promise.all(list.filter(m => !m.name.startsWith("H_") || m.name === "H_Roar").map(m =>
  new Promise(res => { const img = new Image(); img.onload = () => { META[m.name] = { ...m, img }; res(); }; img.onerror = res; img.src = DIR + m.name + ".png"; }))))
  .then(() => { ready = true; }).catch(() => {});

let fig = null, hpEl = null, itemsEl = null; // itemsEl: vrstva itemov nad figúrami
const view = { anim: "Idle", start: 0, ms: 0, flip: false, px: null, py: null, motion: null, hurtUntil: 0, lastKey: "" };
let roar = null;                     // { cells, until } - rozsvietené políčka revu (kríž)
let freshStench = new Map();         // "x,y" → do kedy sa bunka smradu „rozlieva" (animácia nástupu)
const flashCells = new Map();        // "x,y" → do kedy bliká (stench_proc)
const alertCells = new Map();        // "x,y" → do kedy bliká ako vyhodnocovaná dlaždica (výkrik: cieľ skoku / zasiahnutý Shrek)
const freshItems = new Map();        // "x,y" → do kedy item „padá" (item_drop)

function ensureEls() {
  if (fig) return;
  fig = document.createElement("canvas");
  fig.id = "shrek-fig";
  fig.className = "shrek-fig";
  fig.width = CW; fig.height = CH;
  figuresEl.appendChild(fig);
  hpEl = document.createElement("div");
  hpEl.className = "shrek-hp";
  actorsEl.appendChild(hpEl);
  itemsEl = document.createElement("div");
  itemsEl.className = "swamp-items";
  actorsEl.appendChild(itemsEl);
}

const cellCenter = (x, y) => { const { left, top } = cellToPx(x, y); return { x: left + TILE_W / 2, y: top + TILE_H }; };

// pokojová pozícia: stred bunky, nabok ak tam stojí živý hráč (oba hráči → Shrek ostane v strede za nimi)
function restPos(s) {
  const c = cellCenter(s.x, s.y);
  if (s.dead) return c;
  const here = ["p1", "p2"].filter(sl => state?.[sl]?.x === s.x && state?.[sl]?.y === s.y);
  if (here.length === 1) c.x += here[0] === "p1" ? SIDE : -SIDE;
  return c;
}

function play(anim, ms = 0) {
  view.anim = anim; view.start = performance.now(); view.ms = ms; view.lastKey = "";
}

// pohyb v čase ms (skok s oblúkom, tackle, návrat)
function moveTo(to, ms, arc = 0) {
  const from = { x: view.px, y: view.py };
  view.motion = { from, to, start: performance.now(), ms, arc };
}

/* ---------- render z renderGrid (každý snapshot / frame) ---------- */
export function renderShrek(s) {
  const sh = s?.shrek;
  if (!sh) { if (fig) { fig.style.display = "none"; hpEl.style.display = "none"; itemsEl.replaceChildren(); } return; }
  ensureEls();
  fig.style.display = "block";
  // bunky: ohlásené skoky - políčko podfarbené ako špeciálna dlaždica + Shrekova hlava (Mark.png) s číslom
  // (už odskákané vyblednú), smrad, rev, blik smradu
  const cells = gridEl.children, w = state?.board?.w || 4, now = performance.now();
  sh.marks.forEach(([x, y], i) => {
    const cell = cells[y * w + x];
    if (!cell) return;
    const phase = i < sh.done ? "done" : i === sh.done ? "next" : "";
    if (phase !== "done") cell.classList.add("shrek-cell");
    const m = document.createElement("div");
    m.className = "shrek-mark" + (phase ? " " + phase : "");
    m.innerHTML = `<img src="${DIR}Mark.png" alt=""><b>${i + 1}</b>`;
    // viac čísel na jednej bunke (napr. 1 a 3) - ďalšia hlava vedľa, nech sa neprekryjú
    const prior = cell.querySelectorAll(".shrek-mark").length;
    if (prior) m.style.marginLeft = (-17 + prior * 100) + "px";
    cell.appendChild(m);
  });
  // náhľad skokov ďalšieho kola (config.shrekPreview): len číslo vpravo dole v bunke, v odtieni Shrekovej hlavy
  for (const [i, [x, y]] of (sh.next || []).entries()) {
    const cell = cells[y * w + x];
    if (!cell) continue;
    const n = document.createElement("span");
    n.className = "shrek-next";
    n.textContent = i + 1;
    cell.appendChild(n);
  }
  for (const [x, y] of sh.stench) {
    const cell = cells[y * w + x];
    if (!cell) continue;
    // smrad = špeciálna dlaždica (výplň + rámik v zelenej skokov) s pixel ikonou zeleného hovna v rohu
    cell.classList.add("tile-stench");
    if ((freshStench.get(`${x},${y}`) || 0) > now) cell.classList.add("stench-fresh");
    const m = document.createElement("span");
    m.className = "tile-marker stench-marker";
    m.innerHTML = pixSvg("poo");
    cell.appendChild(m);
  }
  // itemy: srdiečko / kvapka (pixel ikony dlaždíc) bez krúžku, vznášajú sa nad tieňom; čerstvé padajú zhora
  // Kreslia sa do vlastnej vrstvy nad figúrami - vždy najviac vpredu, aj pred hráčmi a mŕtvym Shrekom.
  itemsEl.replaceChildren();
  for (const it of s.items || []) {
    const { left, top } = cellToPx(it.x, it.y);
    const el = document.createElement("div");
    el.className = `swamp-item ${it.type}` + ((freshItems.get(`${it.x},${it.y}`) || 0) > now ? " fresh" : "");
    el.style.left = (left + TILE_W / 2) + "px"; el.style.top = (top + TILE_H / 2) + "px";
    el.innerHTML = `<i>${pixSvg(it.type === "heal" ? "heart" : "drop")}</i>`;
    itemsEl.appendChild(el);
  }
  if (roar && roar.until > now) for (const [x, y] of roar.cells) cells[y * w + x]?.classList.add("shrek-roar");
  for (const [k, until] of flashCells) {
    if (until < now) { flashCells.delete(k); continue; }
    const [x, y] = k.split(",").map(Number);
    cells[y * w + x]?.classList.add("stench-flash");
  }
  for (const [k, until] of alertCells) {
    if (until < now) { alertCells.delete(k); continue; }
    const [x, y] = k.split(",").map(Number);
    cells[y * w + x]?.classList.add("shrek-alert");
  }
  if (view.px == null || (!view.motion && !sh.dead)) {
    const p = restPos(sh);
    if (view.px == null) { view.px = p.x; view.py = p.y; }
    else if (!view.motion) view.motion = { from: { x: view.px, y: view.py }, to: p, start: now, ms: 220, arc: 0 };
  }
  if (sh.dead && view.anim !== "HurtDead") { play("HurtDead"); view.start = 0; } // reload po smrti - rovno ležiaci
  if (!sh.dead && view.anim === "HurtDead") { // nová hra série - Shrek znova stojí (bez sklzu z miesta pádu)
    const p = restPos(sh);
    view.px = p.x; view.py = p.y; view.motion = null;
    play("Idle");
  }
  fig.style.zIndex = sh.dead ? 1 : rowZ(sh.y) - 1; // mŕtvy leží za všetkými figúrami, živý za hráčmi na svojom riadku
  // nad hlavou len číslo HP: 20–11 zelené, 10–6 oranžové, 5–0 červené (prahy revu SHREK_RAGE_HP)
  hpEl.style.display = sh.dead ? "none" : "";
  hpEl.className = "shrek-hp " + (sh.hp <= SHREK_RAGE_HP[1] ? "t3" : sh.hp <= SHREK_RAGE_HP[0] ? "t2" : "");
  hpEl.textContent = String(sh.hp);
  if (!view.motion && !sh.dead) view.flip = sh.x >= (state?.board?.w || 4) / 2; // tvárou do stredu dosky
}

/* ---------- efekty timeline ---------- */
export function shrekEffect(e, hold) {
  const sh = state?.shrek;
  if (!sh && !e.kind.startsWith("shrek_") && !e.kind.startsWith("stench_") && !e.kind.startsWith("item_")) return;
  const now = performance.now();
  switch (e.kind) {
    case "shrek_jump": {
      ensureEls();
      const to = cellCenter(e.to[0], e.to[1]);
      const fromC = cellCenter(e.from[0], e.from[1]);
      if (view.px == null) { view.px = fromC.x; view.py = fromC.y; }
      view.flip = to.x < view.px;
      play("JumpKick", hold);
      moveTo(to, hold * 0.85, 120);
      break;
    }
    case "shrek_roar":
      play("Roar", hold);
      roar = { cells: e.cells || [], until: now + hold };
      spawnCellFloat(e.cell, "ROAR!", "shrek-roar-float");
      break;
    case "shrek_hit":
      view.hurtUntil = now + 350;
      floatOverShrek(`-${e.dmg} HP`, "dmg-float");
      break;
    // políčko bliká ako vyhodnocovaná špeciálna dlaždica: pred skokom 1/2/3 cieľ skoku (Shrek len stojí),
    // po zásahu hráčom Shrekovo políčko + výkrik (zvuk shrek.hit) s H_Roar v slučke
    case "shrek_call":
    case "shrek_scream":
      if (e.kind === "shrek_scream") play("H_Roar", hold); // slučka len na dĺžku výkriku (po odraze mirrorom nenasleduje reakcia)
      else view.flip = cellCenter(e.cell[0], e.cell[1]).x < view.px;
      alertCells.set(`${e.cell[0]},${e.cell[1]}`, now + hold);
      gridEl.children[e.cell[1] * (state?.board?.w || 4) + e.cell[0]]?.classList.add("shrek-alert");
      break;
    case "shrek_powerup":
      view.flip = e.dir === "left";
      play("PowerUp", hold);
      break;
    case "shrek_tackle": {
      view.flip = e.dir === "left";
      play("Tackle", hold);
      const to = cellCenter(e.to[0], e.to[1]);
      if (e.target) to.x -= (e.dir === "left" ? -1 : 1) * 70; // zastaví sa pred figúrou, nie v nej
      const tackle = META.Tackle;
      const windup = tackle ? Math.min(hold * 0.4, 5 / tackle.fps * 1000) : 0; // úvodné červené framy na mieste
      setTimeout(() => moveTo(to, hold - windup), windup);
      break;
    }
    case "shrek_return": {
      view.flip = e.dir === "right"; // ide späť - tvárou opačne
      play("Walk", hold);
      const to = cellCenter(e.to[0], e.to[1]);
      moveTo(to, hold * 0.95);
      break;
    }
    case "shrek_die":
      play("HurtDead", hold);
      floatOverShrek("KO!", "shrek-roar-float");
      break;
    case "stench_proc":
      flashCells.set(`${e.cell[0]},${e.cell[1]}`, now + hold);
      break;
    case "item_drop":
      for (const it of e.items || []) freshItems.set(`${it.x},${it.y}`, now + 900);
      break;
    case "item_pick":
      // item zmizne (stav ho už nemá) - krátky záblesk na bunke + float hráčovi / Shrekovi (ten berie len HP)
      spawnCellFloat(e.cell, e.type === "heal" ? "❤" : "💧", "item-pop");
      if (e.target === "shrek") { if (e.amount > 0) floatOverShrek(`+${e.amount} HP`, "heal-float"); }
      else if (e.type === "heal") spawnFloat(e.target, `+${e.amount} HP`, "heal-float");
      else spawnManaFloat(e.target, e.amount);
      break;
    case "stench_spread":
      for (const [x, y] of e.cells || []) freshStench.set(`${x},${y}`, now + 1600);
      break;
  }
}

function floatOverShrek(text, cls) {
  if (view.px == null) return;
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  el.style.left = view.px + "px";
  el.style.top = (view.py - 200) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

/* ---------- kreslenie (vlastná slučka; kreslí len pri zmene framu/polohy) ---------- */
// jednorazová animácia sa zrýchli, aby sa zmestila do framu timeline (view.ms); PowerUp sa točí dookola
// mŕtvy Shrek: po páde donekonečna točí posledné framy s hviezdičkami okolo hlavy (STAR_FRAMES)
const STAR_FRAMES = 3;
function frameIndex(m, now) {
  const stars = () => m.frames - STAR_FRAMES + Math.floor(now / 1000 * m.fps) % STAR_FRAMES;
  if (view.anim === "HurtDead" && view.start === 0) return stars(); // reload po smrti - rovno ležiaci
  const fps = view.ms ? Math.max(m.fps, m.frames / (view.ms / 1000)) : m.fps;
  const n = Math.floor((now - view.start) / 1000 * fps);
  if (view.anim === "HurtDead") return n < m.frames ? n : stars();
  return (m.loop || view.anim === "PowerUp") ? n % m.frames : Math.min(m.frames - 1, n);
}

let lastDraw = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const sh = state?.shrek;
  if (!fig || !sh || !ready) return;
  if (perf.lite && now - lastDraw < 33) return; // úsporná grafika: max ~30 FPS
  lastDraw = now;
  // pohyb
  let lift = 0;
  if (view.motion) {
    const mo = view.motion, p = Math.min(1, (now - mo.start) / Math.max(1, mo.ms));
    view.px = mo.from.x + (mo.to.x - mo.from.x) * p;
    view.py = mo.from.y + (mo.to.y - mo.from.y) * p;
    lift = Math.sin(p * Math.PI) * mo.arc;
    if (p >= 1) {
      view.motion = null;
      // návrat po tackli (Walk je slučka) - po dobehnutí späť do Idle, tvárou do stredu dosky
      if (view.anim === "Walk" && !sh.dead) { play("Idle"); view.flip = sh.x >= (state?.board?.w || 4) / 2; }
    }
  }
  // jednorazová animácia dohrala → späť do Idle (mŕtvy ostáva ležať)
  let m = META[view.anim] || META.Idle;
  if (!m) return;
  // výkrik H_Roar je slučka s danou dĺžkou - po nej späť do Idle (inak by po odraze mirrorom ostal kričať)
  const oneShotDone = (!m.loop || view.anim === "H_Roar") && view.anim !== "HurtDead" && view.ms && now - view.start > view.ms + 60;
  if (oneShotDone || (sh.dead && view.anim !== "HurtDead")) { play(sh.dead ? "HurtDead" : "Idle"); if (sh.dead) view.start = 0; m = META[view.anim]; }
  const f = frameIndex(m, now);
  const hurt = now < view.hurtUntil;
  const key = `${view.anim}|${f}|${view.flip}|${hurt}`;
  fig.style.transform = `translate(${Math.round(view.px - CW / 2)}px, ${Math.round(view.py - CH - lift)}px)`;
  hpEl.style.transform = `translate(${Math.round(view.px)}px, ${Math.round(view.py - lift - 180)}px)`;
  if (key === view.lastKey) return;
  view.lastKey = key;
  const g = fig.getContext("2d");
  g.clearRect(0, 0, CW, CH);
  g.imageSmoothingEnabled = false;
  g.save();
  if (view.flip) { g.translate(CW, 0); g.scale(-1, 1); }
  const S = m.size, D = S * K;
  g.drawImage(m.img, f * S, 0, S, S, (CW - D) / 2, CH - D + 2 * K, D, D);
  g.restore();
  fig.classList.toggle("hurt", hurt);
}
requestAnimationFrame(tick);
