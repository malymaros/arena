// test/sounds.mjs - kontrola registra zvukov public/sounds/manifest.js: každý súbor existuje, má známy zdroj
// (balík s licenciou), status je default|picked, a každý kľúč, ktorý klient prehráva, je v registri.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SOUNDS, SOUND_SOURCES } from "../public/sounds/manifest.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const soundsDir = path.join(root, "public", "sounds");
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log("FAIL:", msg); } };

const packOf = (f) => (f.startsWith("custom/") ? "custom" : f.split("/")[1]);

for (const [key, e] of Object.entries(SOUNDS)) {
  check(Array.isArray(e.files), `${key}: files musí byť pole`);
  check(e.status === "default" || e.status === "picked", `${key}: status "${e.status}" (default|picked)`);
  check(typeof e.vol === "number" && e.vol >= 0 && e.vol <= 1, `${key}: vol mimo 0–1`);
  for (const f of e.files || []) {
    check(fs.existsSync(path.join(soundsDir, f)), `${key}: súbor neexistuje: ${f}`);
    check(f.startsWith("lib/") || f.startsWith("custom/"), `${key}: súbor musí byť v lib/ alebo custom/: ${f}`);
    check(!!SOUND_SOURCES[packOf(f)], `${key}: neznámy zdroj "${packOf(f)}" (doplň SOUND_SOURCES)`);
  }
}
// každý balík v knižnici má licenciu v SOUND_SOURCES; stiahnuté balíky majú aj License.txt
for (const pack of fs.readdirSync(path.join(soundsDir, "lib"))) {
  check(!!SOUND_SOURCES[pack]?.license, `lib/${pack}: chýba v SOUND_SOURCES (zdroj + licencia)`);
  if (pack.startsWith("kenney-")) check(fs.existsSync(path.join(soundsDir, "lib", pack, "License.txt")), `lib/${pack}: chýba License.txt`);
}

// kľúče prehrávané klientom: literály sfx("…") / setMusic("…") a hodnoty mapy DIRECT v sound-map.js
const used = new Set();
const clientDir = path.join(root, "public", "client");
for (const f of fs.readdirSync(clientDir).filter(f => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(clientDir, f), "utf8");
  for (const m of src.matchAll(/\b(?:sfx|setMusic)\(\s*"([a-z0-9_.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\bsfx\([^;\n]*?\?\s*"([a-z0-9_.]+)"\s*:\s*"([a-z0-9_.]+)"/g)) { used.add(m[1]); used.add(m[2]); } // sfx(a ? "x" : "y")
}
const mapSrc = fs.readFileSync(path.join(clientDir, "sound-map.js"), "utf8");
const direct = mapSrc.match(/const DIRECT = \{([\s\S]*?)\n\};/)?.[1] || "";
check(direct.length > 0, "sound-map.js: blok DIRECT nenájdený");
for (const m of direct.matchAll(/:\s*"([a-z0-9_.]+)"/g)) used.add(m[1]);
for (const t of ["dmg", "heal", "mana", "ik"]) used.add(`tile.${t}`);
for (const k of used) check(k in SOUNDS, `kľúč "${k}" sa prehráva, ale chýba v manifest.js`);

console.log(`sounds: ${passes} PASS, ${fails} FAIL`);
if (fails) process.exit(1);
