// test/golden.mjs - golden-master testy: deterministické zápasy (ARENA_SEED + seedované fronty) → timeline
// sa porovnajú s uloženými v test/golden/*.json. Záchranná sieť pre refaktor (docs/REFACTOR_PLAN.md):
// akákoľvek zmena správania (aj kozmetická vo frame-och) sa prejaví ako diff.
// Spustenie:  node test/golden.mjs            → porovnanie
//             node test/golden.mjs --update   → prepíše golden súbory (len vedome, s vysvetlením v commite)
//             node test/golden.mjs fire_vs_onre  → len scenáre obsahujúce daný podreťazec
import { spawn } from "child_process";
import { io } from "socket.io-client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const PORT = 3995;
const URL = `http://localhost:${PORT}`;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(ROOT, "golden");
const UPDATE = process.argv.includes("--update");
const FILTER = process.argv.slice(2).filter(a => !a.startsWith("--"));
const MAX_ROUNDS = 15;
let serverProc = null;

// rovnaký PRNG ako server (mulberry32) - generuje fronty hráčov
function seededRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// scenáre: každá p1 postava proti dvom p2 súperom (každý p2 súper tak padne 2×) + pár explicitných zrkadiel
const P1_CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf", "countess", "luffy"];
const P2_CHARS = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf", "onre", "jotaro"];
const SCENARIOS = [];
P1_CHARS.forEach((c, i) => {
  SCENARIOS.push([c, P2_CHARS[i]]);
  SCENARIOS.push([c, P2_CHARS[(i + 4) % P2_CHARS.length]]);
});
for (const pair of [["naruto", "naruto"], ["minotaur", "minotaur"], ["countess", "jotaro"], ["luffy", "onre"]])
  if (!SCENARIOS.some(s => s[0] === pair[0] && s[1] === pair[1])) SCENARIOS.push(pair);
// každá dvojica 2× - druhý beh má iné seedy frontov (seed závisí od indexu scenára)
SCENARIOS.push(...SCENARIOS.map(p => [...p]));
// Portal Realm (docs/PORTAL_PLAN.md): postavy s mechanikami cez portály - pohyb/dash, strely, charge, slnko,
// guľa, klon, labyrint, THE WORLD. Pridané ZA bridge scenáre, takže tie si držia indexy, seedy aj súbory.
for (const pair of [["naruto", "werewolf"], ["countess", "escanor"], ["luffy", "jotaro"], ["escanor", "onre"],
  ["werewolf", "naruto"], ["fire", "minotaur"], ["soldier", "lightning"], ["minotaur", "medusa"]])
  SCENARIOS.push([...pair, "portal"]);
// aj portal realm každá dvojica 2× (iné seedy frontov)
SCENARIOS.push(...SCENARIOS.filter(p => p[2] === "portal").map(p => [...p]));

const MATCH_CONFIG = {
  format: "single",
  tilesPerRound: 2,
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
  timer: "off",
  tilePreview: true,
};

const PORTAL_CONFIG = { ...MATCH_CONFIG, arena: "portal", tilesPerRound: 1,
  tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 },
  portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 } };

const BASIC_TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror", "special1", "demon"];
const TS_TYPES = ["move", "dash", "recharge", "attack", "melee", "shield", "special1"];
const DIRS8 = ["up", "down", "left", "right", "up_left", "up_right", "down_left", "down_right"];
const DIRS_ANY = DIRS8;

function startServer() {
  const proc = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A", PLAYER_KEYS: "testpass", ARENA_SEED: "1" },
    stdio: "ignore",
  });
  return new Promise((resolve) => setTimeout(() => resolve(proc), 1200));
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const sock = io(URL, { transports: ["websocket"], auth: { name, pass: "testpass" } });
    const killer = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 15000);
    const ctx = { sock, slot: null, lastState: null, timelines: [], rooms: null, gameResult: null };
    sock.on("you_are", (s) => { ctx.slot = s?.slot ?? s; });
    sock.on("rooms", (r) => { ctx.rooms = r; });
    // koniec hry príde hneď s timeline; fáza sa na match_over prepne až po jej dohraní → treba sledovať game_result
    sock.on("game_result", (g) => { ctx.gameResult = g; });
    sock.on("state", (s) => { ctx.lastState = s; if (s.timeline) ctx.timelines.push(s.timeline); });
    sock.on("connect", () => { clearTimeout(killer); setTimeout(() => resolve(ctx), 300); });
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function waitFor(cond, timeoutMs = 5000, label = "condition") {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error("waitFor timeout: " + label)); }
    }, 20);
  });
}
// server v niektorých vetvách ack nepošle (zlá fáza…) → timeout, nech beh nevisí
const emitAck = (ctx, ev, ...args) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`${ev}: bez ack (${ctx.slot}, fáza ${ctx.lastState?.phase})`)), 3000);
  ctx.sock.emit(ev, ...args, (r) => { clearTimeout(t); resolve(r); });
});

// kandidát na frontu - väčšina náhodných kandidátov je neplatná (zlý smer pre postavu…), server ich odmietne cez ack
function candidate(rng, me, isStarter) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const stone = Math.min(3, me?.stone || 0);
  const q = Array.from({ length: stone }, () => ({ type: "stoned" }));
  const pool = [...BASIC_TYPES];
  while (q.length < 3) {
    const t = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const a = { type: t };
    const r = rng();
    if (r < 0.75) a.dir = pick(DIRS_ANY);
    if (rng() < 0.3) a.cell = { x: Math.floor(rng() * 4), y: Math.floor(rng() * 3) };
    q.push(a);
  }
  if (!isStarter && rng() < 0.2) q.unshift({ type: rng() < 0.5 ? "golden_shield" : "golden_mirror" });
  // Last Stand zriedka - doom inak ukončí väčšinu hier v pár kolách a pokrytie ostatných mechaník klesne
  if (rng() < 0.15) q.push({ type: rng() < 0.85 ? "golden_mana" : "last_stand" });
  if (rng() < 0.05) q.unshift({ type: "last_hope" });
  return q;
}

async function lockWithRetry(ctx, rng, me, isStarter, turn) {
  for (let i = 0; i < 2000; i++) {
    const q = candidate(rng, me, isStarter);
    const r = await emitAck(ctx, "lock_in", q, turn);
    if (r?.ok) return q;
  }
  throw new Error(`${ctx.slot}: nenašla sa platná fronta`);
}

async function timestopWithRetry(ctx, rng) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  for (let i = 0; i < 2000; i++) {
    const pool = [...TS_TYPES];
    const q = [];
    while (q.length < 3) {
      const a = { type: pool.splice(Math.floor(rng() * pool.length), 1)[0] };
      if (rng() < 0.75) a.dir = pick(DIRS_ANY);
      q.push(a);
    }
    const r = await emitAck(ctx, "timestop_actions", q);
    if (r?.ok) return q;
  }
  throw new Error("timestop: nenašla sa platná fronta");
}

const lastFrameHas = (tl, kind) => (tl?.[tl.length - 1]?.effects || []).some(e => e.kind === kind);

async function waitTimelines(clients, counts) {
  await waitFor(() => clients.every((c, i) => c.timelines.length > counts[i]), 8000, "timeline");
  await sleep(120); // nech dôjde aj root snapshot
  return clients.map((c, i) => c.timelines.slice(counts[i]));
}

async function runScenario(c1, c2, [ch1, ch2, arena], idx) {
  c1.gameResult = c2.gameResult = null;
  c1.sock.emit("retry");
  await sleep(150);
  c1.sock.emit("configure_match", arena === "portal" ? PORTAL_CONFIG : MATCH_CONFIG);
  await waitFor(() => c1.lastState?.phase === "playing" && c2.lastState?.phase === "playing", 5000, "playing");
  c1.sock.emit("choose_character", ch1);
  c2.sock.emit("choose_character", ch2);
  await waitFor(() => c1.lastState?.p1?.char === ch1 && c1.lastState?.p2?.char === ch2, 5000, "chars");
  await sleep(100);

  const rngs = { p1: seededRng(1000 + idx * 2), p2: seededRng(1001 + idx * 2) };
  const rounds = [];
  const start = { p1: c1.lastState.p1, p2: c1.lastState.p2, tiles: c1.lastState.tiles ?? null };
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const st = c1.lastState;
    if (st.phase !== "playing" || c1.gameResult) break;
    const counts = [c1.timelines.length, c2.timelines.length];
    const starter = st.starter;
    // poradie lockov je deterministické (p1 potom p2) - kolo sa vyhodnotí až pri druhom
    const q1 = await lockWithRetry(c1, rngs.p1, st.p1, starter === "p1", st.turn);
    const q2 = await lockWithRetry(c2, rngs.p2, c2.lastState.p2, starter === "p2", st.turn);
    let [v1, v2] = await waitTimelines([c1, c2], counts);
    let ts = null;
    // THE WORLD: partial timeline končí timestop_wait → Jotaro pošle zmrazené akcie, príde pokračovanie
    while (lastFrameHas(v1[v1.length - 1], "timestop_wait")) {
      const jo = c1.lastState.timestop?.slot === "p1" ? c1 : c2;
      const n = [c1.timelines.length, c2.timelines.length];
      ts = await timestopWithRetry(jo, jo === c1 ? rngs.p1 : rngs.p2);
      const [w1, w2] = await waitTimelines([c1, c2], n);
      v1 = v1.concat(w1); v2 = v2.concat(w2);
    }
    const p1view = JSON.stringify(v1), p2view = JSON.stringify(v2);
    rounds.push({ q1, q2, ...(ts ? { ts } : {}), p1view: v1, p2view: p1view === p2view ? "same" : v2 });
    if (c1.gameResult) break;
    // medzi hrami/po konci zápasu môže server ešte poslať snapshoty - ustáľ
    await sleep(50);
  }
  return { pair: [ch1, ch2], start, rounds, final: { result: c1.gameResult, p1hp: c1.lastState.p1?.hp, p2hp: c1.lastState.p2?.hp } };
}

// delta kódovanie: prvý frame timeline celý, ďalšie len kľúče zmenené voči predošlému (hráči p1/p2 po poliach).
// Zmena čohokoľvek sa v diffe prejaví, len súbory nie sú 10× väčšie kvôli opakovanému configu/sérii/menám.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function deltaFrame(prev, fr) {
  const out = {};
  for (const k of new Set([...Object.keys(prev), ...Object.keys(fr)])) {
    if (k === "effects" || k === "delayMs") { out[k] = fr[k]; continue; }
    if (same(prev[k], fr[k])) continue;
    if ((k === "p1" || k === "p2") && prev[k] && fr[k]) {
      const d = {};
      for (const kk of new Set([...Object.keys(prev[k]), ...Object.keys(fr[k])]))
        if (!same(prev[k][kk], fr[k][kk])) d[kk] = fr[k][kk] === undefined ? "<undefined>" : fr[k][kk];
      out[k] = { "~": d };
    } else out[k] = fr[k] === undefined ? "<undefined>" : fr[k];
  }
  return out;
}
const encodeTimeline = (tl) => tl.map((fr, i) => (i === 0 ? fr : deltaFrame(tl[i - 1], fr)));

// formát: jeden frame = jeden riadok → diff v gite je čitateľný a malý
function serialize(rec) {
  const lines = ["{", `  "pair": ${JSON.stringify(rec.pair)},`, `  "start": ${JSON.stringify(rec.start)},`, `  "rounds": [`];
  rec.rounds.forEach((rd, i) => {
    lines.push("    {");
    lines.push(`      "q1": ${JSON.stringify(rd.q1)},`);
    lines.push(`      "q2": ${JSON.stringify(rd.q2)},`);
    if (rd.ts) lines.push(`      "ts": ${JSON.stringify(rd.ts)},`);
    for (const key of ["p1view", "p2view"]) {
      const v = rd[key];
      const comma = key === "p1view" ? "," : "";
      if (v === "same") { lines.push(`      "${key}": "same"${comma}`); continue; }
      lines.push(`      "${key}": [`);
      v.forEach((tl, ti) => {
        lines.push("        [");
        encodeTimeline(tl).forEach((fr, fi, arr) => lines.push(`          ${JSON.stringify(fr)}${fi < arr.length - 1 ? "," : ""}`));
        lines.push(`        ]${ti < v.length - 1 ? "," : ""}`);
      });
      lines.push(`      ]${comma}`);
    }
    lines.push(`    }${i < rec.rounds.length - 1 ? "," : ""}`);
  });
  lines.push("  ],", `  "final": ${JSON.stringify(rec.final)}`, "}", "");
  return lines.join("\n");
}

// prvý rozdiel medzi uloženým a aktuálnym záznamom (riadok) - pre čitateľný výpis
function firstDiff(a, b) {
  const la = a.split("\n"), lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++)
    if (la[i] !== lb[i]) return { line: i + 1, expected: (la[i] ?? "<EOF>").slice(0, 400), actual: (lb[i] ?? "<EOF>").slice(0, 400) };
  return null;
}

async function main() {
  serverProc = await startServer();
  const c1 = await connect("goldena");
  const c2 = await connect("goldenb");
  c1.sock.emit("create_room");
  await waitFor(() => c1.slot, 5000, "create_room");
  await waitFor(() => c2.rooms?.rooms?.length > 0, 5000, "room list");
  c2.sock.emit("join_room", { roomId: c2.rooms.rooms[0].id });
  await waitFor(() => c2.slot, 5000, "join_room");
  if (c1.slot !== "p1" || c2.slot !== "p2") throw new Error(`sloty ${c1.slot}/${c2.slot}`);

  if (UPDATE) fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  let failures = 0, ran = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const name = `${String(i).padStart(2, "0")}_${SCENARIOS[i][2] ? SCENARIOS[i][2] + "_" : ""}${SCENARIOS[i][0]}_vs_${SCENARIOS[i][1]}`;
    if (FILTER.length && !FILTER.some(f => name.includes(f))) continue;
    ran++;
    const rec = await runScenario(c1, c2, SCENARIOS[i], i);
    const text = serialize(rec);
    const file = path.join(GOLDEN_DIR, name + ".json");
    if (UPDATE) {
      fs.writeFileSync(file, text);
      console.log(`  WROTE ${name} (${rec.rounds.length} kôl, ${rec.final.result ? "koniec hry" : "limit kôl"})`);
      continue;
    }
    if (!fs.existsSync(file)) { failures++; console.log(`  FAIL  ${name}: chýba golden súbor (spusti s --update)`); continue; }
    const expected = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const d = firstDiff(expected, text);
    if (!d) console.log(`  PASS  ${name}`);
    else {
      failures++;
      console.log(`  FAIL  ${name}: rozdiel na riadku ${d.line}\n        golden: ${d.expected}\n        teraz:  ${d.actual}`);
    }
  }
  c1.sock.close(); c2.sock.close();
  serverProc.kill();
  if (UPDATE) { console.log(`\nGolden súbory zapísané (${ran}).`); process.exit(0); }
  console.log(failures ? `\n${failures} GOLDEN ROZDIELOV` : `\nGOLDEN MASTER SEDÍ (${ran} scenárov)`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); serverProc?.kill(); process.exit(1); });
