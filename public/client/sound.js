// public/client/sound.js - zvukový engine: efekty cez Web Audio (dekódované buffre, variácie, panoráma podľa
// stĺpca, prispôsobenie oknu akcie - fit.js), hudba cez <audio> slučku s prelínaním, nastavenia hlasitosti.
// Zvuky sa skladajú z VRSTIEV (vyššia prebíja nižšiu, kľúč po kľúči):
//   1. základ       - public/sounds/manifest.js (cesty k /sounds/)
//   2. aktívny balík - nainštalovaný vlastníkom (public/sounds/packs/index.js → packs/<id>/<verzia>/pack.json)
//   3. koncept       - rozpracovaný balík zo Sound Labu (IndexedDB), len ak je v labe zapnuté „Vyskúšať v hre“
// Bez závislostí na hernom stave - importuje ho aj sound-lab. ČO hrá KEDY: public/sounds/events.js.
import { SOUNDS } from "/sounds/manifest.js";
import { fitPlan, defaultFit } from "/sounds/fit.js";
import { trimOf, loopXfade } from "/sounds/trim.js";
import { loadDraft, draftUrlResolver, isPreviewOn } from "/sounds/draft-store.js";

const SETTINGS_KEY = "arena.sound";
const DEFAULTS = { master: 0.8, sfx: 0.8, music: 0.5, muted: false };

// localStorage môže hodiť (súkromné okno, zablokované dáta) - zvuk musí fungovať aj bez neho
const load = (k, def) => { try { const v = JSON.parse(localStorage.getItem(k)); return v && typeof v === "object" ? v : def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* bez trvalého uloženia */ } };

let settings = { ...DEFAULTS, ...load(SETTINGS_KEY, {}) };
const listeners = new Set();

export function getSettings() { return { ...settings }; }
export function setSettings(patch) {
  settings = { ...settings, ...patch };
  save(SETTINGS_KEY, settings);
  applyMusicVolume();
  listeners.forEach(fn => fn(settings));
}
export function onSettingsChange(fn) { listeners.add(fn); }

/* ---------- vrstvy ---------- */
// vrstva = { name, entries: { kľúč: { ...položka, urls: [...], trims: [[začiatok, koniec] | null, ...] } } }
const layerOf = (name, entries, toUrl) => ({
  name,
  entries: Object.fromEntries(Object.entries(entries || {}).map(([k, e]) => [k, {
    ...e, urls: (e.files || []).map(toUrl), trims: (e.files || []).map(f => trimOf(e, f)),
  }])),
});
const layers = { base: layerOf("base", SOUNDS, f => `/sounds/${f}`), pack: null, draft: null };
let activePack = null; // { id, version, name } nainštalovaného aktívneho balíka

export function getActivePack() { return activePack; }
// koncept z labu (lab ho nastavuje priamo, hra pri štarte z IndexedDB); null = vypnúť
export function setDraftLayer(entries, toUrl) {
  layers.draft = entries ? layerOf("draft", entries, toUrl) : null;
  restartMusicIfChanged();
}
// položka s `urls` (+ `layer`) - najvyššia vrstva, ktorá kľúč má
export function entryFor(key) {
  for (const name of ["draft", "pack", "base"]) {
    const e = layers[name]?.entries[key];
    if (e) return { ...e, layer: name };
  }
  return null;
}
// kľúč postavy prebíja všeobecný: "special.fire" → "special"; prázdne files = vedomé ticho (nespadne na fallback)
export function resolveKey(key, char) {
  if (char && entryFor(`${key}.${char}`)) return `${key}.${char}`;
  return entryFor(key) ? key : null;
}

// aktívny balík + koncept sa načítajú asynchrónne; do tej doby hrá základ
export const soundReady = (async () => {
  try {
    const { ACTIVE } = await import("/sounds/packs/index.js");
    if (ACTIVE?.id) {
      const dir = `/sounds/packs/${ACTIVE.id}/${ACTIVE.version}/`;
      const pack = await fetch(`${dir}pack.json`).then(r => (r.ok ? r.json() : null));
      if (pack) { layers.pack = layerOf("pack", pack.entries, f => dir + f); activePack = { id: pack.id, version: pack.version, name: pack.name }; }
    }
  } catch { /* bez nainštalovaného balíka hrá základ */ }
  try {
    if (isPreviewOn() && !location.pathname.endsWith("sound-lab.html")) {
      const draft = await loadDraft();
      if (draft) layers.draft = layerOf("draft", draft.entries, await draftUrlResolver());
    }
  } catch { /* IndexedDB nedostupná */ }
  restartMusicIfChanged();
})();

/* ---------- Web Audio ---------- */
let ctx = null, sfxBus = null;
const buffers = new Map(); // url → Promise<AudioBuffer|null>

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  sfxBus = ctx.createGain();
  sfxBus.connect(ctx.destination);
  return ctx;
}
function loadBuffer(url) {
  if (!buffers.has(url)) {
    buffers.set(url, fetch(url)
      .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then(b => ctx.decodeAudioData(b))
      .catch(() => null)); // chýbajúci/poškodený súbor = ticho, nie výnimka v prehrávaní kola
  }
  return buffers.get(url);
}
// predbežné načítanie efektov po prvom geste (aby prvý zásah nemal oneskorenie dekódovania)
function preloadAll() {
  const keys = new Set(Object.values(layers).flatMap(l => (l ? Object.keys(l.entries) : [])));
  for (const key of keys) {
    if (key.startsWith("music.")) continue;
    for (const u of entryFor(key)?.urls || []) loadBuffer(u);
  }
}

// prehliadač pustí zvuk až po interakcii používateľa - prvé gesto odomkne kontext aj odloženú hudbu
let unlocked = false;
function unlock() {
  if (unlocked) return;
  if (!ensureCtx()) return;
  unlocked = true;
  ctx.resume?.();
  soundReady.then(preloadAll);
  if (currentMusicKey && !music) startMusicEl();
}
for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, { capture: true, passive: true });

const lastPlayed = new Map(); // kľúč → čas (poistka proti zdvojeniu toho istého zvuku v jednom momente)

// prehraj efekt `key` (s kľúčom postavy `char`), `pan` -1 (vľavo) … 1 (vpravo); `windowMs` = okno akcie
// (events.js) - zvuk sa mu prispôsobí podľa režimu fit položky (fit.js)
export function sfx(key, { char = null, pan = 0, volume = 1, windowMs = null } = {}) {
  if (settings.muted || !unlocked) return;
  const k = resolveKey(key, char);
  if (!k) return;
  const now = performance.now();
  if (now - (lastPlayed.get(k) || 0) < 60) return;
  lastPlayed.set(k, now);
  const e = entryFor(k);
  const urls = e?.urls || [];
  if (!urls.length) return;
  const i = Math.floor(Math.random() * urls.length);
  const jitter = /^(game|round|music)\./.test(k) ? 0 : 0.04; // jemná zmena výšky - opakované kroky neznejú ako stroj
  return playUrl(urls[i], (e.vol ?? 1) * volume, { pan, rate: 1 + (Math.random() * 2 - 1) * jitter, windowMs, fit: e.fit || defaultFit(k), trim: e.trims?.[i] });
}

const activeSources = new Set(); // práve hrajúce efekty (stopAllSfx - Sound Lab „Stop“)

// nízkoúrovňové prehratie (lab ním skúša knižnicu); hlasitosť = vol × efekty × master
// → Promise<{ stop(), ended: Promise }> | null (súbor sa nedá načítať)
// trim = [začiatokMs, koniecMs] - prehrá len hlavnú časť súboru (trim.js)
export function playUrl(url, vol = 1, { pan = 0, rate = 1, windowMs = null, fit = "keep", trim = null } = {}) {
  if (!ensureCtx()) return Promise.resolve(null);
  if (!unlocked) unlock();
  return loadBuffer(url).then(buf => {
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const offMs = trim ? Math.min(trim[0], buf.duration * 1000) : 0;
    const partMs = (trim ? Math.min(trim[1], buf.duration * 1000) : buf.duration * 1000) - offMs; // dĺžka úseku v čase súboru
    const plan = fitPlan(partMs / rate, windowMs, fit);
    src.playbackRate.value = rate * plan.rate;
    const g = ctx.createGain();
    const level = Math.max(0, vol) * settings.sfx * settings.master;
    g.gain.value = level;
    const t0 = ctx.currentTime;
    if (plan.fadeAtMs != null) {
      g.gain.setValueAtTime(level, t0 + plan.fadeAtMs / 1000);
      g.gain.linearRampToValueAtTime(0, t0 + plan.playMs / 1000);
    }
    let node = src.connect(g);
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node = node.connect(p);
    }
    node.connect(sfxBus);
    const realMs = plan.playMs ?? partMs / (rate * plan.rate); // reálne trvanie prehrávania
    src.start(t0, offMs / 1000);
    src.stop(t0 + realMs / 1000);
    activeSources.add(src);
    const ended = new Promise(res => { src.onended = () => { activeSources.delete(src); res(); }; });
    return { stop: () => { try { src.stop(); } catch { /* už dohral */ } }, ended };
  });
}
// zastaví všetky práve hrajúce efekty (hudbu nie)
export function stopAllSfx() {
  for (const src of activeSources) { try { src.stop(); } catch { /* už dohral */ } }
  activeSources.clear();
}
// súbor z /sounds/ (cesta ako v registri)
export function playFile(file, vol = 1, opts = {}) { playUrl(`/sounds/${file}`, vol, opts); }

// dĺžka v ms (dekódovaný buffer; null = nedá sa načítať) - Sound Lab ju porovnáva s oknom z hry
export function urlDuration(url) {
  if (!ensureCtx()) return Promise.resolve(null);
  return loadBuffer(url).then(buf => (buf ? Math.round(buf.duration * 1000) : null));
}
// dekódovaný zvuk (Sound Lab z neho počíta orezanie - trim.js); null = nedá sa načítať
export function urlBuffer(url) {
  if (!ensureCtx()) return Promise.resolve(null);
  return loadBuffer(url);
}
// zabudni dekódovaný buffer (lab po zmene obsahu nahraného súboru pod rovnakou cestou)
export function forgetUrl(url) { buffers.delete(url); }

/* ---------- hudba ---------- */
let currentMusicKey = null;
let currentMusicUrl = null;
let music = null;        // práve hrajúca slučka (loopPlayer)
const FADE_MS = 900;

function musicTargetVolume() {
  const e = entryFor(currentMusicKey);
  return settings.muted ? 0 : (e?.vol ?? 1) * settings.music * settings.master;
}
// fade ide cez časovač, NIE requestAnimationFrame: ten v skrytej karte stojí - prelínanie slučky by zamrzlo
// a nová slučka by ostala potichu. Krivka "in"/"out" = rovnaký výkon (sin/cos) - pri prelínaní konca so
// začiatkom nevznikne prepad hlasitosti v strede (lineárne prelínanie dvoch rôznych úsekov je o ~3 dB tichšie).
function fade(el, to, ms, done, curve = "linear") {
  const from = el.volume, t0 = performance.now();
  const shape = curve === "in" ? (k) => Math.sin(k * Math.PI / 2)
    : curve === "out" ? (k) => 1 - Math.cos(k * Math.PI / 2)
    : (k) => k;
  const tick = () => {
    const k = ms > 0 ? Math.min(1, (performance.now() - t0) / ms) : 1;
    el.volume = Math.max(0, Math.min(1, from + (to - from) * shape(k)));
    if (k < 1) el._fadeT = setTimeout(tick, 25); else done?.();
  };
  clearTimeout(el._fadeT);
  tick();
}
// slučka hudby: hrá úsek [trim začiatok, trim koniec] (bez trim celý súbor) a LOOP_XFADE pred koncom spustí
// druhý prehrávač od začiatku úseku a oba prelínia - skladba nestíchne ani neskočí (aj keď má tichý koniec
// alebo mp3 medzeru). fromMs = odkiaľ začať prvé prehratie (lab: kúsok pred koncom = počuť prechod).
export function playMusicLoop(url, trim, volume, { fadeInMs = FADE_MS, fromMs = null } = {}) {
  let alive = true, vol = volume;
  const startMs = trim?.[0] || 0;
  const spawn = (atMs, fadeMs, curve) => {
    const el = new Audio(url);
    el.preload = "auto";
    el.volume = fadeMs ? 0 : vol;
    const go = () => {
      el.currentTime = atMs / 1000;
      el.play().catch(() => { /* autoplay zablokovaný - spustí sa pri ďalšom geste */ });
      if (fadeMs) fade(el, vol, fadeMs, null, curve);
    };
    if (el.readyState >= 1) go(); else el.addEventListener("loadedmetadata", go, { once: true });
    // poistka: ak súbor dobehol bez odovzdania (časovač prišiel neskoro), hneď pokračuj od začiatku úseku
    el.addEventListener("ended", () => { if (alive && el === cur) cur = spawn(startMs, 0); });
    return el;
  };
  let cur = spawn(fromMs ?? startMs, fadeInMs);
  const timer = setInterval(() => {
    if (!alive || !cur.duration || cur.paused) return;
    const endMs = Math.min(trim?.[1] ?? Infinity, cur.duration * 1000);
    const xf = loopXfade(endMs - startMs);
    if (!cur._handoff && cur.currentTime * 1000 >= endMs - xf) {
      cur._handoff = true;
      const old = cur;
      // zvyšok do konca úseku (časovač mohol prísť neskoro) - nový prehrávač naberá rovnako dlho
      const left = Math.max(50, endMs - old.currentTime * 1000);
      cur = spawn(startMs, left, "in");
      fade(old, 0, left, () => { old.pause(); old.src = ""; }, "out");
    }
  }, 50);
  return {
    url,
    stop(ms = FADE_MS) {
      alive = false;
      clearInterval(timer);
      const el = cur;
      fade(el, 0, ms, () => { el.pause(); el.src = ""; });
    },
    setVolume(v) { vol = v; clearTimeout(cur._fadeT); cur.volume = Math.max(0, Math.min(1, v)); },
    position() { return Math.round(cur.currentTime * 1000); }, // ms v súbore (lab, test slučky)
  };
}
function stopMusicEl() {
  music?.stop(FADE_MS);
  music = null;
  currentMusicUrl = null;
}
function startMusicEl() {
  const e = entryFor(currentMusicKey);
  const urls = e?.urls || [];
  if (!urls.length || !unlocked) return;
  const i = Math.floor(Math.random() * urls.length);
  currentMusicUrl = urls[i];
  music = playMusicLoop(urls[i], e.trims?.[i], musicTargetVolume());
}
// prepni hudbu na `key` (null = ticho); `fallback` sa použije, ak `key` nemá súbory (napr. music.final → music.battle)
export function setMusic(key, fallback = null) {
  if (key && !(entryFor(key)?.urls || []).length) key = fallback;
  if (key === currentMusicKey) return;
  stopMusicEl();
  currentMusicKey = key;
  if (key) startMusicEl();
}
// vrstvy sa zmenili (načítaný balík / koncept) - ak aktuálna hudba má teraz iný súbor, prelínaj na nový
function restartMusicIfChanged() {
  if (!currentMusicKey) return;
  const urls = entryFor(currentMusicKey)?.urls || [];
  if (currentMusicUrl && urls.includes(currentMusicUrl)) return;
  const k = currentMusicKey;
  stopMusicEl();
  currentMusicKey = null;
  setMusic(k);
}
function applyMusicVolume() { music?.setVolume(musicTargetVolume()); }
