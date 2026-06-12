// test/game-test.mjs — integračné testy hernej logiky cez reálne socket spojenia
// Spustenie: node test/game-test.mjs
import { spawn } from "child_process";
import { io } from "socket.io-client";

const PORT = 3996;
const URL = `http://localhost:${PORT}`;

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) { console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

function startServer() {
  const proc = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  return new Promise((resolve) => setTimeout(() => resolve(proc), 1200));
}

function connect() {
  return new Promise((resolve, reject) => {
    const sock = io(URL, { transports: ["websocket"] });
    const ctx = { sock, slot: null, lastState: null, lastTimeline: null, gameOver: null };
    sock.on("you_are", (s) => { ctx.slot = s; });
    sock.on("state", (s) => {
      ctx.lastState = s;
      if (s.timeline) ctx.lastTimeline = s.timeline;
    });
    sock.on("game_over", (g) => { ctx.gameOver = g; });
    sock.on("connect", () => setTimeout(() => resolve(ctx), 300));
    sock.on("connect_error", reject);
  });
}

function waitTimeline(ctx, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (ctx.lastTimeline) { clearInterval(iv); resolve(ctx.lastTimeline); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(iv); reject(new Error("timeline timeout")); }
    }, 50);
  });
}

async function playRound(c1, c2, q1, q2) {
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", q1);
  c2.sock.emit("lock_in", q2);
  const tl = await waitTimeline(c1);
  await new Promise(r => setTimeout(r, 150)); // nech dôjde aj root snapshot
  return tl;
}

function sumEffects(tl) {
  // očakávaná zmena HP podľa efektov v timeline
  const delta = { p1: 0, p2: 0 };
  const hits = [];
  for (const fr of tl) {
    for (const e of fr.effects || []) {
      if (e.kind === "hit")  { delta[e.target] -= e.dmg; hits.push(e); }
      if (e.kind === "heal") { delta[e.target] += e.amount ?? 1; }
      if (e.kind === "golden_mana") { delta[e.from] -= e.hpCost ?? 0; }
    }
  }
  return { delta, hits };
}

function invariantCheck(tl, label) {
  // 1) HP v posledom frame == HP v prvom frame + súčet efektov
  const first = tl[0], last = tl[tl.length - 1];
  const { delta } = sumEffects(tl);
  for (const s of ["p1", "p2"]) {
    const expected = Math.max(0, Math.min(10, first[s].hp + delta[s]));
    check(last[s].hp === expected,
      `${label}: ${s} HP konzistentné s efektami`,
      `prvý=${first[s].hp}, efekty=${delta[s]}, očakávané=${expected}, posledný frame=${last[s].hp}`);
  }
  // 2) HP medzi framami nikdy "neskočí" inak než cez hit/heal efekt
  for (let i = 1; i < tl.length; i++) {
    for (const s of ["p1", "p2"]) {
      const dh = tl[i][s].hp - tl[i - 1][s].hp;
      if (dh === 0) continue;
      const fx = (tl[i].effects || []).filter(e =>
        (e.kind === "hit" && e.target === s) || (e.kind === "heal" && e.target === s) ||
        (e.kind === "golden_mana" && e.from === s));
      const fxDelta = fx.reduce((a, e) =>
        a + (e.kind === "hit" ? -e.dmg : e.kind === "golden_mana" ? -(e.hpCost ?? 0) : (e.amount ?? 1)), 0);
      // hit môže byť orezaný na 0 HP
      const ok = dh === fxDelta || (dh < 0 && tl[i][s].hp === 0 && fxDelta <= dh);
      if (!ok) {
        failures++;
        console.log(`  FAIL  ${label}: frame ${i} ${s} HP skok ${dh} bez zodpovedajúceho efektu (efekty: ${JSON.stringify(tl[i].effects)})`);
      }
    }
  }
}

async function freshGame(c1, c2) {
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 200));
  c1.sock.emit("choose_character", "fire");
  c2.sock.emit("choose_character", "lightning");
  await new Promise(r => setTimeout(r, 200));
}

const M = (dir) => ({ type: "move", dir });
const A = (dir) => ({ type: "attack", dir });
const D = (dir) => ({ type: "dash", dir });
const R = { type: "recharge" };
const S = { type: "shield" };
const B = { type: "block" };
const ML = { type: "melee" };
const G = { type: "golden_shield" };
const GM = { type: "golden_mana" };
const SP = { type: "special" };

async function main() {
  const server = await startServer();
  const c1 = await connect();
  const c2 = await connect();
  check(c1.slot === "p1" && c2.slot === "p2", "sloty pridelené p1/p2");

  /* ---------- Test 1: basic na vzdialenosť 3 → 1 dmg ---------- */
  await freshGame(c1, c2);
  let tl = await playRound(c1, c2, [A("right"), R, S], [R, S, M("up")]);
  let { hits } = sumEffects(tl);
  const h1 = hits.find(h => h.target === "p2");
  check(!!h1 && h1.dmg === 1, "T1: basic dist=3 dáva 1 dmg", `hits=${JSON.stringify(hits)}`);
  invariantCheck(tl, "T1");

  /* ---------- Test 2: priblíženie → dist=1 → 3 dmg ---------- */
  await freshGame(c1, c2);
  // ťah1: P1 ide doprava (0→1), P2 doľava (3→2) => dist 1; ťah2: P1 útočí
  tl = await playRound(c1, c2, [M("right"), A("right"), R], [M("left"), R, S]);
  hits = sumEffects(tl).hits.filter(h => h.target === "p2");
  check(hits.length === 1 && hits[0].dmg === 3, "T2: basic dist=1 dáva 3 dmg", `hits=${JSON.stringify(hits)}`);
  invariantCheck(tl, "T2");

  /* ---------- Test 3: štít blokuje basic ---------- */
  await freshGame(c1, c2);
  // P1 začína. P2 štít v ťahu 1 (druhý aktér) => kryje P1 akciu v ťahu 2 (=útok)
  tl = await playRound(c1, c2, [R, A("right"), M("up")], [S, R, M("up")]);
  const blocks = tl.flatMap(f => f.effects || []).filter(e => e.kind === "block" && e.target === "p2");
  const p2hits = sumEffects(tl).hits.filter(h => h.target === "p2");
  check(blocks.length === 1 && p2hits.length === 0, "T3: štít zablokoval basic", `blocks=${blocks.length}, hits=${JSON.stringify(p2hits)}`);
  invariantCheck(tl, "T3");

  /* ---------- Test 4: melee na rovnakom políčku → 8 dmg ---------- */
  // IK tile sa vie náhodne spawnúť do cesty (10 dmg = predčasný koniec) — vtedy scenár zopakujeme
  let t4tl = null;
  for (let attempt = 0; attempt < 3 && !t4tl; attempt++) {
    await freshGame(c1, c2);
    // kolo 1: P1 → (1,1), P2 → (2,1)
    tl = await playRound(c1, c2, [M("right"), R, S], [R, S, M("left")]);
    if (sumEffects(tl).hits.some(h => h.dmg === 10)) continue;
    // kolo 2 (začína P2): P1 vstúpi na políčko P2 (move spotrebuje P2 štít) a v ťahu 3 udrie melee;
    // P2 lightning special z rovnakého políčka = rovnaká parita → minie
    tl = await playRound(c1, c2, [M("right"), R, ML], [S, R, SP]);
    if (sumEffects(tl).hits.some(h => h.dmg === 10)) continue;
    t4tl = tl;
  }
  check(!!t4tl, "T4: scenár prebehol bez náhodného IK zásahu");
  if (t4tl) {
    const melee = t4tl.flatMap(f => f.effects || []).filter(e => e.kind === "melee");
    const meleeHit = sumEffects(t4tl).hits.find(h => h.target === "p2" && h.dmg === 8);
    check(melee.length === 3, "T4: melee animácia (3 beaty ako special)", `melee=${melee.length}`);
    check(!!meleeHit, "T4: melee na rovnakom políčku dáva 8 dmg", `hits=${JSON.stringify(sumEffects(t4tl).hits)}`);
    invariantCheck(t4tl, "T4");
  }

  /* ---------- Test 5: fuzz — 60 náhodných kôl, invarianty ---------- */
  const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "block"];
  const DIRS = ["up", "down", "left", "right"];
  let rounds = 0;
  for (let g = 0; g < 12; g++) {
    await freshGame(c1, c2);
    c1.gameOver = null; c2.gameOver = null;
    for (let r = 0; r < 5; r++) {
      if (c1.gameOver) break;
      const starter = (r + 1) % 2 === 1 ? "p1" : "p2";
      const rndQ = (slot) => {
        const picked = [...TYPES].sort(() => Math.random() - 0.5).slice(0, 3);
        const q = picked.map(t => (t === "move" || t === "attack" || t === "dash")
          ? { type: t, dir: DIRS[(Math.random() * 4) | 0] }
          : { type: t });
        // ne-starter si občas kúpi golden shield (extra akcia pred kolom)
        if (slot !== starter && Math.random() < 0.3) q.unshift({ type: "golden_shield" });
        // ktokoľvek si občas kúpi golden mana refill (extra akcia po kole)
        if (Math.random() < 0.25) q.push({ type: "golden_mana" });
        return q;
      };
      try {
        tl = await playRound(c1, c2, rndQ("p1"), rndQ("p2"));
      } catch { break; } // hra skončila / server nezareagoval na lock po game over
      invariantCheck(tl, `FUZZ g${g}r${r}`);
      rounds++;
    }
  }
  console.log(`  (fuzz odohral ${rounds} kôl)`);

  /* ---------- Test 6: root snapshot == posledný frame ---------- */
  await freshGame(c1, c2);
  tl = await playRound(c1, c2, [A("right"), R, S], [R, S, M("up")]);
  const last = tl[tl.length - 1];
  const root = c1.lastState;
  check(root.p1.hp === last.p1.hp && root.p2.hp === last.p2.hp,
    "T6: root snapshot HP == posledný frame HP",
    `root=${root.p1.hp}/${root.p2.hp}, frame=${last.p1.hp}/${last.p2.hp}`);

  /* ---------- Test 7: zlé mierenie = whiff (strela letí, dmg nepadne) ---------- */
  await freshGame(c1, c2);
  // P1 (0,1) strieľa hore → strela na (0,0), P2 je na (3,1) → bez zásahu
  tl = await playRound(c1, c2, [A("up"), R, S], [R, S, M("up")]);
  const whiffHits = sumEffects(tl).hits.filter(h => h.target === "p2");
  const whiffCells = tl.flatMap(f => f.effects || [])
    .filter(e => e.kind === "charge").map(e => (e.cell || []).join(","));
  check(whiffHits.length === 0, "T7: strela mimo súpera nedáva dmg", `hits=${JSON.stringify(whiffHits)}`);
  check(whiffCells.includes("0,0"), "T7: projektil preletel dráhu po okraj", `cells=${JSON.stringify(whiffCells)}`);
  invariantCheck(tl, "T7");

  /* ---------- Test 8: vertikálny zásah — dist=1 → 3 dmg ---------- */
  await freshGame(c1, c2);
  // kolo 1: P1 (0,1)→(1,1), P2 (3,1)→(2,1)
  tl = await playRound(c1, c2, [M("right"), R, S], [M("left"), R, S]);
  // kolo 2 (začína P2): ťah1: P2 hore (2,1)→(2,0), P1 doprava (1,1)→(2,1); ťah2: P1 strieľa hore
  tl = await playRound(c1, c2, [M("right"), A("up"), R], [M("up"), R, S]);
  const vHit = sumEffects(tl).hits.find(h => h.target === "p2" && h.dmg === 3);
  check(!!vHit, "T8: vertikálny basic dist=1 dáva 3 dmg", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  invariantCheck(tl, "T8");

  /* ---------- Test 9: block zníži dmg o 1 ---------- */
  await freshGame(c1, c2);
  // kolo 1: P1 → (1,1), P2 → (2,1); kolo 2 (začína P2): P2 block, P1 basic dist=1 → 3−1=2
  tl = await playRound(c1, c2, [M("right"), R, S], [M("left"), R, S]);
  tl = await playRound(c1, c2, [A("right"), R, M("up")], [B, R, S]);
  const chipHit = sumEffects(tl).hits.find(h => h.target === "p2" && h.dmg === 2);
  check(!!chipHit && chipHit.chipped === 1, "T9: block znížil basic 3 → 2 dmg", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  invariantCheck(tl, "T9");

  /* ---------- Test 10: golden shield — extra akcia druhého hráča pred kolom ---------- */
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  // starter (P1) golden poslať nesmie — server lock ignoruje a kolo sa nespustí
  c1.sock.emit("lock_in", [G, A("right"), R, S]);
  c2.sock.emit("lock_in", [G, R, S, M("up")]);
  let goldenRejected = false;
  try { await waitTimeline(c1, 1200); } catch { goldenRejected = true; }
  check(goldenRejected, "T10: starter s golden shieldom je odmietnutý");
  // platný lock P1 → kolo beží; P2 golden blokne prvý úder startera
  c1.sock.emit("lock_in", [A("right"), R, S]);
  tl = await waitTimeline(c1);
  await new Promise(r => setTimeout(r, 150));
  const goldenFx = tl.flatMap(f => f.effects || []).filter(e => e.kind === "golden_shield" && e.from === "p2");
  const gBlocks  = tl.flatMap(f => f.effects || []).filter(e => e.kind === "block" && e.target === "p2");
  const gHits    = sumEffects(tl).hits.filter(h => h.target === "p2");
  check(goldenFx.length === 1, "T10: golden shield efekt v timeline", `fx=${goldenFx.length}`);
  check(gBlocks.length === 1 && gHits.length === 0, "T10: golden shield zablokoval prvý úder startera",
    `blocks=${gBlocks.length}, hits=${JSON.stringify(gHits)}`);
  const t10last = tl[tl.length - 1];
  check(t10last.p2.mana === 3, "T10: P2 mana sedí (4−3+4−2=3)", `mana=${t10last.p2.mana}`);
  invariantCheck(tl, "T10");

  /* ---------- Test 11: speciály — fire 5 dmg na riadku, lightning 3 dmg na opačnej parite ---------- */
  await freshGame(c1, c2);
  // P1 fire (0,1), P2 lightning (3,1): rovnaký riadok → fire 5; parity 1 vs 0 → lightning 3
  tl = await playRound(c1, c2, [R, SP, M("up")], [R, SP, M("up")]);
  const fireHit  = sumEffects(tl).hits.find(h => h.target === "p2" && h.dmg === 5);
  const boltHit  = sumEffects(tl).hits.find(h => h.target === "p1" && h.dmg === 3);
  check(!!fireHit, "T11: fire special dáva 5 dmg na riadku", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  check(!!boltHit, "T11: lightning special dáva 3 dmg na opačnej parite", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  invariantCheck(tl, "T11");

  // rovnaká parita → lightning minie: P1 sa presunie na (0,0) (parita 0 ako P2 na (3,1))
  await freshGame(c1, c2);
  tl = await playRound(c1, c2, [M("up"), R, B], [R, SP, M("up")]);
  const boltMiss = sumEffects(tl).hits.filter(h => h.target === "p1");
  check(boltMiss.length === 0, "T11: lightning special na rovnakej parite minie", `hits=${JSON.stringify(boltMiss)}`);
  invariantCheck(tl, "T11b");

  /* ---------- Test 12: melee whiff — švih, žiadny dmg, mana preč ---------- */
  await freshGame(c1, c2);
  tl = await playRound(c1, c2, [R, ML, M("up")], [R, S, M("up")]);
  const whiffSwing = tl.flatMap(f => f.effects || []).filter(e => e.kind === "melee" && e.from === "p1");
  const whiffDmg = sumEffects(tl).hits.filter(h => h.target === "p2");
  const t12last = tl[tl.length - 1];
  check(whiffSwing.length === 3, "T12: melee švih aj pri minutí (3 beaty)", `swing=${whiffSwing.length}`);
  check(whiffDmg.length === 0, "T12: melee mimo políčka nedáva dmg", `hits=${JSON.stringify(whiffDmg)}`);
  check(t12last.p1.mana === 4, "T12: melee spálil 4 many aj pri minutí (4+4−4=4)", `mana=${t12last.p1.mana}`);
  invariantCheck(tl, "T12");

  /* ---------- Test 13: golden mana refill — +6 many, HP cena rastie (1, 2, …) ---------- */
  // náhodný IK koniec kola vie refill predbehnúť — vtedy scenár opakujeme
  let t13a = null, t13b = null;
  for (let attempt = 0; attempt < 3 && !(t13a && t13b); attempt++) {
    await freshGame(c1, c2);
    const tla = await playRound(c1, c2, [M("up"), S, B, GM], [R, S, M("up")]);
    const fx1 = tla.flatMap(f => f.effects || []).filter(e => e.kind === "golden_mana" && e.from === "p1");
    if (fx1.length !== 1) continue;
    const tlb = await playRound(c1, c2, [R, S, B, GM], [R, S, M("down")]);
    const fx2 = tlb.flatMap(f => f.effects || []).filter(e => e.kind === "golden_mana" && e.from === "p1");
    if (fx2.length !== 1) continue;
    t13a = { tl: tla, fx: fx1[0] };
    t13b = { tl: tlb, fx: fx2[0] };
  }
  check(!!t13a && t13a.fx.hpCost === 1 && t13a.fx.gained === 6,
    "T13: prvý refill stojí 1 HP a dá +6 many", `fx=${JSON.stringify(t13a?.fx)}`);
  check(!!t13b && t13b.fx.hpCost === 2, "T13: druhý refill stojí 2 HP", `fx=${JSON.stringify(t13b?.fx)}`);
  if (t13a) invariantCheck(t13a.tl, "T13");
  if (t13b) invariantCheck(t13b.tl, "T13b");

  /* ---------- Test 14: dash — presun o 2 políčka, na okraji clamp na 1 ---------- */
  await freshGame(c1, c2);
  tl = await playRound(c1, c2, [D("right"), R, S], [R, S, M("up")]);
  let t14last = tl[tl.length - 1];
  check(t14last.p1.x === 2 && t14last.p1.y === 1, "T14: dash doprava presunie o 2 políčka",
    `pos=${t14last.p1.x},${t14last.p1.y}`);
  invariantCheck(tl, "T14");
  // R pred dashom — po zdražení dashu na 4 many by inak v druhom kole mana nestačila
  tl = await playRound(c1, c2, [R, D("up"), S], [R, S, M("down")]);
  t14last = tl[tl.length - 1];
  check(t14last.p1.y === 0, "T14: dash hore zo stredného radu presunie o 1 (clamp)",
    `pos=${t14last.p1.x},${t14last.p1.y}`);
  invariantCheck(tl, "T14b");

  c1.sock.close(); c2.sock.close();
  server.kill();
  console.log(failures === 0 ? "\nVŠETKY TESTY PREŠLI" : `\nZLYHANÍ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
