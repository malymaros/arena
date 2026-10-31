// tools/bugs.mjs - vypíše bug reporty (záznamy t:"bug") zo stiahnutých herných dát (docs/TELEMETRY.md):
// kedy, zariadenie (MOBILE / TABLET / PC, systém, prehliadač, appka), obrazovka hry, zápas + kolo, text a JS chyby.
// Zápas, na ktorý hlásenie odkazuje, sa dá prehrať: node tools/replay.mjs <dáta> --match <id> --rounds
// Spustenie:  node tools/bugs.mjs <súbor.jsonl | súbor.jsonl.gz | adresár> [--json]
import fs from "fs";
import path from "path";
import zlib from "zlib";

const args = process.argv.slice(2);
const inputs = args.filter(a => !a.startsWith("--"));
if (!inputs.length) { console.error("použitie: node tools/bugs.mjs <súbor.jsonl | súbor.jsonl.gz | adresár> [--json]"); process.exit(2); }

function readRecords(p) {
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).filter(f => /\.jsonl(\.gz)?$/.test(f)).sort().flatMap(f => readRecords(path.join(p, f)));
  let text = fs.readFileSync(p);
  if (p.endsWith(".gz")) text = zlib.gunzipSync(text);
  return text.toString("utf8").split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const bugs = inputs.flatMap(readRecords).filter(r => r.t === "bug");
if (args.includes("--json")) { for (const b of bugs) console.log(JSON.stringify(b)); process.exit(0); }
const KIND = { mobile: "MOBILE", tablet: "TABLET", pc: "PC" };
for (const b of bugs) {
  const d = b.device || {};
  console.log(`── ${b.ts?.slice(0, 16).replace("T", " ")} UTC  ${KIND[d.kind] || d.kind}  ${d.os}/${d.browser}${d.app ? " APP" : ""}  ${d.screen} ${d.orient} ${d.graphics}`);
  console.log(`   obrazovka: ${b.screenName}  room ${b.room ?? "-"}  ${b.arena ?? ""}  strana ${b.side ?? "-"}  ${b.chars ? `${b.chars.white ?? "?"} vs ${b.chars.black ?? "?"}` : ""}`);
  if (b.match) console.log(`   zápas ${b.match}  hra ${b.g ?? "-"}  kolo ${b.turn ?? "-"}  (${b.phase})  commit ${b.commit}  → node tools/replay.mjs <dáta> --match ${b.match} --rounds`);
  console.log(`   ${b.text.replace(/\n/g, "\n   ")}`);
  for (const e of b.errors || []) console.log(`   JS chyba: ${e}`);
}
console.log(`\n${bugs.length} hlásení`);
