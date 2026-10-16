// tools/sound-pack.mjs - inštalácia zvukových balíkov VLASTNÍKOM servera (zip zo Sound Labu → repo → commit → deploy).
// Na serveri nie je žiadny upload - balík ide do hry len cez git.
//   node tools/sound-pack.mjs install <zip> [--activate]   validácia + migrácia + report, rozbalí do packs/<id>/<verzia>/
//   node tools/sound-pack.mjs activate <id>@<verzia> | none  ktorý balík hrá v hre (staré verzie ostávajú → rollback)
//   node tools/sound-pack.mjs check                        všetky nainštalované balíky sú platné voči aktuálnej hre (npm test)
//   node tools/sound-pack.mjs report                       nainštalované balíky + upozornenia
//   --root <priečinok>  iný koreň balíkov (testy); predvolený public/sounds/packs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readZip } from "../public/sounds/zip.js";
import { compatReport, safePath } from "../public/sounds/pack.js";
import { SOUNDS, SOUND_API_VERSION, KEY_MIGRATIONS } from "../public/sounds/manifest.js";
import { CHAR_LIST } from "../public/chars/index.js";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const ROOT = path.resolve(opt("root") || path.join(REPO, "public", "sounds", "packs"));
const INDEX = path.join(ROOT, "index.js");
const WINDOWS = JSON.parse(fs.readFileSync(path.join(REPO, "public", "sounds", "windows.json"), "utf8"));
const CTX = { keys: new Set(Object.keys(SOUNDS)), chars: CHAR_LIST.map(c => c.key), api: SOUND_API_VERSION, migrations: KEY_MIGRATIONS, windows: WINDOWS };

const die = (msg) => { console.error(`CHYBA: ${msg}`); process.exit(1); };
function printReport(title, rep) {
  const lvl = { ok: "OK", warnings: "OK s upozorneniami", incompatible: "NEKOMPATIBILNÝ" }[rep.level];
  console.log(`${title}: ${lvl}`);
  for (const e of rep.errors) console.log(`  ✕ ${e}`);
  for (const w of rep.warnings) console.log(`  ! ${w}`);
  for (const n of rep.notes) console.log(`  → ${n}`);
}

// nainštalované: packs/<id>/<verzia>/pack.json
function installed() {
  if (!fs.existsSync(ROOT)) return [];
  const out = [];
  for (const id of fs.readdirSync(ROOT)) {
    const d = path.join(ROOT, id);
    if (!fs.statSync(d).isDirectory()) continue;
    for (const v of fs.readdirSync(d)) {
      const pj = path.join(d, v, "pack.json");
      if (!fs.existsSync(pj)) continue;
      const pack = JSON.parse(fs.readFileSync(pj, "utf8"));
      out.push({ id, version: Number(v), dir: path.join(d, v), pack });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
}
// ACTIVE z vygenerovaného index.js (čítané ako text - index.js mimo repa by Node nenačítal ako ES modul)
async function currentActive() {
  if (!fs.existsSync(INDEX)) return null;
  const m = fs.readFileSync(INDEX, "utf8").match(/^export const ACTIVE = (.*);$/m);
  return m ? JSON.parse(m[1]) : null;
}
function writeIndex(active) {
  const packs = installed().map(p => ({ id: p.id, version: p.version, name: p.pack.name, author: p.pack.author || "" }));
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(INDEX, `// public/sounds/packs/index.js - GENEROVANÉ nástrojom tools/sound-pack.mjs (install / activate) - neupravuj ručne.
// Nainštalované zvukové balíky (packs/<id>/<verzia>/) a ten, ktorý hrá v hre.
export const PACKS = ${JSON.stringify(packs, null, 1)};
export const ACTIVE = ${JSON.stringify(active)};
`);
}
// veľkosti súborov balíka na disku (relatívne cesty ako v pack.json)
function sizesOf(dir) {
  const sizes = new Map();
  const walk = (rel) => {
    for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(r); else sizes.set(r, fs.statSync(path.join(dir, r)).size);
    }
  };
  walk("");
  return sizes;
}

const cmd = args[0];
if (cmd === "install") {
  const zipPath = args[1];
  if (!zipPath || !fs.existsSync(zipPath)) die("zadaj cestu k zipu balíka");
  let entries;
  try { entries = await readZip(fs.readFileSync(zipPath)); } catch (e) { die(`zip sa nedá prečítať: ${e.message}`); }
  let pack;
  try { pack = JSON.parse(new TextDecoder().decode(entries.get("pack.json"))); } catch { die("v zipe chýba platný pack.json"); }
  const sizes = new Map([...entries].map(([n, d]) => [n, d.length]));
  const rep = compatReport(pack, sizes, CTX);
  printReport(`${pack.id}@${pack.version} „${pack.name}“`, rep);
  if (rep.level === "incompatible") die("balík sa nedá nainštalovať");
  const dest = path.join(ROOT, rep.pack.id, String(rep.pack.version));
  if (fs.existsSync(dest)) die(`${rep.pack.id}@${rep.pack.version} už je nainštalovaný - nainštalované verzie sa neprepisujú (v labe zvýš verziu)`);
  const used = new Set(Object.values(rep.pack.entries).flatMap(e => e.files));
  for (const [name, data] of entries) {
    if (!used.has(name) || !safePath(name)) continue; // len súbory, ktoré balík naozaj používa
    fs.mkdirSync(path.dirname(path.join(dest, name)), { recursive: true });
    fs.writeFileSync(path.join(dest, name), data);
  }
  fs.writeFileSync(path.join(dest, "pack.json"), JSON.stringify(rep.pack, null, 1) + "\n"); // už preložený na aktuálne API
  const active = args.includes("--activate") ? { id: rep.pack.id, version: rep.pack.version } : await currentActive();
  writeIndex(active);
  console.log(`nainštalované → ${path.relative(REPO, dest)}${args.includes("--activate") ? " (AKTÍVNY)" : ""}`);
} else if (cmd === "activate") {
  const spec = args[1];
  if (spec === "none") { writeIndex(null); console.log("žiadny aktívny balík - hrá základný register"); process.exit(0); }
  const [id, ver] = (spec || "").split("@");
  const hit = installed().find(p => p.id === id && p.version === Number(ver));
  if (!hit) die(`${spec} nie je nainštalovaný (node tools/sound-pack.mjs report)`);
  writeIndex({ id, version: Number(ver) });
  console.log(`aktívny: ${id}@${ver}`);
} else if (cmd === "check" || cmd === "report") {
  const list = installed();
  const active = await currentActive();
  let bad = 0;
  for (const p of list) {
    const rep = compatReport(p.pack, sizesOf(p.dir), CTX);
    const isActive = active && active.id === p.id && active.version === p.version;
    if (cmd === "report" || rep.level === "incompatible") printReport(`${p.id}@${p.version}${isActive ? " (aktívny)" : ""}`, rep);
    if (rep.level === "incompatible") bad++;
  }
  if (active && !list.some(p => p.id === active.id && p.version === active.version)) { console.log(`aktívny ${active.id}@${active.version} nie je nainštalovaný`); bad++; }
  console.log(`sound-pack ${cmd}: ${list.length} balíkov${active ? `, aktívny ${active.id}@${active.version}` : ", aktívny žiadny (základ)"}${bad ? `, ${bad} CHÝB` : ""}`);
  process.exit(bad ? 1 : 0);
} else {
  console.log("použitie: node tools/sound-pack.mjs install <zip> [--activate] | activate <id>@<verzia>|none | check | report  [--root <priečinok>]");
  process.exit(cmd ? 1 : 0);
}
