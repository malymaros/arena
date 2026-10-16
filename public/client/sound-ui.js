// public/client/sound-ui.js - ovládanie zvuku v hre (tlačidlo 🔊 vľavo dole + panel: stlmiť, master / hudba /
// efekty) a UI zvuky klikov: jeden delegovaný listener namiesto zvuku v každom handleri tlačidla
// (LOCK IN → ui.lock_in, karta postavy → ui.pick, ostatné tlačidlá → ui.click).
import { sfx, setMusic, getSettings, setSettings, onSettingsChange } from "/client/sound.js";

const wrap = document.createElement("div");
wrap.id = "sound-ctl";
wrap.innerHTML = `
  <button type="button" class="snd-toggle" title="Sound settings" aria-label="Sound settings"></button>
  <div class="snd-panel hidden" role="dialog" aria-label="Sound">
    <label class="snd-row snd-mute"><input type="checkbox" data-k="muted" /> MUTE</label>
    <label class="snd-row">MASTER <input type="range" min="0" max="1" step="0.05" data-k="master" /></label>
    <label class="snd-row">MUSIC  <input type="range" min="0" max="1" step="0.05" data-k="music" /></label>
    <label class="snd-row">SFX    <input type="range" min="0" max="1" step="0.05" data-k="sfx" /></label>
  </div>`;
document.body.appendChild(wrap);

// menu hudba už od prihlásenia / room-browsera (rozbehne sa prvým klikom); v hre ju prepína syncMusic podľa fázy
setMusic("music.menu");

const toggle = wrap.querySelector(".snd-toggle");
const panel = wrap.querySelector(".snd-panel");

function render(s = getSettings()) {
  toggle.textContent = s.muted || s.master === 0 ? "🔇" : "🔊";
  for (const inp of wrap.querySelectorAll("input")) {
    if (inp.type === "checkbox") inp.checked = !!s[inp.dataset.k];
    else inp.value = s[inp.dataset.k];
  }
}
render();
onSettingsChange(render);

toggle.addEventListener("click", () => panel.classList.toggle("hidden"));
wrap.addEventListener("input", (ev) => {
  const inp = ev.target;
  if (!inp.dataset.k) return;
  setSettings({ [inp.dataset.k]: inp.type === "checkbox" ? inp.checked : Number(inp.value) });
});
// pustenie posuvníka efektov zahrá ukážku (nech je počuť, ako hlasno to je)
wrap.addEventListener("change", (ev) => { if (ev.target.dataset.k === "sfx" || ev.target.dataset.k === "master") sfx("ui.click"); });
// klik mimo panelu ho zavrie
document.addEventListener("pointerdown", (ev) => { if (!wrap.contains(ev.target)) panel.classList.add("hidden"); });
// M = stlmiť / zapnúť (mimo textových polí)
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "m" && ev.key !== "M") return;
  if (ev.target.closest?.("input, textarea, select, [contenteditable]")) return;
  setSettings({ muted: !getSettings().muted });
});

// UI kliky - capture, aby zazneli aj keď handler tlačidla zastaví propagáciu
document.addEventListener("click", (ev) => {
  const t = ev.target.closest?.("button, .btn, .char-card, [role=button]");
  if (!t || t.disabled || wrap.contains(t)) return;
  if (t.id === "lock") sfx("ui.lock_in");
  else if (t.classList.contains("char-card")) sfx("ui.pick");
  else sfx("ui.click");
}, true);
