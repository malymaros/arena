// tools/simulate.mjs - headless simulácia zápasov priamo cez engine (bez servera, socketov a čakania).
// Hráči ťahajú náhodne (tools/random-bot.mjs - náhodné fronty, o platnosti rozhoduje engine),
// takže výsledky hovoria o stabilite enginu, nie o balanse postáv.
// Spustenie:  node tools/simulate.mjs [počet zápasov na dvojicu=20] [p1postava p2postava] [--portal | --swamp]
//   napr.     node tools/simulate.mjs 50
//             node tools/simulate.mjs 200 naruto jotaro
//             node tools/simulate.mjs 20 --portal   (Portal Realm + kontrola invariantov portálov po každom kole)
//             node tools/simulate.mjs 20 --swamp    (Shrek Swamp + kontrola invariantov Shreka po každom kole)
import { createEngine } from "../engine/game.js";
import { CHARS } from "../engine/constants.js";
import { playBotMatch } from "./random-bot.mjs";

const PORTAL = process.argv.includes("--portal");
const SWAMP = process.argv.includes("--swamp");
const args = process.argv.slice(2).filter(a => a !== "--portal" && a !== "--swamp");
const N = Number(args[0]) || 20;
const pairArg = args.slice(1, 3);
const P1_POOL = [...CHARS, "countess", "luffy"]; // side-postavy viazané na p1
const P2_POOL = [...CHARS, "onre", "jotaro"];    // side-postavy viazané na p2
const MAX_ROUNDS = 60;
const CONFIG = {
  format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white", // osoba A = p1
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
  ...(PORTAL ? { arena: "portal", tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 },
    portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 } } : {}),
  ...(SWAMP ? { arena: "swamp" } : {}),
};
// Portal Realm invarianty po každom kole: max 7 párov, unikátne hrany a písmená, HP/mana v rozsahu
function checkPortals(g, where) {
  const ends = g.portals.flatMap(p => p.ends.map(e => `${e.x},${e.y},${e.side}`));
  const bad = g.portals.length > 7 || new Set(ends).size !== ends.length || new Set(g.portals.map(p => p.id)).size !== g.portals.length
    || ["p1", "p2"].some(s => { const p = g.players[s]; return p.hp < 0 || p.hp > 10 || p.mana < 0 || p.mana > 10; });
  if (bad) throw new Error(`porušený invariant (${where}): ${JSON.stringify({ portals: g.portals, p1: [g.players.p1.hp, g.players.p1.mana], p2: [g.players.p2.hp, g.players.p2.mana] })}`);
}

// Shrek Swamp invarianty po každom kole: HP Shreka 0–20, živý = 3 rôzne ohlásené skoky na doske, mŕtvy = smrad bez
// duplicít a bez dlaždíc; najviac 4 itemy, každý na inom políčku a nikdy nepadne pod hráča/klona; HP/mana hráčov v rozsahu
function checkSwamp(g, where, timeline = []) {
  for (const f of timeline) for (const e of f.effects || []) if (e.kind === "item_drop") for (const it of e.items) {
    const under = ["p1", "p2"].some(sl => { const p = f[sl]; return p && ((p.x === it.x && p.y === it.y) || (p.clone && p.clone.x === it.x && p.clone.y === it.y)); });
    if (under) throw new Error(`item padol pod figúru (${where}): ${JSON.stringify(it)}`);
  }
  const s = g.shrek, on = ([x, y]) => x >= 0 && y >= 0 && x < 4 && y < 3;
  const bad = !s || s.hp < 0 || s.hp > 20 || !on([s.x, s.y]) || g.tiles.length || g.iks.length
    || (!s.dead && (s.marks.length !== 3 || !s.marks.every(on)))
    || (s.dead && (s.marks.length || !s.stench.length || new Set(s.stench.map(String)).size !== s.stench.length || !s.stench.every(on)))
    || g.items.length > 4 || new Set(g.items.map(i => i.x + "," + i.y)).size !== g.items.length || !g.items.every(i => on([i.x, i.y]))
    || ["p1", "p2"].some(sl => { const p = g.players[sl]; return p.hp < 0 || p.hp > 10 || p.mana < 0 || p.mana > 10; });
  if (bad) throw new Error(`porušený invariant (${where}): ${JSON.stringify({ shrek: s, tiles: g.tiles, p1: [g.players.p1.hp, g.players.p1.mana], p2: [g.players.p2.hp, g.players.p2.mana] })}`);
}
const shrekStats = { died: 0, games: 0 };

function playMatch(ch1, ch2, seed) {
  let result = null, frames = 0;
  const engine = createEngine({
    seed,
    emit: (ev, payload) => { if (ev === "game_result") result = payload; },
    emitState: (timeline) => { if (timeline) frames += timeline.length; if (PORTAL && timeline) checkPortals(engine.game, `${ch1}/${ch2} seed ${seed}`); if (SWAMP && timeline) checkSwamp(engine.game, `${ch1}/${ch2} seed ${seed}`, timeline); },
  });
  // Portal Realm: počet párov za kolo cyklí 1–7 podľa seedu (pokrytie plnej dosky)
  engine.startMatch(engine.sanitizeConfig(PORTAL ? { ...CONFIG, portalsPerRound: (seed % 7) + 1 } : CONFIG));
  engine.chooseCharacter("A", ch1);
  engine.chooseCharacter("B", ch2);
  const g = () => engine.game;
  if (g().players.p1.char !== ch1 || g().players.p2.char !== ch2) throw new Error(`voľba postáv zlyhala ${ch1}/${ch2}`);
  const rounds = playBotMatch(engine, seed, () => !!result, MAX_ROUNDS);
  if (SWAMP) { shrekStats.games++; if (g().shrek?.dead) shrekStats.died++; }
  return { winner: result?.gameWinner ?? null, rounds, frames };
}

const pairs = pairArg.length === 2 ? [pairArg] : P1_POOL.flatMap(a => P2_POOL.map(b => [a, b]));
const t0 = performance.now();
let games = 0, unfinished = 0, totalRounds = 0;
const wins = {}; // postava → { w, n }
// každá dvojica má vlastné seedy - pri spoločných by dlaždice aj náhodné ťahy boli rovnaké a výsledky umelo korelovali
pairs.forEach(([a, b], pi) => {
  for (let i = 0; i < N; i++) {
    const r = playMatch(a, b, 1000 + pi * 100000 + i);
    games++; totalRounds += r.rounds;
    if (!r.winner) { unfinished++; continue; }
    for (const [ch, slot] of [[a, "p1"], [b, "p2"]]) {
      wins[ch] ??= { w: 0, n: 0 };
      wins[ch].n++;
      if (r.winner === slot) wins[ch].w++;
    }
  }
});
const ms = performance.now() - t0;
console.log(`${games} zápasov, ${totalRounds} kôl za ${(ms / 1000).toFixed(2)} s (${(ms / games).toFixed(1)} ms/zápas), nedohraných: ${unfinished}`);
if (SWAMP) console.log(`Shrek padol v ${shrekStats.died}/${shrekStats.games} zápasoch`);
console.log("Úspešnosť pri NÁHODNÝCH ťahoch (nie balans!):");
for (const [ch, { w, n }] of Object.entries(wins).sort((x, y) => y[1].w / y[1].n - x[1].w / x[1].n))
  console.log(`  ${ch.padEnd(10)} ${(100 * w / n).toFixed(0).padStart(3)} %  (${w}/${n})`);
