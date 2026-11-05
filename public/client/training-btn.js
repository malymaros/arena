// public/client/training-btn.js - TRAINING GROUNDS v room browseri (schválený návrh public/dev/tutorial.html):
// tlačidlo vpravo hore (slamená cvičná figurína + TRAINING GROUNDS, pevná šírka). Voľná miestnosť → klik otvorí
// okno TRAINING GROUNDS (v dizajne tlačidla: OBJECTIVE + riadky scenárov s počtom kôl) → join_room { scenario }.
// Obsadená (niekto trénuje) → v tlačidle bez textu Fire wizard dáva figuríne melee, klik = sledovať (ako AI roomka).
// Telefón: len figurína / obsadená scéna, šírka rovnaká v oboch stavoch.
import { TRAINING } from "/shared/training.js";
import { sfx } from "/client/sound.js";

/* ---------- cvičná figurína (pixel SVG; obrys sa dopočíta okolo tvaru) ---------- */
export const DUMMY_SVG = (() => {
  const W = 22, H = 27, g = Array.from({ length: H }, () => Array(W).fill(null));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; };
  const disc = (cx, cy, r, c) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) set(x, y, c); };
  for (let y = 15; y <= 23; y++) { set(10, y, "w"); set(11, y, "W"); }                 // kôl
  for (let x = 6; x <= 15; x++) { set(x, 24, "W"); set(x, 25, "W"); }                  // podstavec
  for (let x = 2; x <= 19; x++) { set(x, 10, "w"); set(x, 11, "W"); }                  // ruky (brvno)
  for (const x of [1, 2, 19, 20]) for (let y = 9; y <= 12; y++) set(x, y, "s");        // slama na koncoch rúk
  for (let y = 8; y <= 17; y++) for (let x = 6; x <= 15; x++) if (!((y === 8 || y === 17) && (x === 6 || x === 15))) set(x, y, (x + y) % 5 ? "s" : "S"); // vrece
  disc(10.5, 12.5, 3.4, "r"); disc(10.5, 12.5, 2.3, "R"); disc(10.5, 12.5, 1.1, "r");   // terč
  for (let x = 8; x <= 13; x++) set(x, 7, "t");                                        // povraz na krku
  disc(10.5, 3.6, 3.6, "s");                                                           // hlava
  for (const [x, y] of [[8, 2], [9, 3], [9, 2], [8, 3], [12, 2], [13, 3], [13, 2], [12, 3]]) set(x, y, "k"); // oči
  for (let x = 9; x <= 12; x++) set(x, 5, x % 2 ? "k" : "S");                          // zašité ústa
  const pal = { s: "#f0cd6a", S: "#c99a34", w: "#9a6533", W: "#64401c", t: "#7a5426", r: "#d8322b", R: "#f4efe2", k: "#1a0f06", o: "#000" };
  const empty = (x, y) => y < 0 || x < 0 || y >= H || x >= W || !g[y][x];
  let rects = "";
  for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
    let c = empty(x, y) ? null : g[y][x];
    if (!c && (!empty(x - 1, y) || !empty(x + 1, y) || !empty(x, y - 1) || !empty(x, y + 1))) c = "o";
    if (c) rects += `<rect x="${x + 1}" y="${y + 1}" width="1" height="1" fill="${pal[c]}"/>`;
  }
  return `<svg viewBox="0 0 ${W + 2} ${H + 2}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
})();

/* ---------- obsadené: Fire wizard (melee = Attack_2) mláti figurínu ---------- */
// výrez okolo postavy zo všetkých framov (sheet má veľa prázdneho miesta); načíta sa až pri prvom obsadení
let melee = null, meleeLoading = false;
function loadMelee() {
  if (melee || meleeLoading) return;
  meleeLoading = true;
  const im = new Image();
  im.onload = () => {
    const f = im.height, c = document.createElement("canvas"); c.width = im.width; c.height = f;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0);
    const d = g.getImageData(0, 0, im.width, f).data;
    let x0 = f, y0 = f, x1 = 0, y1 = 0;
    for (let y = 0; y < f; y++) for (let x = 0; x < im.width; x++) {
      if (d[(y * im.width + x) * 4 + 3] <= 20) continue;
      const lx = x % f; x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const side = Math.max(x1 - x0, y1 - y0) + 2;
    melee = { im, f, sx: Math.round((x0 + x1 - side) / 2), sy: y1 + 1 - side, side };
  };
  im.src = "/assets/fire/Attack_2.png";
}
const SEQ = [0, 0, 0, 1, 2, 3, 3, 3]; // nápriahnutie, úder (index 4 = zásah figuríny), dobeh
const STEP_MS = 110;

let btn = null, cvs = null, dummyEl = null, powEl = null, room = null, onPick = null, raf = 0, lastStep = -1, clicked = false;
function build(roomsEl) {
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tg-btn";
  btn.setAttribute("aria-label", "Training grounds");
  btn.innerHTML = `<span class="tg-free">${DUMMY_SVG}<span class="tg-t">TRAINING<span>GROUNDS</span></span></span>
    <span class="tg-scene"><canvas width="80" height="80"></canvas>${DUMMY_SVG}<i class="tg-pow"></i></span>`;
  cvs = btn.querySelector(".tg-scene canvas");
  dummyEl = btn.querySelector(".tg-scene svg");
  powEl = btn.querySelector(".tg-pow");
  btn.addEventListener("click", () => {
    if (!room || clicked) return;
    sfx("ui.click");
    if (room.canJoin) openTraining((n) => { if (!room?.canJoin) return; clicked = true; onPick?.(room, n); });
    else { clicked = true; onPick?.(room, null); } // obsadené → sledovať
  });
  roomsEl.appendChild(btn);
}

function loop(now) {
  raf = 0;
  if (!btn || btn.offsetParent === null || !btn.classList.contains("busy")) return; // skryté / voľné → nekresli
  if (melee) {
    const i = Math.floor(now / STEP_MS) % SEQ.length;
    if (i !== lastStep) {
      lastStep = i;
      const g = cvs.getContext("2d");
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, cvs.width, cvs.height);
      g.drawImage(melee.im, SEQ[i] * melee.f + melee.sx, melee.sy, melee.side, melee.side, 0, 0, cvs.width, cvs.height);
      if (i === 4) for (const [el, k] of [[dummyEl, "hit"], [powEl, "on"]]) { el.classList.remove(k); void el.getBoundingClientRect(); el.classList.add(k); }
    }
  }
  raf = requestAnimationFrame(loop);
}

// net.js pri každom `rooms`: trainingRoom = { id, players, canJoin, training } alebo null;
// pick(room, n) - n = číslo scenára pri vstupe, null pri sledovaní
export function setTrainingBtn(roomsEl, trainingRoom, pick) {
  if (!roomsEl) return;
  if (!btn) build(roomsEl);
  room = trainingRoom; onPick = pick; clicked = false;
  btn.classList.toggle("hidden", !trainingRoom);
  const busy = !!trainingRoom && !trainingRoom.canJoin;
  btn.classList.toggle("busy", busy);
  btn.setAttribute("aria-label", busy ? "Watch training" : "Training grounds");
  if (busy) { closeTraining(); loadMelee(); if (!raf) raf = requestAnimationFrame(loop); } // obsadil ju niekto iný → okno preč
  // LEAVE z okna výsledku → po návrate do room browsera sa okno TRAINING GROUNDS otvorí znova
  let reopen = false;
  try { reopen = sessionStorage.getItem(REOPEN_KEY) === "1"; sessionStorage.removeItem(REOPEN_KEY); } catch { /* bez úložiska */ }
  if (reopen && trainingRoom?.canJoin) btn.click();
}
export const REOPEN_KEY = "arenaTrainingReopen";

/* ---------- okno TRAINING GROUNDS ---------- */
let back = null, choose = null;
function buildWindow() {
  back = document.createElement("div");
  back.className = "tg-back hidden";
  back.innerHTML = `<div class="tg-win" role="dialog" aria-label="Training grounds">
      <button class="tg-close" type="button" aria-label="Back">✕</button>
      <div class="tg-top">${DUMMY_SVG}<h2 class="tg-title">TRAINING<br>GROUNDS</h2></div>
      <p class="tg-sub">OBJECTIVE: <b>Kill your opponent!</b></p>
      <div class="tg-list">${TRAINING.map(s => `<button class="tg-row" type="button" data-n="${s.n}">
        <span class="tg-num">${s.n}</span><span class="tg-name">${s.name}</span>
        <span class="tg-rounds">${s.rounds.length} ROUND${s.rounds.length > 1 ? "S" : ""}</span></button>`).join("")}</div>
    </div>`;
  for (const row of back.querySelectorAll(".tg-row")) {
    row.addEventListener("mouseenter", () => sfx("ui.random_hop")); // zvuková odozva pri prejdení nad scenárom
    row.addEventListener("click", () => { sfx("ui.click"); const cb = choose; closeTraining(); cb?.(Number(row.dataset.n)); });
  }
  back.querySelector(".tg-close").addEventListener("click", () => { sfx("ui.click"); closeTraining(); });
  back.addEventListener("click", (e) => { if (e.target === back) closeTraining(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && back && !back.classList.contains("hidden")) closeTraining(); });
  document.body.appendChild(back); // pevné prekrytie patrí do body (zmenšená virtuálna obrazovka, docs/MOBILE.md)
}
function openTraining(cb) {
  if (!back) buildWindow();
  choose = cb;
  back.classList.remove("hidden");
}
export function closeTraining() { back?.classList.add("hidden"); choose = null; }
