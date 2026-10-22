// tools/voice-loudness.mjs - vyrovnanie hlasitosti HLASOV (voice.*, ui.hover_char.* z custom/ nahrávok + hlas démona custom/demon/)
// podľa vnímanej hlasitosti LUFS (EBU R128 / ITU-R BS.1770: K-váženie, bloky 400 ms, hradlá -70 LUFS a -10 LU),
// meranej v úseku, ktorý hra naozaj prehráva (trim). vol = zosilnenie na cieľ TARGET_LUFS, ale vrchol nahrávky
// nesmie prekročiť PEAK_MAX_DBFS (inak by sa skreslila) a vol najviac MAX_VOL.
// Dekódovanie mp3 potrebuje prehliadač (Node mp3 nedekóduje) - headless Chrome/Edge cez CDP, server na :3978.
//   node tools/voice-loudness.mjs           → tabuľka (aktuálny vol, LUFS, vrchol, navrhovaný vol)
//   node tools/voice-loudness.mjs --write   → zapíše navrhované vol do public/sounds/manifest.js
// Po pridaní nových hlasov stačí spustiť s --write (a npm test).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { MAX_VOL } from "../public/sounds/pack.js";

export const TARGET_LUFS = -18;    // cieľová hlasitosť hlasu (vol × nahrávka)
export const PEAK_MAX_DBFS = -1;   // rezerva vrcholu po zosilnení (mp3 dekódovanie, prekrývanie zvukov)

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const MANIFEST = path.join(ROOT, "public/sounds/manifest.js");
const PORT = 3978, CDP = 9350;
const WRITE = process.argv.includes("--write");
const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// meranie v stránke: pre každú položku hlasu → { key, vol, lufs, peakDb }
const MEASURE = `(async () => {
  const { SOUNDS } = await import("/sounds/manifest.js");
  const out = [];
  for (const [key, e] of Object.entries(SOUNDS)) {
    // hlasy postáv + hlas démona (REAPER, custom/demon/)
    if (!(/^(voice\\.|ui\\.hover_char\\.)/.test(key) || e.files?.[0]?.startsWith("custom/demon/")) || !e.files?.[0]?.startsWith("custom/")) continue;
    const file = e.files[0];
    const a = await new OfflineAudioContext(1, 48000, 48000).decodeAudioData(await (await fetch("/sounds/" + file)).arrayBuffer());
    const sr = a.sampleRate, tr = e.trim?.[file] || [0, a.duration * 1000];
    const i0 = Math.floor(tr[0] / 1000 * sr), i1 = Math.min(a.length, Math.floor(tr[1] / 1000 * sr)), len = Math.max(1, i1 - i0);
    // K-váženie: high-shelf +4 dB @ 1681 Hz a high-pass 38 Hz (BS.1770)
    const oc = new OfflineAudioContext(a.numberOfChannels, len, sr);
    const part = oc.createBuffer(a.numberOfChannels, len, sr);
    let peak = 0;
    for (let c = 0; c < a.numberOfChannels; c++) {
      const d = a.getChannelData(c).subarray(i0, i1);
      part.copyToChannel(d, c);
      for (let j = 0; j < d.length; j++) peak = Math.max(peak, Math.abs(d[j]));
    }
    const src = oc.createBufferSource(); src.buffer = part;
    const shelf = oc.createBiquadFilter(); shelf.type = "highshelf"; shelf.frequency.value = 1681; shelf.gain.value = 4;
    const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 38; hp.Q.value = 0.5;
    src.connect(shelf).connect(hp).connect(oc.destination); src.start();
    const r = await oc.startRendering();
    const ch = Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c));
    const B = Math.round(0.4 * sr), H = Math.round(0.1 * sr), blocks = [];
    for (let st = 0; ; st += H) {
      const en = Math.min(r.length, st + B);
      let z = 0;
      for (const d of ch) { let q = 0; for (let j = st; j < en; j++) q += d[j] * d[j]; z += q / Math.max(1, en - st); }
      blocks.push(z);
      if (en >= r.length) break;
    }
    const L = (z) => -0.691 + 10 * Math.log10(z);
    const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
    let g = blocks.filter(z => L(z) > -70);
    if (!g.length) { out.push({ key, vol: e.vol, lufs: null, peakDb: null }); continue; }
    const rel = L(mean(g)) - 10;
    g = g.filter(z => L(z) > rel);
    out.push({ key, vol: e.vol, lufs: L(mean(g)), peakDb: 20 * Math.log10(peak) });
  }
  return JSON.stringify(out);
})()`;

const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-loudness-"));
const br = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${dataDir}`, "--no-first-run", "--mute-audio", "about:blank"], { stdio: "ignore" });
let code = 0;
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://localhost:${PORT}`)).ok) break; } catch {} await sleep(200); }
  let list = null;
  for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); } catch {} }
  const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once("open", r));
  let id = 0;
  const pend = new Map();
  ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.navigate", { url: `http://localhost:${PORT}/sound-lab.html` });
  await sleep(1500);
  const r = await send("Runtime.evaluate", { expression: MEASURE, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description);
  const rows = JSON.parse(r.result.result.value);

  let manifest = fs.readFileSync(MANIFEST, "utf8");
  console.log(`cieľ ${TARGET_LUFS} LUFS, vrchol najviac ${PEAK_MAX_DBFS} dBFS, vol najviac ${MAX_VOL}\n`);
  console.log("kľúč".padEnd(28) + "vol    LUFS   vrchol  → vol   výsledok");
  for (const row of rows) {
    if (row.lufs == null) { console.log(`${row.key.padEnd(28)}(ticho - preskočené)`); continue; }
    const gainDb = Math.min(TARGET_LUFS - row.lufs, PEAK_MAX_DBFS - row.peakDb, 20 * Math.log10(MAX_VOL));
    const vol = Math.round(10 ** (gainDb / 20) * 100) / 100;
    const result = row.lufs + 20 * Math.log10(vol);
    const short = result < TARGET_LUFS - 0.5 ? `  (pod cieľom ${(result - TARGET_LUFS).toFixed(1)} dB - obmedzené vrcholom)` : "";
    console.log(`${row.key.padEnd(28)}${String(row.vol).padEnd(7)}${row.lufs.toFixed(1).padStart(5)}  ${row.peakDb.toFixed(1).padStart(6)}  → ${String(vol).padEnd(5)} ${result.toFixed(1).padStart(6)}${short}`);
    if (WRITE) {
      const re = new RegExp(`("${row.key.replace(/\./g, "\\.")}":\\s*\\{[^\\n]*?vol: )[0-9.]+`); // \\s* - kľúče môžu byť zarovnané medzerami
      if (!re.test(manifest)) throw new Error(`${row.key}: položka v manifeste nemá vol na jednom riadku`);
      manifest = manifest.replace(re, `$1${vol}`);
    }
  }
  if (WRITE) { fs.writeFileSync(MANIFEST, manifest); console.log(`\nzapísané do ${path.relative(ROOT, MANIFEST)}`); }
  ws.close();
} catch (e) {
  console.error("voice-loudness:", e.message || e);
  code = 1;
} finally {
  try { br.kill(); } catch {}
  try { srv.kill(); } catch {}
  setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(code); }, 800);
}
