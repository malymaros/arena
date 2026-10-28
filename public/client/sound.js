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
import { PHASE_SPAN, DIRECT } from "/sounds/events.js";

// kľúče stôp cez celú fázu (pakt, útok démona, vyhnanie, Last Hope) - dlhé repliky hrajú bez náhodnej zmeny tempa
const PHASE_KEYS = new Set(Object.keys(PHASE_SPAN).map(kind => DIRECT[kind]));

const SETTINGS_KEY = "arena.sound";
// predvolené (kým si hráč nič nenastavil): efekty naplno, hudba v pozadí - postavy majú byť počuť (aj z reproduktora mobilu)
const DEFAULTS = { master: 1, sfx: 1, music: 0.3, muted: false };

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

// hudba sa začne načítať až so známymi vrstvami - inak by sa zbytočne sťahovala skladba zo základu,
// ktorú balík o chvíľu nahradí (a brala by šírku pásma tej správnej)
let layersReady = false;
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
  layersReady = true;
  restartMusicIfChanged();
})();

/* ---------- Web Audio ---------- */
let ctx = null, sfxBus = null;
const SFX_MAKEUP = 1.8; // ≈ +5 dB pred kompresorom
const buffers = new Map(); // url → Promise<AudioBuffer|null>

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  // efekty idú cez kompresor + zosilnenie: tiché zvuky sú hlasnejšie a súbežné (zásah + výbuch + hlas) sa nezlejú
  // do skreslenia - na slabom reproduktore mobilu je ich tak počuť
  sfxBus = ctx.createGain();
  sfxBus.gain.value = SFX_MAKEUP;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 4;
  comp.attack.value = 0.003; comp.release.value = 0.2;
  sfxBus.connect(comp);
  comp.connect(ctx.destination);
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
// predbežné načítanie efektov po prvom geste (aby prvý zásah nemal oneskorenie dekódovania).
// Po PRELOAD_PARALLEL naraz: prehliadač má na server len ~6 spojení - keby šlo ~40 súborov naraz,
// hudba by čakala v rade za nimi. UI zvuky (hover nad kartou) idú prvé.
const PRELOAD_PARALLEL = 3;
function preloadAll() {
  const keys = [...new Set(Object.values(layers).flatMap(l => (l ? Object.keys(l.entries) : [])))]
    .filter(k => !k.startsWith("music."))
    .sort((a, b) => (b.startsWith("ui.") ? 1 : 0) - (a.startsWith("ui.") ? 1 : 0));
  const urls = [...new Set(keys.flatMap(k => entryFor(k)?.urls || []))];
  let i = 0;
  const worker = async () => { while (i < urls.length) await loadBuffer(urls[i++]); };
  for (let w = 0; w < PRELOAD_PARALLEL; w++) worker();
}
// efekty sa začnú načítať, až keď hudba hrá (alebo najneskôr po MUSIC_FIRST_MS) - hudba má prednosť
const MUSIC_FIRST_MS = 3000;
let musicPlayingResolve;
const musicPlaying = new Promise(r => { musicPlayingResolve = r; });

// prehliadač pustí zvuk až po interakcii používateľa - prvé gesto odomkne kontext aj odloženú hudbu
let unlocked = false;
function unlock() {
  // kontext môže ostať uspatý, ak prvé gesto prehliadač neuznal → každé ďalšie gesto ho skúsi zobudiť
  if (unlocked) { if (ctx?.state === "suspended") ctx.resume?.(); return; }
  if (!ensureCtx()) return;
  unlocked = true;
  ctx.resume?.();
  soundReady.then(() => Promise.race([musicPlaying, new Promise(r => setTimeout(r, MUSIC_FIRST_MS))])).then(preloadAll);
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
  // jemná zmena výšky - opakované kroky neznejú ako stroj; nie pri znelkách/hudbe a stopách cez celú fázu (dlhé repliky)
  const jitter = /^(game|round|music)\./.test(k) || PHASE_KEYS.has(k.split(".")[0]) ? 0 : 0.04;
  return playUrl(urls[i], (e.vol ?? 1) * volume, { pan, rate: 1 + (Math.random() * 2 - 1) * jitter, windowMs, fit: e.fit || defaultFit(k), trim: e.trims?.[i],
    duck: !/^(ui|music)\./.test(k) }); // herné efekty stíšia hudbu (kliky v UI nie)
}

const activeSources = new Set(); // práve hrajúce efekty (stopAllSfx - Sound Lab „Stop“)

// nízkoúrovňové prehratie (lab ním skúša knižnicu); hlasitosť = vol × efekty × master
// → Promise<{ stop(), ended: Promise }> | null (súbor sa nedá načítať)
// trim = [začiatokMs, koniecMs] - prehrá len hlavnú časť súboru (trim.js)
export function playUrl(url, vol = 1, { pan = 0, rate = 1, windowMs = null, fit = "keep", trim = null, duck = false } = {}) {
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
    if (duck) duckMusic(realMs);
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
  return settings.muted ? 0 : (e?.vol ?? 1) * settings.music * settings.master * duckLevel;
}
// stíšenie hudby počas herných efektov („ducking"): kým hrá efekt, hudba klesne na DUCK_TO a potom sa plynulo vráti
const DUCK_TO = 0.5, DUCK_TAIL_MS = 250;
let duckLevel = 1, duckUntil = 0, duckTimer = null;
function duckMusic(ms) {
  duckUntil = Math.max(duckUntil, performance.now() + ms + DUCK_TAIL_MS);
  if (duckTimer) return;
  duckTimer = setInterval(() => {
    const target = performance.now() < duckUntil ? DUCK_TO : 1;
    duckLevel += (target - duckLevel) * (target < duckLevel ? 0.5 : 0.15); // rýchlo dole, pomaly hore
    if (Math.abs(duckLevel - target) < 0.01) duckLevel = target;
    music?.setVolume(musicTargetVolume());
    if (duckLevel === 1) { clearInterval(duckTimer); duckTimer = null; }
  }, 50);
}
// Hlasitosť každého prehrávača sa počíta z JEHO POZÍCIE v skladbe, nie z bežiaceho časovača: prelínanie
// konca so začiatkom tak nezamrzne ani v skrytej karte, kde prehliadač časovače brzdí (až na 1× za minútu) -
// prepočet spúšťa aj `timeupdate` samotného prehrávača. Krivka sin/cos = rovnaký výkon (bez prepadu v strede).
const easeIn = (k) => Math.sin(Math.max(0, Math.min(1, k)) * Math.PI / 2);
const easeOut = (k) => Math.cos(Math.max(0, Math.min(1, k)) * Math.PI / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const FIRST_FADE_MS = 400;       // nábeh pri prvom spustení
const RESUME_FADE_MS = 300;      // nábeh po obnovení zaseknutého prehrávača (bez lupnutia)
const PREPARE_AHEAD_MS = 10000;  // ďalšie kolo slučky sa načíta a nastaví toľko pred prelínaním → nástup bez čakania
const STALL_MS = 8000;           // prehrávač, ktorý hral a toľko sa nepohol (sieť) → nahradí sa novým od toho miesta
const ERROR_RETRY_MS = 2000;     // chyba načítania → nový pokus po 2 s, 4 s, 8 s … (najviac ERROR_RETRY_MAX_MS)
const ERROR_RETRY_MAX_MS = 30000;
const GESTURES = ["pointerdown", "keydown", "touchstart"];
// autoplay zablokovaný (pred prvým gestom, alebo gesto prehliadač neuznal, napr. Shift/Esc) → pusti pri ďalšom geste
let gestureWaiters = [];
function retryOnGesture(fn) {
  if (!gestureWaiters.length) {
    const go = () => {
      for (const ev of GESTURES) window.removeEventListener(ev, go, true);
      const w = gestureWaiters;
      gestureWaiters = [];
      w.forEach(f => f());
    };
    for (const ev of GESTURES) window.addEventListener(ev, go, { capture: true, passive: true });
  }
  gestureWaiters.push(fn);
}
// slučka hudby: hrá úsek [trim začiatok, trim koniec] (bez trim celý súbor); pred koncom úseku spustí vopred
// pripravený druhý prehrávač od začiatku úseku a oba prelínia - skladba nestíchne ani neskočí (aj keď má tichý
// koniec alebo mp3 medzeru). Strážca: prehrávač, ktorý má hrať a stojí (pauza zvonka - systém/klávesy médií,
// chyba siete, zaseknutie), sa sám znova rozbehne. fromMs = odkiaľ začať prvé prehratie (lab: kúsok pred koncom).
export function playMusicLoop(url, trim, volume, { fadeInMs = FIRST_FADE_MS, fromMs = null } = {}) {
  let alive = true, vol = volume, stopAt = null, stopMs = 0, waitingGesture = false, errors = 0;
  const startMs = trim?.[0] || 0;
  const posOf = (el) => el.currentTime * 1000;
  const endOf = (el) => Math.min(trim?.[1] ?? Infinity, el.duration > 0 ? el.duration * 1000 : Infinity);

  const make = (atMs) => {
    const el = new Audio(url);
    el.preload = "auto";
    el.volume = 0;
    el.addEventListener("loadedmetadata", () => { el.currentTime = atMs / 1000; el._ready = true; tick(); }, { once: true });
    el.addEventListener("playing", () => { el._played = true; errors = 0; musicPlayingResolve(); });
    el.addEventListener("error", () => { el._errAt ??= performance.now(); });
    for (const ev of ["timeupdate", "playing", "pause", "ended", "error", "stalled"]) el.addEventListener(ev, tick);
    return el;
  };
  const kill = (el) => {
    if (!el) return;
    el._want = false;
    el.pause();
    el.removeAttribute("src");
    try { el.load(); } catch { /* nič */ }
  };
  const play = (el) => {
    el._want = true;
    el._lastPos = -1;
    el._lastMove = performance.now();
    el.play()?.catch?.((err) => {
      if (err?.name !== "NotAllowedError" || waitingGesture) return; // AbortError = prehrávač sme medzitým zrušili
      waitingGesture = true;
      // play() priamo v obsluhe gesta - niektoré prehliadače (Safari) to inak neuznajú
      retryOnGesture(() => { waitingGesture = false; if (alive && cur?._want && cur.paused) play(cur); });
    });
  };
  const fresh = (atMs, fadeMs) => { const el = make(atMs); el._fadeFrom = atMs; el._fadeIn = fadeMs; return el; };

  let cur = fresh(fromMs ?? startMs, fadeInMs), old = null, next = null;
  play(cur);

  const gainOf = (el) => {
    const p = posOf(el);
    let g = 1;
    if (el._fadeIn > 0) g *= easeIn((p - el._fadeFrom) / el._fadeIn);
    if (el._xfIn > 0) g *= easeIn((p - startMs) / el._xfIn);
    if (el._xfOut > 0) g *= easeOut((p - el._xfOutFrom) / el._xfOut);
    if (stopAt != null) g *= stopMs > 0 ? easeOut((performance.now() - stopAt) / stopMs) : 0;
    return g;
  };
  // nové kolo slučky: aktuálny prehrávač dohrá do konca úseku (stíši sa), pripravený nastúpi od začiatku
  const handoff = (end) => {
    const o = cur, left = Math.max(50, end - posOf(o));
    const n = next || make(startMs);
    next = null;
    n._xfIn = o.ended ? 0 : left; // dobehol bez odovzdania (brzdený časovač) → nový hneď naplno, žiadne ticho
    kill(old);
    old = null;
    if (o.ended) kill(o);
    else { o._want = false; o._xfOut = left; o._xfOutFrom = posOf(o); old = o; }
    cur = n;
    play(cur);
  };
  const respawn = (atMs) => { kill(cur); cur = fresh(atMs, RESUME_FADE_MS); play(cur); };

  function tick() {
    if (!cur) return;
    const now = performance.now();
    if (stopAt != null) {
      const done = now - stopAt >= stopMs;
      for (const el of [cur, old]) if (el) el.volume = done ? 0 : clamp01(vol * gainOf(el));
      if (done) finish();
      return;
    }
    if (!alive) return;
    if (old && (old.ended || old.error || posOf(old) >= endOf(old))) { kill(old); old = null; }
    const end = endOf(cur);
    if (cur._ready && end < Infinity) {
      const xf = loopXfade(end - startMs);
      if (!next && posOf(cur) >= end - xf - PREPARE_AHEAD_MS) next = make(startMs);
      if (posOf(cur) >= end - xf || cur.ended) handoff(end);
    }
    // strážca: má hrať, ale stojí
    if (cur._want && !waitingGesture) {
      if (cur.error) {
        if (now - cur._errAt >= Math.min(ERROR_RETRY_MAX_MS, ERROR_RETRY_MS * 2 ** errors)) {
          errors++;
          respawn(cur._played ? Math.max(startMs, posOf(cur)) : (fromMs ?? startMs));
        }
      } else if (cur.paused) {
        if (!cur._retryAt || now - cur._retryAt > 1000) { cur._retryAt = now; play(cur); }
      } else if (cur._played) {
        const p = posOf(cur);
        if (p !== cur._lastPos) { cur._lastPos = p; cur._lastMove = now; }
        else if (now - cur._lastMove > STALL_MS) respawn(p);
      }
    }
    for (const el of [cur, old]) if (el) el.volume = clamp01(vol * gainOf(el));
  }
  const timer = setInterval(tick, 50);
  document.addEventListener("visibilitychange", tick);
  function finish() {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
    [cur, old, next].forEach(kill);
    cur = old = next = null;
  }
  return {
    url,
    stop(ms = FADE_MS) {
      if (!alive) return;
      alive = false;
      kill(next);
      next = null;
      stopAt = performance.now();
      stopMs = ms;
      tick();
      if (cur) setTimeout(tick, ms + 30);
    },
    setVolume(v) { vol = v; tick(); },
    position() { return cur ? Math.round(posOf(cur)) : 0; }, // ms v súbore (lab, test slučky)
  };
}
function stopMusicEl() {
  music?.stop(FADE_MS);
  music = null;
  currentMusicUrl = null;
}
// hudba sa spustí hneď (nie až po prvom geste): súbor sa začne sťahovať už pri načítaní stránky a ak prehliadač
// autoplay povolí, hrá okamžite; inak sa rozbehne v obsluhe prvého gesta (retryOnGesture)
function startMusicEl() {
  const e = entryFor(currentMusicKey);
  const urls = e?.urls || [];
  if (!urls.length || !layersReady) return;
  const i = Math.floor(Math.random() * urls.length);
  currentMusicUrl = urls[i];
  music = playMusicLoop(urls[i], e.trims?.[i], musicTargetVolume());
}
// kľúč práve nastavenej hudby (null = ticho)
export function musicKey() { return currentMusicKey; }
// prepni hudbu na `key` (null = ticho); `fallback` sa použije, ak `key` nemá súbory (napr. music.final → music.battle)
export function setMusic(key, fallback = null) {
  wantedMusic = { key, fallback };
  if (key && !(entryFor(key)?.urls || []).length) key = fallback;
  if (key === currentMusicKey) return;
  stopMusicEl();
  currentMusicKey = key;
  if (key) startMusicEl();
}
// požadovaná hudba pred náhradou za fallback - po dotiahnutí balíka sa vyhodnotí znova (restartMusicIfChanged)
let wantedMusic = { key: null, fallback: null };
// vrstvy sa zmenili (načítaný balík / koncept) - ak aktuálna hudba má teraz iný súbor, prelínaj na nový.
// Rozhoduje POŽADOVANÝ kľúč: pri reloade sa balík dotiahne až po prvom setMusic, ktorý vtedy spadol na fallback
// (portal realm → music.battle, lebo music.battle.portal ešte nemal súbor) - po načítaní hrá správna skladba
function restartMusicIfChanged() {
  const { key: wk, fallback: wf } = wantedMusic;
  const want = wk && (entryFor(wk)?.urls || []).length ? wk : wf;
  if (!currentMusicKey && !want) return;
  const urls = entryFor(currentMusicKey)?.urls || [];
  if (want === currentMusicKey && currentMusicUrl && urls.includes(currentMusicUrl)) return;
  stopMusicEl();
  currentMusicKey = null;
  setMusic(wk, wf);
}
function applyMusicVolume() { music?.setVolume(musicTargetVolume()); }
