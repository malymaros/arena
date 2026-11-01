// test/random-arena.mjs - náhodná aréna (lobby kocka, docs/RANDOM_ARENA_PLAN.md) priamo nad enginom (bez servera):
// sanitizácia configu s nastaveniami všetkých troch arén, deterministické losovanie v startMatch (prvé rand()),
// normalizovaný config = config ručného výberu, poradie udalostí arena_roll → color_roll → char_roll, posun
// časovača ťahu a séria hraná celá na jednej aréne.
// Spustenie: node test/random-arena.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";
import { ARENA_ROLL_MS, COLOR_ROLL_MS, charRollMs } from "../shared/timing.js";
import { botLock, seededRng } from "../tools/random-bot.mjs";

let failures = 0, passes = 0;
function check(cond, label, detail = "") {
  if (cond) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;

const BRIDGE = { tilesPerRound: 2, tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 }, tilePreview: true };
const PORTAL = { tilesPerRound: 1, tileWeights: { dmg: 90, ik: 10 }, tilePreview: false,
  portalWeights: { classic: 70, hp: 5, mana: 5, power: 10, nodef: 10 }, portalsPerRound: 3 };
const SWAMP = { itemsPerRound: 2, itemWeights: { heal: 60, mana: 40 }, shrekPreview: false };
const COMMON = { format: "single", timer: "30", colorPref: "random" };
const dice = (extra = {}, arenas = {}) => ({ ...COMMON, ...extra, arena: "random",
  arenas: { bridge: BRIDGE, portal: PORTAL, swamp: SWAMP, ...arenas } });
// ten istý config pri ručnom výbere arény
const manual = (key, extra = {}) => ({ ...COMMON, ...extra,
  ...(key === "portal" ? { arena: "portal", ...PORTAL } : key === "swamp" ? { arena: "swamp", ...SWAMP } : BRIDGE) });
const BG = { bridge: "bridge", portal: "portal-realm", swamp: "shrek-swamp" };

// engine so zachytenými udalosťami (emit) a posunmi časovača ťahu
function engine(seed, schedule = null) {
  const events = [], timers = [];
  const e = createEngine({ seed, emit: (ev, p) => events.push([ev, p]), beginPlanningTimer: (ms) => timers.push(ms),
    ...(schedule ? { schedule } : {}) });
  return { e, events, timers, kinds: () => events.map(([k]) => k) };
}
const arenaOf = (cfg) => cfg.arena || "bridge";

/* ==================== Config ==================== */
console.log("Config (kocka)");
{
  const { e } = engine(1);
  const c = e.sanitizeConfig(dice());
  check(c && c.arena === "random" && J(Object.keys(c.arenas)) === J(["bridge", "portal", "swamp"]), "C1: kocka - config nesie pravidlá všetkých troch arén", J(c && Object.keys(c)));
  for (const key of ["bridge", "portal", "swamp"]) {
    check(J(c.arenas[key]) === J(e.sanitizeConfig(manual(key))), `C2: pravidlá ${key} = config ručného výberu ${key}`);
  }
  check(e.sanitizeConfig(dice({}, { bridge: { ...BRIDGE, tileWeights: { ...BRIDGE.tileWeights, dmg: 40 } } })) === null, "C3: zlý súčet dlaždíc stone bridge → null");
  check(e.sanitizeConfig(dice({}, { portal: { ...PORTAL, portalWeights: { ...PORTAL.portalWeights, classic: 60 } } })) === null, "C4: zlý súčet portálov → null");
  check(e.sanitizeConfig(dice({}, { swamp: { ...SWAMP, itemWeights: { heal: 50, mana: 40 } } })) === null, "C5: zlý súčet itemov → null");
  const r = e.sanitizeConfig(dice({ randomChars: true }));
  check(r.randomChars === true && !("randomChars" in c), "C6: náhodné postavy sa prenesú, bez nich kľúč chýba");
  const plain = e.sanitizeConfig(manual("bridge"));
  check(!("arena" in plain) && !("randomArena" in plain) && !("arenas" in plain), "C7: stone bridge bez kocky - config bez nových kľúčov (goldeny)", J(plain));
}

/* ==================== Losovanie ==================== */
console.log("Losovanie arény v startMatch");
{
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    const a = engine(seed), b = engine(seed);
    a.e.startMatch(a.e.sanitizeConfig(dice()));
    b.e.startMatch(b.e.sanitizeConfig(dice()));
    if (arenaOf(a.e.game.config) !== arenaOf(b.e.game.config)) { check(false, `L1: seed ${seed} vylosoval rôzne arény`); break; }
    seen.add(arenaOf(a.e.game.config));
  }
  check(seen.size === 3, "L1: rovnaký seed = rovnaká aréna; cez 60 seedov padnú všetky tri", J([...seen]));
  for (const seed of [1, 2, 12]) { // portal, swamp, bridge
    const { e } = engine(seed);
    e.startMatch(e.sanitizeConfig(dice()));
    const key = arenaOf(e.game.config);
    const expect = { ...e.sanitizeConfig(manual(key)), randomArena: true };
    check(J(e.game.config) === J(expect) && e.game.arena === BG[key], `L2: seed ${seed} → ${key}: config = ručný výber + randomArena, pozadie ${BG[key]}`, J(e.game.config));
    if (key === "portal") check(e.game.portals.length === PORTAL.portalsPerRound, "L3: portal realm - portály podľa jeho pravidiel", String(e.game.portals.length));
    if (key === "swamp") check(!!e.game.shrek && e.game.tiles.length === 0, "L3: shrek swamp - Shrek, bez dlaždíc");
  }
}

/* ==================== Udalosti a časovač ==================== */
console.log("Udalosti a časovač ťahu");
{
  const a = engine(3);
  a.e.startMatch(a.e.sanitizeConfig(dice({ randomChars: true })));
  const [, roll] = a.events.find(([k]) => k === "arena_roll") || [];
  const order = a.kinds().filter(k => ["arena_roll", "color_roll", "char_roll"].includes(k));
  check(J(order) === J(["arena_roll", "color_roll", "char_roll"]) && roll?.arena === arenaOf(a.e.game.config),
    "E1: arena_roll (vylosovaná aréna) → color_roll → char_roll", J(order));
  const color = a.events.find(([k]) => k === "color_roll")[1], chars = a.events.find(([k]) => k === "char_roll")[1];
  check(color.afterArena === true && color.animate === true && chars.afterArena === true && chars.afterColor === true, "E2: ruleta farieb aj losovanie postáv čakajú na losovanie arény", J([color, chars]));
  check(a.timers.includes(charRollMs() + COLOR_ROLL_MS + ARENA_ROLL_MS), "E3: časovač ťahu posunutý o losovanie arény + farieb + postáv", J(a.timers));

  const b = engine(3);
  b.e.startMatch(b.e.sanitizeConfig(dice({ colorPref: "white" })));
  check(J(b.events.find(([k]) => k === "color_roll")[1]) === J({ animate: false, afterArena: true }) && !b.kinds().includes("char_roll"),
    "E4: pevná farba, ručný výber - ruleta sa nehrá, losovanie arény áno");

  const c = engine(3);
  c.e.startMatch(c.e.sanitizeConfig(manual("swamp", { randomChars: true })));
  check(!c.kinds().includes("arena_roll") && c.events.find(([k]) => k === "color_roll")[1].afterArena === false
    && c.timers.includes(charRollMs() + COLOR_ROLL_MS) && !("randomArena" in c.e.game.config), "E5: bez kocky žiadny arena_roll ani posun", J(c.timers));

  const t = engine(5);
  t.e.startMatch(t.e.sanitizeConfig(dice({ format: "tournament", randomChars: true })));
  const team = t.events.find(([k]) => k === "char_roll")?.[1];
  check(team?.team === true && team.afterArena === true, "E6: turnaj s náhodnými tímami - losovanie tímov čaká na arénu", J(team));
}

/* ==================== Séria ==================== */
console.log("Séria na jednej aréne");
for (const seed of [11, 12]) {
  const pending = [];
  const { e, events, kinds } = engine(seed, (fn) => pending.push(fn));
  e.startMatch(e.sanitizeConfig(dice({ format: "bo3", randomChars: true })));
  const arena = e.game.arena, rng = { A: seededRng(seed * 7 + 1), B: seededRng(seed * 7 + 2) };
  let games = 1, sameArena = true;
  for (let guard = 0; guard < 400 && e.game.phase !== "match_over"; guard++) {
    if (pending.length) { pending.shift()(); games++; sameArena &&= e.game.arena === arena; continue; }
    if (!botLock(e, "A", rng.A) || !botLock(e, "B", rng.B)) break;
  }
  const charRolls = events.filter(([k]) => k === "char_roll").map(([, p]) => p.afterArena);
  check(e.game.phase === "match_over" && games >= 2, `S1: seed ${seed} - séria dohraná (${games} hry)`, e.game.phase);
  check(sameArena && kinds().filter(k => k === "arena_roll").length === 1, `S2: seed ${seed} - celá séria na ${arena}, losovanie arény len raz`);
  check(charRolls[0] === true && charRolls.slice(1).every(x => x === false), `S3: seed ${seed} - na arénu čaká len losovanie postáv hry 1`, J(charRolls));
}

console.log(`\n${passes} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
