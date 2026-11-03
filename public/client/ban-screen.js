// public/client/ban-screen.js - obrazovka BANNED CHARACTERS (ADVANCED SETTINGS → tlačidlo WHITE: n / BLACK: n;
// schválený návrh public/dev/ban-chars.html, variant E). Rozloženie ako losovanie postáv (char-roll.js: mriežka 4×3
// s menami, skryté postavy fialovo glitchujú, ??? na konci, čierny = zrkadlené hlavy). Klik na hlavu = zakázať /
// povoliť (krížik, zošedne, prestane sa hýbať, meno prečiarknuté); posledná postava farby musí ostať („1 MUST STAY").
// CLEAR zmaže zákazy farby, DONE / Escape zavrie. Zákazy sa menia priamo v poli `bans` (lobby ich uloží).
import { drawMageHeadAnim, mageHeadHtml } from "/client/mage-head.js";
import { usesAltColor } from "/client/sprites.js";
import { SIDE_CHARS } from "/chars/index.js";
import { LAYOUT, rollName } from "/client/char-roll.js";

// pixelový ✕ (ten istý tvar ako ✕ LEAVE ROOM v lobby), 8×8
const X_SVG = `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true"><path d="M0 0h2v1h1v1h2V1h1V0h2v2H7v1H6v2h1v1h1v2H6V7H5V6H3v1H2v1H0V6h1V5h1V3H1V2H0z"/></svg>`;

let root = null, gridEl = null, sideEl = null, msgEl = null, clearBtn = null;
let cur = null; // { slot, bans: [], onDone }
let raf = 0, glitch = 0;

function build() {
  root = document.createElement("div");
  root.id = "ban-screen";
  root.className = "char-roll ban-screen hidden";
  root.innerHTML = `<div class="bs-title">BANNED CHARACTERS</div><div class="rr-title"></div><div class="rr-grid"></div>
    <div class="bs-msg"></div>
    <div class="adv-foot bs-foot"><button class="bs-clear" type="button">${X_SVG}CLEAR</button><button class="lobby-start adv-done bs-done" type="button">DONE</button></div>`;
  sideEl = root.querySelector(".rr-title");
  gridEl = root.querySelector(".rr-grid");
  msgEl = root.querySelector(".bs-msg");
  clearBtn = root.querySelector(".bs-clear");
  root.addEventListener("click", (e) => {
    if (!cur) return;
    if (e.target.closest(".bs-done")) { close(); return; }
    if (e.target.closest(".bs-clear")) { cur.bans.length = 0; msg(""); render(); return; }
    const cell = e.target.closest(".rr-cell[data-char]");
    if (!cell) return;
    const c = cell.dataset.char, i = cur.bans.indexOf(c);
    if (i >= 0) cur.bans.splice(i, 1);
    else if (cur.bans.length >= LAYOUT[cur.slot].filter(Boolean).length - 1) { // posledná postava farby musí ostať
      msg("1 MUST STAY");
      cell.classList.remove("nope"); void cell.offsetWidth; cell.classList.add("nope");
      return;
    } else cur.bans.push(c);
    msg("");
    render();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && cur) close(); });
  document.body.appendChild(root); // pevné prekrytie patrí do body (virtuálna obrazovka, docs/MOBILE.md)
}

const msg = (t) => { msgEl.textContent = t; };

function render() {
  const slot = cur.slot;
  sideEl.className = "rr-title " + (slot === "p1" ? "white" : "black");
  sideEl.textContent = slot === "p1" ? "⚪ WHITE" : "⚫ BLACK";
  root.classList.toggle("p2-side", slot === "p2");
  gridEl.innerHTML = LAYOUT[slot].map((c, i) => c
    ? `<div class="rr-cell${SIDE_CHARS[c] ? " corrupt" : ""}${cur.bans.includes(c) ? " banned" : ""}" data-i="${i}" data-char="${c}"><div class="rr-face">${mageHeadHtml(c, usesAltColor(c, slot) ? "alt-color" : "", slot)}</div><div class="rr-name">${rollName(c)}</div></div>`
    : `<div class="rr-cell future" data-i="${i}"><div class="rr-face"><span class="rr-q">???</span></div><div class="rr-name"></div></div>`).join("");
  clearBtn.disabled = !cur.bans.length;
  // zakázané hlavy stoja - nakreslí sa raz prvý frame a ďalej sa neprekresľujú
  gridEl.querySelectorAll(".rr-cell.banned canvas.mage-head").forEach(cv => drawMageHeadAnim(cv, cv.dataset.char, 0));
}

function loop(now) {
  raf = 0;
  if (!cur) return;
  gridEl.querySelectorAll(".rr-cell:not(.banned) canvas.mage-head").forEach(cv => drawMageHeadAnim(cv, cv.dataset.char, now));
  raf = requestAnimationFrame(loop);
}

// slot = "p1" (biela) | "p2" (čierna); bans = pole zákazov tej farby (mení sa na mieste); onDone po zatvorení
export function openBanScreen(slot, bans, onDone) {
  if (!root) build();
  cur = { slot, bans, onDone };
  msg("");
  render();
  root.classList.remove("hidden");
  if (!raf) raf = requestAnimationFrame(loop);
  clearInterval(glitch);
  glitch = setInterval(() => gridEl.querySelectorAll(".rr-cell.corrupt:not(.banned)").forEach(c => c.classList.toggle("flash", Math.random() < 0.2)), 120);
}

export const banScreenOpen = () => !!cur;

function close() {
  const done = cur?.onDone;
  cur = null;
  clearInterval(glitch); glitch = 0;
  root?.classList.add("hidden");
  done?.();
}
export function closeBanScreen() { if (cur) close(); }
