// test/telemetry.mjs - zber herných dát (telemetry/*, docs/TELEMETRY.md): headless boti odohrajú zápasy
// všetkých formátov cez engine obalený recorderom (single, bo3, turnaj, náhodné postavy, Portal Realm,
// THE WORLD, timer auto-lock, nedohraný zápas) a každý zápas sa potom prehrá LEN zo zapísaného logu -
// znova odvodené záznamy musia byť identické s logom (= log je úplný a zápas sa dá kedykoľvek dosimulovať).
// Nakoniec JSONL store: zápis na disk + gzip export.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { createRecordedEngine } from "../telemetry/recorder.js";
import { replayMatch, splitMatches, diffReplay } from "../telemetry/replay.js";
import { createJsonlStore } from "../telemetry/store.js";
import { botLock, botTimestop, seededRng } from "../tools/random-bot.mjs";
import { CHARS } from "../engine/constants.js";

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error("  ✗ " + msg); }
}

const POOL = { p1: [...CHARS, "countess", "luffy"], p2: [...CHARS, "onre", "jotaro"] };
const BASE = { tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "random",
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 } };

let clock = 0, ids = 0;
// odohrá jeden zápas, záznamy pridá do `log`; opts.chars = { p1, p2 } pevné postavy, opts.retryAt = kolo, v ktorom
// host dá retry (nedohraný zápas)
function playMatch(log, config, seed, opts = {}) {
  const pending = [];
  const eng = createRecordedEngine({ schedule: (fn) => { pending.push(fn); } }, {
    sink: (r) => log.push(r), now: () => (clock += 37), newId: () => `m${++ids}`, seed: () => seed,
    meta: { commit: "test", dirty: false, balance: "test" },
  });
  const rng = { A: seededRng(seed * 3 + 1), B: seededRng(seed * 3 + 2), X: seededRng(seed * 3 + 3) };
  const pick = (arr) => arr[Math.floor(rng.X() * arr.length)];
  eng.startMatch(eng.sanitizeConfig({ ...BASE, ...config }));
  for (let guard = 0; guard < 1500; guard++) {
    const g = eng.game;
    if (g.phase === "match_over") return;
    if (pending.length) { pending.shift()(); continue; }
    if (g.phase === "team_select") {
      for (const person of ["A", "B"]) {
        if (g.roster[person]) continue;
        const pool = [...POOL[eng.slotForPerson(person)]];
        const team = [];
        while (team.length < 3) team.push(pool.splice(Math.floor(rng.X() * pool.length), 1)[0]);
        eng.chooseTeam(person, team);
      }
      continue;
    }
    if (g.phase !== "playing") return;
    if (!g.players.p1.char || !g.players.p2.char) {
      for (const slot of ["p1", "p2"]) {
        if (g.players[slot].char) continue;
        const person = g.seats[slot];
        const options = g.mageHp ? g.roster[person].filter(k => g.mageHp[person][k] > 0) : POOL[slot];
        eng.chooseCharacter(person, opts.chars?.[slot] ?? pick(options));
      }
      continue;
    }
    if (g.timestop?.mode === "waiting") {
      if (!botTimestop(eng, g.seats[g.timestop.slot], rng.X)) break;
      continue;
    }
    if (opts.retryAt && g.turn >= opts.retryAt) { eng.newGame(); return; }
    if (g.turn > 60) break;
    // kolo: väčšinou bot zamkne frontu, občas nechá rozpracovaný draft a ťah dokončí timer (autoLock)
    let auto = false;
    for (const person of ["A", "B"]) {
      if (rng.X() < 0.15) {
        auto = true;
        eng.draftQueue(person, { queue: [{ type: pick(["recharge", "shield", "attack"]), dir: pick(["up", "down", "left", "right"]) }], goldenMana: rng.X() < 0.2 });
      } else if (!botLock(eng, person, rng[person])) { auto = true; }
    }
    if (auto) eng.autoLock();
  }
  eng.abort("test_limit");
}

const log = [];
const scenarios = [
  ...Array.from({ length: 8 }, (_, i) => [{ format: "single" }, 100 + i, { chars: { p2: "jotaro" } }]),          // THE WORLD
  ...Array.from({ length: 4 }, (_, i) => [{ format: "single" }, 200 + i, { chars: { p1: "naruto", p2: "onre" } }]),
  ...Array.from({ length: 6 }, (_, i) => [{ format: "single" }, 300 + i]),
  ...Array.from({ length: 4 }, (_, i) => [{ format: "single", randomChars: true }, 400 + i]),
  ...Array.from({ length: 4 }, (_, i) => [{ format: "bo3" }, 500 + i]),
  ...Array.from({ length: 3 }, (_, i) => [{ format: "bo3", randomChars: true }, 600 + i]),
  ...Array.from({ length: 3 }, (_, i) => [{ format: "tournament" }, 700 + i]),
  ...Array.from({ length: 2 }, (_, i) => [{ format: "tournament", randomChars: true }, 800 + i]),
  ...Array.from({ length: 4 }, (_, i) => [{ format: "single", arena: "portal", tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 },
    portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 }, portalsPerRound: 1 + i }, 900 + i]),
  ...Array.from({ length: 3 }, (_, i) => [{ format: i ? "bo3" : "single", arena: "swamp" }, 950 + i]),           // Shrek Swamp
  ...Array.from({ length: 2 }, (_, i) => [{ format: "bo3" }, 1000 + i, { retryAt: 4 }]),                            // nedohraný
];
const t0 = performance.now();
for (const [config, seed, opts] of scenarios) playMatch(log, config, seed, opts);

/* ---- obsah logu ---- */
console.log("telemetry: obsah logu");
const matches = splitMatches(log);
check(matches.size === scenarios.length, `počet zápasov ${matches.size} ≠ ${scenarios.length}`);
const count = (t) => log.filter(r => r.t === t).length;
const stats = { round: count("round"), game_end: count("game_end"), lock: count("lock"), auto: count("auto"), ts: count("ts"), next: count("next") };
console.log("  ", JSON.stringify(stats));
for (const k of ["round", "game_end", "lock", "auto", "ts", "next"]) check(stats[k] > 0, `žiadny záznam „${k}“`);
for (const r of log) {
  check(typeof r.t === "string" && typeof r.m === "string", `záznam bez t/m: ${JSON.stringify(r).slice(0, 80)}`);
  // hráči len ako strany white/black - žiadne osoby A/B ani mená
  check(!/"(seats|person|names?|winnerPerson)"/.test(JSON.stringify(r)), `záznam obsahuje identitu hráča: ${JSON.stringify(r).slice(0, 120)}`);
}
for (const [m, recs] of matches) {
  check(recs[0].t === "match_start", `${m}: prvý záznam nie je match_start`);
  check(typeof recs[0].seed === "number", `${m}: match_start bez seedu`);
  const end = recs.filter(r => r.t === "match_end");
  check(end.length === 1 && recs[recs.length - 1] === end[0], `${m}: match_end chýba alebo nie je posledný`);
  const cfg = recs[0].config;
  for (const ge of recs.filter(r => r.t === "game_end")) {
    check(["white", "black"].includes(ge.winner), `${m}: game_end winner ${ge.winner}`);
    check(ge.chars.white && ge.chars.black, `${m}: game_end bez postáv`);
    check(ge.random === !!(cfg.randomChars && cfg.format !== "tournament"), `${m}: game_end random`);
    const picks = recs.filter(r => r.t === "pick" && r.g === ge.g);
    check(picks.length === 2 && picks.every(p => p.char === ge.chars[p.side]), `${m} g${ge.g}: pick záznamy nesedia s game_end`);
    check(picks.every(p => p.random === ge.random), `${m} g${ge.g}: pick random flag`);
    check(ge.lastHit !== null, `${m} g${ge.g}: game_end bez lastHit`);
  }
  if (cfg.format === "tournament") {
    const teams = recs.filter(r => r.t === "team");
    check(teams.length === 2 && teams.every(t => t.random === !!cfg.randomChars && t.team.length === 3), `${m}: team záznamy`);
  }
  for (const r of recs.filter(r => r.t === "round")) {
    check(Array.isArray(r.segs) && r.segs.some(s => s.side), `${m}: kolo bez akcií`);
    check(r.end?.white?.char && r.end?.black?.char, `${m}: kolo bez koncového stavu`);
  }
}
const finished = [...matches.values()].filter(recs => recs.at(-1).reason === "finished").length;
const retried = [...matches.values()].filter(recs => recs.at(-1).reason === "retry").length;
check(retried === 2, `nedohrané (retry) zápasy: ${retried}`);
check(finished >= scenarios.length - 4, `dohraných zápasov len ${finished}`);
check(log.some(r => r.t === "round" && r.segs.some(s => s.fx.timestop_start)), "žiadne kolo s THE WORLD");

/* ---- replay: každý zápas znova len z logu ---- */
console.log("telemetry: replay zo zapísaného logu");
for (const [m, recs] of matches) {
  let res;
  try { res = replayMatch(recs); } catch (e) { check(false, `${m}: replay zlyhal: ${e.stack}`); continue; }
  const diff = diffReplay(recs, res.records);
  check(!diff, `${m}: replay sa líši na zázname ${diff?.index}\n     log:    ${diff?.logged?.slice(0, 300)}\n     replay: ${diff?.replayed?.slice(0, 300)}`);
}

/* ---- JSONL store + gzip export ---- */
console.log("telemetry: JSONL store");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-telemetry-"));
try {
  const store = createJsonlStore(dir, { flushMs: 60000 });
  for (const r of log) store.append(r);
  store.flush();
  const files = store.files();
  check(files.length === 1, `denných súborov ${files.length}`);
  const back = files.flatMap(f => fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").map(l => JSON.parse(l)));
  check(JSON.stringify(back) === JSON.stringify(log), "záznamy prečítané zo súboru sa líšia");
  check(store.files("2999-01-01").length === 0, "filter ?from nefunguje");
  const chunks = [];
  const { PassThrough } = await import("stream");
  const sinkStream = new PassThrough();
  sinkStream.on("data", (c) => chunks.push(c));
  await new Promise((resolve) => { sinkStream.on("end", resolve); store.pipeGzip(sinkStream); });
  const unzipped = zlib.gunzipSync(Buffer.concat(chunks)).toString("utf8").trim().split("\n");
  check(unzipped.length === log.length, `gzip export: ${unzipped.length} riadkov ≠ ${log.length}`);
  const fromGz = [...splitMatches(unzipped.map(l => JSON.parse(l))).values()][0];
  check(!diffReplay(fromGz, replayMatch(fromGz).records), "replay zápasu z gzip exportu sa líši");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const kb = Math.round(log.reduce((a, r) => a + JSON.stringify(r).length + 1, 0) / 1024);
console.log(`telemetry: ${matches.size} zápasov, ${log.length} záznamov (${kb} kB) za ${Math.round(performance.now() - t0)} ms`);
if (failures) { console.error(`telemetry: ${failures} chýb`); process.exit(1); }
console.log("telemetry: OK");
