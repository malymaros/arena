// test/ai-bot.mjs - AI bot (docs/AI_PLAN.md): determinizmus a minimálna sila. Deterministický rozpočet
// (budgetSims), takže výsledok nezávisí od rýchlosti stroja.
//  1. rovnaký seed + rovnaké payloady → identické rozhodnutia (dva behy toho istého zápasu)
//  2. bot (B) porazí náhodného bota vo väčšine zápasov aj pri malom rozpočte
import { playMatch } from "../tools/ai-vs.mjs";

let fails = 0;
const fail = (m) => { fails++; console.log("  FAIL " + m); };

// 1. determinizmus
const picks = [[], []];
for (const run of [0, 1]) {
  playMatch(4242, { A: "bot", B: "bot" }, { budgetSims: 400, budgetMs: 100, log: (e) => picks[run].push(e.pick ?? null) });
}
if (!picks[0].length) fail("bot nerozhodol ani raz");
if (JSON.stringify(picks[0]) !== JSON.stringify(picks[1])) fail("rovnaký seed dal iné rozhodnutia");

// 2. sila proti náhodnému botovi
const N = 8;
let wins = 0;
for (let i = 0; i < N; i++) if (playMatch(7000 + i, { A: "random", B: "bot" }, { budgetSims: 600, budgetMs: 100 }).winner === "B") wins++;
if (wins < N - 1) fail(`bot vyhral len ${wins}/${N} proti náhodnému botovi`);

console.log(`ai-bot: ${picks[0].length} rozhodnutí deterministických, proti náhodnému ${wins}/${N}`);
if (fails) process.exit(1);
console.log("ai-bot: OK");
