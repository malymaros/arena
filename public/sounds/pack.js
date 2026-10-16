// public/sounds/pack.js - ČISTÝ formát zvukového balíka (pack.json v zipe): validácia, migrácia starších verzií
// a report kompatibility. Používa ho Sound Lab (import/export), inštalátor tools/sound-pack.mjs aj testy.
//
// pack.json:
//   { format, id, name, version, author, created, soundApi,
//     entries: { "<kľúč>[.<char>]": { files: ["sounds/…"], vol, fit?, madeForMs?, credit? } } }
// Súbory ležia v zipe vedľa pack.json pod sounds/…; balík je samostatný (nesie aj zvuky z knižnice).
// Tri osi verzií: format (schéma súboru) · soundApi (sada kľúčov, KEY_MIGRATIONS) · madeForMs (okno v čase
// tvorby vs windows.json). Balík NEMENÍ časovanie hry - pri posunutom okne len upozorní.
import { FIT_MODES } from "./fit.js";

export const PACK_FORMAT = 1;
export const AUDIO_EXT = ["ogg", "mp3", "wav", "webm"];
export const MAX_FILE_BYTES = 8 * 1024 * 1024;  // hudobná skladba má bežne 2–5 MB
export const MAX_PACK_BYTES = 40 * 1024 * 1024;
export const WINDOW_TOLERANCE = 0.1; // ±10 % posun okna = upozornenie
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const PATH_RE = /^sounds\/[A-Za-z0-9._\-/]+$/;

// kľúč je platný, ak je v registri, alebo je to "<kľúč registra>.<postava>"
export function keyAllowed(key, { keys, chars }) {
  if (keys.has(key)) return true;
  const i = key.lastIndexOf(".");
  return i > 0 && keys.has(key.slice(0, i)) && chars.includes(key.slice(i + 1));
}
// "special.naruto" → "special" (aj keď je kľúč postavy priamo v registri); bez postavy vráti kľúč
const baseOf = (key, chars) => { const i = key.lastIndexOf("."); return i > 0 && chars.includes(key.slice(i + 1)) ? key.slice(0, i) : key; };
export function safePath(f) {
  return typeof f === "string" && PATH_RE.test(f) && !f.split("/").some(s => s === "" || s === "." || s === "..")
    && AUDIO_EXT.includes(f.split(".").pop().toLowerCase());
}

// trim: { "<súbor položky>": [startMs, endMs] } (trim.js) - len súbory položky, 0 ≤ začiatok < koniec
export function trimErrors(key, e) {
  if (e.trim === undefined) return [];
  if (!e.trim || typeof e.trim !== "object" || Array.isArray(e.trim)) return [`${key}: trim musí byť objekt { súbor: [začiatok, koniec] }`];
  const out = [];
  for (const [f, t] of Object.entries(e.trim)) {
    if (!(e.files || []).includes(f)) out.push(`${key}: trim pre súbor ${f}, ktorý položka nemá`);
    else if (!Array.isArray(t) || t.length !== 2 || !t.every(Number.isFinite) || t[0] < 0 || t[1] <= t[0]) out.push(`${key}: trim ${f} musí byť [začiatok ≥ 0, koniec > začiatok] v ms`);
  }
  return out;
}

// preloží kľúče balíka zo staršej soundApi na `api` podľa KEY_MIGRATIONS → { pack (kópia), notes }
export function migratePack(pack, api, migrations) {
  const out = { ...pack, entries: { ...(pack.entries || {}) } };
  const notes = [];
  for (let v = (pack.soundApi || 1) + 1; v <= api; v++) {
    for (const [from, to] of Object.entries(migrations[v] || {})) {
      for (const key of Object.keys(out.entries)) {
        const suffix = key === from ? "" : key.startsWith(from + ".") ? key.slice(from.length) : null;
        if (suffix === null) continue;
        const entry = out.entries[key];
        delete out.entries[key];
        if (to === null) { notes.push(`${key}: udalosť bola v API ${v} zrušená - vynechané`); continue; }
        out.entries[to + suffix] = entry;
        notes.push(`${key} → ${to + suffix} (API ${v})`);
      }
    }
  }
  if ((pack.soundApi || 1) < api) out.soundApi = api;
  return { pack: out, notes };
}

// pack + zoznam súborov v zipe (meno → veľkosť v B) → { errors, warnings }
export function validatePack(pack, fileSizes, { keys, chars, api }) {
  const errors = [], warnings = [];
  const sizes = fileSizes instanceof Map ? fileSizes : new Map(Object.entries(fileSizes || {}));
  if (!pack || typeof pack !== "object") return { errors: ["pack.json chýba alebo nie je objekt"], warnings };
  if (!Number.isInteger(pack.format)) errors.push("format: chýba");
  else if (pack.format > PACK_FORMAT) errors.push(`format ${pack.format} je novší ako hra (${PACK_FORMAT}) - aktualizuj hru`);
  if (!ID_RE.test(pack.id || "")) errors.push(`id "${pack.id}": len malé písmená, číslice a pomlčky (max 40)`);
  if (typeof pack.name !== "string" || !pack.name.trim()) errors.push("name: chýba");
  if (!Number.isInteger(pack.version) || pack.version < 1) errors.push("version: celé číslo ≥ 1");
  if (!Number.isInteger(pack.soundApi) || pack.soundApi < 1) errors.push("soundApi: chýba");
  else if (pack.soundApi > api) errors.push(`soundApi ${pack.soundApi} je novšie ako hra (${api}) - aktualizuj hru`);
  if (!pack.entries || typeof pack.entries !== "object") { errors.push("entries: chýba"); return { errors, warnings }; }

  const used = new Set();
  for (const [key, e] of Object.entries(pack.entries)) {
    if (!keyAllowed(key, { keys, chars })) { warnings.push(`${key}: hra takú udalosť nepozná - ignoruje sa`); continue; }
    if (!e || !Array.isArray(e.files)) { errors.push(`${key}: files musí byť pole`); continue; }
    for (const f of e.files) {
      if (!safePath(f)) { errors.push(`${key}: nepovolená cesta "${f}" (sounds/…, ${AUDIO_EXT.join("/")})`); continue; }
      if (!sizes.has(f)) errors.push(`${key}: súbor ${f} v balíku chýba`);
      used.add(f);
    }
    if (typeof e.vol !== "number" || e.vol < 0 || e.vol > 1) errors.push(`${key}: vol mimo 0–1`);
    if (e.fit !== undefined && !FIT_MODES.includes(e.fit)) errors.push(`${key}: fit "${e.fit}"`);
    errors.push(...trimErrors(key, e));
  }
  let total = 0;
  for (const [name, size] of sizes) {
    if (name === "pack.json") continue;
    total += size;
    if (size > MAX_FILE_BYTES) errors.push(`${name}: ${(size / 1048576).toFixed(1)} MB > limit ${MAX_FILE_BYTES / 1048576} MB`);
    if (!used.has(name)) warnings.push(`${name}: v balíku je navyše (nepoužitý)`);
  }
  if (total > MAX_PACK_BYTES) errors.push(`balík má ${(total / 1048576).toFixed(1)} MB > limit ${MAX_PACK_BYTES / 1048576} MB`);
  return { errors, warnings };
}

// celkový report: migrácia → validácia → posun okien. level: ok | warnings | incompatible
export function compatReport(pack, fileSizes, { keys, chars, api, migrations = {}, windows = {} }) {
  if (pack && Number.isInteger(pack.format) && pack.format > PACK_FORMAT) {
    return { level: "incompatible", errors: [`format ${pack.format} je novší ako hra (${PACK_FORMAT}) - aktualizuj hru`], warnings: [], notes: [], pack };
  }
  const { pack: migrated, notes } = pack?.entries && pack.soundApi < api ? migratePack(pack, api, migrations) : { pack, notes: [] };
  const { errors, warnings } = validatePack(migrated, fileSizes, { keys, chars, api });
  for (const [key, e] of Object.entries(migrated?.entries || {})) {
    if (!(e?.madeForMs > 0) || !keyAllowed(key, { keys, chars })) continue;
    const now = windows[key]?.med ?? windows[baseOf(key, chars)]?.med;
    if (now > 0 && Math.abs(now - e.madeForMs) / e.madeForMs > WINDOW_TOLERANCE) {
      warnings.push(`${key}: robené pre okno ${e.madeForMs} ms, hra má teraz ${now} ms (zvuk sa prispôsobí: ${e.fit || "predvolené"})`);
    }
  }
  return { level: errors.length ? "incompatible" : warnings.length ? "warnings" : "ok", errors, warnings, notes, pack: migrated };
}
