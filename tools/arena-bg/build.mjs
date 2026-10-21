// tools/arena-bg/build.mjs - vrstvy pozadia arény zmenšené na rozlíšenie, v ktorom ich hra kreslí.
// Klient (public/client/arena-bg.js) kreslí každú vrstvu do canvasu ARENA_RES (320×180) cez „cover" drawImage
// a CSS ho roztiahne s pixelated. Originály majú 3840 px (spolu ~20 MB), z ktorých sa po zmenšení použije zlomok.
// Tento skript urobí to isté zmenšenie VOPRED - v headless Chrome, rovnakým drawImage ako klient, takže výsledok
// je pixelovo zhodný - a uloží hotové 320×180 PNG do public/arenas/<aréna>/. Klient ich potom kreslí 1:1.
// Na záver sám overí zhodu: obe cesty (originál → canvas, nový PNG → canvas) vykreslí a porovná pixely.
//
//   node tools/arena-bg/build.mjs        (originály: tools/arena-bg/src/<aréna>/*.png)
// Zmena ARENA_RES v arena-bg.js = spusti znova.
import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SRC = "tools/arena-bg/src";
const OUT = "public/arenas";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clientSrc = fs.readFileSync("public/client/arena-bg.js", "utf8");
const m = clientSrc.match(/ARENA_RES\s*=\s*\{\s*w:\s*(\d+),\s*h:\s*(\d+)\s*\}/);
if (!m) { console.error("ARENA_RES sa nenašiel v public/client/arena-bg.js"); process.exit(2); }
const RES = { w: Number(m[1]), h: Number(m[2]) };

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const BROWSER = process.env.CHROME || BROWSERS.find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }

// mini server: /src/... = originály, /out/... = vygenerované vrstvy
const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>arena-bg</title>"); return; }
  const file = u.startsWith("/src/") ? path.join(SRC, u.slice(5)) : u.startsWith("/out/") ? path.join(OUT, u.slice(5)) : null;
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": file.endsWith(".png") ? "image/png" : "text/html", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-bg-"));
const cdpPort = 9400 + Math.floor(Math.random() * 50);
const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${dataDir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
let list = null;
for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); } catch {} }
const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise(r => ws.once("open", r));
let id = 0; const pend = new Map();
ws.on("message", raw => { const msg = JSON.parse(raw); if (msg.id && pend.has(msg.id)) { pend.get(msg.id)(msg); pend.delete(msg.id); } });
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "chyba v stránke");
  return r.result?.result?.value;
};
await send("Page.navigate", { url: base + "/" }); // prázdna stránka na rovnakom origine ako obrázky
await sleep(500);

// rovnaký výpočet ako renderArenaLayers v public/client/arena-bg.js (cover do RES)
const DRAW = `(url) => new Promise((ok, fail) => {
  const img = new Image();
  img.onload = () => {
    const cvs = document.createElement("canvas"); cvs.width = ${RES.w}; cvs.height = ${RES.h};
    const ctx = cvs.getContext("2d");
    const s = Math.max(${RES.w} / img.width, ${RES.h} / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (${RES.w} - dw) / 2, (${RES.h} - dh) / 2, dw, dh);
    ok(cvs);
  };
  img.onerror = () => fail(new Error("nenačítal sa " + url));
  img.src = url;
})`;

let worst = 0;
try {
  for (const arena of fs.readdirSync(SRC)) {
    fs.mkdirSync(path.join(OUT, arena), { recursive: true });
    for (const file of fs.readdirSync(path.join(SRC, arena)).filter(f => f.endsWith(".png"))) {
      const b64 = await evaluate(`(${DRAW})("/src/${arena}/${file}").then(c => c.toDataURL("image/png").split(",")[1])`);
      const out = path.join(OUT, arena, file);
      fs.writeFileSync(out, Buffer.from(b64, "base64"));
      // overenie: stará cesta (originál) vs. nová (zmenšený PNG) - obe cez rovnaký kód klienta
      const diff = await evaluate(`Promise.all([(${DRAW})("/src/${arena}/${file}"), (${DRAW})("/out/${arena}/${file}")]).then(([a, b]) => {
        const da = a.getContext("2d").getImageData(0, 0, ${RES.w}, ${RES.h}).data, db = b.getContext("2d").getImageData(0, 0, ${RES.w}, ${RES.h}).data;
        let max = 0; for (let i = 0; i < da.length; i++) max = Math.max(max, Math.abs(da[i] - db[i]));
        return max;
      })`);
      worst = Math.max(worst, diff);
      const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0);
      console.log(`${arena}/${file}: ${kb(path.join(SRC, arena, file))} kB → ${kb(out)} kB (${RES.w}×${RES.h}), max. rozdiel pixelu ${diff}`);
    }
  }
} finally {
  ws.close(); proc.kill(); srv.close();
  setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 1500);
}
// ±2 = zaokrúhlenie premultiplikovanej alfy pri uložení/načítaní PNG (polopriehľadné okraje mrakov), okom nerozoznateľné
if (worst > 2) { console.error(`ROZDIEL ${worst} > 2 - zmenšené vrstvy sa líšia od pôvodného vykreslenia`); process.exitCode = 1; }
else console.log(`OK - vykreslenie zhodné (max. rozdiel ${worst})`);
