// public/client/sound-ui.js - zvukové okno (otvára ho menu ☰ cez openSoundWindow: stlmiť, master / hudba /
// efekty - posuvníky + tlačidlá −/+ po 10 %, na dotyku vo veľkosti displeja) v dizajne knihy-menu (schválený návrh
// public/dev/sound-tome.html: koža s fialovým stehom, oko pri nadpise, MUTE a posuvníky = grimoárové knižky z tome.js,
// MUTE = oválny výrez prázdny / červený, % vo výreze; stlmené = knižky hlasitosti pohasnú) a UI zvuky klikov: jeden
// delegovaný listener namiesto zvuku v každom handleri tlačidla (LOCK IN → ui.lock_in, karta postavy → ui.pick,
// ostatné tlačidlá → ui.click). Klávesa M = stlmiť / zapnúť.
import { sfx, setMusic, getSettings, setSettings, onSettingsChange } from "/client/sound.js";
import { tomeReady, tomeWidgets } from "/client/tome.js";

const ROWS = [["master", "MASTER"], ["music", "MUSIC"], ["sfx", "SFX"]];
const backdrop = document.createElement("div");
backdrop.className = "ui-backdrop hidden";
const win = document.createElement("div");
win.id = "sound-win";
win.className = "ui-modal tome hidden";
win.setAttribute("role", "dialog");
win.setAttribute("aria-label", "Sound");
win.innerHTML = `
  <div class="um-head"><span class="ttl"><canvas class="eye"></canvas>SOUND</span><button type="button" class="um-close" aria-label="Close">✕</button></div>
  <div class="snd-list">
    <button type="button" class="snd-book snd-mute" aria-label="Mute"><canvas class="ib-art"></canvas><span class="snd-mute-lbl">MUTE</span><span class="slot mute"></span></button>
    ${ROWS.map(([k, label]) => `
    <div class="snd-book snd-row"><canvas class="ib-art"></canvas>
      <span class="snd-label">${label}</span>
      <button type="button" class="snd-step" data-k="${k}" data-d="-0.1" aria-label="${label} −">−</button>
      <input type="range" min="0" max="1" step="0.05" data-k="${k}" aria-label="${label}" />
      <button type="button" class="snd-step" data-k="${k}" data-d="0.1" aria-label="${label} +">+</button>
      <span class="slot snd-val" data-v="${k}"></span>
    </div>`).join("")}
  </div>`;
document.body.appendChild(backdrop);
document.body.appendChild(win);

// menu hudba až po prihlásení (na prihlasovacej obrazovke ticho): hrá v room browseri (rozbehne sa prvým klikom);
// v hre ju prepína syncMusic podľa fázy
const loginEl = document.getElementById("login"), roomsEl = document.getElementById("rooms");
const shown = (el) => !!el && !el.classList.contains("hidden");
function syncLoginMusic() {
  if (shown(loginEl)) setMusic(null);
  else if (shown(roomsEl)) setMusic("music.menu");
}
for (const el of [loginEl, roomsEl]) if (el) new MutationObserver(syncLoginMusic).observe(el, { attributes: true, attributeFilter: ["class"] });
syncLoginMusic();

// kresby knihy (oko, koža knižiek) - kreslia sa len kým je okno otvorené
let widgets = [], raf = 0;
tomeReady.then(() => { widgets = tomeWidgets(win); });
function loop(t) { raf = 0; if (win.classList.contains("hidden")) return; for (const f of widgets) f?.(t); raf = requestAnimationFrame(loop); }
export function openSoundWindow() { backdrop.classList.remove("hidden"); win.classList.remove("hidden"); if (!raf) raf = requestAnimationFrame(loop); }
export function closeSoundWindow() { backdrop.classList.add("hidden"); win.classList.add("hidden"); }

function render(s = getSettings()) {
  for (const inp of win.querySelectorAll("input[type=range]")) { inp.value = s[inp.dataset.k]; inp.style.setProperty("--pct", `${inp.value * 100}%`); }
  for (const v of win.querySelectorAll(".snd-val")) v.textContent = `${Math.round((s[v.dataset.v] ?? 0) * 100)}%`;
  win.querySelector(".slot.mute").classList.toggle("on", !!s.muted); // stlmené = červený výrez
  win.querySelector(".snd-list").classList.toggle("muted", !!s.muted); // a knižky hlasitosti pohasnú
}
render();
onSettingsChange(render);

win.addEventListener("input", (ev) => {
  const inp = ev.target;
  if (!inp.dataset.k) return;
  inp.style.setProperty("--pct", `${inp.value * 100}%`);
  setSettings({ [inp.dataset.k]: Number(inp.value) });
});
// pustenie posuvníka efektov zahrá ukážku (nech je počuť, ako hlasno to je)
win.addEventListener("change", (ev) => { if (ev.target.dataset.k === "sfx" || ev.target.dataset.k === "master") sfx("ui.click"); });
win.addEventListener("click", (ev) => {
  const step = ev.target.closest(".snd-step");
  if (step) {
    const k = step.dataset.k, v = Math.round(((getSettings()[k] ?? 0) + Number(step.dataset.d)) * 10) / 10;
    setSettings({ [k]: Math.max(0, Math.min(1, v)) });
  }
  if (ev.target.closest(".snd-mute")) setSettings({ muted: !getSettings().muted });
  if (ev.target.closest(".um-close")) closeSoundWindow();
});
backdrop.addEventListener("click", closeSoundWindow);
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") closeSoundWindow(); });
// M = stlmiť / zapnúť (mimo textových polí)
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "m" && ev.key !== "M") return;
  if (ev.target.closest?.("input, textarea, select, [contenteditable]")) return;
  setSettings({ muted: !getSettings().muted });
});

// UI kliky - capture, aby zazneli aj keď handler tlačidla zastaví propagáciu
document.addEventListener("click", (ev) => {
  const t = ev.target.closest?.("button, .btn, .char-card, [role=button]");
  if (!t || t.disabled || win.contains(t)) return;
  if (t.id === "lock") sfx("ui.lock_in");
  else if (t.classList.contains("char-card")) sfx("ui.pick");
  else sfx("ui.click");
}, true);
// −/+ v okne: krátka ukážka hlasitosti (ako pustenie posuvníka)
win.addEventListener("click", (ev) => { const k = ev.target.closest(".snd-step")?.dataset.k; if (k === "sfx" || k === "master") sfx("ui.click"); });
