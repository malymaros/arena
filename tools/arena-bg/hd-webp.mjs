// tools/arena-bg/hd-webp.mjs - maľované (HD) pozadie arény: originál PNG → webp v plnom rozlíšení (klient ho kreslí
// cez HD_ARENAS v public/client/arena-bg.js, bez pixelizácie). Prevod robí headless Chrome (canvas.toDataURL webp),
// netreba žiadnu knižnicu na obrázky.
//
//   node tools/arena-bg/hd-webp.mjs tools/arena-bg/src/shrek-swamp/shrek-swamp.png public/arenas/shrek-swamp/shrek-swamp-hd.webp [kvalita=0.9]
import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [src, dst, q = "0.9"] = process.argv.slice(2);
if (!src || !dst) { console.error("použitie: node tools/arena-bg/hd-webp.mjs <src.png> <dst.webp> [kvalita]"); process.exit(2); }
const BROWSER = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((req, res) => {
  if (req.url === "/src.png") { res.writeHead(200, { "Content-Type": "image/png" }); fs.createReadStream(src).pipe(res); return; }
  res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>hd-webp</title>");
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const port = srv.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-webp-"));
const proc = spawn(BROWSER, ["--headless=new", "--remote-debugging-port=9334", `--user-data-dir=${dataDir}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
let list = null;
for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch("http://127.0.0.1:9334/json/list")).json(); } catch {} }
const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { maxPayload: 1 << 30 });
await new Promise(r => ws.once("open", r));
let id = 0;
const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id) pend.get(m.id)?.(m); });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });
await sleep(500);
const r = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression: `new Promise(res => {
  const img = new Image(); img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0); res({ w: img.width, h: img.height, url: c.toDataURL("image/webp", ${Number(q)}) }); };
  img.src = "/src.png"; })` });
const { w, h, url } = r.result.result.value;
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, Buffer.from(url.split(",")[1], "base64"));
console.log(`${dst}: ${w}×${h}, ${(fs.statSync(dst).size / 1024).toFixed(0)} kB`);
ws.close(); proc.kill(); srv.close();
setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} }, 1500);
