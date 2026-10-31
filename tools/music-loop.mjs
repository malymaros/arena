// tools/music-loop.mjs - príprava hudobnej slučky pre hru (docs/SOUNDS.md, „Orezanie a slučka hudby"): v headless Chrome
// dekóduje skladbu, odhadne tempo, nájde dve miesta s rovnakou hudbou o celý počet taktov od seba (podobnosť pásmového
// spektra, spresnenie na 1 ms podľa nábehov úderov), vyreže úsek po MP3 rámcoch (bez prekódovania, s prepočítanou
// Xing hlavičkou pre VBR) a zmeria hlasitosť (LUFS, BS.1770) úseku slučky.
// Hra hrá úsek [trim[0], trim[1]] a posledných LOOP_XFADE_MS (1,5 s) prelína so začiatkom → koniec = začiatok + slučka + 1,5 s.
//
//   node tools/music-loop.mjs <vstup.mp3> <výstup.mp3> [--bars 16-40] [--from 10] [--ref -17.9]
//   → vypíše tempo, kandidátov, trim [ms] pre manifest a vol, s ktorým bude slučka mať --ref LUFS (default = music.battle)
import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const [SRC, OUT] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!SRC || !OUT) { console.error("použitie: node tools/music-loop.mjs <vstup.mp3> <výstup.mp3> [--bars 16-40] [--from 10] [--ref -17.9]"); process.exit(2); }
const [BARS_MIN, BARS_MAX] = opt("bars", "16-40").split("-").map(Number);
const FROM_S = Number(opt("from", 8));      // slučka nezačína v úvode skladby
const REF_LUFS = Number(opt("ref", -17.9)); // music.battle: −9,9 LUFS × vol 0,40
const XFADE_MS = 1500;                      // public/sounds/trim.js LOOP_XFADE_MS
const BROWSER = process.env.CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(p => fs.existsSync(p));
if (!BROWSER) { console.error("Nenašiel sa Chrome/Edge (nastav CHROME=cesta)"); process.exit(2); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- MP3 rámce (MPEG1/2 Layer III) ---------- */
const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const SRT = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function mp3Frames(b) {
  let p = 0;
  if (b.toString("latin1", 0, 3) === "ID3") p = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  const frames = [];
  while (p + 4 < b.length) {
    if (b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) { p++; continue; }
    const ver = (b[p + 1] >> 3) & 3, layer = (b[p + 1] >> 1) & 3, bri = b[p + 2] >> 4, sri = (b[p + 2] >> 2) & 3, pad = (b[p + 2] >> 1) & 1;
    if (layer !== 1 || ver === 1 || bri === 0 || bri === 15 || sri === 3) { p++; continue; }
    const br = BR[ver === 3 ? 1 : 2][bri], sr = SRT[ver][sri];
    const len = Math.floor((ver === 3 ? 144 : 72) * br * 1000 / sr) + pad;
    frames.push({ p, len, sr, spf: ver === 3 ? 1152 : 576 });
    p += len;
  }
  return frames;
}
// úsek [fromMs, toMs] po celých rámcoch; pri VBR (Xing/Info v 1. rámci) sa hlavička prepočíta pre nový úsek
function cutMp3(buf, fromMs, toMs) {
  const fr = mp3Frames(buf);
  const head = buf.subarray(fr[0].p, fr[0].p + fr[0].len);
  const xp = head.indexOf("Xing") >= 0 ? head.indexOf("Xing") : head.indexOf("Info");
  const audio = xp >= 0 ? fr.slice(1) : fr;
  const ms = audio[0].spf / audio[0].sr * 1000;
  const a = Math.max(0, Math.floor(fromMs / ms)), z = Math.min(audio.length, Math.ceil(toMs / ms));
  const body = Buffer.concat(audio.slice(a, z).map(f => buf.subarray(f.p, f.p + f.len)));
  if (xp < 0) return { data: body, cutMs: a * ms };
  const x = Buffer.from(head), flags = x.readUInt32BE(xp + 4), total = x.length + body.length;
  let o = xp + 8;
  if (flags & 1) { x.writeUInt32BE(z - a, o); o += 4; }
  if (flags & 2) { x.writeUInt32BE(total, o); o += 4; }
  if (flags & 4) {
    let off = 0; const offs = audio.slice(a, z).map(f => { const v = off; off += f.len; return v; });
    for (let i = 0; i < 100; i++) x[o + i] = Math.min(255, Math.floor((x.length + offs[Math.floor(i / 100 * offs.length)]) / total * 256));
  }
  return { data: Buffer.concat([x, body]), cutMs: a * ms };
}

/* ---------- analýza v prehliadači ---------- */
const files = { "/a.mp3": SRC };
const srv = http.createServer((q, s) => {
  const f = files[q.url];
  if (f) { s.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" }); fs.createReadStream(f).pipe(s); }
  else { s.writeHead(200, { "Content-Type": "text/html" }); s.end("<!doctype html><title>music-loop</title>"); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "music-loop-"));
const port = 9400 + Math.floor(Math.random() * 50);
const proc = spawn(BROWSER, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${dataDir}`, "--no-first-run", "--mute-audio", "about:blank"], { stdio: "ignore" });
let list = null;
for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch {} }
const ws = new WebSocket(list.find(t => t.type === "page").webSocketDebuggerUrl, { maxPayload: 1 << 30 });
await new Promise(r => ws.once("open", r));
let id = 0;
const pend = new Map();
ws.on("message", (raw) => { const m = JSON.parse(raw); if (m.id) pend.get(m.id)?.(m); });
const send = (method, params = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.navigate", { url: base + "/" });
await sleep(500);
const run = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "chyba v stránke");
  return r.result.result.value;
};
// dekódovanie do window.X (mono) + obálka 1 ms (window.ENV) + pásmové spektrum (24 log pásiem, krok 1024)
const DECODE = (url) => `(async () => {
  const ab = await new OfflineAudioContext(1, 44100, 44100).decodeAudioData(await (await fetch("${url}")).arrayBuffer());
  const sr = ab.sampleRate, n = ab.length, x = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) x[i] += d[i] / ab.numberOfChannels; }
  const hop = Math.round(sr / 1000), m = Math.floor(n / hop), env = new Float32Array(m);
  for (let i = 0; i < m; i++) { let e = 0; for (let k = 0; k < hop; k++) e += Math.abs(x[i * hop + k]); env[i] = e; }
  window.AB = ab; window.X = x; window.ENV = env; window.SR = sr;
  return { sr, dur: n / sr };
})()`;
const FEATURES = `(() => {
  const x = window.X, sr = window.SR, N = 2048, H = 1024, nb = 24, frames = Math.floor((x.length - N) / H);
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
  const re = new Float32Array(N), im = new Float32Array(N);
  const fft = () => { for (let i = 1, j = 0; i < N; i++) { let b = N >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k, q = p + len / 2, vr = re[q] * cr - im[q] * ci, vi = re[q] * ci + im[q] * cr;
        re[q] = re[p] - vr; im[q] = im[p] - vi; re[p] += vr; im[p] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } };
  const edges = Array.from({ length: nb + 1 }, (_, i) => Math.round(60 * Math.pow(11000 / 60, i / nb) / sr * N));
  const feat = [];
  for (let f = 0; f < frames; f++) { for (let i = 0; i < N; i++) { re[i] = x[f * H + i] * win[i]; im[i] = 0; } fft();
    const row = []; for (let b = 0; b < nb; b++) { let s = 0; for (let k = edges[b]; k < Math.max(edges[b] + 1, edges[b + 1]); k++) s += re[k] * re[k] + im[k] * im[k]; row.push(Math.log(1e-9 + s)); }
    const mean = row.reduce((a, b) => a + b) / nb; feat.push(row.map(v => +(v - mean).toFixed(3))); }
  return { fps: sr / H, feat };
})()`;
// LUFS (BS.1770: K-váženie, bloky 400 ms, hradlá −70 LUFS a −10 LU) úseku [a, b] ms + vrchol
const LOUD = (a, b) => `(async () => {
  const ab = window.AB, sr = ab.sampleRate, i0 = Math.floor(${a} / 1000 * sr), i1 = Math.min(ab.length, Math.floor(${b} / 1000 * sr)), len = i1 - i0;
  const oc = new OfflineAudioContext(ab.numberOfChannels, len, sr), part = oc.createBuffer(ab.numberOfChannels, len, sr);
  let peak = 0;
  for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c).subarray(i0, i1); part.copyToChannel(d, c); for (let j = 0; j < d.length; j++) peak = Math.max(peak, Math.abs(d[j])); }
  const src = oc.createBufferSource(); src.buffer = part;
  const sh = oc.createBiquadFilter(); sh.type = "highshelf"; sh.frequency.value = 1681; sh.gain.value = 4;
  const hp = oc.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 38; hp.Q.value = 0.5;
  src.connect(sh).connect(hp).connect(oc.destination); src.start();
  const r = await oc.startRendering(), ch = Array.from({ length: r.numberOfChannels }, (_, c) => r.getChannelData(c));
  const B = Math.round(0.4 * sr), Hh = Math.round(0.1 * sr), blocks = [];
  for (let st = 0; st + B <= r.length; st += Hh) { let z = 0; for (const d of ch) { let q = 0; for (let j = st; j < st + B; j++) q += d[j] * d[j]; z += q / B; } blocks.push(z); }
  const L = (z) => -0.691 + 10 * Math.log10(z), mean = (xs) => xs.reduce((p, q) => p + q, 0) / xs.length;
  let g = blocks.filter(z => L(z) > -70); const rel = L(mean(g)) - 10; g = g.filter(z => L(z) > rel);
  return { lufs: L(mean(g)), peakDb: 20 * Math.log10(peak) };
})()`;

let code = 0;
try {
  const info = await run(DECODE("/a.mp3"));
  const { fps, feat } = await run(FEATURES);
  // tempo: autokorelácia nábehov (kladné zmeny spektra) v rozsahu 70–190 BPM
  const on = feat.map((r, i) => (i ? r.reduce((s, v, b) => s + Math.max(0, v - feat[i - 1][b]), 0) : 0));
  const mu = on.reduce((a, b) => a + b) / on.length, o = on.map(v => v - mu);
  let bpm = 0, bestA = -Infinity;
  for (let t = 70; t <= 190; t += 0.25) { const lag = 60 / t * fps, l = Math.floor(lag), f = lag - l; let s = 0;
    for (let i = 0; i + l + 1 < o.length; i++) s += o[i] * (o[i + l] * (1 - f) + o[i + l + 1] * f); if (s > bestA) { bestA = s; bpm = t; } }
  const bar = 4 * 60 / bpm;
  // koniec hudby: posledná sekunda s hlasitosťou > 5 % maxima obálky
  const env = await run(`Array.from(window.ENV.filter((_, i) => i % 100 === 0))`);
  const maxE = Math.max(...env), endS = (env.length - 1 - [...env].reverse().findIndex(v => v > maxE * 0.05)) / 10;
  // kandidáti: S od FROM_S, slučka N taktov (±0,4 s), podobnosť 6 s spektra po S a po S+L
  const W = Math.round(6 * fps);
  const sim = (a, b) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < W; i++) { const x = feat[a + i], y = feat[b + i]; if (!x || !y) return -1;
    for (let k = 0; k < x.length; k++) { s += x[k] * y[k]; na += x[k] * x[k]; nb += y[k] * y[k]; } } return s / Math.sqrt(na * nb); };
  const cands = [];
  for (let S = FROM_S; S < endS; S += 0.05) for (let N = BARS_MIN; N <= BARS_MAX; N++) {
    let best = [-2, 0];
    for (let dl = -0.4; dl <= 0.4; dl += 0.023) { const L = N * bar + dl; if (S + L + XFADE_MS / 1000 + 6 > endS) continue;
      const v = sim(Math.round(S * fps), Math.round((S + L) * fps)); if (v > best[0]) best = [v, L]; }
    if (best[0] > 0) cands.push({ sim: best[0], S, N, L: best[1] });
  }
  if (!cands.length) throw new Error("nenašla sa slučka - skús iný rozsah --bars alebo --from");
  // preferuj dlhšiu slučku: skóre = podobnosť + malý bonus za dĺžku (opakovanie je menej nápadné)
  cands.sort((a, b) => (b.sim + b.N * 0.004) - (a.sim + a.N * 0.004));
  const top = [];
  for (const c of cands) { if (!top.some(t => Math.abs(t.S - c.S) < 3 && t.N === c.N)) top.push(c); if (top.length === 5) break; }
  // spresnenie najlepšieho na 1 ms (korelácia nábehov úderov, okno 6 s)
  const best = top[0];
  const refine = await run(`(() => { const env = window.ENV, on = new Float32Array(env.length); for (let i = 1; i < env.length; i++) on[i] = Math.max(0, env[i] - env[i - 1]);
    const S0 = ${Math.round(best.S * 1000)}, L0 = ${Math.round(best.L * 1000)}; let best = [-1, 0, 0];
    for (let ds = -25; ds <= 25; ds += 5) for (let dl = -60; dl <= 60; dl++) { let s = 0, a = 0, b = 0;
      for (let i = 0; i < 6000; i++) { const p = on[S0 + ds + i], q = on[S0 + ds + L0 + dl + i]; s += p * q; a += p * p; b += q * q; }
      const c = s / Math.sqrt(a * b); if (c > best[0]) best = [c, ds, dl]; }
    return { S: S0 + best[1], L: L0 + best[2], corr: best[0] }; })()`);
  const S = refine.S, L = refine.L, E = S + L + XFADE_MS;
  const loud = await run(LOUD(S, E));
  // rez s rezervou (bit reservoir / oneskorenie dekodéra) a presná poloha S v orezanom súbore
  const { data, cutMs } = cutMp3(fs.readFileSync(SRC), S - 600, E + 400);
  fs.writeFileSync(OUT, data);
  const origEnv = await run(`Array.from(window.ENV.slice(${S}, ${S + 4000}))`);
  files["/b.mp3"] = OUT;
  const cut = await run(DECODE("/b.mp3"));
  const off = await run(`(() => { const ref = ${JSON.stringify(origEnv)}, env = window.ENV; let best = [-1, 0];
    for (let d = 0; d < 1500; d++) { let s = 0, a = 0, b = 0; for (let i = 0; i < 4000; i++) { const p = ref[i], q = env[d + i]; s += p * q; a += p * p; b += q * q; }
      const c = s / Math.sqrt(a * b); if (c > best[0]) best = [c, d]; } return best; })()`);
  const t0 = off[1], t1 = t0 + L + XFADE_MS;
  const vol = Math.round(Math.min(1, 10 ** ((REF_LUFS - loud.lufs) / 20)) * 100) / 100;
  console.log(`skladba ${info.dur.toFixed(1)} s, hudba do ${endS.toFixed(1)} s, tempo ${bpm} BPM (takt ${bar.toFixed(3)} s)`);
  console.log("kandidáti (podobnosť, začiatok, takty, slučka):");
  for (const c of top) console.log(`  ${c.sim.toFixed(3)}  S ${c.S.toFixed(2)} s  ${c.N} taktov  L ${c.L.toFixed(2)} s`);
  console.log(`zvolené: S ${S} ms, slučka ${L} ms (${best.N} taktov), korelácia úderov ${refine.corr.toFixed(3)}, koniec ${E} ms`);
  console.log(`výstup: ${OUT} - ${cut.dur.toFixed(2)} s, ${(data.length / 1024).toFixed(0)} kB (rez od ${(cutMs / 1000).toFixed(2)} s originálu)`);
  console.log(`zhoda začiatku v orezanom súbore: ${off[0].toFixed(4)}`);
  console.log(`trim: [${t0}, ${t1}]`);
  console.log(`hlasitosť slučky ${loud.lufs.toFixed(1)} LUFS, vrchol ${loud.peakDb.toFixed(1)} dBFS → vol ${vol} (cieľ ${REF_LUFS} LUFS${vol >= 1 && loud.lufs + 0 < REF_LUFS ? ", nahrávka je tichšia - aj pri vol 1 ostane " + (loud.lufs - REF_LUFS).toFixed(1) + " dB pod cieľom" : ""})`);
} catch (e) {
  console.error(e.message); code = 1;
} finally {
  ws.close(); proc.kill(); srv.close();
  setTimeout(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} process.exit(code); }, 800);
}
