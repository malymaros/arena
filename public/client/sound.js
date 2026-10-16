// public/client/sound.js - zvukový engine: efekty cez Web Audio (dekódované buffre, variácie, panoráma podľa
// stĺpca), hudba cez <audio> slučku s prelínaním, nastavenia hlasitosti (localStorage) a lokálne PREPISY
// z /sound-lab.html (vlastník si v labe priradí iný súbor a hneď ho počuje v hre - kým zmenu nezapíše do
// public/sounds/manifest.js). Bez závislostí na hernom stave - importuje ho aj sound-lab.
// ČO hrá KEDY je v public/client/sound-map.js; ktorý SÚBOR v public/sounds/manifest.js.
import { SOUNDS } from "/sounds/manifest.js";

const SETTINGS_KEY = "arena.sound";
const OVERRIDES_KEY = "arena.soundOverrides";
const DEFAULTS = { master: 0.8, sfx: 0.8, music: 0.5, muted: false };

// localStorage môže hodiť (súkromné okno, zablokované dáta) - zvuk musí fungovať aj bez neho
const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === "object" ? v : def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez trvalého uloženia */ } };

let settings = { ...DEFAULTS, ...load(SETTINGS_KEY, {}) };
let overrides = load(OVERRIDES_KEY, {});
const listeners = new Set();

export function getSettings() { return { ...settings }; }
export function setSettings(patch) {
  settings = { ...settings, ...patch };
  save(SETTINGS_KEY, settings);
  applyMusicVolume();
  listeners.forEach(fn => fn(settings));
}
export function onSettingsChange(fn) { listeners.add(fn); }

/* ---------- register + prepisy ---------- */
export function getOverrides() { return { ...overrides }; }
export function setOverride(key, entry) {
  if (entry) overrides[key] = entry; else delete overrides[key];
  save(OVERRIDES_KEY, overrides);
  if (key.startsWith("music.") && currentMusicKey === key) { const k = currentMusicKey; currentMusicKey = null; setMusic(k); }
}
export function clearOverrides() { overrides = {}; save(OVERRIDES_KEY, overrides); }
// položka registra s prípadným prepisom z labu
export function entryFor(key) { return overrides[key] || SOUNDS[key] || null; }
// kľúč postavy prebíja všeobecný: "special.fire" → "special"; prázdne files = vedomé ticho (nespadne na fallback)
export function resolveKey(key, char) {
  if (char && entryFor(`${key}.${char}`)) return `${key}.${char}`;
  return entryFor(key) ? key : null;
}

/* ---------- Web Audio ---------- */
let ctx = null, sfxBus = null;
const buffers = new Map(); // cesta → Promise<AudioBuffer|null>

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  sfxBus = ctx.createGain();
  sfxBus.connect(ctx.destination);
  return ctx;
}
function loadBuffer(file) {
  if (!buffers.has(file)) {
    buffers.set(file, fetch(`/sounds/${file}`)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then(b => ctx.decodeAudioData(b))
      .catch(() => null)); // chýbajúci/poškodený súbor = ticho, nie výnimka v prehrávaní kola
  }
  return buffers.get(file);
}
// predbežné načítanie všetkých efektov po prvom geste (aby prvý zásah nemal oneskorenie dekódovania)
function preloadAll() {
  for (const key of Object.keys(SOUNDS)) {
    if (key.startsWith("music.")) continue;
    for (const f of entryFor(key)?.files || []) loadBuffer(f);
  }
}

// prehliadač pustí zvuk až po interakcii používateľa - prvé gesto odomkne kontext aj odloženú hudbu
let unlocked = false;
function unlock() {
  if (unlocked) return;
  if (!ensureCtx()) return;
  unlocked = true;
  ctx.resume?.();
  preloadAll();
  if (currentMusicKey) startMusicEl(true);
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { capture: true, passive: true });

const lastPlayed = new Map(); // kľúč → čas (poistka proti zdvojeniu toho istého zvuku v jednom momente)

// prehraj efekt `key` (s kľúčom postavy `char`), `pan` -1 (vľavo) … 1 (vpravo)
export function sfx(key, { char = null, pan = 0, volume = 1 } = {}) {
  if (settings.muted || !unlocked) return;
  const k = resolveKey(key, char);
  if (!k) return;
  const now = performance.now();
  if (now - (lastPlayed.get(k) || 0) < 60) return;
  lastPlayed.set(k, now);
  const e = entryFor(k);
  const files = e?.files || [];
  if (!files.length) return;
  const file = files[Math.floor(Math.random() * files.length)];
  const jitter = /^(game|round|music)\./.test(k) ? 0 : 0.04; // jemná zmena výšky - opakované kroky neznejú ako stroj
  playFile(file, (e.vol ?? 1) * volume, { pan, rate: 1 + (Math.random() * 2 - 1) * jitter });
}

// nízkoúrovňové prehratie súboru (lab ním skúša knižnicu); hlasitosť = vol × efekty × master
export function playFile(file, vol = 1, { pan = 0, rate = 1 } = {}) {
  if (!ensureCtx()) return;
  if (!unlocked) unlock();
  loadBuffer(file).then(buf => {
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, vol) * settings.sfx * settings.master;
    let node = src.connect(g);
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    node.connect(sfxBus);
    src.start();
  });
}

/* ---------- hudba ---------- */
let currentMusicKey = null;
let musicEl = null;      // práve hrajúci <audio>
const FADE_MS = 900;

function musicTargetVolume() {
  const e = entryFor(currentMusicKey);
  return settings.muted ? 0 : (e?.vol ?? 1) * settings.music * settings.master;
}
function fade(el, to, ms, done) {
  const from = el.volume, t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) el._fadeRaf = requestAnimationFrame(tick); else done?.();
  };
  cancelAnimationFrame(el._fadeRaf);
  tick();
}
function stopMusicEl() {
  const el = musicEl;
  musicEl = null;
  if (el) fade(el, 0, FADE_MS, () => { el.pause(); el.src = ""; });
}
function startMusicEl(fadeIn) {
  const files = entryFor(currentMusicKey)?.files || [];
  if (!files.length || !unlocked) return;
  const el = new Audio(`/sounds/${files[Math.floor(Math.random() * files.length)]}`);
  el.loop = true;
  el.volume = fadeIn ? 0 : musicTargetVolume();
  el.play().catch(() => { /* autoplay zablokovaný - spustí sa pri ďalšom geste */ });
  musicEl = el;
  if (fadeIn) fade(el, musicTargetVolume(), FADE_MS);
}
// prepni hudbu na `key` (null = ticho); `fallback` sa použije, ak `key` nemá súbory (napr. music.final → music.battle)
export function setMusic(key, fallback = null) {
  if (key && !(entryFor(key)?.files || []).length) key = fallback;
  if (key === currentMusicKey) return;
  stopMusicEl();
  currentMusicKey = key;
  if (key) startMusicEl(true);
}
function applyMusicVolume() {
  if (musicEl) { cancelAnimationFrame(musicEl._fadeRaf); musicEl.volume = musicTargetVolume(); }
}
