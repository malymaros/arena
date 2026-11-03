// public/client/maintenance.js - obrazovka MAINTENANCE BREAK: počas údržby server
// bežného hráča nepustí do room browsera (udalosť `maintenance`, net.js) - vidí len hlavu bota s neutrálnou tvárou
// a žltou bublinou. ADMIN LOGIN = späť na prihlásenie (admin heslom sa dá hrať aj počas údržby).
import { drawBotFigure, FIGURE_W, FIGURE_H } from "/client/bot-face.js";

let el = null, cvs = null, raf = 0;

function build() {
  el = document.createElement("div");
  el.id = "maintenance";
  el.className = "maint-screen hidden";
  el.innerHTML = `<div class="maint-bubble">MAINTENANCE BREAK</div>
    <canvas class="maint-head" width="${FIGURE_W * 4}" height="${FIGURE_H * 4}"></canvas>
    <div class="maint-sub">WE'LL BE RIGHT BACK</div>
    <button type="button" class="maint-admin">ADMIN LOGIN</button>`;
  cvs = el.querySelector("canvas");
  el.querySelector(".maint-admin").addEventListener("click", () => {
    try { sessionStorage.removeItem("arenaLogin"); } catch {}
    location.reload(); // bez uloženého prihlásenia sa ukáže prihlasovací formulár
  });
  document.body.appendChild(el);
}

function loop(now) {
  raf = 0;
  if (!el || el.classList.contains("hidden")) return;
  drawBotFigure(cvs, "neutral", now);
  raf = requestAnimationFrame(loop);
}

export function showMaintenance() {
  if (!el) build();
  el.classList.remove("hidden");
  if (!raf) raf = requestAnimationFrame(loop);
}
export function hideMaintenance() { el?.classList.add("hidden"); }
