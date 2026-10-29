// tools/replay.mjs - znova prehrá zápasy zo stiahnutých herných dát (docs/TELEMETRY.md) a overí, že
// prehratie dá presne to isté, čo je v logu. Zápas treba prehrávať na commite, na ktorom sa hral
// (match_start.commit) - pri inom commite nástroj varuje (iná herná logika = iný priebeh).
// Spustenie:  node tools/replay.mjs <súbor.jsonl | súbor.jsonl.gz | adresár> [--match <id>] [--rounds]
//   --match <id>  len jeden zápas
//   --rounds      vypíše aj priebeh po kolách (akcie oboch strán, HP/mana na konci kola)
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { execSync } from "child_process";
import { splitMatches, replayMatch, diffReplay } from "../telemetry/replay.js";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const onlyMatch = opt("--match");
const showRounds = args.includes("--rounds");
const inputs = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--match");
if (!inputs.length) {
  console.error("použitie: node tools/replay.mjs <súbor.jsonl | súbor.jsonl.gz | adresár> [--match <id>] [--rounds]");
  process.exit(2);
}

function readRecords(p) {
  if (fs.statSync(p).isDirectory()) {
    return fs.readdirSync(p).filter(f => /\.jsonl(\.gz)?$/.test(f)).sort().flatMap(f => readRecords(path.join(p, f)));
  }
  let text = fs.readFileSync(p);
  if (p.endsWith(".gz")) text = zlib.gunzipSync(text);
  return text.toString("utf8").split("\n").filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { console.warn(`${p}:${i + 1}: nečitateľný riadok`); return null; }
  }).filter(Boolean);
}

let head = null;
try { head = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { /* */ }

const matches = splitMatches(inputs.flatMap(readRecords));
let ok = 0, bad = 0, skipped = 0;
for (const [m, recs] of matches) {
  if (onlyMatch && m !== onlyMatch) continue;
  const start = recs.find(r => r.t === "match_start");
  if (!start) { skipped++; continue; }
  const games = recs.filter(r => r.t === "game_end").map(g => `${g.chars.white}–${g.chars.black} → ${g.winner}`);
  const end = recs.find(r => r.t === "match_end");
  const where = `${start.ts?.slice(0, 16).replace("T", " ") || "?"} ${start.config?.format}${start.config?.arena === "portal" ? " portal" : ""}`;
  const commitNote = start.commit && head && start.commit !== head ? `  (hrané na ${start.commit}, teraz ${head})` : "";
  let res;
  try { res = replayMatch(recs, { onInput: showRounds ? printInput : null }); }
  catch (e) { bad++; console.log(`✗ ${m}  ${where}  replay zlyhal: ${e.message}${commitNote}`); continue; }
  const diff = diffReplay(recs, res.records);
  if (diff) bad++; else ok++;
  console.log(`${diff ? "✗" : "✓"} ${m}  ${where}  ${games.join(", ") || "(žiadna dohraná hra)"}  [${end?.reason ?? "bez konca"}]${commitNote}`);
  if (diff) console.log(`    prvý rozdiel na zázname ${diff.index}:\n    log:    ${diff.logged?.slice(0, 400)}\n    replay: ${diff.replayed?.slice(0, 400)}`);
}
console.log(`\n${ok} zhodných, ${bad} rozdielnych${skipped ? `, ${skipped} bez match_start` : ""}`);
process.exit(bad ? 1 : 0);

// --rounds: po každom vyhodnotenom kole vypíš akcie a stav (čítané zo živého enginu po prehraní vstupu)
function printInput(r, engine) {
  if (r.t !== "lock" && r.t !== "auto" && r.t !== "ts") return;
  const g = engine.game;
  if (g.players.p1.locked || g.players.p2.locked || g.timestop?.mode === "waiting") return; // kolo ešte nebolo vyhodnotené
  const st = (p) => `${p.char} HP ${p.hp} MP ${p.mana} @${p.x},${p.y}`;
  console.log(`    hra ${g.series.gameIndex} po kole ${r.turn}: white ${st(g.players.p1)} | black ${st(g.players.p2)}`);
}
