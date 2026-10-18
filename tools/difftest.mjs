// tools/difftest.mjs - rozdielový test enginu: engine z gitu (default HEAD) vs pracovný strom.
// Oba enginy odohrajú headless rovnaké zápasy (rovnaké seedy, náhodní boti z tools/random-bot.mjs) a porovná sa
// každá emitnutá timeline. Pri refaktore má byť výsledok 0 rozdielov (alebo len vedomé zmeny).
// Spustenie:  node tools/difftest.mjs [zápasov na dvojicu=40] [git ref=HEAD]
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { playBotMatch } from "./random-bot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const N = Number(process.argv[2]) || 40;
const REF = process.argv[3] || "HEAD";
const OLD = path.join(ROOT, ".difftest_old");

// starý engine: všetky súbory engine/ a shared/ z daného commitu (zachová relatívne importy)
fs.rmSync(OLD, { recursive: true, force: true });
const files = execSync(`git ls-tree -r --name-only ${REF} engine shared`, { cwd: ROOT }).toString().trim().split("\n").filter(Boolean);
for (const f of files) {
  fs.mkdirSync(path.join(OLD, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(OLD, f), execSync(`git show ${REF}:${f}`, { cwd: ROOT, maxBuffer: 64e6 }));
}
const { createEngine: oldEngine } = await import(pathToFileURL(path.join(OLD, "engine/game.js")).href);
const { createEngine: newEngine } = await import(pathToFileURL(path.join(ROOT, "engine/game.js")).href);

const P1 = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf", "countess", "luffy"];
const P2 = ["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf", "onre", "jotaro"];
const CFG = { format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white",
  tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 } };

function play(mk, a, b, seed) {
  const log = []; let res = null;
  const e = mk({ seed, emit: (ev, p) => { if (ev === "game_result") res = p; }, emitState: (tl) => { if (tl) log.push(JSON.stringify(tl)); } });
  e.startMatch(e.sanitizeConfig(CFG)); e.chooseCharacter("A", a); e.chooseCharacter("B", b);
  playBotMatch(e, seed, () => !!res);
  // aj vypršaný čas nech je pokrytý: nový zápas (seed+1), v ktorom obom 3 kolá vyprší čas (autoLock)
  log.push("--- timeout ---");
  res = null;
  const e2 = mk({ seed: seed + 1, emit: (ev, p) => { if (ev === "game_result") res = p; }, emitState: (tl) => { if (tl) log.push(JSON.stringify(tl)); } });
  e2.startMatch(e2.sanitizeConfig(CFG)); e2.chooseCharacter("A", a); e2.chooseCharacter("B", b);
  for (let r = 0; !res && r < 3 && e2.game.timestop?.mode !== "waiting"; r++) e2.autoLock();
  return log;
}

let games = 0, diffGames = 0;
const byPair = {};
try {
  P1.forEach((a, pi) => P2.forEach((b, qi) => {
    for (let i = 0; i < N; i++) {
      const seed = 70000 + pi * 7919 + qi * 104729 + i;
      const o = play(oldEngine, a, b, seed), n = play(newEngine, a, b, seed);
      games++;
      const k = o.findIndex((t, idx) => t !== n[idx]);
      if (k < 0 && o.length === n.length) continue;
      diffGames++;
      const idx = k < 0 ? Math.min(o.length, n.length) : k;
      const of = JSON.parse(o[idx] || "[]"), nf = JSON.parse(n[idx] || "[]");
      let fi = 0; while (fi < Math.max(of.length, nf.length) && JSON.stringify(of[fi]) === JSON.stringify(nf[fi])) fi++;
      const key = `${a} vs ${b}`;
      byPair[key] ??= { n: 0, ex: { seed, timeline: idx, frame: fi, old: of[fi]?.effects, new: nf[fi]?.effects } };
      byPair[key].n++;
    }
  }));
} finally {
  fs.rmSync(OLD, { recursive: true, force: true });
}
console.log(`difftest ${REF} vs pracovný strom: ${games} zápasov, s rozdielom ${diffGames}`);
for (const [k, v] of Object.entries(byPair)) console.log(`  ${k}: ${v.n}×  ${JSON.stringify(v.ex).slice(0, 500)}`);
process.exit(diffGames ? 1 : 0);
