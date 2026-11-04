// shared/match-record.js - záznamy zápasov (MATCHES) a statický rozbor (ANALYZE), docs/MATCH_REVIEW_PLAN.md.
// Zdieľa server (telemetry/match-record.js, telemetry/match-log.js) aj klient (public/client/review.js).

// Verzia formátu záznamu. ZVÝŠ ju pri každej zmene, po ktorej by aktuálny klient starý záznam nevedel správne
// vykresliť (premenované / odstránené pole stavu, postava, sprity, rozloženie lišty kola). Server záznamy inej verzie
// nezobrazí (história začne odznova, súbory sa presunú do matches/old-v<N>/). Stráži to test/match-record.mjs.
// v2 (2026-11-04): stav po akcii je uložený ako ROZDIEL voči predošlému (diffState / expandView) - menej pamäte, disku
// aj dát na prenos; v1 mala pri každej akcii celý stav.
export const MATCH_RECORD_VERSION = 2;

// ako skončila hra (ikona v zozname): aréna (dlaždice, IK, Shrek, smrad, doom po Last Stande), útok súpera
// (akákoľvek akcia vrátane démona, aj vlastná strela cez portál), mirror (vlastný útok odrazený), breaker súpera
export const END_CAUSES = ["arena", "attack", "mirror", "breaker"];

// koľko posledných zápasov zoznam MATCHES ukáže (ukladajú sa všetky - limit je len zobrazenie)
export const MATCHES_SHOWN = 100;

// kľúče snapshotu, ktoré sa do zápisu kola neukladajú (mená = identita, efekty / časovanie = animácie, config
// a séria sú v hlavičke hry)
export const FRAME_DROP = ["effects", "delayMs", "names", "config", "series", "timerMs", "awaitingOpponent", "phase", "board", "arena", "vsAi", "aiLevel"];

// ---------- rozdiely stavov (zápis kola: celý stav len na začiatku kola, po každej akcii len zmeny) ----------
// diff = { kľúč: nová hodnota } pre zmenené kľúče stavu; postavy p1 / p2 (a hodnoty ako objekty v nich nie) sa
// porovnávajú po poliach: { p1: { hp: 7 } }. Zmazané kľúče: $del = ["kľúč", "p1.pole"]. Prázdny rozdiel = {}.
const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const ACTORS = ["p1", "p2"];
export function diffState(prev, next) {
  const d = {}, del = [];
  for (const k of Object.keys(next)) {
    if (ACTORS.includes(k) && prev[k] && next[k] && typeof next[k] === "object") {
      const pd = {};
      for (const f of Object.keys(next[k])) if (!same(prev[k][f], next[k][f])) pd[f] = next[k][f];
      for (const f of Object.keys(prev[k])) if (!(f in next[k])) del.push(k + "." + f);
      if (Object.keys(pd).length) d[k] = pd;
    } else if (!same(prev[k], next[k])) d[k] = next[k];
  }
  for (const k of Object.keys(prev)) if (!(k in next)) del.push(k);
  if (del.length) d.$del = del;
  return d;
}
export function applyDiff(prev, d) {
  const s = { ...prev };
  for (const [k, v] of Object.entries(d)) {
    if (k === "$del") continue;
    s[k] = ACTORS.includes(k) && prev[k] && typeof prev[k] === "object" && !Array.isArray(v) && v && typeof v === "object" ? { ...prev[k], ...v } : v;
  }
  for (const p of d.$del || []) {
    const [k, f] = p.split(".");
    if (f) { if (s[k]) { s[k] = { ...s[k] }; delete s[k][f]; } } else delete s[k];
  }
  return s;
}
// zápis kola jedného pohľadu → celé stavy po každej akcii (beat.d → beat.state); volá klient pri načítaní záznamu
export function expandView(v) {
  let s = v.start;
  for (const b of v.beats) { if (b.d) { s = applyDiff(s, b.d); b.state = s; delete b.d; } else if (b.state) s = b.state; }
  return v;
}
export function expandRecord(rec) {
  for (const g of rec.games || []) for (const rd of g.rounds || []) for (const v of Object.values(rd.views || {})) expandView(v);
  return rec;
}

// pozícia beatu v lište kola (rovnaké číslovanie ako public/client/queue.js): 9 = Last Hope, 0 = golden shield /
// mirror, 1-6 = akcie (štartér nepárne), 7 / 8 = golden mana / Last Stand štartéra / druhého; counts = { p1, p2 }
// počty už zaradených bežných akcií (mutuje sa)
export function beatPos(from, action, counts, starter) {
  const t = action?.type;
  const masked = t === "unknown" ? (action.beat || "act") : null;
  if (t === "last_hope" || masked === "lhope") return 9;
  if (t === "golden_shield" || t === "golden_mirror" || masked === "gpre") return 0;
  if (t === "golden_mana" || t === "last_stand" || masked === "gmana") return from === starter ? 7 : 8;
  const k = counts[from]++;
  return from === starter ? [1, 3, 5][k] : [2, 4, 6][k];
}
// prázdny golden beat (beat_empty) → pozícia v lište
export function emptyBeatPos(from, beat, starter) {
  return beat === "lhope" ? 9 : beat === "gpre" ? 0 : from === starter ? 7 : 8;
}
