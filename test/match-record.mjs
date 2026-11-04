// test/match-record.mjs - záznamy zápasov MATCHES / ANALYZE (docs/MATCH_REVIEW_PLAN.md) nad headless enginom:
// zápis kôl z bot zápasov (všetky arény, BO3, turnaj, THE WORLD, labyrint, pasca), bez mien hráčov, férovosť pohľadov
// (pohľad = presne to, čo dostal hráč: súperova pasca skrytá, poloha súpera v labyrinte skrytá), príčina konca,
// úložisko (stránkovanie, get, presun inej verzie do old-v<N>/) a STRÁŽ FORMÁTU: tvar záznamu (cesty kľúčov) sa
// porovná so vzorom test/fixtures/match-record-shape.json - zmizne / premenuje sa kľúč, ktorý starý záznam má →
// test zlyhá: zvýš MATCH_RECORD_VERSION (shared/match-record.js) a pregeneruj vzor: node test/match-record.mjs --update
// Spustenie: node test/match-record.mjs  (súčasť npm test)
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRecordedEngine } from "../telemetry/recorder.js";
import { createMatchLog, summaryOf } from "../telemetry/match-log.js";
import { MATCH_RECORD_VERSION, END_CAUSES } from "../shared/match-record.js";
import { playBotMatch } from "../tools/random-bot.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHAPE_FILE = path.join(__dirname, "fixtures", "match-record-shape.json");
const UPDATE = process.argv.includes("--update");
let failures = 0, passes = 0;
function check(cond, label, detail = "") {
  if (cond) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}

const TILES = { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 };
const ARENAS = {
  bridge: {},
  portal: { arena: "portal", tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 }, portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 } },
  swamp: { arena: "swamp" },
};
// zápas botov → uložený záznam (alebo null)
function play({ arena = "bridge", format = "single", chars, teams, seed }) {
  let over = false, saved = null;
  const e = createRecordedEngine({ emit: (ev) => { if (ev === "game_over") over = true; }, schedule: (fn) => fn(), names: () => ({ A: "ALICEQ", B: "BOBBYQ" }) },
    { matchLog: { save: (r) => { saved = r; } }, seed: () => seed, now: () => 1767225600000 + seed * 1000, newId: () => `abcdef${String(seed).padStart(4, "0")}` });
  e.startMatch(e.sanitizeConfig({ format, tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white", tileWeights: TILES, ...ARENAS[arena] }));
  if (teams) { e.chooseTeam("A", teams[0]); e.chooseTeam("B", teams[1]); }
  for (let g = 0; g < 5 && !over; g++) {
    const gi = e.game.series?.gameIndex;
    if (teams) {
      const alive = (p) => teams[p === "A" ? 0 : 1].find(c => (e.game.mageHp?.[p]?.[c] ?? 1) > 0);
      e.chooseCharacter("A", alive("A")); e.chooseCharacter("B", alive("B"));
    } else { e.chooseCharacter("A", chars[0]); e.chooseCharacter("B", chars[1]); }
    playBotMatch(e, seed * 10 + g, () => over || e.game.series?.gameIndex !== gi || e.game.phase !== "playing", 60);
  }
  e.abort("test");
  return saved;
}

const MATCHES = [
  { arena: "bridge", chars: ["countess", "jotaro"], seed: 3 },
  { arena: "bridge", format: "bo3", chars: ["minotaur", "jotaro"], seed: 11 },
  { arena: "bridge", chars: ["minotaur", "naruto"], seed: 5 },
  { arena: "portal", format: "bo3", chars: ["escanor", "onre"], seed: 7 },
  { arena: "swamp", chars: ["werewolf", "medusa"], seed: 9 },
  { arena: "bridge", format: "tournament", teams: [["fire", "minotaur", "luffy"], ["soldier", "naruto", "jotaro"]], seed: 11 },
];
const recs = MATCHES.map(play);

console.log("Záznam");
check(recs.every(Boolean), "každý zápas uloží záznam");
check(recs.every(r => r.v === MATCH_RECORD_VERSION), "záznam nesie MATCH_RECORD_VERSION");
check(recs.every(r => !JSON.stringify(r).includes("ALICEQ") && !JSON.stringify(r).includes("BOBBYQ")), "žiadne mená hráčov (bez identity)");
check(recs.every(r => !JSON.stringify(r).includes("\"effects\"")), "bez efektov (statický rozbor)");
check(recs[1].games.length >= 2 && recs[5].games.length >= 2, "séria = jeden záznam s viacerými hrami", recs.map(r => r.games.length).join(","));
check(recs[5].team?.p1?.length === 3 && recs[5].team?.p2?.length === 3, "turnaj: tímy oboch strán");
check(recs.every(r => r.games.every(g => g.rounds.every(rd => rd.views.p1.beats.length && rd.views.p2.beats.length))), "každé kolo má beaty v oboch pohľadoch");
check(recs.every(r => r.games.filter(g => g.winner).every(g => END_CAUSES.includes(g.cause))), "príčina konca je jedna zo 4", recs.flatMap(r => r.games.map(g => g.cause)).join(","));
// hra končí smrťou porazeného - posledný beat posledného kola ju ukazuje
check(recs.every(r => r.games.filter(g => g.winner).every(g => {
  const v = g.rounds[g.rounds.length - 1].views.p1, st = v.beats[v.beats.length - 1].state, loser = g.winner === "p1" ? "p2" : "p1";
  return st[loser].hp <= 0;
})), "posledný stav hry: porazený má 0 HP");
const allBeats = recs.flatMap(r => r.games.flatMap(g => g.rounds.flatMap(rd => ["p1", "p2"].flatMap(v => rd.views[v].beats.map(b => ({ v, b, rd }))))));
check(allBeats.some(x => x.b.frozen) && allBeats.some(x => x.b.tsEnd), "THE WORLD: frozen akcie + koniec pauzy");
check(allBeats.some(x => x.b.empty === "gmana"), "prázdne golden beaty (beat_empty)");

console.log("Pohľady (férovosť)");
const states = (r, view) => r.games.flatMap(g => g.rounds.flatMap(rd => [rd.views[view].start, ...rd.views[view].beats.map(b => b.state)]));
// Vampire (p1) pascu vidí len ona
check(states(recs[0], "p1").some(s => s.p1.trap), "Vampire vidí vlastnú pascu");
check(states(recs[0], "p2").every(s => !s.p1.trap), "súper Vampire pascu v zázname nevidí");
// prekliaty v labyrinte nevidí polohu súpera
const lab = recs.flatMap(r => ["p1", "p2"].flatMap(v => states(r, v).filter(s => s[v].labyrinth && !s[v].labReveal).map(s => ({ s, v }))));
check(lab.length > 0, "labyrint sa v zázname vyskytol");
check(lab.every(({ s, v }) => s[v === "p1" ? "p2" : "p1"].x == null), "prekliaty nevidí polohu súpera");
check(allBeats.some(x => x.b.action?.type === "unknown"), "súperove akcie v labyrinte ako „?\"");

console.log("Úložisko");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-matches-"));
  const log = createMatchLog(dir);
  recs.forEach(r => log.save(r));
  const p1 = log.list({ limit: 4 });
  check(p1.rows.length === 4 && p1.more && p1.rows[0].id === recs[recs.length - 1].id, "stránka zoznamu: najnovšie prvé, more");
  const p2 = log.list({ before: p1.rows[3].id, limit: 4 });
  check(p2.rows.length === 2 && !p2.more, "ďalšia stránka (before)");
  check(JSON.stringify(log.get(recs[2].id)) === JSON.stringify(recs[2]), "get vráti celý záznam");
  check(log.get("../index") === null && log.get("ffffffffffff") === null, "neplatné / neznáme id = null");
  check(JSON.stringify(p1.rows[0]) === JSON.stringify(summaryOf(recs[recs.length - 1])), "riadok zoznamu = summaryOf");
  // iná verzia → presun do old-v<N>/
  const idx = path.join(dir, "index.jsonl");
  const old = { ...summaryOf(recs[0]), id: "0123456789ab", v: MATCH_RECORD_VERSION - 1 };
  fs.appendFileSync(idx, JSON.stringify(old) + "\n");
  fs.writeFileSync(path.join(dir, "0123456789ab.json.gz"), "x");
  const log2 = createMatchLog(dir);
  check(log2.size === recs.length && log2.get("0123456789ab") === null, "záznam inej verzie sa nezobrazí");
  check(fs.existsSync(path.join(dir, `old-v${old.v}`, "0123456789ab.json.gz")), "súbor inej verzie presunutý do old-v<N>/");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("Stráž formátu (MATCH_RECORD_VERSION)");
{
  // cesty kľúčov záznamu (polia zlúčené cez []). Len STABILNÉ kľúče - nie tie, čo sa objavia náhodou podľa priebehu
  // zápasu: stav (start / state) len do hĺbky kľúčov postavy (p1.trap aj keď je null), voliteľné príznaky beatov /
  // kôl / záznamu (frozen, invalid, demon, ai…) sa vynechajú; slovníky per postava (rosterHp…) sú list
  const OPTIONAL = new Set(["frozen", "invalid", "empty", "tsEnd", "action", "demon", "ai", "team", "dead", "randomArena", "vsAi", "aiLevel", "config", "planned"]);
  const paths = new Set();
  const walk = (v, p) => {
    const last = p.split(".").pop().replace("[]", "");
    if (last === "start" || last === "state") {
      for (const k of Object.keys(v)) {
        if (k === "p1" || k === "p2") for (const kk of Object.keys(v[k] || {})) paths.add(`${p}.${k}.${kk}`);
        else paths.add(`${p}.${k}`);
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach(x => walk(x, p + "[]")); return; }
    if (v && typeof v === "object") { for (const k of Object.keys(v)) if (!OPTIONAL.has(k)) walk(v[k], p ? `${p}.${k}` : k); return; }
    paths.add(p);
  };
  recs.forEach(r => walk(r, ""));
  const shape = [...paths].sort();
  if (UPDATE) {
    fs.writeFileSync(SHAPE_FILE, JSON.stringify({ v: MATCH_RECORD_VERSION, paths: shape }, null, 1) + "\n");
    console.log(`  vzor zapísaný: ${path.relative(process.cwd(), SHAPE_FILE)} (${shape.length} ciest)`);
  } else {
    const fx = JSON.parse(fs.readFileSync(SHAPE_FILE, "utf8"));
    const missing = fx.paths.filter(p => !paths.has(p));
    check(fx.v === MATCH_RECORD_VERSION, "vzor je pre aktuálnu verziu", `vzor v${fx.v}, kód v${MATCH_RECORD_VERSION} - pregeneruj: node test/match-record.mjs --update`);
    check(!missing.length, "žiadny kľúč starého formátu nezmizol",
      `chýba: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""} → zvýš MATCH_RECORD_VERSION a pregeneruj vzor (node test/match-record.mjs --update)`);
  }
}

console.log(`\nmatch-record: ${passes} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
