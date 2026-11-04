// shared/match-record.js - záznamy zápasov (MATCHES) a statický rozbor (ANALYZE), docs/MATCH_REVIEW_PLAN.md.
// Zdieľa server (telemetry/match-record.js, telemetry/match-log.js) aj klient (public/client/review.js).

// Verzia formátu záznamu. ZVÝŠ ju pri každej zmene, po ktorej by aktuálny klient starý záznam nevedel správne
// vykresliť (premenované / odstránené pole stavu, postava, sprity, rozloženie lišty kola). Server záznamy inej verzie
// nezobrazí (história začne odznova, súbory sa presunú do matches/old-v<N>/). Stráži to test/match-record.mjs.
export const MATCH_RECORD_VERSION = 1;

// ako skončila hra (ikona v zozname): aréna (dlaždice, IK, Shrek, smrad, doom po Last Stande), útok súpera
// (akákoľvek akcia vrátane démona, aj vlastná strela cez portál), mirror (vlastný útok odrazený), breaker súpera
export const END_CAUSES = ["arena", "attack", "mirror", "breaker"];

// koľko posledných zápasov zoznam MATCHES ukáže (ukladajú sa všetky - limit je len zobrazenie)
export const MATCHES_SHOWN = 100;

// kľúče snapshotu, ktoré sa do zápisu kola neukladajú (mená = identita, efekty / časovanie = animácie, config
// a séria sú v hlavičke hry)
export const FRAME_DROP = ["effects", "delayMs", "names", "config", "series", "timerMs", "awaitingOpponent", "phase", "board", "arena", "vsAi", "aiLevel"];

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
