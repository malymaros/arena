// public/sounds/fit.js - ČISTÉ: ako zvuk prispôsobiť oknu akcie (ms, kým hra pokračuje ďalej - events.js).
// Čas patrí hre, zvuk sa mu prispôsobuje; zvukové balíky dĺžku akcie nemenia.
//   keep - hrá celý (krátke nárazy, kliky; prečnievanie do ďalšej akcie nevadí)
//   fade - na konci okna jemne stíchne (casty, lety, kroky)
//   fit  - zrýchli/spomalí sa presne na okno, ak to stačí v rozsahu RATE_MIN–RATE_MAX (mení aj výšku tónu);
//          inak sa správa ako fade. Kratší zvuk sa nikdy nenaťahuje.
export const FIT_MODES = ["keep", "fade", "fit"];
export const FADE_MS = 120;
export const RATE_MIN = 0.85;
export const RATE_MAX = 1.15;

// predvolený režim, ak ho položka registra/balíka nemá
const FADE_KEYS = /^(special|attack|move|dash|wolf_charge|vamp_charge|luffy_roll|luffy_pull|soldier_beam|timestop_|teleport|labyrinth$)/;
export function defaultFit(key) { return FADE_KEYS.test(key) ? "fade" : "keep"; }

// soundMs = dĺžka súboru, windowMs = okno (0/null = neznáme) → plán prehratia v reálnom čase:
//   rate      - playbackRate (1 = bez zmeny)
//   playMs    - ako dlho zvuk reálne hrá (null = celý)
//   fadeAtMs  - kedy začne stíšenie (null = bez stíšenia); stíšenie končí v playMs
//   mode      - režim, ktorý sa naozaj použil (fit mimo rozsahu → fade)
export function fitPlan(soundMs, windowMs, mode = "keep") {
  const whole = { rate: 1, playMs: null, fadeAtMs: null, mode: "keep" };
  if (!FIT_MODES.includes(mode) || mode === "keep" || !(windowMs > 0) || !(soundMs > windowMs)) return whole;
  if (mode === "fit") {
    const rate = soundMs / windowMs;
    if (rate >= RATE_MIN && rate <= RATE_MAX) return { rate, playMs: windowMs, fadeAtMs: null, mode: "fit" };
  }
  return { rate: 1, playMs: windowMs, fadeAtMs: Math.max(0, windowMs - FADE_MS), mode: "fade" };
}
