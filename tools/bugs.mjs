// tools/bugs.mjs - vypíše bug reporty (záznamy t:"bug") zo stiahnutých herných dát (docs/TELEMETRY.md):
// kedy, zariadenie (MOBILE / TABLET / PC, systém, prehliadač, appka), obrazovka hry, zápas + kolo, text a JS chyby.
// Zápas, na ktorý hlásenie odkazuje, sa dá prehrať: node tools/replay.mjs <dáta> --match <id> --rounds
// Hlásenie z AI roomky: k zápasu sa vypíše aj zdôvodnenie ťahov bota (záznamy t:"bot") za posledné kolá pred
// hlásením - čo hral, s akou pravdepodobnosťou a hodnotou, aké alternatívy zvažoval, čo čakal od súpera a čo by ho zabilo.
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

const all = inputs.flatMap(readRecords);
const bugs = all.filter(r => r.t === "bug");
const botRecs = all.filter(r => r.t === "bot");
if (args.includes("--json")) { for (const b of bugs) console.log(JSON.stringify(b)); process.exit(0); }
const KIND = { mobile: "MOBILE", tablet: "TABLET", pc: "PC" };
for (const b of bugs) {
  const d = b.device || {};
  console.log(`── ${b.ts?.slice(0, 16).replace("T", " ")} UTC  ${KIND[d.kind] || d.kind}  ${d.os}/${d.browser}${d.app ? " APP" : ""}  ${d.screen} ${d.orient} ${d.graphics}`);
  console.log(`   obrazovka: ${b.screenName}  room ${b.room ?? "-"}  ${b.arena ?? ""}  strana ${b.side ?? "-"}  ${b.chars ? `${b.chars.white ?? "?"} vs ${b.chars.black ?? "?"}` : ""}`);
  if (b.match) console.log(`   zápas ${b.match}  hra ${b.g ?? "-"}  kolo ${b.turn ?? "-"}  (${b.phase})  commit ${b.commit}  → node tools/replay.mjs <dáta> --match ${b.match} --rounds`);
  console.log(`   ${b.text.replace(/\n/g, "\n   ")}`);
  for (const e of b.errors || []) console.log(`   JS chyba: ${e}`);
  // staršie hlásenia z AI roomky po konci hry nemali zápas - priradí sa posledný zápas bota pred hlásením (podľa času)
  if (!b.match && b.room === "ai") {
    const last = botRecs.filter(r => r.ts && b.ts && r.ts <= b.ts).at(-1);
    if (last) { b.match = last.match; b.g = last.g; b.turn = last.turn; console.log(`   zápas ${last.match} (priradený podľa času)  → node tools/replay.mjs <dáta> --match ${last.match} --rounds`); }
  }
  const why = botRecs.filter(r => r.match && r.match === b.match && (r.g ?? 1) === (b.g ?? 1) && (b.turn == null || r.turn <= b.turn)).slice(-3);
  for (const r of why) {
    console.log(`   bot (${r.side}) kolo ${r.turn}: hral ${r.pick}  p=${r.p}  hodnota ${r.value}${r.model ? `  model súpera z ${r.model} kôl` : ""}`);
    for (const t of r.top || []) console.log(`      zvažoval ${t.q}  p=${t.p}  v=${t.v}`);
    for (const o of r.opp || []) console.log(`      čakal od súpera ${o.q}  p=${o.p}`);
    if (r.deadly?.length) console.log(`      zomrel by na: ${r.deadly.join(" | ")}`);
  }
  if (why.length) console.log(`   rozbor: node tools/ai-explain.mjs <dáta> --match ${b.match} --game ${why.at(-1).g ?? 1} --turn <kolo>`);
}
console.log(`\n${bugs.length} hlásení`);
