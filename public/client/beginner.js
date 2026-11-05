// public/client/beginner.js - BEGINNER mód (shared/beginner.js, schválený návrh public/dev/beginner.html): prepínač
// vľavo hore v room browseri - tri hlavy mágov v okienkach (ako hlavy v HUD) + vypínač; rovnako veľký ako TRAINING
// GROUNDS (PC s nápisom BEGINNER, telefón bez neho). Stav sa pamätá v prehliadači. Zapnutý mód posiela server-u pri
// vytvorení / vstupe do roomky (beginner: true); roomky druhého módu sú zamknuté (room-tiles.js), lobby len Stone
// Bridge bez ADVANCED SETTINGS (lobby.js). Zákazy postáv a arénu vynúti server (sanitizeConfig).
import { BEGINNER_CHARS } from "/shared/beginner.js";
import { drawMageHeadAnim } from "/client/mage-head.js";
import { sfx } from "/client/sound.js";

const KEY = "arena.beginner";
let on = false;
try { on = localStorage.getItem(KEY) === "1"; } catch { /* bez úložiska = vypnutý */ }
const listeners = [];
export const isBeginner = () => on;
export function onBeginnerChange(fn) { listeners.push(fn); }
function setBeginner(v) {
  on = !!v;
  try { localStorage.setItem(KEY, on ? "1" : "0"); } catch { /* bez úložiska */ }
  sync();
  listeners.forEach(fn => fn(on));
}

let btn = null, heads = [], raf = 0;
function build(roomsEl) {
  btn = document.createElement("button");
  btn.type = "button";
  btn.className = "bg-btn";
  const faces = document.createElement("span");
  faces.className = "bg-heads";
  for (const c of BEGINNER_CHARS) {
    const f = document.createElement("span");
    f.className = "bg-face";
    const cvs = document.createElement("canvas");
    cvs.width = 52; cvs.height = 52;
    f.append(cvs);
    faces.append(f);
    heads.push({ cvs, char: c });
  }
  btn.append(faces);
  btn.insertAdjacentHTML("beforeend", `<span class="bg-lbl"><span class="bg-name">BEGINNER</span><span class="bg-sw"><i></i><b></b></span></span>`);
  btn.addEventListener("click", () => { sfx("ui.click"); setBeginner(!on); });
  roomsEl.appendChild(btn);
  sync();
}
function sync() {
  if (!btn) return;
  btn.classList.toggle("on", on);
  btn.querySelector(".bg-sw b").textContent = on ? "ON" : "OFF";
  btn.setAttribute("aria-label", `Beginner mode: ${on ? "on" : "off"}`);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}
function loop(now) {
  raf = 0;
  if (!btn || btn.offsetParent === null) return; // room browser skrytý → nekresli
  for (const h of heads) drawMageHeadAnim(h.cvs, h.char, now);
  raf = requestAnimationFrame(loop);
}
// net.js pri každom zobrazení room browsera
export function showBeginnerBtn(roomsEl) {
  if (!roomsEl) return;
  if (!btn) build(roomsEl);
  if (!raf) raf = requestAnimationFrame(loop);
}
