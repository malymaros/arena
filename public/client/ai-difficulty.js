// public/client/ai-difficulty.js - okno CHOOSE DIFFICULTY (docs/AI_PLAN.md, „Obťažnosť BABY"; schválený návrh
// public/dev/ai-difficulty.html): klik na voľnú hlavu bota v room browseri (lobby-bot.js) ho otvorí ešte pred
// vstupom do AI roomky. BABY (pre deti a úplných začiatočníkov), NORMAL a CHEATER (podvádza - vidí jednu tvoju akciu
// za kolo, docs/AI_PLAN.md 8c; avatar líška, bot-face-fox.js); klik na kartu = onPick(level).
// ✕, klik mimo okna alebo Escape = späť do room browsera. Hlavy kreslí bot-face.js (tie isté ako v hre).
import { drawBotFigure, FIGURE_W, FIGURE_H } from "/client/bot-face.js";

const SCALE = 4;
let back = null, raf = 0, onPick = null, hover = null;
const heads = []; // { cvs, level }

function build() {
  back = document.createElement("div");
  back.className = "ai-diff hidden";
  back.innerHTML = `
    <div class="ai-diff-win" role="dialog" aria-label="Choose difficulty">
      <button class="ai-diff-close" type="button" aria-label="Back">✕</button>
      <h2 class="ai-diff-title">CHOOSE DIFFICULTY</h2>
      <div class="ai-diff-cards">
        <button class="ai-diff-card baby" type="button" data-level="baby"><canvas></canvas><div class="ai-diff-name">BABY</div></button>
        <button class="ai-diff-card normal" type="button" data-level="normal"><canvas></canvas><div class="ai-diff-name">NORMAL</div></button>
        <button class="ai-diff-card cheater" type="button" data-level="cheater"><canvas></canvas><div class="ai-diff-name">CHEATER</div></button>
      </div>
    </div>`;
  for (const card of back.querySelectorAll(".ai-diff-card")) {
    const level = card.dataset.level, cvs = card.querySelector("canvas");
    cvs.width = FIGURE_W * SCALE; cvs.height = FIGURE_H * SCALE;
    heads.push({ cvs, level });
    card.addEventListener("mouseenter", () => { hover = level; });
    card.addEventListener("mouseleave", () => { if (hover === level) hover = null; });
    card.addEventListener("click", () => { const cb = onPick; close(); cb?.(level); });
  }
  back.querySelector(".ai-diff-close").addEventListener("click", () => close());
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) close(); });
  document.body.appendChild(back); // pevné prekrytie patrí do body (zmenšená virtuálna obrazovka, docs/MOBILE.md)
}

function loop(now) {
  raf = 0;
  if (!isOpen()) return;
  for (const h of heads) drawBotFigure(h.cvs, hover === h.level ? "happy" : "neutral", now, { hop: hover === h.level, level: h.level });
  raf = requestAnimationFrame(loop);
}

export const isOpen = () => !!back && !back.classList.contains("hidden");

export function openDifficulty(pick) {
  if (!back) build();
  onPick = pick; hover = null;
  back.classList.remove("hidden");
  if (!raf) raf = requestAnimationFrame(loop);
}

export function closeDifficulty() { close(); }
function close() {
  if (!back) return;
  back.classList.add("hidden");
  onPick = null; hover = null;
}
