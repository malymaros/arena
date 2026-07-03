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
    // FORCE_FIRST_STARTER: v produkcii sa osoby losujú na sloty (p1 = biely, začína každú hru) —
    // testy fixujú osobu A (host) na p1, aby deterministické scenáre (golden akcie nestartéra, démon startera…) sedeli
    env: { ...process.env, PORT: String(PORT), FORCE_FIRST_STARTER: "A" },
    stdio: "ignore",
  });
  return new Promise((resolve) => setTimeout(() => resolve(proc), 1200));
}

function connect() {
  return new Promise((resolve, reject) => {
    const sock = io(URL, { transports: ["websocket"] });
    // pomalší boot servera nesmie zhodiť test — socket.io sa retryne samo; reject až po celkovom timeoute
    const killer = setTimeout(() => { sock.close(); reject(new Error("connect timeout")); }, 15000);
    const ctx = { sock, slot: null, isHost: false, lastState: null, lastTimeline: null, gameOver: null, gameResult: null, lastTimer: null, colorRolls: 0 };
    sock.on("you_are", (s) => { ctx.slot = s?.slot ?? s; ctx.isHost = !!s?.isHost; });
    sock.on("color_roll", () => { ctx.colorRolls++; }); // ruleta farieb po configure_match (klient ju animuje)
    sock.on("game_result", (g) => { ctx.gameResult = g; });
    sock.on("turn_timer", (t) => { ctx.lastTimer = t; });
    sock.on("new_game", () => { /* séria: ďalšia hra — sloty prídu cez you_are */ });
    sock.on("state", (s) => {
      ctx.lastState = s;
      if (s.timeline) ctx.lastTimeline = s.timeline;
    });
    sock.on("game_over", (g) => { ctx.gameOver = g; });
    sock.on("connect", () => { clearTimeout(killer); setTimeout(() => resolve(ctx), 300); });
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

// host nakonfiguruje zápas (single match, časovač vypnutý nech testy nikto neauto-lockne)
function configureMatch(host, opts = {}) {
  host.sock.emit("configure_match", {
    format: opts.format || "single",
    tilesPerRound: opts.tilesPerRound ?? 1,
    tileWeights: opts.tileWeights || { dmg: 75, heal: 12, mana: 8, ik: 5 },
    timer: opts.timer || "off",
  });
}

async function freshGame(c1, c2) {
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 150));
  configureMatch(c1);
  await new Promise(r => setTimeout(r, 150));
  c1.sock.emit("choose_character", "fire");
  c2.sock.emit("choose_character", "lightning");
  await new Promise(r => setTimeout(r, 200));
}

const M = (dir) => ({ type: "move", dir });
const A = (dir) => ({ type: "attack", dir });
const D = (dir) => ({ type: "dash", dir });
const R = { type: "recharge" };
const S = { type: "shield" };
const MI = { type: "mirror" };
const ML = { type: "melee" };
const G = { type: "golden_shield" };
const GMI = { type: "golden_mirror" };
const GM = { type: "golden_mana" };
const LS = { type: "last_stand" };
const SP = { type: "special" };
const SPR = { type: "special", dir: "right" }; // Medúzin special so smerom pohľadu
const SPL = { type: "special", dir: "left" };
const STONED = { type: "stoned" };             // skamenený pass ťah (predvyplnený slot)
const DEMON = { type: "demon" };
const LHOPE = { type: "last_hope" };

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
  const TYPES = ["move", "dash", "recharge", "attack", "melee", "special", "shield", "mirror"];
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

  /* ---------- Test 9: mirror odrazí celý dmg do útočníka ---------- */
  await freshGame(c1, c2);
  // kolo 1: P1 → (1,1), P2 → (2,1); kolo 2 (začína P2): P2 mirror, P1 basic dist=1 → 3 dmg sa odrazí do P1
  tl = await playRound(c1, c2, [M("right"), R, S], [M("left"), R, S]);
  tl = await playRound(c1, c2, [A("right"), R, M("up")], [MI, R, S]);
  const mirrorFx  = tl.flatMap(f => f.effects || []).filter(e => e.kind === "mirror" && e.target === "p2");
  const reflected = sumEffects(tl).hits.find(h => h.target === "p1" && h.dmg === 3);
  const p2basic   = sumEffects(tl).hits.find(h => h.target === "p2" && h.dmg === 3);
  check(mirrorFx.length === 1, "T9: mirror efekt v timeline", `fx=${mirrorFx.length}`);
  check(!!reflected, "T9: odrazený basic dáva 3 dmg útočníkovi", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  check(!p2basic, "T9: obranca s mirrorom nedostal dmg", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  invariantCheck(tl, "T9");

  /* ---------- Test 10: golden shield — extra akcia druhého hráča pred kolom ---------- */
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  // starter (P1) golden poslať nesmie — server lock ignoruje a kolo sa nespustí
  c1.sock.emit("lock_in", [G, A("right"), R, S]);
  c2.sock.emit("lock_in", [G, R, ML, M("up")]); // golden_shield sa vylučuje s bežným shieldom → melee namiesto neho
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
  check(t10last.p2.mana === 3, "T10: P2 mana sedí (6−3+4−4=3)", `mana=${t10last.p2.mana}`);
  invariantCheck(tl, "T10");

  /* ---------- Test 10b: golden mirror — ten istý predťah, ale odraz namiesto štítu ---------- */
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  // starter (P1) golden mirror poslať nesmie — rovnako ako golden shield ho server odmietne
  c1.sock.emit("lock_in", [GMI, A("right"), R, S]);
  c2.sock.emit("lock_in", [GMI, R, S, M("up")]);
  let gmiRejected = false;
  try { await waitTimeline(c1, 1200); } catch { gmiRejected = true; }
  check(gmiRejected, "T10b: starter s golden mirrorom je odmietnutý");
  // platný lock P1 (útok na dist 3 = 1 dmg) → P2 golden mirror odrazí prvý úder startera späť do P1
  c1.sock.emit("lock_in", [A("right"), R, S]);
  tl = await waitTimeline(c1);
  await new Promise(r => setTimeout(r, 150));
  const gmiFx     = tl.flatMap(f => f.effects || []).filter(e => e.kind === "golden_mirror" && e.from === "p2");
  const gmiMirror = tl.flatMap(f => f.effects || []).filter(e => e.kind === "mirror" && e.target === "p2");
  const gmiP1Hits = sumEffects(tl).hits.filter(h => h.target === "p1");
  const gmiP2Hits = sumEffects(tl).hits.filter(h => h.target === "p2");
  check(gmiFx.length === 1, "T10b: golden mirror efekt v timeline", `fx=${gmiFx.length}`);
  check(gmiMirror.length === 1 && gmiMirror[0].gold === true, "T10b: odraz je označený ako zlatý",
    `mirror=${JSON.stringify(gmiMirror)}`);
  check(gmiP1Hits.length === 1 && gmiP1Hits[0].dmg === 1, "T10b: odrazený basic (1 dmg) zasiahol startera",
    `hits=${JSON.stringify(gmiP1Hits)}`);
  check(gmiP2Hits.length === 0, "T10b: obranca s golden mirrorom nedostal dmg", `hits=${JSON.stringify(gmiP2Hits)}`);
  const t10blast = tl[tl.length - 1];
  check(t10blast.p2.mana === 3, "T10b: P2 mana sedí (6−5+4−2=3)", `mana=${t10blast.p2.mana}`);
  invariantCheck(tl, "T10b");

  /* ---------- Test 10c: golden predťah sa vzájomne vylučuje s bežnou akciou rovnakého druhu ---------- */
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  // P2 (nestartér) golden_shield + bežný shield v tom istom kole → server lock odmietne (akcia 2× za kolo)
  c1.sock.emit("lock_in", [A("right"), R, S]);
  c2.sock.emit("lock_in", [G, R, S, M("up")]);
  let gsConflict = false;
  try { await waitTimeline(c1, 1200); } catch { gsConflict = true; }
  check(gsConflict, "T10c: golden_shield + shield je odmietnutý");
  // golden_mirror + bežný mirror → tiež odmietnuté
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [A("right"), R, S]);
  c2.sock.emit("lock_in", [GMI, R, MI, M("up")]);
  let gmiConflict = false;
  try { await waitTimeline(c1, 1200); } catch { gmiConflict = true; }
  check(gmiConflict, "T10c: golden_mirror + mirror je odmietnutý");
  // golden_shield + bežný mirror (iný druh obrany) → POVOLENÉ, kolo beží normálne
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [A("right"), R, S]);
  c2.sock.emit("lock_in", [G, R, MI, M("up")]);
  tl = await waitTimeline(c1);
  const gsMixFx = tl.flatMap(f => f.effects || []).filter(e => e.kind === "golden_shield" && e.from === "p2");
  check(gsMixFx.length === 1, "T10c: golden_shield + mirror je povolený (kolo prebehlo)", `fx=${gsMixFx.length}`);
  invariantCheck(tl, "T10c");

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
  tl = await playRound(c1, c2, [M("up"), R, S], [R, SP, M("up")]);
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
  check(t12last.p1.mana === 6, "T12: melee spálil 4 many aj pri minutí (6+4−4=6)", `mana=${t12last.p1.mana}`);
  invariantCheck(tl, "T12");

  /* ---------- Test 13: golden mana refill — +6 many, HP cena rastie (1, 2, …) ---------- */
  // náhodný IK koniec kola vie refill predbehnúť — vtedy scenár opakujeme
  let t13a = null, t13b = null;
  for (let attempt = 0; attempt < 3 && !(t13a && t13b); attempt++) {
    await freshGame(c1, c2);
    // queue musí minúť aspoň 2 many (refill potrebuje priestor na plných +6) a zmestiť sa do štartu 6
    const tla = await playRound(c1, c2, [A("up"), S, M("up"), GM], [R, S, M("up")]);
    const fx1 = tla.flatMap(f => f.effects || []).filter(e => e.kind === "golden_mana" && e.from === "p1");
    if (fx1.length !== 1) continue;
    const tlb = await playRound(c1, c2, [R, S, MI, GM], [R, S, M("down")]);
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

  /* ---------- Test 15: BO3 séria — skóre, vylosované fixné strany (p1=biely začína každú hru), game_over až pri rozhodnutí ---------- */
  // mana-only tiles (žiadne dmg/heal/ik) => HP sa mení len cez akcie => kill je deterministický
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 150));
  const rollsBefore = { c1: c1.colorRolls, c2: c2.colorRolls };
  configureMatch(c1, { format: "bo3", tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 } });
  await new Promise(r => setTimeout(r, 150));
  c1.gameOver = null; c1.gameResult = null;
  check(c1.slot === "p1" && c1.lastState?.series?.format === "bo3" && c1.lastState?.series?.needed === 2,
    "T15: BO3 nakonfigurované, vylosovaný biely (FORCE=A) hru 1 začína vľavo (p1)",
    `slot=${c1.slot}, series=${JSON.stringify(c1.lastState?.series)}`);
  check(c1.colorRolls === rollsBefore.c1 + 1 && c2.colorRolls === rollsBefore.c2 + 1,
    "T15: color_roll (ruleta farieb) odišiel obom hráčom po konfigurácii",
    `c1=${c1.colorRolls - rollsBefore.c1}, c2=${c2.colorRolls - rollsBefore.c2}`);
  check(c1.lastState?.starter === "p1", "T15: hru 1 začína biely (p1)", `starter=${c1.lastState?.starter}`);
  c1.sock.emit("choose_character", "fire");
  c2.sock.emit("choose_character", "lightning");
  await new Promise(r => setTimeout(r, 200));
  // 2 kolá: fire special (celý riadok 5 dmg) zabije p2 (10 HP); p2 ostáva na riadku y=1 bez obrany
  await playRound(c1, c2, [R, SP, S], [M("left"), R, ML]);
  tl = await playRound(c1, c2, [R, SP, S], [M("left"), R, ML]);
  const t15last = tl[tl.length - 1];
  check(t15last.p2.hp === 0, "T15: p2 padol vo 2. kole (fire special 2×5)", `p2 hp=${t15last.p2.hp}`);
  check(c1.gameOver === null, "T15: pri vedení 1:0 v BO3 sa game_over NEodošle");
  check(c1.gameResult && c1.gameResult.matchOver === false && c1.gameResult.gameWinner === "p1",
    "T15: game_result hlási víťaza hry a matchOver=false", `gr=${JSON.stringify(c1.gameResult)}`);
  check(c1.gameResult?.series?.winsP1 === 1 && c1.gameResult?.series?.winsP2 === 0,
    "T15: skóre série 1:0 pre p1", `series=${JSON.stringify(c1.gameResult?.series)}`);
  // počkaj na new_game (server ho plánuje až po timelineDuration + 6,5 s — kolo s 2 špeciálmi a melee
  // má timeline ~15 s, takže 20 s strop bol tesný a na pomalšom stroji občas nestihol)
  const t0 = Date.now();
  while (c1.lastState?.series?.gameIndex !== 2 && Date.now() - t0 < 35000) await new Promise(r => setTimeout(r, 100));
  check(c1.lastState?.series?.gameIndex === 2, "T15: séria postúpila na hru 2",
    `gameIndex=${c1.lastState?.series?.gameIndex}`);
  check(c1.slot === "p1", "T15: strany sú fixné — vylosovaný biely ostáva vľavo (p1) aj v hre 2", `slot=${c1.slot}`);
  check(c1.lastState?.starter === "p2", "T15: hru 2 v sérii začína čierny (p2) — štartér hier sa strieda", `starter=${c1.lastState?.starter}`);

  // tiles bez dmg/IK — aby náhodný tile nezabil hráča a nepokazil deterministické last-stand scenáre
  async function freshGameLS() {
    c1.sock.emit("retry");
    await new Promise(r => setTimeout(r, 150));
    configureMatch(c1, { tileWeights: { dmg: 0, heal: 50, mana: 50, ik: 0 } });
    await new Promise(r => setTimeout(r, 150));
    c1.sock.emit("choose_character", "fire");
    c2.sock.emit("choose_character", "lightning");
    await new Promise(r => setTimeout(r, 250));
  }

  /* ---------- Test 16: Last Stand summon — oživenie na plno + buff + zámok ---------- */
  await freshGameLS();
  tl = await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]);
  const lsSummon = tl.flatMap(f => f.effects || []).filter(e => e.kind === "last_stand_summon" && e.from === "p1");
  check(lsSummon.length === 1, "T16: last_stand_summon efekt v timeline", `fx=${lsSummon.length}`);
  const s16 = c1.lastState;
  check(s16?.p1?.hp === 10 && s16?.p1?.mana === 10, "T16: p1 oživený na plné HP+manu", `hp=${s16?.p1?.hp} mana=${s16?.p1?.mana}`);
  check(s16?.p1?.lastStandBuff === true, "T16: p1 má lastStandBuff", `buff=${s16?.p1?.lastStandBuff}`);
  check(s16?.goldLocked === true, "T16: duálny gold button zamknutý (goldLocked)", `gl=${s16?.goldLocked}`);

  /* ---------- Test 17: v poslednom kole je gold button zamknutý (lock_in s gold odmietnutý) ---------- */
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [R, S, M("down"), GM]); // golden mana v zamknutom kole → neplatné
  c2.sock.emit("lock_in", [R, S, M("down")]);
  let locked17 = false;
  try { await waitTimeline(c1, 1500); } catch { locked17 = true; }
  check(locked17, "T17: gold button v poslednom kole zamknutý (lock_in s golden_mana odmietnutý)");

  /* ---------- Test 18: doom — ak obaja prežijú posledné kolo, Last Stand hráč zomrie (banish), súper vyhrá ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // kolo 1: p1 summon
  c1.gameResult = null;
  const tlDoom = await playRound(c1, c2, [R, S, M("down")], [R, S, M("down")]); // kolo 2 buffnuté, obaja neškodní
  const banish = tlDoom.flatMap(f => f.effects || []).filter(e => e.kind === "last_stand_banish" && e.from === "p1");
  const doomLast = tlDoom[tlDoom.length - 1];
  check(banish.length === 1, "T18: last_stand_banish na konci posledného kola", `fx=${banish.length}`);
  check(doomLast.p1.hp === 0, "T18: p1 (last stand) zomrel na konci kola", `hp=${doomLast.p1.hp}`);
  check(c1.gameResult?.gameWinner === "p2", "T18: súper (p2) vyhráva sériu", `gr=${JSON.stringify(c1.gameResult)}`);

  /* ---------- Test 19: démon je len jeden — pri oboch Last Stand ho dostane len starter (p1), druhý ✗ ---------- */
  await freshGameLS();
  const tlX = await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up"), LS]);
  const summonX = tlX.flatMap(f => f.effects || []).filter(e => e.kind === "last_stand_summon");
  const invX = tlX.flatMap(f => f.effects || []).filter(e => e.kind === "invalid" && e.reason === "no_demon");
  check(summonX.length === 1 && summonX[0].from === "p1", "T19: démon vyvolá len starter (p1)", `summon=${JSON.stringify(summonX)}`);
  check(invX.length === 1 && invX[0].target === "p2", "T19: druhý Last Stand dostane ✗ (no_demon)", `inv=${JSON.stringify(invX)}`);
  const s19 = c1.lastState;
  check(s19?.p1?.lastStandBuff === true && !s19?.p2?.lastStandBuff, "T19: buff má len p1, nie p2",
    `p1=${s19?.p1?.lastStandBuff} p2=${s19?.p2?.lastStandBuff}`);

  /* ---------- Test 20: buff — Last Stand hráč dáva 2× dmg ---------- */
  await freshGameLS();
  // kolo 1: p1 dash doprava (0→2) + summon; p2 ostáva na (3,1)
  await playRound(c1, c2, [D("right"), R, S, LS], [R, S, ML]);
  // kolo 2 (buffnuté): p1 útok doprava z (2,1) na p2 (3,1) → dist 1 → základ 3 → 2× = 6
  const tl2x = await playRound(c1, c2, [A("right"), R, S], [R, S, M("up")]);
  const hit2x = sumEffects(tl2x).hits.find(h => h.target === "p2" && h.dmg === 6);
  check(!!hit2x, "T20: Last Stand basic dáva 2× dmg (3→6)", `hits=${JSON.stringify(sumEffects(tl2x).hits)}`);

  /* ---------- Test 21: p2 (nestartér) Last Stand → p1 NEdostane golden mana ---------- */
  await freshGameLS();
  const tlP2 = await playRound(c1, c2, [R, S, M("up")], [R, S, M("up"), LS]);
  const gmFx21 = tlP2.flatMap(f => f.effects || []).filter(e => e.kind === "golden_mana");
  const sumP2 = tlP2.flatMap(f => f.effects || []).filter(e => e.kind === "last_stand_summon");
  check(gmFx21.length === 0, "T21: žiadny golden_mana efekt (p1 si ho nenastavil)", `gm=${JSON.stringify(gmFx21)}`);
  check(sumP2.length === 1 && sumP2[0].from === "p2", "T21: démon dostal p2", `summon=${JSON.stringify(sumP2)}`);
  const s21 = c1.lastState;
  check(s21?.p2?.lastStandBuff === true && !s21?.p1?.lastStandBuff, "T21: buff má p2, p1 nie",
    `p1=${s21?.p1?.lastStandBuff} p2=${s21?.p2?.lastStandBuff}`);
  check(s21?.p1?.hp === 10, "T21: p1 HP nezmenené (žiadna golden mana cena)", `hp=${s21?.p1?.hp}`);

  /* ---------- Test 24: démon útok — buffnutý hráč v poslednom kole zabije súpera (10 dmg mimo svojej bunky) ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // kolo 1: p1 summon → buff, 10/10
  c1.gameResult = null;
  // kolo 2 (buffnuté, final): p1 vyvolá démon útok ako jednu z 3 akcií; p2 (na inej bunke) dostane 10 dmg
  const tlDemon = await playRound(c1, c2, [DEMON, R, S], [R, S, M("down")]);
  const demonSummon = tlDemon.flatMap(f => f.effects || []).filter(e => e.kind === "demon_summon" && e.from === "p1");
  const demonAtk = tlDemon.flatMap(f => f.effects || []).filter(e => e.kind === "demon_attack" && e.from === "p1");
  const demonHit = sumEffects(tlDemon).hits.find(h => h.target === "p2" && h.dmg === 10);
  check(demonSummon.length === 1, "T24: demon_summon efekt v timeline", `fx=${demonSummon.length}`);
  check(demonAtk.length >= 1 && Array.isArray(demonAtk[0].cells), "T24: demon_attack nesie zoznam buniek", `fx=${JSON.stringify(demonAtk[0]?.cells)}`);
  check(!!demonHit, "T24: démon dal súperovi 10 dmg", `hits=${JSON.stringify(sumEffects(tlDemon).hits)}`);
  check(tlDemon[tlDemon.length - 1].p2.hp === 0, "T24: p2 mŕtvy po démon útoku", `hp=${tlDemon[tlDemon.length - 1].p2.hp}`);
  check(c1.gameResult?.gameWinner === "p1", "T24: démon útok = výhra buffnutého hráča", `gr=${JSON.stringify(c1.gameResult)}`);

  /* ---------- Test 25: démon útok smie navoliť LEN buffnutý hráč (bežné kolo → lock odmietnutý) ---------- */
  await freshGame(c1, c2);
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [DEMON, R, S]); // p1 nie je buffnutý → neplatné
  c2.sock.emit("lock_in", [R, S, M("down")]);
  let demonRejected = false;
  try { await waitTimeline(c1, 1500); } catch { demonRejected = true; }
  check(demonRejected, "T25: démon útok bez Last Stand buffu je odmietnutý");

  /* ---------- Test 26: mirror na démon útok — démon zmizne (demon_center_out) PRED mirror animáciou ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // kolo 1: p1 summon
  // kolo 2 (final, starter p2): p2 mirror sa vyhodnotí pred p1 démonom → odraz; démon má zmiznúť pred lúčom
  const tlMir = await playRound(c1, c2, [DEMON, R, S], [MI, R, S]);
  const flatMir = tlMir.flatMap(f => (f.effects || []).map(e => e.kind));
  const idxOut = flatMir.indexOf("demon_center_out");
  const idxMir = flatMir.indexOf("mirror");
  check(idxOut !== -1 && idxMir !== -1 && idxOut < idxMir,
    "T26: démon zmizne (demon_center_out) pred mirror odrazom", `out=${idxOut} mirror=${idxMir}`);

  /* ---------- Test 26b: shield na démon útok — démon zmizne PRED block animáciou (nech je blok vidno) ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // kolo 1: p1 summon
  const tlBlk = await playRound(c1, c2, [DEMON, R, M("up")], [S, R, M("down")]); // p2 shield pred p1 démonom
  const flatBlk = tlBlk.flatMap(f => (f.effects || []).map(e => e.kind));
  const bOut = flatBlk.indexOf("demon_center_out");
  const bBlk = flatBlk.indexOf("block");
  check(bOut !== -1 && bBlk !== -1 && bOut < bBlk,
    "T26b: démon zmizne (demon_center_out) pred block animáciou", `out=${bOut} block=${bBlk}`);

  /* ---------- Test 27: Last Hope — nebuffnutý hráč vo final kole: HP→1, mana→10, ultra buff ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // kolo 1: p1 summon → p1 buff, p2 nebuffnutý
  c1.gameResult = null;
  // kolo 2 (final, starter p2): p2 zahrá Last Hope ako úvodnú akciu (pred golden); nikto neútočí → p1 doom banish
  const tlHope = await playRound(c1, c2, [R, S, M("up")], [LHOPE, R, S, M("down")]);
  const hopeSummon = tlHope.flatMap(f => f.effects || []).filter(e => e.kind === "last_hope_summon" && e.from === "p2");
  check(hopeSummon.length === 1, "T27: last_hope_summon efekt v timeline", `fx=${hopeSummon.length}`);
  const settleFrame = tlHope.find(f => (f.effects || []).some(e => e.kind === "last_hope_settle" && e.from === "p2"));
  check(settleFrame?.p2?.hp === 1 && settleFrame?.p2?.mana === 10, "T27: p2 HP→1, mana→10 po Last Hope", `hp=${settleFrame?.p2?.hp} mana=${settleFrame?.p2?.mana}`);
  check(settleFrame?.p2?.lastHopeBuff === true, "T27: p2 má lastHopeBuff (ultra mód)", `buff=${settleFrame?.p2?.lastHopeBuff}`);

  /* ---------- Test 28: Last Hope smie len NEbuffnutý hráč; buffnutý (Last Stand) ho má odmietnutý ---------- */
  await freshGameLS();
  await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // p1 buff
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [LHOPE, R, S, M("down")]); // p1 je buffnutý → Last Hope neplatný
  c2.sock.emit("lock_in", [R, S, M("up")]);
  let hopeRejected = false;
  try { await waitTimeline(c1, 1500); } catch { hopeRejected = true; }
  check(hopeRejected, "T28: Last Hope buffnutým (Last Stand) hráčom je odmietnutý");

  /* ---------- Test 22: časovač po Last Stand summone = dur(timeline) + čas na ťah (dlhá animácia nezje čas) ---------- */
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 150));
  configureMatch(c1, { timer: "30", tileWeights: { dmg: 0, heal: 50, mana: 50, ik: 0 } });
  await new Promise(r => setTimeout(r, 150));
  c1.sock.emit("choose_character", "fire");
  c2.sock.emit("choose_character", "lightning");
  await new Promise(r => setTimeout(r, 250));
  c1.lastTimer = null;
  const tlLS = await playRound(c1, c2, [R, S, M("up"), LS], [R, S, M("up")]); // p1 summon
  const durLS = tlLS.reduce((a, f) => a + (f.delayMs || 0), 0);
  await new Promise(r => setTimeout(r, 300)); // nech dôjde turn_timer po beginPlanningTimer(dur)
  const tmr = c1.lastTimer;
  check(!!tmr && typeof tmr.ms === "number", "T22: turn_timer prišiel po Last Stand summone", `tmr=${JSON.stringify(tmr)}`);
  check(tmr && Math.abs(tmr.ms - (durLS + 30000)) <= 200,
    "T22: turn_timer = dur(summon timeline) + 30s (časovač nenaruší Last Stand)",
    `ms=${tmr?.ms} dur=${durLS} expected=${durLS + 30000}`);

  /* ---------- Test 23: výber postáv — súperov pick je skrytý, kým si nevyberie aj druhý hráč ---------- */
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 150));
  configureMatch(c1); // single, časovač off
  await new Promise(r => setTimeout(r, 200));
  // host (A=p1) si vyberie; nestartér (B=p2) ešte nevybral → NESMIE vidieť p1 pick
  c1.sock.emit("choose_character", "fire");
  await new Promise(r => setTimeout(r, 200));
  check(c2.lastState?.p1 && c2.lastState.p1.char === null,
    "T23: kým si druhý hráč nevyberie, súperov pick je skrytý", `vidí p1.char=${c2.lastState?.p1?.char}`);
  check(c1.lastState?.p1?.char === "fire", "T23: vlastný pick vidím hneď", `p1.char=${c1.lastState?.p1?.char}`);
  // teraz si vyberie aj p2 → obom sa pick odhalí
  c2.sock.emit("choose_character", "lightning");
  await new Promise(r => setTimeout(r, 200));
  check(c2.lastState?.p1?.char === "fire" && c2.lastState?.p2?.char === "lightning",
    "T23: po vlastnom výbere sa súperov pick odhalí", `p1=${c2.lastState?.p1?.char} p2=${c2.lastState?.p2?.char}`);

  /* ---------- Medúza: pomocný fresh game (p1 = medusa, p2 = fire; mana-only tiles = deterministické HP) ---------- */
  async function freshMedusa() {
    c1.sock.emit("retry");
    await new Promise(r => setTimeout(r, 150));
    configureMatch(c1, { tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 } });
    await new Promise(r => setTimeout(r, 150));
    c1.sock.emit("choose_character", "medusa");
    c2.sock.emit("choose_character", "fire");
    await new Promise(r => setTimeout(r, 200));
  }
  const fxOf = (timeline, kind) => timeline.flatMap(f => (f.effects || []).filter(e => e.kind === kind));

  /* ---------- Test 29: Medúzin special — zóna, petrify, preskočenie 2 akcií v tom istom kole ---------- */
  await freshMedusa();
  // p1 (0,1) special doprava zasiahne celý zvyšok boardu vrátane p2 (3,1) → petrify;
  // p2 move aj recharge sa preskočia (stone 2→0), attack v ťahu 3 už prebehne
  tl = await playRound(c1, c2, [SPR, R, A("right")], [M("left"), R, A("left")]);
  const spFx = fxOf(tl, "special").filter(e => e.from === "p1");
  check(spFx.length === 3 && Array.isArray(spFx[0].cells), "T29: special efekt nesie zoznam buniek", `fx=${JSON.stringify(spFx[0])}`);
  const cellKey = new Set((spFx[0].cells || []).map(([x, y]) => `${x},${y}`));
  check(cellKey.has("0,1") && cellKey.has("3,1") && !cellKey.has("0,0") && !cellKey.has("0,2"),
    "T29: zóna = vlastné políčko + všetko doprava (bez rohov za chrbtom)", `cells=${JSON.stringify(spFx[0].cells)}`);
  check(fxOf(tl, "petrify").filter(e => e.target === "p2").length === 1, "T29: petrify efekt na p2");
  const stonedP2 = fxOf(tl, "stoned").filter(e => e.target === "p2");
  check(stonedP2.length === 2, "T29: p2 preskočil presne 2 akcie (stoned ×2)", `count=${stonedP2.length}`);
  const t29last = tl[tl.length - 1];
  check(t29last.p2.x === 3 && t29last.p2.y === 1, "T29: preskočený move — p2 sa nepohol", `p2=(${t29last.p2.x},${t29last.p2.y})`);
  check(t29last.p2.stone === 0, "T29: kameň skončil posledným skameneným ťahom", `stone=${t29last.p2.stone}`);
  check(t29last.p2.mana === 5, "T29: preskočený recharge nič nedal a nič nestál (6−1 za attack)", `mana=${t29last.p2.mana}`);
  const t29hits = sumEffects(tl).hits;
  check(t29hits.some(h => h.target === "p2" && h.dmg === 1) && t29hits.some(h => h.target === "p1" && h.dmg === 1),
    "T29: petrify nedáva dmg — jediné zásahy sú 2 basic strely po 1", `hits=${JSON.stringify(t29hits)}`);
  invariantCheck(tl, "T29");

  /* ---------- Test 30: kameň sa prenáša do ďalšieho kola + golden mana skamenenému prepadne ---------- */
  await freshMedusa();
  // petrify padne až po VŠETKÝCH p2 akciách okrem a3 → p2 preskočí len a3 (stone 2→1);
  // golden mana p2 po konci kola sa skamenenému nevykoná a kameň NEuberá → stone=1 do ďalšieho kola
  tl = await playRound(c1, c2, [M("right"), R, SPR], [R, M("up"), A("left"), GM]);
  check(fxOf(tl, "petrify").filter(e => e.target === "p2").length === 1, "T30: petrify efekt na p2");
  check(fxOf(tl, "golden_mana").length === 0, "T30: golden mana sa skamenenému nevykonala");
  const t30last = tl[tl.length - 1];
  check(t30last.p2.stone === 1, "T30: kameň sa prenáša do ďalšieho kola (stone=1)", `stone=${t30last.p2.stone}`);
  check(t30last.p2.hp === 10, "T30: prepadnutá golden mana nestála HP", `hp=${t30last.p2.hp}`);
  invariantCheck(tl, "T30");
  // kolo 2: lock bez stone passu na začiatku fronty je odmietnutý
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [R, S, M("left")]);
  c2.sock.emit("lock_in", [R, S, M("down")]); // chýba úvodný stoned pass → neplatné
  let stoneRejected = false;
  try { await waitTimeline(c1, 1500); } catch { stoneRejected = true; }
  check(stoneRejected, "T30: lock skameneného bez stoned passu je odmietnutý");
  // správny lock so stoned passom prejde a prvá akcia sa preskočí
  c2.sock.emit("lock_in", [STONED, R, A("left")]);
  tl = await waitTimeline(c1, 5000);
  await new Promise(r => setTimeout(r, 150));
  check(fxOf(tl, "stoned").filter(e => e.target === "p2").length === 1, "T30: v ďalšom kole sa preskočil 1 ťah");
  check(tl[tl.length - 1].p2.stone === 0, "T30: po odžití passu je kameň preč", `stone=${tl[tl.length - 1].p2.stone}`);
  invariantCheck(tl, "T30b");

  /* ---------- Test 31: shield blokuje petrify ---------- */
  await freshMedusa();
  // p2 štít v ťahu 1 kryje p1 ťah 2 = special → block, žiadny petrify
  tl = await playRound(c1, c2, [R, SPR, M("right")], [S, R, M("up")]);
  check(fxOf(tl, "block").filter(e => e.target === "p2").length === 1, "T31: štít zablokoval petrify");
  check(fxOf(tl, "petrify").length === 0 && tl[tl.length - 1].p2.stone === 0,
    "T31: p2 neskamenel", `stone=${tl[tl.length - 1].p2.stone}`);
  invariantCheck(tl, "T31");

  /* ---------- Test 32: mirror odrazí petrify — skamenie samotná Medúza ---------- */
  await freshMedusa();
  tl = await playRound(c1, c2, [R, SPR, A("right")], [MI, R, M("up")]);
  const mirFx = fxOf(tl, "mirror").filter(e => e.target === "p2");
  check(mirFx.length === 1 && mirFx[0].atk === "special" && mirFx[0].dmg === 0,
    "T32: mirror efekt na odrazený special (dmg 0)", `fx=${JSON.stringify(mirFx)}`);
  check(fxOf(tl, "petrify").filter(e => e.target === "p1").length === 1, "T32: odraz skamenil Medúzu (p1)");
  check(fxOf(tl, "stoned").filter(e => e.target === "p1").length === 1, "T32: Medúze sa preskočil zvyšný ťah kola");
  check(tl[tl.length - 1].p1.stone === 1, "T32: zvyšok kameňa sa Medúze prenáša (stone=1)", `stone=${tl[tl.length - 1].p1.stone}`);
  invariantCheck(tl, "T32");

  /* ---------- Test 33: special na už skamenenú postavu = bez efektu, žiadny refresh ---------- */
  await freshMedusa();
  // kolo 1: neutrálne (p1 sa priblíži), kolo 2 (starter p2): p1 special ako ÚPLNE posledná akcia kola
  // → p2 skamenie s plnými 2 ťahmi do kola 3
  tl = await playRound(c1, c2, [R, S, M("right")], [R, S, M("up")]);
  tl = await playRound(c1, c2, [R, M("right"), SPR], [R, M("down"), A("left")]);
  check(tl[tl.length - 1].p2.stone === 2, "T33: petrify poslednou akciou kola → plné 2 ťahy do ďalšieho kola", `stone=${tl[tl.length - 1].p2.stone}`);
  // kolo 3 (starter p1=medúza): special na stále skamenenú p2 → invalid already_stone, kameň bez refreshu
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [SPR, R, S]);
  c2.sock.emit("lock_in", [STONED, STONED, R]);
  tl = await waitTimeline(c1, 8000);
  await new Promise(r => setTimeout(r, 150));
  const invStone = fxOf(tl, "invalid").filter(e => e.target === "p1" && e.reason === "already_stone");
  check(invStone.length === 1, "T33: opakovaný special na sochu = invalid already_stone", `inv=${JSON.stringify(fxOf(tl, "invalid"))}`);
  check(fxOf(tl, "petrify").length === 0, "T33: žiadny nový petrify (bez refreshu)");
  check(fxOf(tl, "stoned").filter(e => e.target === "p2").length === 2, "T33: p2 odžil presne 2 stone passy");
  check(tl[tl.length - 1].p2.stone === 0, "T33: po odžití passov je kameň preč", `stone=${tl[tl.length - 1].p2.stone}`);
  invariantCheck(tl, "T33");

  /* ---------- Test 34: Medúzin melee — vlastné políčko + diagonály, 4 dmg; ortogonál mimo dosah ---------- */
  await freshMedusa();
  // p1 dash → (2,1); p2 move up → (3,0) = diagonálne od p1 → melee zasiahne za 4
  tl = await playRound(c1, c2, [D("right"), R, ML], [M("up"), R, S]);
  const t34melee = fxOf(tl, "melee");
  check(t34melee.length === 3 && Array.isArray(t34melee[0].cells) && t34melee[0].cells.length === 5,
    "T34: melee efekt nesie 5 buniek (vlastná + 4 diagonály)", `cells=${JSON.stringify(t34melee[0]?.cells)}`);
  const t34hits = sumEffects(tl).hits.filter(h => h.target === "p2");
  check(t34hits.length === 1 && t34hits[0].dmg === 4, "T34: diagonálny melee dáva 4 dmg", `hits=${JSON.stringify(t34hits)}`);
  invariantCheck(tl, "T34");
  // kolo 2 (starter p2): p2 zíde na (3,1) = ortogonálne vedľa p1 (2,1) → melee minie
  tl = await playRound(c1, c2, [R, ML, S], [M("down"), R, S]);
  check(fxOf(tl, "melee").length === 3, "T34: švih prebehne aj pri minutí");
  check(sumEffects(tl).hits.filter(h => h.target === "p2").length === 0,
    "T34: ortogonálne susedné políčko je mimo dosahu", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  invariantCheck(tl, "T34b");

  /* ---------- Minotaur: pomocný fresh game (p1 = minotaur, p2 = fire; mana-only tiles) ---------- */
  async function freshMinotaur() {
    c1.sock.emit("retry");
    await new Promise(r => setTimeout(r, 150));
    configureMatch(c1, { tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 } });
    await new Promise(r => setTimeout(r, 150));
    c1.sock.emit("choose_character", "minotaur");
    c2.sock.emit("choose_character", "fire");
    await new Promise(r => setTimeout(r, 200));
  }

  /* ---------- Test 35: Minotaurov special — celoplošný labyrint + redakcia dát pre prekliateho ---------- */
  await freshMinotaur();
  // p1 special v a1 → p2 (3,1) je zakliaty hneď; jeho move v a3 už ťahá niť
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("up")]);
  const t35sp = fxOf(tl, "special").filter(e => e.from === "p1");
  check(t35sp.length === 3 && (t35sp[0].cells || []).length === 12,
    "T35: special zóna = celý board (12 buniek)", `cells=${JSON.stringify(t35sp[0]?.cells)}`);
  check(fxOf(tl, "labyrinth").filter(e => e.target === "p2").length === 1, "T35: labyrinth efekt na p2");
  check(sumEffects(tl).hits.length === 0, "T35: labyrint nedáva dmg", `hits=${JSON.stringify(sumEffects(tl).hits)}`);
  const t35last = tl[tl.length - 1];
  check(t35last.p2.labyrinth === true, "T35: p2 blúdi v labyrinte");
  check(JSON.stringify(c2.lastState?.p2?.thread) === JSON.stringify([[3, 1], [3, 0]]),
    "T35: niť (pohľad prekliateho) = bunka zakliatia + move up", `thread=${JSON.stringify(c2.lastState?.p2?.thread)}`);
  // redakcia: prekliaty (c2) nedostane pozíciu Minotaura ani tiles — ani v snapshote, ani v timeline
  check(c2.lastState?.p1?.x === null && c2.lastState?.p1?.y === null,
    "T35: prekliaty nevidí pozíciu Minotaura v dátach", `p1=(${c2.lastState?.p1?.x},${c2.lastState?.p1?.y})`);
  check((c2.lastState?.tiles || []).length === (c1.lastState?.tiles || []).length && (c1.lastState?.tiles || []).length > 0,
    "T35: prekliaty VIDÍ špeciálne tiles (neredigujú sa)", `c2 tiles=${JSON.stringify(c2.lastState?.tiles)}`);
  const c2lastFrame = c2.lastTimeline[c2.lastTimeline.length - 1];
  check(c2lastFrame.p1.x === null, "T35: redakcia platí aj vo frame-och timeline");
  check(c2.lastTimeline.some(f => (f.effects || []).some(e => e.kind === "action" && e.from === "p1" && e.action?.type === "unknown")),
    "T35: akcie Minotaura sú prekliatemu maskované (unknown)");
  // Minotaur (c1) vidí pozície, ale NIE Ariadninu niť ani manu prekliateho (obojstranný mana blackout)
  check(c1.lastState?.p1?.x === 0 && c1.lastState?.p2?.x === 3, "T35: Minotaur vidí pozície neredigované");
  check((c1.lastState?.p2?.thread || []).length === 0 && c1.lastState?.p2?.threadMark === null,
    "T35: Minotaur Ariadninu niť NEVIDÍ", `thread=${JSON.stringify(c1.lastState?.p2?.thread)}`);
  check(c1.lastState?.p2?.mana === null && c2.lastState?.p1?.mana === null,
    "T35: počas labyrintu ani jeden nevidí manu súpera",
    `c1 vidí p2.mana=${c1.lastState?.p2?.mana}, c2 vidí p1.mana=${c2.lastState?.p1?.mana}`);
  check(c1.lastState?.p2?.hp != null && c2.lastState?.p1?.hp != null, "T35: HP ostáva viditeľné obom");
  invariantCheck(tl, "T35");

  /* ---------- Test 36: niť rastie, vstup na ňu zanechá obrys; zablokovaný zásah labyrint ukončí ---------- */
  // pokračovanie hry z T35 (p2 zakliaty na nití [3,1],[3,0])
  tl = await playRound(c1, c2, [R, D("right"), S], [R, S, M("left")]); // kolo 2 (starter p2)
  check(JSON.stringify(c2.lastState?.p2?.thread) === JSON.stringify([[3, 1], [3, 0], [2, 0]]),
    "T36: niť rastie s pohybom prekliateho", `thread=${JSON.stringify(c2.lastState?.p2?.thread)}`);
  check(fxOf(c2.lastTimeline, "thread_mark").length === 0 && c2.lastState?.p2?.threadMark === null,
    "T36: dash mimo nite nezanechá obrys");
  // kolo 3 (starter p1): p1 (2,1) vstúpi move-om hore na niťovú bunku (2,0) → obrys
  tl = await playRound(c1, c2, [M("up"), R, S], [R, M("down"), S]);
  const t36marks = fxOf(c2.lastTimeline, "thread_mark");
  check(t36marks.length === 1 && JSON.stringify(t36marks[0].cell) === JSON.stringify([2, 0]),
    "T36: vstup na niť zanechal obrys na (2,0)", `marks=${JSON.stringify(t36marks)}`);
  check(fxOf(tl, "thread_mark").length === 0, "T36: lovec o obryse nevie (efekt sa mu rediguje)");
  check(JSON.stringify(c2.lastState?.p2?.threadMark) === JSON.stringify([2, 0]),
    "T36: prekliaty vidí threadMark v snapshote", `mark=${JSON.stringify(c2.lastState?.p2?.threadMark)}`);
  check(tl[tl.length - 1].p2.labyrinth === true, "T36: labyrint stále trvá");
  // kolo 4 (starter p2): p2 strieľa hore do p1 — golden shield zásah ZABLOKUJE, aj tak labyrint končí
  tl = await playRound(c1, c2, [G, R, M("left"), ML], [A("up"), R, ML]);
  const t36block = fxOf(tl, "block").filter(e => e.target === "p1");
  check(t36block.length === 1 && t36block[0].gold === true, "T36: golden shield zásah zablokoval");
  check(fxOf(tl, "labyrinth_end").filter(e => e.target === "p2").length === 1,
    "T36: aj zablokovaný zásah ukončil labyrint");
  check(fxOf(tl, "labyrinth_reveal").filter(e => e.target === "p2").length === 1,
    "T36: istý (hoci zablokovaný) zásah odhalil labyrint už pred animáciou útoku");
  const t36last = tl[tl.length - 1];
  check(t36last.p2.labyrinth === false && t36last.p2.thread.length === 0 && t36last.p2.threadMark === null,
    "T36: niť aj obrys zanikli s labyrintom");
  check(c2.lastState?.p1?.x === 1, "T36: po úniku vidí p2 súperovu pozíciu opäť", `p1.x=${c2.lastState?.p1?.x}`);
  invariantCheck(tl, "T36");

  /* ---------- Test 37: mirror odrazí labyrint — blúdi samotný Minotaur ---------- */
  await freshMinotaur();
  tl = await playRound(c1, c2, [R, SP, S], [MI, R, M("up")]);
  const t37mir = fxOf(tl, "mirror").filter(e => e.target === "p2");
  check(t37mir.length === 1 && t37mir[0].atk === "special" && t37mir[0].dmg === 0,
    "T37: mirror efekt na odrazený labyrint (dmg 0)", `fx=${JSON.stringify(t37mir)}`);
  check(fxOf(tl, "labyrinth").filter(e => e.target === "p1").length === 1
    && fxOf(tl, "labyrinth").filter(e => e.target === "p2").length === 0,
    "T37: v labyrinte skončil Minotaur (p1), nie p2");
  check(JSON.stringify(tl[tl.length - 1].p1.thread) === JSON.stringify([[0, 1]]),
    "T37: Minotaurova niť začína na jeho bunke", `thread=${JSON.stringify(tl[tl.length - 1].p1.thread)}`);
  check(c1.lastState?.p2?.x === null, "T37: teraz je redigovaný Minotaurov pohľad (nevidí p2)");
  check(c2.lastState?.p1?.x === 0 && c2.lastState?.p1?.labyrinth === true,
    "T37: p2 vidí blúdiaceho Minotaura aj s pozíciou");
  check((c2.lastState?.p1?.thread || []).length === 0 && c2.lastState?.p1?.mana === null,
    "T37: p2 je teraz lovec — nevidí Minotaurovu niť ani manu");
  invariantCheck(tl, "T37");

  /* ---------- Test 39: prebudenie z labyrintu cez MIRROR (odraz = zásah, labyrint končí) ---------- */
  await freshMinotaur();
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("up")]); // p2 zakliaty, presunie sa na (3,0)
  // kolo 2 (starter p2): mirror v a2 kryje presne Minotaurov útok v a2 (obrana kryje najbližšiu súperovu akciu);
  // Minotaur sa posunie na (0,0) a strieľa doprava do zrkadla
  tl = await playRound(c1, c2, [M("up"), A("right"), S], [R, MI, M("left")]);
  check(fxOf(tl, "labyrinth_end").filter(e => e.target === "p2").length === 1,
    "T39: odrazený zásah ukončil labyrint");
  const t39mir = fxOf(tl, "mirror").filter(e => e.target === "p2");
  check(t39mir.length === 1 && t39mir[0].atk === "basic" && t39mir[0].dmg === 1,
    "T39: mirror efekt odrazil basic (dmg 1)", `fx=${JSON.stringify(t39mir)}`);
  const t39hits = sumEffects(tl).hits;
  check(t39hits.length === 1 && t39hits[0].target === "p1" && t39hits[0].dmg === 1,
    "T39: jediný zásah kola je odraz do Minotaura", `hits=${JSON.stringify(t39hits)}`);
  const t39last = tl[tl.length - 1];
  check(t39last.p2.labyrinth === false && t39last.p2.thread.length === 0 && t39last.p2.threadMark === null,
    "T39: labyrint aj niť zanikli odrazom");
  check(c2.lastState?.p1?.x === 0, "T39: po prebudení p2 opäť vidí Minotaurovu pozíciu", `p1.x=${c2.lastState?.p1?.x}`);
  // konzistencia redigovanej timeline prekliateho: istý zásah = odhalenie (labyrinth_reveal) padne
  // ešte PRED animáciou útoku — pred reveal frame-om je p1 skrytý (žiadne charge efekty),
  // od reveal frame-u je p1 odhalený v každom frame — presne toto poradie hrá klient pri prebudení
  {
    let seenReveal = false, orderOk = true, revealBeforeCharge = true;
    for (const f of c2.lastTimeline) {
      if ((f.effects || []).some(e => e.kind === "labyrinth_reveal" || e.kind === "labyrinth_end")) seenReveal = true;
      if (!seenReveal && (f.effects || []).some(e => e.from === "p1" && e.kind === "charge")) revealBeforeCharge = false;
      if (!seenReveal && f.p2.labyrinth && (f.p1.x !== null || (f.effects || []).some(e => e.from === "p1" && e.kind === "charge"))) orderOk = false;
      if (seenReveal && f.p1.x == null) orderOk = false;
    }
    check(seenReveal && orderOk, "T39: redigovaná timeline je pri mirror úniku konzistentná (skrytý → odhalený)");
    check(revealBeforeCharge, "T39: odhalenie prišlo PRED letom strely (reveal predchádza charge efekty)");
    check(fxOf(c2.lastTimeline, "labyrinth_reveal").filter(e => e.target === "p2").length === 1,
      "T39: presne jeden labyrinth_reveal pre prekliateho");
    // reveal frame nesie plné dáta — prekliaty v ňom vidí pozíciu aj manu Minotaura (widget sa odkryje)
    const t39rev = c2.lastTimeline.find(f => (f.effects || []).some(e => e.kind === "labyrinth_reveal"));
    check(t39rev && t39rev.p1.x !== null && t39rev.p1.mana !== null && t39rev.p2.labReveal === true,
      "T39: reveal frame odhaľuje pozíciu aj manu (labReveal)", `p1=(${t39rev?.p1?.x},${t39rev?.p1?.mana})`);
  }
  // ďalšie kolo po prebudení beží normálne (žiadny zamrznutý stav)
  tl = await playRound(c1, c2, [R, S, M("down")], [R, S, M("right")]);
  check(tl[tl.length - 1].p1.labyrinth === false && tl[tl.length - 1].p2.labyrinth === false,
    "T39: kolo po prebudení prebehlo normálne");
  invariantCheck(tl, "T39");

  /* ---------- Test 39b: prebudenie cez GOLDEN mirror (predťah nestartéra) ---------- */
  await freshMinotaur();
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("up")]);        // p2 zakliaty → (3,0)
  tl = await playRound(c1, c2, [R, S, M("up")], [R, S, M("left")]); // kolo 2: p1 → (0,0), p2 → (2,0)
  // kolo 3 (starter p1): p2 (nestartér) golden mirror; Minotaur strieľa doprava → odraz, labyrint končí
  tl = await playRound(c1, c2, [A("right"), R, S], [GMI, R, S, M("right")]);
  const t39bmir = fxOf(tl, "mirror").filter(e => e.target === "p2");
  check(t39bmir.length === 1 && t39bmir[0].gold === true && t39bmir[0].dmg === 2,
    "T39b: golden mirror odrazil basic (dist 2 → dmg 2, zlatý)", `fx=${JSON.stringify(t39bmir)}`);
  check(fxOf(tl, "labyrinth_end").filter(e => e.target === "p2").length === 1,
    "T39b: aj golden mirror odraz ukončil labyrint");
  const t39bhits = sumEffects(tl).hits;
  check(t39bhits.length === 1 && t39bhits[0].target === "p1" && t39bhits[0].dmg === 2,
    "T39b: odraz dal Minotaurovi 2 dmg", `hits=${JSON.stringify(t39bhits)}`);
  check(tl[tl.length - 1].p2.labyrinth === false, "T39b: labyrint skončil");
  invariantCheck(tl, "T39b");

  /* ---------- Test 38: special na už blúdiaceho = invalid already_lost, niť sa neresetuje ---------- */
  await freshMinotaur();
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("up")]); // p2 zakliaty
  tl = await playRound(c1, c2, [R, SP, S], [R, S, M("left")]); // kolo 2: opakovaný special
  const t38inv = fxOf(tl, "invalid").filter(e => e.target === "p1" && e.reason === "already_lost");
  check(t38inv.length === 1, "T38: opakovaný labyrint = invalid already_lost", `inv=${JSON.stringify(fxOf(tl, "invalid"))}`);
  check(fxOf(tl, "labyrinth").length === 0, "T38: žiadne nové zakliatie");
  const t38last = tl[tl.length - 1];
  check(t38last.p2.labyrinth === true && (c2.lastState?.p2?.thread || []).length === 3,
    "T38: labyrint aj niť bežia ďalej bez resetu", `thread=${JSON.stringify(c2.lastState?.p2?.thread)}`);
  invariantCheck(tl, "T38");

  /* ---------- Test 40: obrys vznikne aj keď prekliaty vstúpi na Minotaurovu bunku (dashom cez ňu) ---------- */
  await freshMinotaur();
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("left")]); // p2 zakliaty → (2,1), niť [3,1],[2,1]
  // kolo 2 (starter p2): p2 dashuje doľava cez (1,1) až NA Minotaurovu bunku (0,1) → obrys na (0,1)
  tl = await playRound(c1, c2, [R, S, M("up")], [D("left"), R, S]);
  const t40marks = fxOf(c2.lastTimeline, "thread_mark");
  check(t40marks.length === 1 && JSON.stringify(t40marks[0].cell) === JSON.stringify([0, 1]),
    "T40: niť dorástla na Minotaurovu bunku → obrys na (0,1)", `marks=${JSON.stringify(t40marks)}`);
  check(JSON.stringify(c2.lastState?.p2?.threadMark) === JSON.stringify([0, 1]),
    "T40: threadMark v snapshote prekliateho", `mark=${JSON.stringify(c2.lastState?.p2?.threadMark)}`);
  check(JSON.stringify(c2.lastState?.p2?.thread) === JSON.stringify([[3, 1], [2, 1], [1, 1], [0, 1]]),
    "T40: dash pridal do nite aj medzibunku", `thread=${JSON.stringify(c2.lastState?.p2?.thread)}`);
  check(fxOf(tl, "thread_mark").length === 0, "T40: lovec o obryse nevie (efekt redigovaný)");
  invariantCheck(tl, "T40");

  /* ---------- Test 41: turnajový draft — choose_team validácia, maskovanie, štart hry ---------- */
  const SW = (to) => ({ type: "swap", to });
  c1.sock.emit("retry");
  await new Promise(r => setTimeout(r, 150));
  configureMatch(c1, { format: "tournament", tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 } });
  await new Promise(r => setTimeout(r, 200));
  check(c1.lastState?.phase === "team_select", "T41: turnaj začína fázou team_select", `phase=${c1.lastState?.phase}`);
  // nevalidné tímy sa odmietnu (duplicita / zlý počet / neznáma postava)
  c1.sock.emit("choose_team", ["fire", "fire", "wanderer"]);
  c1.sock.emit("choose_team", ["fire", "lightning"]);
  c1.sock.emit("choose_team", ["fire", "lightning", "unicorn"]);
  await new Promise(r => setTimeout(r, 200));
  check(c1.lastState?.rosterReady?.p1 === false, "T41: nevalidné tímy odmietnuté", `ready=${JSON.stringify(c1.lastState?.rosterReady)}`);
  // p1 potvrdí tím vrátane experimentálnych postáv
  c1.sock.emit("choose_team", ["minotaur", "fire", "medusa"]);
  await new Promise(r => setTimeout(r, 200));
  check(c1.lastState?.rosterReady?.p1 === true && c1.lastState?.phase === "team_select",
    "T41: tím p1 potvrdený, čaká sa na p2");
  check(JSON.stringify(c1.lastState?.roster?.p1) === JSON.stringify(["minotaur", "fire", "medusa"]),
    "T41: vlastný tím vidím hneď (v poradí výberu)", `roster=${JSON.stringify(c1.lastState?.roster?.p1)}`);
  check(c2.lastState?.roster?.p1 === null, "T41: súperov tím je počas draftu maskovaný", `vidí=${JSON.stringify(c2.lastState?.roster?.p1)}`);
  check(c2.lastState?.rosterReady?.p1 === true, "T41: rosterReady súpera je verejné (opponent is ready)");
  // opakovaný choose_team sa ignoruje
  c1.sock.emit("choose_team", ["fire", "lightning", "wanderer"]);
  await new Promise(r => setTimeout(r, 150));
  check(JSON.stringify(c1.lastState?.roster?.p1) === JSON.stringify(["minotaur", "fire", "medusa"]),
    "T41: tím sa potvrdzuje len raz");
  // p2 potvrdí → oba tímy verejné, hra 1 (char-select)
  c2.sock.emit("choose_team", ["fire", "lightning", "wanderer"]);
  await new Promise(r => setTimeout(r, 200));
  check(c1.lastState?.phase === "playing", "T41: oba tímy potvrdené → hra 1", `phase=${c1.lastState?.phase}`);
  check(JSON.stringify(c1.lastState?.roster?.p2) === JSON.stringify(["fire", "lightning", "wanderer"]),
    "T41: po drafte sú tímy verejné", `roster.p2=${JSON.stringify(c1.lastState?.roster?.p2)}`);
  check(!!c1.lastState?.mageHp && Object.keys(c1.lastState.mageHp).sort().join() === "fire,medusa,minotaur",
    "T41: mageHp = presne vlastný tím", `keys=${Object.keys(c1.lastState?.mageHp || {}).join()}`);
  // postava mimo tímu sa nedá zvoliť; postava z tímu áno
  c1.sock.emit("choose_character", "wanderer");
  await new Promise(r => setTimeout(r, 150));
  check(!c1.lastState?.p1?.char, "T41: postava mimo tímu sa nedá zvoliť", `char=${c1.lastState?.p1?.char}`);
  c1.sock.emit("choose_character", "minotaur");
  c2.sock.emit("choose_character", "fire");
  await new Promise(r => setTimeout(r, 200));
  check(c1.lastState?.p1?.char === "minotaur", "T41: postava z tímu zvolená", `char=${c1.lastState?.p1?.char}`);

  /* ---------- Test 42: swap podľa tímu + zákaz swapu počas labyrintu + roster mana redakcia ---------- */
  // pokračovanie hry z T41: p1 = minotaur (tím minotaur/fire/medusa), p2 = fire (tím fire/lightning/wanderer)
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [SW("wanderer"), R, S]); // wanderer NIE JE v tíme p1
  c2.sock.emit("lock_in", [R, S, M("up")]);
  let swapRejected = false;
  try { await waitTimeline(c1, 1500); } catch { swapRejected = true; }
  check(swapRejected, "T42: swap na maga mimo tímu je odmietnutý pri locku");
  // valídny swap na maga z tímu prejde (teleport out/in), p1 dohrá kolo ako medusa
  c1.sock.emit("lock_in", [SW("medusa"), R, S]);
  tl = await waitTimeline(c1, 8000);
  await new Promise(r => setTimeout(r, 150));
  check(fxOf(tl, "teleport_out").length === 1 && fxOf(tl, "teleport_in").length === 1,
    "T42: swap prehráva teleport out/in");
  check(tl[tl.length - 1].p1.char === "medusa", "T42: p1 hrá po swape medusu", `char=${tl[tl.length - 1].p1.char}`);
  invariantCheck(tl, "T42");
  // kolo 2 (starter p2): p1 sa vráti na minotaura a zakleje p2 do labyrintu; p2 nesmie trafiť (S kryje R)
  tl = await playRound(c1, c2, [SW("minotaur"), SP, R], [R, M("down"), S]);
  check(fxOf(tl, "labyrinth").filter(e => e.target === "p2").length === 1, "T42: p2 skončil v labyrinte");
  check(tl[tl.length - 1].p2.labyrinth === true, "T42: labyrint trvá na konci kola");
  // roster mana redakcia — obojsmerná: prekliaty nevidí manu tímu lovca a naopak; HP tímov ostávajú
  check(c1.lastState?.rosterMana?.p2 === null && c2.lastState?.rosterMana?.p1 === null,
    "T42: počas labyrintu ani jeden nevidí manu súperovho tímu",
    `c1 vidí p2=${JSON.stringify(c1.lastState?.rosterMana?.p2)}, c2 vidí p1=${JSON.stringify(c2.lastState?.rosterMana?.p1)}`);
  check(!!c1.lastState?.rosterMana?.p1 && !!c2.lastState?.rosterMana?.p2, "T42: vlastný roster mana ostáva viditeľný");
  check(!!c1.lastState?.rosterHp?.p2 && !!c2.lastState?.rosterHp?.p1, "T42: roster HP sa nereďiguje (ako živé HP)");
  // kolo 3 (starter p1): počas labyrintu je swap odmietnutý OBOM stranám už pri locku
  c1.lastTimeline = null; c2.lastTimeline = null;
  c1.sock.emit("lock_in", [SW("medusa"), R, S]);
  c2.sock.emit("lock_in", [SW("lightning"), R, S]);
  let labSwapRejected = 0;
  try { await waitTimeline(c1, 1500); } catch { labSwapRejected++; }
  check(labSwapRejected === 1, "T42: swap počas labyrintu je odmietnutý (lovec aj prekliaty)");
  // valídne locky bez swapu kolo normálne dohrajú, labyrint beží ďalej
  c1.sock.emit("lock_in", [R, S, M("right")]);
  c2.sock.emit("lock_in", [R, S, M("left")]);
  tl = await waitTimeline(c1, 8000);
  await new Promise(r => setTimeout(r, 150));
  check(tl[tl.length - 1].p2.labyrinth === true, "T42: kolo bez swapu prebehlo, labyrint trvá");
  invariantCheck(tl, "T42b");

  /* ---------- Test 43: kliatba uprostred kola zneplatní už naplánovaný swap (doSwap guard) ---------- */
  async function freshTournament() {
    c1.sock.emit("retry");
    await new Promise(r => setTimeout(r, 150));
    configureMatch(c1, { format: "tournament", tileWeights: { dmg: 0, heal: 0, mana: 100, ik: 0 } });
    await new Promise(r => setTimeout(r, 150));
    c1.sock.emit("choose_team", ["minotaur", "fire", "medusa"]);
    c2.sock.emit("choose_team", ["fire", "lightning", "wanderer"]);
    await new Promise(r => setTimeout(r, 200));
    c1.sock.emit("choose_character", "minotaur");
    c2.sock.emit("choose_character", "fire");
    await new Promise(r => setTimeout(r, 200));
  }
  await freshTournament();
  // kolo 1 (starter p1): p1a1 = special (kliatba na p2), p2a1 = swap → v momente vykonania už beží
  // labyrint → swap prepadne ako invalid, p2 ostáva fire
  tl = await playRound(c1, c2, [SP, R, S], [SW("lightning"), R, S]);
  check(fxOf(tl, "labyrinth").filter(e => e.target === "p2").length === 1, "T43: kliatba padla prvou akciou kola");
  check(fxOf(tl, "invalid").filter(e => e.target === "p2").length === 1,
    "T43: naplánovaný swap prekliateho prepadol ako invalid", `inv=${JSON.stringify(fxOf(tl, "invalid"))}`);
  check(fxOf(tl, "teleport_out").length === 0, "T43: žiadny teleport neprebehol");
  check(tl[tl.length - 1].p2.char === "fire", "T43: p2 ostáva fire", `char=${tl[tl.length - 1].p2.char}`);
  invariantCheck(tl, "T43");

  /* ---------- Test 44: Last Stand pakt — vo final kole je swap zakázaný ---------- */
  // inak by si hráč zabankoval démonov full-heal do rosteru (swap ukladá živých 10/10)
  // a doom by zabil náhradníka namiesto mága, ktorý pakt uzavrel
  await freshTournament(); // p1 = minotaur (tím minotaur/fire/medusa), p2 = fire
  // kolo 1 (starter p1): p1 aktivuje Last Stand (trailing) — démon ho zabije a oživí na 10/10
  tl = await playRound(c1, c2, [R, S, M("right"), LS], [R, S, M("up")]);
  check(tl[tl.length - 1].p1.lastStandBuff === true, "T44: po summone má p1 buff (final kolo)");
  // final kolo (starter p2): lock buffnutého hráča so swapom je odmietnutý
  c1.lastTimeline = null; c2.lastTimeline = null; c1.gameResult = null;
  c1.sock.emit("lock_in", [SW("medusa"), R, A("right")]);
  c2.sock.emit("lock_in", [R, S, M("down")]);
  let lsSwapRejected = false;
  try { await waitTimeline(c1, 1500); } catch { lsSwapRejected = true; }
  check(lsSwapRejected, "T44: swap hráča s paktom vo final kole je odmietnutý");
  // bez swapu final kolo prebehne; p1 nevyhrá → banish zabije mága, ktorý pakt uzavrel
  c1.sock.emit("lock_in", [R, M("left"), S]);
  tl = await waitTimeline(c1, 8000);
  await new Promise(r => setTimeout(r, 150));
  check(tl[tl.length - 1].p1.hp === 0, "T44: doom — banish zabil mága s paktom", `hp=${tl[tl.length - 1].p1.hp}`);
  check(c1.gameResult?.gameWinner === "p2", "T44: hru berie p2", `res=${JSON.stringify(c1.gameResult)}`);

  /* ---------- Test 45: doom banish počas labyrintu = reveal sekvencia ako pri istom zásahu ---------- */
  // Minotaur zakleje súpera, privolá Last Stand; vo final kole nikto nikoho netrafí → banish ho zabije.
  // Banish je istá smrť = koniec hry — labyrint sa musí odhaliť PRED banish animáciou a skončiť po smrti,
  // inak by hra skončila v hmle s aktívnou redakciou.
  await freshMinotaur(); // single: p1 = minotaur, p2 = fire (mana-only tiles)
  tl = await playRound(c1, c2, [SP, R, S], [R, S, M("up")]);              // kolo 1: p2 zakliaty
  check(tl[tl.length - 1].p2.labyrinth === true, "T45: p2 blúdi v labyrinte");
  tl = await playRound(c1, c2, [R, S, M("right"), LS], [R, S, M("left")]); // kolo 2: p1 aktivuje Last Stand
  check(tl[tl.length - 1].p1.lastStandBuff === true, "T45: p1 má buff, labyrint stále beží");
  check(tl[tl.length - 1].p2.labyrinth === true, "T45: Last Stand summon labyrint nekončí (žiadny zásah)");
  // final kolo (starter p1): žiadne zásahy → doom banish na konci kola
  c1.gameResult = null;
  tl = await playRound(c1, c2, [R, S, M("left")], [R, S, M("right")]);
  const idxReveal = tl.findIndex(f => (f.effects || []).some(e => e.kind === "labyrinth_reveal"));
  const idxBanish = tl.findIndex(f => (f.effects || []).some(e => e.kind === "last_stand_banish"));
  const idxLabEnd = tl.findIndex(f => (f.effects || []).some(e => e.kind === "labyrinth_end"));
  check(idxReveal >= 0 && idxBanish > idxReveal, "T45: odhalenie labyrintu prišlo PRED banish animáciou",
    `reveal=${idxReveal}, banish=${idxBanish}`);
  check(idxLabEnd > idxBanish, "T45: labyrint skončil po banish smrti", `end=${idxLabEnd}, banish=${idxBanish}`);
  const t45last = tl[tl.length - 1];
  check(t45last.p1.hp === 0 && t45last.p2.labyrinth === false && t45last.p2.thread.length === 0,
    "T45: hra skončila mimo hmly — labyrint aj niť zanikli", `hp=${t45last.p1.hp}, lab=${t45last.p2.labyrinth}`);
  check(c1.gameResult?.gameWinner === "p2", "T45: hru berie p2", `res=${JSON.stringify(c1.gameResult)}`);
  // prekliaty (c2) má od reveal framu neredigované dáta — banish choreografiu vidí
  const c2reveal = c2.lastTimeline.findIndex(f => (f.effects || []).some(e => e.kind === "labyrinth_reveal"));
  const c2banish = c2.lastTimeline.some(f => (f.effects || []).some(e => e.kind === "last_stand_banish"));
  check(c2reveal >= 0 && c2banish, "T45: prekliaty vidí banish choreografiu (reveal zrušil redakciu)",
    `reveal=${c2reveal}, banishSeen=${c2banish}`);

  c1.sock.close(); c2.sock.close();
  server.kill();
  console.log(failures === 0 ? "\nVŠETKY TESTY PREŠLI" : `\nZLYHANÍ: ${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(2); });
