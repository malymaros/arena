// test/sound-pack.mjs - zvukové balíky: zip (zápis/čítanie, deflate, CRC), validácia pack.json, migrácia
// starších soundApi, report kompatibility (posun okna) a T-API: sada kľúčov registra sa nesmie zmenšiť
// bez zvýšenia SOUND_API_VERSION + KEY_MIGRATIONS.
//   node test/sound-pack.mjs              (súčasť npm test)
//   node test/sound-pack.mjs --snapshot   zapíše snímku kľúčov aktuálnej verzie (po pridaní kľúčov / zvýšení verzie)
import fs from "fs";
import path from "path";
import zlib from "zlib";
import os from "os";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { writeZip, readZip, crc32 } from "../public/sounds/zip.js";
import { validatePack, migratePack, compatReport, keyAllowed, safePath, PACK_FORMAT, MAX_FILE_BYTES } from "../public/sounds/pack.js";
import { SOUNDS, SOUND_API_VERSION, KEY_MIGRATIONS } from "../public/sounds/manifest.js";
import { CHAR_LIST } from "../public/chars/index.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const root0 = root;
let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const enc = new TextEncoder();
const ctx = { keys: new Set(Object.keys(SOUNDS)), chars: CHAR_LIST.map(c => c.key), api: SOUND_API_VERSION };
const okPack = () => ({
  format: PACK_FORMAT, id: "test-pack", name: "Test", version: 1, author: "t", created: "2026-10-16", soundApi: SOUND_API_VERSION,
  entries: {
    "hit": { files: ["sounds/a.ogg"], vol: 0.5 },
    "special.naruto": { files: ["sounds/b.wav"], vol: 1, fit: "fade", madeForMs: 4860 },
  },
});
const okSizes = () => ({ "pack.json": 100, "sounds/a.ogg": 1000, "sounds/b.wav": 2000 });

/* ---------- zip ---------- */
{
  check(crc32(enc.encode("123456789")) === 0xCBF43926, "crc32 referenčná hodnota");
  const files = [{ name: "pack.json", data: enc.encode('{"a":1}') }, { name: "sounds/č.ogg", data: new Uint8Array([0, 1, 2, 255]) }];
  const z = writeZip(files);
  const back = await readZip(z);
  check(back.size === 2 && new TextDecoder().decode(back.get("pack.json")) === '{"a":1}', "zip roundtrip: text");
  check(back.get("sounds/č.ogg")?.join() === "0,1,2,255", "zip roundtrip: binárne + UTF-8 meno");
  check(writeZip(files).join() === z.join(), "zip je deterministický");
  // deflate záznam (ako ho vytvorí bežný archivátor) - lokálna hlavička + centrálny adresár ručne
  const data = enc.encode("ahoj ".repeat(200)), comp = zlib.deflateRawSync(data), name = enc.encode("x.txt");
  const lh = Buffer.alloc(30), ch = Buffer.alloc(46), eo = Buffer.alloc(22);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data), 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
  const cdOff = 30 + name.length + comp.length;
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + name.length, 12); eo.writeUInt32LE(cdOff, 16);
  const dz = Buffer.concat([lh, name, comp, ch, name, eo]);
  const d = await readZip(dz);
  check(new TextDecoder().decode(d.get("x.txt")) === "ahoj ".repeat(200), "zip: čítanie deflate");
  const bad = z.slice(); bad[30 + "pack.json".length] ^= 0xFF; // poškodený obsah prvého súboru
  let threw = false; try { await readZip(bad); } catch { threw = true; }
  check(threw, "zip: zlé CRC → chyba");
  threw = false; try { await readZip(enc.encode("toto nie je zip")); } catch { threw = true; }
  check(threw, "nie-zip → chyba");
}

/* ---------- validácia ---------- */
{
  const r = validatePack(okPack(), okSizes(), ctx);
  check(r.errors.length === 0 && r.warnings.length === 0, "platný balík bez chýb", JSON.stringify(r));
  check(keyAllowed("special.naruto", ctx) && !keyAllowed("special.goku", ctx) && !keyAllowed("nic.naruto", ctx), "kľúč postavy: len známa udalosť + známa postava");
  check(!safePath("sounds/../x.ogg") && !safePath("/sounds/x.ogg") && !safePath("sounds/x.exe") && !safePath("lib/x.ogg") && safePath("sounds/lib/a/b-c.ogg"), "safePath");

  const errOf = (mut, sizes = okSizes()) => { const p = okPack(); mut(p); return validatePack(p, sizes, ctx); };
  check(errOf(p => { p.entries.hit.files = ["sounds/../../server.js"]; }).errors.length > 0, "cesta s .. → chyba");
  check(errOf(p => { p.entries.hit.files = ["sounds/chyba.ogg"]; }).errors.some(e => e.includes("chýba")), "chýbajúci súbor → chyba");
  check(errOf(p => { p.entries["nieco.nove"] = { files: [], vol: 1 }; }).warnings.some(w => w.includes("nieco.nove")), "neznámy kľúč → upozornenie, nie chyba");
  check(errOf(p => { p.entries.hit.vol = 2; }).errors.length > 0, "vol mimo 0–1 → chyba");
  check(errOf(p => { p.entries.hit.fit = "stretch"; }).errors.length > 0, "neznámy fit → chyba");
  check(errOf(p => { p.id = "Zlé ID!"; }).errors.length > 0, "zlé id → chyba");
  check(errOf(() => {}, { ...okSizes(), "sounds/a.ogg": MAX_FILE_BYTES + 1 }).errors.some(e => e.includes("limit")), "privelký súbor → chyba");
  check(errOf(() => {}, { ...okSizes(), "sounds/navyse.ogg": 10 }).warnings.some(w => w.includes("navyše")), "nepoužitý súbor → upozornenie");
  check(errOf(p => { p.soundApi = SOUND_API_VERSION + 1; }).errors.some(e => e.includes("novšie")), "novšie soundApi → chyba");
}

/* ---------- migrácia + kompatibilita ---------- */
{
  const old = { ...okPack(), soundApi: 1, entries: { "stary": { files: ["sounds/a.ogg"], vol: 1 }, "stary.naruto": { files: ["sounds/b.wav"], vol: 1 }, "zruseny": { files: [], vol: 1 } } };
  const mig = { 2: { stary: "hit", zruseny: null } };
  const { pack, notes } = migratePack(old, 2, mig);
  check(pack.soundApi === 2 && pack.entries.hit && pack.entries["hit.naruto"] && !pack.entries.stary && !("zruseny" in pack.entries), "migrácia: premenovanie aj s postavou, zrušenie", JSON.stringify(pack.entries));
  check(notes.length === 3, "migrácia: poznámky");
  check(old.entries.stary !== undefined, "migrácia nemení vstup");

  const ok = compatReport(okPack(), okSizes(), { ...ctx, windows: { "special.naruto": { med: 4860 } } });
  check(ok.level === "ok", "report: ok", JSON.stringify(ok));
  const drift = compatReport(okPack(), okSizes(), { ...ctx, windows: { "special.naruto": { med: 6000 } } });
  check(drift.level === "warnings" && drift.warnings.some(w => w.includes("4860") && w.includes("6000")), "report: posunuté okno → upozornenie");
  const fallback = compatReport(okPack(), okSizes(), { ...ctx, windows: { special: { med: 9000 } } });
  check(fallback.level === "warnings", "report: okno z všeobecného kľúča, keď postava nemá vlastné");
  const newer = compatReport({ ...okPack(), format: PACK_FORMAT + 1 }, okSizes(), ctx);
  check(newer.level === "incompatible", "report: novší formát → nekompatibilné");
}

/* ---------- inštalátor tools/sound-pack.mjs (do dočasného priečinka) ---------- */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arena-packs-"));
  const zipFile = (name, pack, files) => {
    const p = path.join(tmp, name);
    fs.writeFileSync(p, writeZip([{ name: "pack.json", data: enc.encode(JSON.stringify(pack)) }, ...Object.entries(files).map(([n, d]) => ({ name: n, data: d }))]));
    return p;
  };
  const root = path.join(tmp, "packs");
  const tool = (...a) => spawnSync(process.execPath, [path.join(root0, "tools", "sound-pack.mjs"), ...a, "--root", root], { encoding: "utf8" });
  const files = { "sounds/a.ogg": new Uint8Array([1, 2, 3]), "sounds/b.wav": new Uint8Array([4, 5]), "sounds/navyse.ogg": new Uint8Array([9]) };
  const z1 = zipFile("v1.zip", okPack(), files);
  const r1 = tool("install", z1, "--activate");
  check(r1.status === 0, "install + activate", r1.stdout + r1.stderr);
  check(fs.existsSync(path.join(root, "test-pack", "1", "sounds", "a.ogg")) && fs.existsSync(path.join(root, "test-pack", "1", "pack.json")), "install: súbory rozbalené do packs/<id>/<verzia>/");
  check(!fs.existsSync(path.join(root, "test-pack", "1", "sounds", "navyse.ogg")), "install: nepoužitý súbor sa nekopíruje");
  const idx1 = fs.readFileSync(path.join(root, "index.js"), "utf8");
  check(/ACTIVE = \{"id":"test-pack","version":1\}/.test(idx1), "index.js: aktívny balík", idx1);
  check(tool("install", z1).status !== 0, "install: existujúca verzia sa neprepíše");
  const z2 = zipFile("v2.zip", { ...okPack(), version: 2 }, files);
  // index.js s CRLF (Git na Windows) - aktívny balík sa musí stále prečítať
  const idxPath = path.join(root, "index.js");
  fs.writeFileSync(idxPath, fs.readFileSync(idxPath, "utf8").replace(/\r?\n/g, "\r\n"));
  check(tool("install", z2).status === 0, "install v2 bez --activate");
  check(/ACTIVE = \{"id":"test-pack","version":1\}/.test(fs.readFileSync(path.join(root, "index.js"), "utf8")), "install bez --activate nechá aktívnu verziu");
  check(tool("activate", "test-pack@2").status === 0 && /"version":2\}/.test(fs.readFileSync(path.join(root, "index.js"), "utf8")), "activate v2");
  check(tool("activate", "test-pack@9").status !== 0, "activate neexistujúcej verzie → chyba");
  check(tool("check").status === 0, "check: nainštalované balíky OK");
  const bad = zipFile("bad.zip", { ...okPack(), id: "zly", format: PACK_FORMAT + 1 }, files);
  check(tool("install", bad).status !== 0 && !fs.existsSync(path.join(root, "zly")), "nekompatibilný balík sa nenainštaluje");
  const trav = zipFile("trav.zip", { ...okPack(), id: "trav", entries: { hit: { files: ["sounds/../../x.ogg"], vol: 1 } } }, { "sounds/../../x.ogg": new Uint8Array([1]) });
  check(tool("install", trav).status !== 0 && !fs.existsSync(path.join(tmp, "x.ogg")), "cesta s .. sa nenainštaluje");
  fs.rmSync(path.join(root, "test-pack", "2", "sounds", "a.ogg"));
  check(tool("check").status !== 0, "check: chýbajúci súbor aktívneho balíka → chyba");
  check(tool("activate", "none").status === 0 && /ACTIVE = null/.test(fs.readFileSync(path.join(root, "index.js"), "utf8")), "activate none");
  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ---------- T-API: sada kľúčov vs SOUND_API_VERSION ---------- */
{
  const fx = (v) => path.join(root, "test", "fixtures", `sound-api-${v}.json`);
  const current = Object.keys(SOUNDS).sort();
  if (process.argv.includes("--snapshot")) {
    fs.mkdirSync(path.dirname(fx(SOUND_API_VERSION)), { recursive: true });
    fs.writeFileSync(fx(SOUND_API_VERSION), JSON.stringify(current, null, 1) + "\n");
    console.log(`  snímka kľúčov API ${SOUND_API_VERSION} zapísaná`);
  }
  check(fs.existsSync(fx(SOUND_API_VERSION)), `snímka test/fixtures/sound-api-${SOUND_API_VERSION}.json existuje (node test/sound-pack.mjs --snapshot)`);
  for (let v = 1; v <= SOUND_API_VERSION; v++) {
    if (!fs.existsSync(fx(v))) continue;
    const snap = JSON.parse(fs.readFileSync(fx(v), "utf8"));
    // kľúč zo staršej verzie, ktorý už nie je, musí mať migráciu v niektorej novšej verzii
    const migrated = new Set();
    for (let w = v + 1; w <= SOUND_API_VERSION; w++) Object.keys(KEY_MIGRATIONS[w] || {}).forEach(k => migrated.add(k));
    const lost = snap.filter(k => !(k in SOUNDS) && !migrated.has(k));
    check(lost.length === 0, `API ${v}: žiadny kľúč nezmizol bez migrácie`, `chýbajú: ${lost.join(", ")} - zvýš SOUND_API_VERSION a doplň KEY_MIGRATIONS`);
  }
}

console.log(failures ? `\n${failures} ZLYHANÍ` : "\nsound-pack: VŠETKO PREŠLO");
if (failures) process.exit(1);
