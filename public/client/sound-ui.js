// public/client/sound-ui.js - zvukové okno (otvára ho menu ☰ cez openSoundWindow: stlmiť, master / hudba /
// efekty - posuvníky + tlačidlá −/+ po 10 %, na dotyku vo veľkosti displeja) a UI zvuky klikov: jeden
// delegovaný listener namiesto zvuku v každom handleri tlačidla (LOCK IN → ui.lock_in, karta postavy → ui.pick,
// ostatné tlačidlá → ui.click). Klávesa M = stlmiť / zapnúť.
import { sfx, setMusic, getSettings, setSettings, onSettingsChange } from "/client/sound.js";

const ROWS = [["master", "MASTER"], ["music", "MUSIC"], ["sfx", "SFX"]];
const backdrop = document.createElement("div");
backdrop.className = "ui-backdrop hidden";
const win = document.createElement("div");
win.id = "sound-win";
win.className = "ui-modal hidden";
win.setAttribute("role", "dialog");
win.setAttribute("aria-label", "Sound");
win.innerHTML = `
  <div class="um-head"><span>SOUND</span><button type="button" class="um-close" aria-label="Close">✕</button></div>
  <label class="snd-mute"><input type="checkbox" data-k="muted" /> MUTE</label>
  ${ROWS.map(([k, label]) => `
  <div class="snd-row">
    <span class="snd-label">${label}</span>
    <button type="button" class="snd-step" data-k="${k}" data-d="-0.1" aria-label="${label} −">−</button>
    <input type="range" min="0" max="1" step="0.05" data-k="${k}" aria-label="${label}" />
    <button type="button" class="snd-step" data-k="${k}" data-d="0.1" aria-label="${label} +">+</button>
    <span class="snd-val" data-v="${k}"></span>
  </div>`).join("")}`;
document.body.appendChild(backdrop);
document.body.appendChild(win);

// menu hudba už od prihlásenia / room-browsera (rozbehne sa prvým klikom); v hre ju prepína syncMusic podľa fázy
setMusic("music.menu");

export function openSoundWindow() { backdrop.classList.remove("hidden"); win.classList.remove("hidden"); }
export function closeSoundWindow() { backdrop.classList.add("hidden"); win.classList.add("hidden"); }

function render(s = getSettings()) {
  for (const inp of win.querySelectorAll("input")) {
    if (inp.type === "checkbox") inp.checked = !!s[inp.dataset.k];
    else { inp.value = s[inp.dataset.k]; inp.style.setProperty("--pct", `${inp.value * 100}%`); }
  }
  for (const v of win.querySelectorAll(".snd-val")) v.textContent = `${Math.round((s[v.dataset.v] ?? 0) * 100)}%`;
}
render();
onSettingsChange(render);

win.addEventListener("input", (ev) => {
  const inp = ev.target;
  if (!inp.dataset.k) return;
  if (inp.type === "range") inp.style.setProperty("--pct", `${inp.value * 100}%`);
  setSettings({ [inp.dataset.k]: inp.type === "checkbox" ? inp.checked : Number(inp.value) });
});
// pustenie posuvníka efektov zahrá ukážku (nech je počuť, ako hlasno to je)
win.addEventListener("change", (ev) => { if (ev.target.dataset.k === "sfx" || ev.target.dataset.k === "master") sfx("ui.click"); });
win.addEventListener("click", (ev) => {
  const step = ev.target.closest(".snd-step");
  if (step) {
    const k = step.dataset.k, v = Math.round(((getSettings()[k] ?? 0) + Number(step.dataset.d)) * 10) / 10;
    setSettings({ [k]: Math.max(0, Math.min(1, v)) });
  }
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
