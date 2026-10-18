// public/sounds/draft-store.js - KONCEPT zvukového balíka v prehliadači (IndexedDB): metadáta, položky
// (rovnaký tvar ako pack.json entries) a nahraté súbory ako Bloby. Nič sa neposiela na server - výstupom
// labu je stiahnutý zip. „Vyskúšať v hre“ = príznak v localStorage; hra (sound.js) potom koncept prekryje
// cez aktívny balík, ale len v tomto prehliadači.
// Cesty v koncepte sú cesty v balíku: "sounds/lib/<balík>/<súbor>" (z knižnice) alebo "sounds/custom/<meno>"
// (nahraté - Blob v IndexedDB).
const DB = "arena-sound", VER = 1, META = "draft", BLOBS = "blobs", PREVIEW_KEY = "arena.soundPreview";

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore(META); r.result.createObjectStore(BLOBS); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => { db.close(); res(out?.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}

// { meta: { id, name, author, version }, entries: { kľúč: {...} } } | null
export const loadDraft = () => tx(META, "readonly", s => s.get("current"));
export const saveDraft = (draft) => tx(META, "readwrite", s => s.put(draft, "current"));
export const putBlob = (path, blob) => tx(BLOBS, "readwrite", s => s.put(blob, path));
export const getBlob = (path) => tx(BLOBS, "readonly", s => s.get(path));
export const deleteBlob = (path) => tx(BLOBS, "readwrite", s => s.delete(path));
export const listBlobPaths = () => tx(BLOBS, "readonly", s => s.getAllKeys());
export async function clearDraft() {
  await tx(META, "readwrite", s => s.clear());
  await tx(BLOBS, "readwrite", s => s.clear());
}

// cesta v balíku → URL na prehratie (Blob z IndexedDB → object URL, knižnica → /sounds/lib/…)
export async function draftUrlResolver() {
  const urls = new Map();
  for (const p of await listBlobPaths()) urls.set(p, URL.createObjectURL(await getBlob(p)));
  return (path) => urls.get(path) || (path.startsWith("sounds/lib/") ? `/${path}` : `/sounds/${path}`);
}

export function isPreviewOn() { try { return localStorage.getItem(PREVIEW_KEY) === "1"; } catch { return false; } }
export function setPreview(on) { try { localStorage.setItem(PREVIEW_KEY, on ? "1" : "0"); } catch { /* bez uloženia */ } }
