// tools/sound-smoke.mjs - dymový test ZVUKU v reálnom prehliadači (headless Chrome/Edge cez CDP, server na :3994):
//   hra:  skutočný klik odomkne audio → všetky zvuky vrstiev sa načítajú (žiadne 4xx), mapovanie bez výnimiek
//   lab:  nahratie vlastného súboru → položka v koncepte (aj pre postavu) → export zip → import späť = rovnaké
//         položky; „Vyskúšať v hre“ → hra po načítaní hrá koncept (vrstva draft)
// Spustenie: node tools/sound-smoke.mjs   (manuálne, ako tools/browser-smoke.mjs; exit 1 pri chybe)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const PORT = 3994, CDP = 9334, URL0 = `http://localhost:${PORT}`;
const BROWSERS = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

let failures = 0;
const check = (c, label, detail = "") => { console.log(`  ${c ? "PASS" : "FAIL"}  ${label}${!c && detail ? " - " + detail : ""}`); if (!c) failures++; };

const srv = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-sound-smoke-"));
const br = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${dataDir}`, "--no-first-run",
  "--mute-audio", "--window-size=1400,900", "about:blank"], { stdio: "ignore" });
const cleanup = () => { try { br.kill(); } catch {} try { srv.kill(); } catch {} setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 1000); };

try {
  // počkaj, kým server odpovedá
  for (let i = 0; i < 50; i++) { try { if ((await fetch(URL0)).ok) break; } catch {} await sleep(200); }
  let list = null;
  for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); } catch {} }
  const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise(r => ws.once("open", r));
  let id = 0;
  const pend = new Map(), errs = [], net = { ok: 0, bad: [] };
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push(m.params.args.map(a => a.value ?? a.description).join(" "));
    if (m.method === "Network.responseReceived" && m.params.response.url.includes("/sounds/")) {
      if (m.params.response.status < 400) net.ok++; else net.bad.push(`${m.params.response.status} ${m.params.response.url}`);
    }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.exception?.description } : r.result?.result?.value; };
  const click = async () => { for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: 700, y: 450, button: "left", clickCount: 1 }); };
  await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");

  console.log("hra:");
  await send("Page.navigate", { url: `${URL0}/` }); await sleep(2500);
  await click(); await sleep(3500);
  check(net.ok > 50 && net.bad.length === 0, `po kliku sa načítali zvuky (${net.ok} OK)`, net.bad.join(", "));
  const mapped = await ev(`import("/client/sound-map.js").then(m => {
    const P = {x:0,y:1,char:"fire"}, Q = {x:3,y:1,char:"naruto"};
    const tl = [{p1:P,p2:Q,effects:[],delayMs:10}];
    for (const k of ["charge","hit","block","mirror","special","melee","clone_die","trap_set","timestop_start","demon_attack","tile_proc"])
      tl.push({p1:P,p2:Q,effects:[{kind:k,from:"p1",target:"p2",dmg:9,tile:"ik",cell:[1,1]}],delayMs:500});
    m.soundTimelineStart();
    for (let i = 1; i < tl.length; i++) m.soundForFrame(tl, i, {p1: tl[i-1].p1, p2: tl[i-1].p2});
    return "ok"; })`);
  check(mapped === "ok", "mapovanie efektov bez výnimky", JSON.stringify(mapped));

  console.log("lab:");
  net.bad = [];
  await send("Page.navigate", { url: `${URL0}/sound-lab.html` }); await sleep(2500);
  check(await ev(`document.querySelectorAll(".ev").length > 50`) === true, "zoznam udalostí");
  const rt = await ev(`(async () => {
    const L = window.__soundLab;
    await L.resetDraft();
    // 0,2 s ticha ako WAV (vlastný „nahratý“ zvuk)
    const n = 8820, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    await L.addFiles([new File([b], "Môj Úder.wav", { type: "audio/wav" })]);
    const d = L.getDraft();
    d.entries["hit.naruto"] = { files: ["sounds/custom/moj-uder.wav"], vol: 0.7, fit: "keep" };
    d.entries["special"] = { files: ["sounds/lib/kenney-digital-audio/zap2.ogg"], vol: 0.5, fit: "fade" };
    const built = await L.buildPack();
    if (!built.zip) return { error: JSON.stringify(built.report) };
    const before = JSON.stringify(built.pack.entries);
    await L.resetDraft();
    const imp = await L.importZip(built.zip);
    await imp.load();
    const after = L.getDraft();
    const strip = (es) => JSON.stringify(Object.fromEntries(Object.entries(es).map(([k, e]) => [k, { files: e.files, vol: e.vol, fit: e.fit }])));
    return { level: built.report.level, files: built.pack.credits, same: strip(JSON.parse(before)) === strip(after.entries), version: after.meta.version, madeFor: built.pack.entries.special.madeForMs };
  })()`);
  check(rt && !rt.error && rt.level !== "incompatible", "export balíka (report kompatibility)", JSON.stringify(rt));
  check(rt?.same === true, "export → import: rovnaké položky");
  check(rt?.files?.["sounds/custom/moj-uder.wav"]?.own === true && rt?.files?.["sounds/lib/kenney-digital-audio/zap2.ogg"]?.license === "CC0 1.0", "kredity: vlastný súbor aj licencia z knižnice");
  check(rt?.version === 2 && rt?.madeFor > 0, "verzia konceptu po importe +1, okno uložené v balíku");

  console.log("vyskúšať v hre:");
  await ev(`localStorage.setItem("arena.soundPreview", "1")`);
  await send("Page.navigate", { url: `${URL0}/` }); await sleep(2500);
  const layer = await ev(`import("/client/sound.js").then(async m => { await m.soundReady; return [m.entryFor("hit.naruto")?.layer, m.entryFor("special")?.layer, m.entryFor("hit")?.layer]; })`);
  check(JSON.stringify(layer) === JSON.stringify(["draft", "draft", "base"]), "hra hrá koncept nad základom", JSON.stringify(layer));
  await ev(`localStorage.setItem("arena.soundPreview", "0")`);
  await send("Page.navigate", { url: `${URL0}/sound-lab.html` }); await sleep(2500);
  console.log("lab - zmena cez UI:");
  await ev(`window.__soundLab.resetDraft()`);
  const fresh = await ev(`document.getElementById("state").className + "|" + document.getElementById("state").textContent`);
  check(/clean/.test(fresh) && /bez zmien/.test(fresh), "na začiatku: predvolené zvuky bez zmien", fresh);
  await ev(`document.querySelector('[data-edit="hit"]').click()`); await sleep(300);
  await ev(`document.getElementById("q").value = "zap2"; document.getElementById("q").dispatchEvent(new Event("input")); document.querySelector("#lib [data-add]").click()`); await sleep(500);
  const dirty = await ev(`JSON.stringify({ st: document.getElementById("state").className + "|" + document.getElementById("state").textContent,
    meta: window.__soundLab.getDraft().meta, row: document.querySelector('.ev[data-k="hit"]').className, badge: document.querySelector('.ev[data-k="hit"] .badge').textContent })`);
  const d = JSON.parse(dirty);
  check(/dirty/.test(d.st) && /NEULOŽENÉ/.test(d.st) && /1 zmena/.test(d.st), "po zmene: hneď uložené do konceptu, stav NEULOŽENÉ", d.st);
  check(/^Balík /.test(d.meta.name) && /^balik-\d{8}-\d{4}$/.test(d.meta.id) && d.meta.version === 1, "prvá zmena založí nový balík s generickým názvom", JSON.stringify(d.meta));
  check(/changed/.test(d.row) && d.badge === "zmenené", "riadok označený ako zmenený");
  await ev(`document.getElementById("export").click()`); await sleep(1500);
  const saved = await ev(`document.getElementById("state").className + "|" + document.getElementById("state").textContent`);
  check(/clean/.test(saved) && /uložený/.test(saved), "po uložení: stav uložené", saved);
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  const shot = (await send("Page.captureScreenshot")).result?.data;
  if (shot && process.env.SOUND_SMOKE_SHOT) fs.writeFileSync(process.env.SOUND_SMOKE_SHOT, Buffer.from(shot, "base64"));

  check(net.bad.length === 0, "žiadne zlyhané požiadavky na zvuky", net.bad.join(", "));
  check(errs.length === 0, "žiadne JS chyby", errs.join(" | "));
  ws.close();
} catch (e) {
  failures++;
  console.log("  FAIL ", e.message);
} finally {
  cleanup();
}
console.log(failures ? `\nsound-smoke: ${failures} ZLYHANÍ` : "\nsound-smoke: OK");
setTimeout(() => process.exit(failures ? 1 : 0), 1200);
