// tools/sounds-report.mjs - prehľad registra zvukov: čo je ešte Claudov odhad (default) a čo už vybral vlastník
// (picked), s pôvodom a licenciou každého súboru. `node tools/sounds-report.mjs` → markdown na stdout.
import { SOUNDS, SOUND_SOURCES } from "../public/sounds/manifest.js";

const packOf = (f) => (f.startsWith("custom/") ? "custom" : f.split("/")[1]);
const rows = Object.entries(SOUNDS);
const picked = rows.filter(([, e]) => e.status === "picked");
const def = rows.filter(([, e]) => e.status !== "picked");

const table = (list) => [
  "| kľúč | súbory | zdroj (licencia) | poznámka |",
  "|---|---|---|---|",
  ...list.map(([k, e]) => {
    const files = e.files.length ? e.files.map(f => f.split("/").pop()).join(", ") : "_ticho_";
    const src = [...new Set(e.files.map(packOf))].map(p => `${p} (${SOUND_SOURCES[p]?.license || "?"})`).join(", ") || "—";
    return `| \`${k}\` | ${files} | ${src} | ${e.note || ""} |`;
  }),
].join("\n");

console.log(`# Zvuky - stav registra\n\n${rows.length} udalostí: **${picked.length} picked** (vlastník), **${def.length} default** (Claude).\n`);
console.log(`## Picked - vybral vlastník\n\n${picked.length ? table(picked) : "_zatiaľ nič_"}\n`);
console.log(`## Default - dohľadal Claude (čaká na vypočutie)\n\n${table(def)}\n`);
console.log("## Zdroje\n");
for (const [p, s] of Object.entries(SOUND_SOURCES)) console.log(`- **${p}** - ${s.title}, ${s.author}, ${s.license}${s.url ? ` - ${s.url}` : ""}`);
