// public/client/perf.js - úsporná grafika („lite") pre slabšie zariadenia (docs/PERF_PLAN.md, etapa 1).
// Režim: auto (predvolený) | lite | full. Auto = lite na dotykovom zariadení (mobil, tablet); na desktope sa lite
// zapne sám, keď hra dlhšie beží pod ~40 FPS (strážca v perfFrame, volá ho raf.js). Voľba sa pamätá v localStorage
// (menu ☰ → GRAPHICS, alebo ?perf=lite|full|auto v URL). Lite = trieda html.perf-lite (CSS) + perf.lite (JS):
// menej drahých efektov (rozostrenie, tiene, počet častíc) a slučka kreslenia na 30 FPS. Vzhľad hry sa inak nemení.
import { isTouch } from "/client/viewport.js";

const KEY = "arena.perf";
const MODES = ["auto", "lite", "full"];
const root = document.documentElement;
const listeners = [];

function load() {
  try {
    const q = new URLSearchParams(location.search).get("perf");
    if (MODES.includes(q)) { localStorage.setItem(KEY, q); return q; }
    const v = localStorage.getItem(KEY);
    if (MODES.includes(v)) return v;
  } catch {}
  return "auto";
}

let mode = load();
let autoSlow = false; // strážca FPS zistil, že zariadenie nestíha (platí do obnovenia stránky)

/** Aktuálny stav: lite = úsporné efekty, fpsCap = max FPS slučky kreslenia (0 = bez limitu). */
export const perf = { lite: false, fpsCap: 0 };

function apply() {
  const lite = mode === "lite" || (mode === "auto" && (isTouch || autoSlow));
  const changed = lite !== perf.lite;
  perf.lite = lite;
  perf.fpsCap = lite ? 30 : 0;
  root.classList.toggle("perf-lite", lite);
  if (changed) listeners.forEach(f => f(perf));
}
apply();

export const perfMode = () => mode;
/** Nastaví režim (auto | lite | full) a zapamätá ho. */
export function setPerfMode(m) {
  if (!MODES.includes(m)) return;
  mode = m;
  try { localStorage.setItem(KEY, m); } catch {}
  apply();
}
/** Zavolá fn pri každej zmene perf.lite. */
export function onPerfChange(fn) { listeners.push(fn); }

// strážca FPS: kĺzavý priemer dĺžky snímky; ak je 3 s v kuse nad 25 ms (< 40 FPS), v režime auto sa zapne lite.
// Prvých 5 s po načítaní (sťahovanie, dekódovanie) a výpadky > 250 ms (prepnutie karty) sa nerátajú.
const BOOT_MS = 5000, SLOW_MS = 25, SLOW_FOR_MS = 3000;
let lastT = 0, avg = 16.7, slowSince = 0;
export function perfFrame(now) {
  const dt = lastT ? now - lastT : 0;
  lastT = now;
  if (mode !== "auto" || perf.lite || now < BOOT_MS || dt <= 0 || dt > 250) return;
  avg += (dt - avg) * 0.1;
  if (avg <= SLOW_MS) { slowSince = 0; return; }
  if (!slowSince) slowSince = now;
  else if (now - slowSince > SLOW_FOR_MS) { autoSlow = true; apply(); }
}
