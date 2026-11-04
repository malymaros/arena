// tools/match-record-demo.mjs - ukážkové záznamy zápasov (MATCHES / ANALYZE, docs/MATCH_REVIEW_PLAN.md) z headless
// zápasov náhodných botov: ten istý recorder + úložisko ako server (telemetry/recorder.js → telemetry/match-log.js).
//   node tools/match-record-demo.mjs [adresár=tmp/matches]
//   MATCHES_DIR=tmp/matches npm start   → záznamy sú v zozname, rozbor: http://localhost:3000/?review=<id>
// Zápasy pokrývajú okrajové prípady rozboru: THE WORLD (Jotaro), labyrint (Minotaurus), pasca (Vampire),
// klon (Naruto), Shrek, portály, BO3 a turnaj.
import path from "path";
import { createRecordedEngine } from "../telemetry/recorder.js";
import { createMatchLog } from "../telemetry/match-log.js";
import { playBotMatch } from "./random-bot.mjs";

const dir = path.resolve(process.argv[2] || "tmp/matches");
const log = createMatchLog(dir);
const TILES = { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 };
const ARENAS = {
  bridge: {},
  portal: { arena: "portal", tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 }, portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 } },
  swamp: { arena: "swamp" },
};
const MATCHES = [
  { arena: "bridge", format: "single", chars: ["countess", "jotaro"], seed: 3 },
  { arena: "bridge", format: "single", chars: ["minotaur", "naruto"], seed: 5 },
  { arena: "bridge", format: "bo3", chars: ["minotaur", "jotaro"], seed: 11 },
  { arena: "portal", format: "bo3", chars: [["escanor", "onre"], ["fire", "onre"], ["fire", "werewolf"]], seed: 7, ai: "normal" },
  { arena: "swamp", format: "single", chars: ["werewolf", "medusa"], seed: 9 },
  { arena: "bridge", format: "tournament", teams: [["fire", "minotaur", "luffy"], ["soldier", "naruto", "jotaro"]], seed: 11 },
  { arena: "swamp", format: "tournament", teams: [["escanor", "wanderer", "countess"], ["medusa", "lightning", "onre"]], seed: 13, ai: "baby" },
];
let t = Date.now() - MATCHES.length * 3600e3;
for (const m of MATCHES) {
  let over = false, saved = null;
  // ai = zápas proti botovi (čierny = osoba B): snapshot nesie vsAi / aiLevel, záznam ai - hlava bota v HUD a zozname
  const e = createRecordedEngine({ emit: (ev) => { if (ev === "game_over") over = true; }, schedule: (fn) => fn(),
    ...(m.ai ? { vsAi: () => "p2", aiLevel: () => m.ai } : {}) },
    { matchLog: { save: (r) => { log.save(r); saved = r; } }, seed: () => m.seed, now: () => (t += 1000),
      ...(m.ai ? { aiPerson: "B", aiLevel: () => m.ai } : {}) });
  e.startMatch(e.sanitizeConfig({ format: m.format, tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white", tileWeights: TILES, ...ARENAS[m.arena] }));
  if (m.teams) { e.chooseTeam("A", m.teams[0]); e.chooseTeam("B", m.teams[1]); }
  for (let g = 0; g < 5 && !over; g++) {
    const gi = e.game.series?.gameIndex;
    if (m.teams) {
      const alive = (p) => m.teams[p === "A" ? 0 : 1].find(c => (e.game.mageHp?.[p]?.[c] ?? 1) > 0);
      e.chooseCharacter("A", alive("A")); e.chooseCharacter("B", alive("B"));
    } else {
      const pair = Array.isArray(m.chars[0]) ? m.chars[Math.min(g, m.chars.length - 1)] : m.chars; // BO3: postavy per hra
      e.chooseCharacter("A", pair[0]); e.chooseCharacter("B", pair[1]);
    }
    playBotMatch(e, m.seed * 10 + g, () => over || e.game.series?.gameIndex !== gi || e.game.phase !== "playing", 60);
  }
  e.abort("demo"); // nedohraný (limit kôl) sa uloží tiež
  console.log(saved ? `${saved.id}  ${m.arena} ${m.format} ${saved.games.map(x => `${x.chars.p1}/${x.chars.p2} ${x.rounds.length}r ${x.cause}`).join(", ")}` : `(nič) ${m.arena} ${m.format}`);
}
console.log(`→ ${dir} (${log.size} záznamov)`);
