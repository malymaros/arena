// test/bans.mjs - BANNED CHARACTERS (ADVANCED SETTINGS, zákazy postáv per aréna a farba) priamo nad enginom:
// sanitizácia (len postavy strany, bez duplicít, aspoň 1 ostane, kľúč len keď nejaké sú), turnaj → single pri
// menej ako 3 voľných (aj pri kocke, keď to platí pre ktorúkoľvek arénu), choose_character / choose_team zakázanú
// odmietne, RANDOM CHARACTERS ju nikdy nevylosuje (single aj turnajový tím), snapshot nesie zákazy, bot si ju
// nevyberie; zdieľaná detekcia CUSTOM arény (shared/arena-defaults.js) pre dlaždicu roomky.
// Spustenie: node test/bans.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";
import { CHARS, SIDE_CHARS } from "../engine/constants.js";
import { createBot } from "../engine/ai/bot.js";
import { DEF_ARENA, arenaRules, arenaConfigCustom, matchConfigCustom } from "../shared/arena-defaults.js";

let failures = 0, passes = 0;
function check(cond, label, detail = "") {
  if (cond) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;
const pool = (slot) => [...CHARS, ...Object.keys(SIDE_CHARS).filter(k => SIDE_CHARS[k] === slot)];
const BRIDGE = arenaRules("bridge", DEF_ARENA.bridge);
const cfg = (extra = {}) => ({ format: "single", timer: "off", colorPref: "white", ...BRIDGE, ...extra });
const engine = (seed = 1) => createEngine({ seed, emit: () => {}, beginPlanningTimer: () => {} });

console.log("Sanitizácia");
{
  const e = engine();
  const c = e.sanitizeConfig(cfg());
  check(c && !("bans" in c), "bez zákazov config nemá kľúč bans (goldeny)");
  const c2 = e.sanitizeConfig(cfg({ bans: { p1: ["fire", "fire", "luffy", "onre", "nobody"], p2: ["jotaro", "countess"] } }));
  check(J(c2?.bans) === J({ p1: ["fire", "luffy"], p2: ["jotaro"] }), "len postavy danej strany, bez duplicít", J(c2?.bans));
  check(e.sanitizeConfig(cfg({ bans: { p1: pool("p1"), p2: [] } })) === null, "zakázať všetky postavy farby = neplatný config");
  check(!!e.sanitizeConfig(cfg({ bans: { p1: pool("p1").slice(1), p2: [] } })), "1 voľná postava stačí");
  const t3 = e.sanitizeConfig(cfg({ format: "tournament", bans: { p1: [], p2: pool("p2").slice(3) } }));
  check(t3?.format === "tournament", "turnaj s 3 voľnými ostane turnaj");
  const t2 = e.sanitizeConfig(cfg({ format: "tournament", bans: { p1: [], p2: pool("p2").slice(2) } }));
  check(t2?.format === "single", "turnaj s 2 voľnými → single");
  // kocka: jedna aréna by nedovolila tím → celý zápas single
  const portal = { arena: "portal", ...arenaRules("portal", DEF_ARENA.portal) };
  const dice = e.sanitizeConfig({ format: "tournament", timer: "off", colorPref: "white", arena: "random",
    arenas: { bridge: BRIDGE, portal: { ...portal, bans: { p1: pool("p1").slice(2), p2: [] } }, swamp: arenaRules("swamp", DEF_ARENA.swamp) } });
  check(dice?.format === "single" && Object.values(dice.arenas).every(a => a.format === "single"), "kocka: turnaj → single, keď to nedovolí ktorákoľvek aréna", dice?.format);
  check(J(dice?.arenas.portal.bans?.p1) === J(pool("p1").slice(2)) && !("bans" in dice.arenas.bridge), "kocka: zákazy per aréna");
}

console.log("Výber postavy");
{
  const e = engine();
  e.startMatch(e.sanitizeConfig(cfg({ bans: { p1: ["fire", "medusa"], p2: ["jotaro"] } })));
  const pA = e.slotForPerson("A");
  check(pA === "p1", "FORCE colorPref white: A = p1");
  e.chooseCharacter("A", "fire");
  check(!e.game.players.p1.char, "zakázanú postavu (fire pre bielu) sa nedá zvoliť");
  e.chooseCharacter("B", "fire");
  check(e.game.players.p2.char === "fire", "čierny fire zvoliť môže (zákazy patria farbe)");
  e.chooseCharacter("A", "lightning");
  check(e.game.players.p1.char === "lightning", "nezakázaná postava sa zvolí");
  check(J(e.snapshotFor("A").config?.bans) === J({ p1: ["fire", "medusa"], p2: ["jotaro"] }), "snapshot nesie zákazy (verejné)");
}

console.log("RANDOM CHARACTERS nelosuje zakázané");
{
  let bad = 0;
  const bansP1 = pool("p1").filter(k => k !== "naruto" && k !== "soldier"), bansP2 = ["minotaur", "onre", "jotaro"];
  for (let seed = 1; seed <= 120; seed++) {
    const e = engine(seed);
    e.startMatch(e.sanitizeConfig(cfg({ randomChars: true, bans: { p1: bansP1, p2: bansP2 } })));
    if (bansP1.includes(e.game.players.p1.char) || bansP2.includes(e.game.players.p2.char)) bad++;
  }
  check(bad === 0, "single: 120 zápasov bez zakázanej postavy", `${bad} zlých`);
  let badT = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const e = engine(seed);
    e.startMatch(e.sanitizeConfig(cfg({ format: "tournament", randomChars: true, bans: { p1: pool("p1").slice(3), p2: bansP2 } })));
    const r = e.game.roster;
    if (r.A.some(k => pool("p1").slice(3).includes(k)) || r.B.some(k => bansP2.includes(k))) badT++;
  }
  check(badT === 0, "turnaj: 60 vylosovaných tímov bez zakázanej postavy", `${badT} zlých`);
}

console.log("Turnajový draft");
{
  const e = engine();
  e.startMatch(e.sanitizeConfig(cfg({ format: "tournament", bans: { p1: ["fire"], p2: [] } })));
  e.chooseTeam("A", ["fire", "lightning", "wanderer"]);
  check(!e.game.roster.A, "tím so zakázanou postavou sa odmietne");
  e.chooseTeam("A", ["medusa", "lightning", "wanderer"]);
  check(J(e.game.roster.A) === J(["medusa", "lightning", "wanderer"]), "tím bez zakázanej sa prijme");
}

console.log("Bot");
{
  const bot = createBot({ seed: 3, budgetSims: 50, budgetMs: 10 });
  const e = engine();
  const bans = pool("p2").filter(k => k !== "werewolf");
  e.startMatch(e.sanitizeConfig(cfg({ bans: { p1: [], p2: bans } })));
  bot.onYouAre({ slot: "p2" });
  bot.onState(e.snapshotFor("B"));
  const d = bot.decide();
  check(d?.kind === "character" && d.char === "werewolf", "bot si vyberie len nezakázanú postavu", J(d));
}

console.log("CUSTOM aréna (dlaždica roomky)");
{
  const e = engine();
  const s = (c) => e.sanitizeConfig({ format: "single", timer: "off", colorPref: "random", ...c });
  check(!arenaConfigCustom(s(BRIDGE)), "stone bridge s predvolenými = nie CUSTOM");
  check(!arenaConfigCustom(s({ arena: "portal", ...arenaRules("portal", DEF_ARENA.portal) })), "portal realm predvolený = nie CUSTOM");
  check(!arenaConfigCustom(s({ arena: "swamp", ...arenaRules("swamp", DEF_ARENA.swamp) })), "shrek swamp predvolený = nie CUSTOM");
  check(arenaConfigCustom(s({ ...BRIDGE, bans: { p1: [], p2: ["fire"] } })), "zákaz = CUSTOM");
  check(arenaConfigCustom(s({ ...BRIDGE, tilesPerRound: 2 })), "iný počet dlaždíc = CUSTOM");
  const dice = (portal) => s({ arena: "random", arenas: { bridge: BRIDGE, portal: { arena: "portal", ...portal }, swamp: arenaRules("swamp", DEF_ARENA.swamp) } });
  check(!matchConfigCustom(dice(arenaRules("portal", DEF_ARENA.portal))), "kocka s predvolenými = nie CUSTOM");
  check(matchConfigCustom(dice({ ...arenaRules("portal", DEF_ARENA.portal), portalsPerRound: 5 })), "kocka s upravenou arénou = CUSTOM");
}

console.log(`\nbans: ${passes} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
