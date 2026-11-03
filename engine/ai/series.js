// engine/ai/series.js - turnaj (first-to-3, tím 3 mágov, HP/mana sa prenášajú) z pohľadu AI bota.
// Stratégia vlastníka 2026-11-03 (docs/AI_PLAN.md 8d):
//  - cieľ je výhra TURNAJA, nie záchrana maga za každú cenu - hodnota stavu = odhad P(výhra turnaja):
//    P(výhra hry) z bežného eval × šanca turnaja po výhre / prehre tejto hry podľa sily tímov, ktoré ostanú;
//  - lavička: čo najzdravší a najmanovejší mágovia; 1 HP mág má stále cenu (jeho special môže zastihnúť
//    nepripraveného súpera), Werewolf s nízkym HP je tajná zbraň (moon charge 8 dmg);
//  - prehrávajúci hrá riskantnejšie (vlastné HP mu menej záleží), vedúci defenzívnejšie (pomalé uberanie);
//  - swap len výnimočne (zlý matchup, vysoko-dmg kombo) - malá penalizácia za každý swap vo fronte.
// Osoby v simulácii: p1 = A, p2 = B (view.simState).
import { START_HP as MAX_HP, MAX_MANA } from "../../shared/balance.js";

const PERSON = { p1: "A", p2: "B" };
const other = (s) => (s === "p1" ? "p2" : "p1");
export const SERIES = {
  K: 2.2,          // strmosť P(turnaj) podľa rozdielu sily tímov (1.0 = jeden plný mág)
  MANA: 0.35,      // váha many maga voči HP
  FLOOR: 0.15,     // minimálna cena živého maga (special)
  WOLF: 0.45,      // minimálna cena živého Werewolfa (moon charge pri nízkom HP)
  RISK: 0.15,      // sklon k riziku: vedúci si cení vlastné HP viac, prehrávajúci menej
  SWAP_PEN: 0.04,  // penalizácia za swap vo fronte (swap je výnimka)
};

export const isTournament = (state) => state?.config?.format === "tournament" && !!state.roster && !!state.mageHp;

// cena jedného maga (0 = mŕtvy, 1 = plné HP a mana)
export function mageValue(char, hp, mana) {
  if (hp <= 0) return 0;
  const v = (hp + SERIES.MANA * mana) / (MAX_HP + SERIES.MANA * MAX_MANA);
  return Math.max(v, char === "werewolf" ? SERIES.WOLF : SERIES.FLOOR);
}

// mágovia strany: [{ char, hp, mana, current }] - nasadený mág so živými hodnotami
function mages(state, slot) {
  const person = PERSON[slot], p = state.players[slot];
  return (state.roster[person] || []).map(k => k === p.char
    ? { char: k, hp: p.hp, mana: p.mana ?? 0, current: true }
    : { char: k, hp: state.mageHp[person]?.[k] ?? 0, mana: state.mageMana?.[person]?.[k] ?? 0, current: false });
}

// sila tímu; deadCurrent = nasadený mág padol (táto hra je prehratá)
function power(list, deadCurrent) {
  let t = 0, alive = 0;
  for (const m of list) {
    if (m.current && deadCurrent) continue;
    const v = mageValue(m.char, m.hp, m.mana);
    if (v > 0) { t += v; alive++; }
  }
  return { t, alive };
}

// P(výhra turnaja) po skončení aktuálnej hry (winner = ja / súper)
function afterGame(state, me, iWin) {
  const A = power(mages(state, me), !iWin), B = power(mages(state, other(me)), iWin);
  if (!B.alive) return 1;
  if (!A.alive) return 0;
  return 1 / (1 + Math.exp(-SERIES.K * (A.t - B.t)));
}

// náskok sily tímov (v jednotkách plného maga) - z pohľadu `me`, pre sklon k riziku
export function teamLead(state, me) {
  return power(mages(state, me), false).t - power(mages(state, other(me)), false).t;
}

// hodnota stavu po kole v turnaji v škále eval [-1, 1]: e = eval hry, lead = náskok tímov na začiatku kola,
// hp0 = moje HP na začiatku kola (sklon k riziku sa týka HP, ktoré v kole stratím)
export function seriesValue(state, me, e, lead = 0, hp0 = null) {
  if (!isTournament(state)) return e;
  const a = state.players[me], b = state.players[other(me)];
  let pGame;
  if (b.hp <= 0 && a.hp > 0) pGame = 1;
  else if (a.hp <= 0 && b.hp > 0) pGame = 0;
  else {
    let ea = e;
    if (hp0 !== null) {
      const tilt = Math.max(-1, Math.min(1, lead));
      ea += SERIES.RISK * tilt * (a.hp - hp0) / MAX_HP; // vedúci: strata HP bolí viac; prehrávajúci: menej
    }
    pGame = (Math.max(-1, Math.min(1, ea)) + 1) / 2;
  }
  const p = pGame * afterGame(state, me, true) + (1 - pGame) * afterGame(state, me, false);
  return 2 * p - 1;
}

export const swapCount = (q) => q.reduce((n, a) => n + (a.type === "swap" ? 1 : 0), 0);
