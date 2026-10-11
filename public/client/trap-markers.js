// public/client/trap-markers.js - pasca Countess/Onryō: statická hlava castera v strede bunky (vidí ju len caster;
// server súperovi pascu z dát odstraňuje).
import { gridEl, actorsEl, TILE_W, GAP, TILE_H, cellToPx } from "/client/dom.js";
import { usesAltColor, charDirFor, ensureSpriteMeta, ANIM_DEF } from "/client/sprites.js";
import { HEAD_CROP } from "/chars/index.js";
import { board } from "/client/session.js";

/* ---------- Pasca (Countess/Onre) - statická hlava castera v strede bunky ---------- */
// kreslí sa len tomu, komu server player.trap NEredigoval (caster; divák vidí oboch);
// grid sa maže každý render, marker sa preto vkladá nanovo (výrez hlavy je cachovaný cez SPRITES)
export function renderTrapMarkers(s) {
  for (const sl of ["p1", "p2"]) {
    const t = s?.[sl]?.trap;
    const char = s?.[sl]?.char;
    if (!t || !char) continue;
    const cellEl = gridEl.querySelector(`.cell[data-x="${t.x}"][data-y="${t.y}"]`);
    if (!cellEl) continue;
    const cvs = document.createElement("canvas");
    cvs.className = "trap-marker";
    cvs.width = 88; cvs.height = 88;
    if (usesAltColor(char, sl)) cvs.classList.add("alt-color");
    cellEl.appendChild(cvs);
    drawTrapHead(cvs, char, sl);
  }
}
// statický výrez hlavy z Idle frame 0 (rovnaký crop ako HUD hlavy, len bez animácie)
function drawTrapHead(cvs, char, slot) {
  const dir = charDirFor(char, slot);
  const c = HEAD_CROP[char];
  if (!dir || !c) return;
  ensureSpriteMeta(dir, ANIM_DEF.idle.file).then(meta => {
    if (!cvs.isConnected) return; // grid sa medzitým prekreslil
    const ctx = cvs.getContext("2d");
    const fw = meta.fw, fh = meta.fh, side = fh * c.size;
    let sx = fw * c.cx - side / 2, sy = fh * c.cy - side / 2;
    sx = Math.max(0, Math.min(fw - side, sx));
    sy = Math.max(0, Math.min(fh - side, sy));
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.drawImage(meta.img, sx, sy, side, side, 0, 0, cvs.width, cvs.height);
  }).catch(() => {});
}

// Ariadnina niť ako súvislá čiara cez stredy navštívených buniek (+ uzlík na začiatku);
// kreslí sa pre oboch hráčov - komu ju server neredigoval, ten ju vidí
export function renderThreadLines(s) {
  actorsEl.querySelectorAll(".thread-svg").forEach(n => n.remove());
  const W = board.w * TILE_W + (board.w - 1) * GAP;
  const H = board.h * TILE_H + (board.h - 1) * GAP;
  for (const sl of ["p1", "p2"]) {
    const th = s?.[sl]?.thread;
    if (!Array.isArray(th) || !th.length) continue;
    const pts = th.map(([x, y]) => {
      const { left, top } = cellToPx(x, y);
      return [left + TILE_W / 2, top + TILE_H / 2];
    });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "thread-svg");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    const poly = pts.length > 1
      ? `<polyline points="${pts.map(p => p.join(",")).join(" ")}" fill="none" stroke="#e8b23c" stroke-width="5" stroke-dasharray="14 10" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>`
      : "";
    svg.innerHTML = `${poly}<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="9" fill="#e8b23c" opacity=".9"/>`;
    actorsEl.appendChild(svg);
  }
}
