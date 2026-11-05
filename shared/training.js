// shared/training.js - TRAINING GROUNDS (tutoriál): scenáre navrhol vlastník 2026-11-05, schválený vzhľad
// public/dev/tutorial.html. Hráč (Fire wizard, biely, vľavo) hrá proti Baby botovi (Fire wizard, čierny) s
// ODHALENÝMI akciami bota. Cieľ vždy: neumrieť a zabiť súpera. Výhra predpísaným ťahom = WELL DONE, výhra iným
// ťahom = CREATIVE (hráč našiel vlastné riešenie). Čistý modul - číta ho server (engine/game.js startTraining,
// server.js tréningová miestnosť) aj klient (okno TRAINING GROUNDS, lišta kola).
//
// Doska 4×3: riadky A (hore) / B / C, stĺpce 1–4 (vľavo → vpravo); "B1" = { x: 0, y: 1 }.
// rounds[k].bot = fronta bota v kole k+1 (ako lock_in: golden pred akcie, last_stand / golden_mana za ne)
// rounds[k].solution = predpísané riešenie hráča v rovnakom tvare; ANY = na tejto akcii nezáleží
// rounds[k].next = zmeny dlaždíc na konci kola (ohlásené ako náhľad): ik = nové pozície IK (paralelne s tiles typu
// "ik" v poradí zápisu), spawn = nové dlaždice. Bez next IK ostávajú, nič nepribudne a hráč nevidí žiadny náhľad.
// rounds[k].variants = [{ when, bot, solution }] namiesto bot/solution: fronta bota (a predpísané riešenie) závisí od
// pozície na začiatku kola - platí prvý variant, ktorého podmienka WHEN sedí (trainingRound).
// Slot riešenia: akcia | ANY | pole akcií (ktorákoľvek z nich) | OPT(akcia) = posledná akcia, ktorú hráč smie vynechať.

export const TRAINING_CHAR = "fire";
export const ANY = "*";
export const OPT = (act) => ({ opt: act });
const a = (type, dir) => (dir ? { type, dir } : { type });

export const TRAINING = [
  { n: 1, name: "FIREBALL!", starter: "you",
    you: { at: "B1", hp: 1, mana: 0 }, bot: { at: "B4", hp: 1, mana: 1 }, tiles: [],
    rounds: [{ bot: [a("attack", "left"), a("move", "up"), a("recharge")],
      solution: [a("move", "up"), a("recharge"), a("attack", "right")] }] },
  { n: 2, name: "Who is the fairest one of all?", starter: "you",
    you: { at: "B1", hp: 1, mana: 10 }, bot: { at: "B4", hp: 6, mana: 6 }, tiles: [],
    rounds: [{ bot: [a("attack", "left"), a("special"), a("recharge")],
      solution: [a("shield"), a("mirror"), a("attack", "right")] }] },
  { n: 3, name: "MIGHTY SWORD!", starter: "bot",
    you: { at: "B1", hp: 6, mana: 4 }, bot: { at: "B4", hp: 8, mana: 5 },
    tiles: [{ type: "dmg", at: "B1" }, { type: "ik", at: "B2" }, { type: "ik", at: "A1" }, { type: "ik", at: "C1" }],
    rounds: [{ bot: [a("special"), a("move", "left"), a("recharge")],
      solution: [a("dash", "right"), a("recharge"), a("melee")] }] },
  { n: 4, name: "Midas approves...", starter: "bot",
    you: { at: "B1", hp: 5, mana: 4 }, bot: { at: "B4", hp: 5, mana: 5 }, tiles: [],
    rounds: [{ bot: [a("special"), a("recharge"), a("mirror")],
      solution: [a("golden_shield"), a("recharge"), a("special"), ANY] }] },
  { n: 5, name: "I Want to Break Free", starter: "bot",
    you: { at: "B1", hp: 1, mana: 0 }, bot: { at: "B4", hp: 6, mana: 6 }, tiles: [{ type: "mana", at: "B2" }],
    rounds: [{ bot: [a("recharge"), a("mirror"), a("shield")],
      solution: [a("move", "right"), a("mirror_breaker"), a("shield_breaker")] }] },
  { n: 6, name: "Shinigami", starter: "bot",
    you: { at: "C1", hp: 1, mana: 6 }, bot: { at: "B4", hp: 10, mana: 10 },
    tiles: [{ type: "heal", at: "A1" }, { type: "dmg", at: "B1" }, { type: "dmg", at: "B2" }, { type: "dmg", at: "C1" },
      { type: "dmg", at: "C2" }, { type: "dmg", at: "C3" }, { type: "dmg", at: "A3" }, { type: "ik", at: "A2" }, { type: "ik", at: "C4" }],
    rounds: [
      { bot: [a("move", "up"), a("attack", "left"), a("special")],
        solution: [a("dash", "up"), a("shield"), ANY, a("last_stand")],
        next: { ik: ["B1", "B3"], spawn: [{ type: "mana", at: "B4" }] } },
      // 3. akcia bota bola shield - golden shield ho v tom istom kole vylučuje (validQueue); na výsledok nevplýva
      { bot: [a("golden_shield"), a("move", "down"), a("mirror"), a("recharge")],
        solution: [ANY, a("demon"), ANY] },
    ] },
  // vlastník 2026-11-05: v 1. kole si hráč vyberie „jed" - démona (Last Stand) alebo nie; 2. kolo podľa toho, kde a
  // s čím skončil. Bot v 1. kole: move dole = náraz do steny (ostáva na C1, special bije riadok C).
  { n: 7, name: "Pick your POISON", starter: "you",
    you: { at: "C1", hp: 10, mana: 2 }, bot: { at: "C1", hp: 10, mana: 10 },
    tiles: [{ type: "ik", at: "A1" }, { type: "ik", at: "B3" }, { type: "ik", at: "C2" },
      { type: "dmg", at: "A3" }, { type: "dmg", at: "A4" }, { type: "dmg", at: "B2" }, { type: "dmg", at: "C1" },
      { type: "block", at: "B4" }, { type: "mana", at: "C3" }, { type: "mana", at: "C4" }, { type: "heal", at: "B1" }],
    rounds: [
      { bot: [a("melee"), a("move", "down"), a("special"), a("last_stand")],
        solution: [a("recharge"), a("dash", "right"), [a("shield"), a("mirror")], OPT(a("last_stand"))],
        // staré IK sa vymenia medzi sebou (A1 → B3, B3 → C2, C2 → A1), nové IK na B1 a C4
        next: { ik: ["B3", "C2", "A1"], spawn: [{ type: "ik", at: "B1" }, { type: "ik", at: "C4" }] } },
      { variants: [
        // hráč a bot na rovnakom políčku: Last Hope dá manu na golden obranu proti melee, bota zabije doom
        { when: "same", bot: [a("melee"), a("attack", "right"), a("recharge")],
          solution: [a("last_hope"), [a("golden_shield"), a("golden_mirror")], ANY, ANY, ANY] },
        // A) démon má hráč: bot (Last Hope) dashne na hráčovo políčko - démon by minul, rovno melee / special
        { when: "youDemon", bot: [a("last_hope"), a("dash", "right"), a("mirror"), a("shield")],
          solution: [[a("melee"), a("special")], ANY, ANY] },
        // B) démon má bot: golden obrana proti démonovi, prežiť - bota zabije doom
        { when: "else", bot: [a("demon"), a("recharge"), a("melee")],
          solution: [[a("golden_shield"), a("golden_mirror")], ANY, ANY, ANY] },
      ] },
    ] },
];

// podmienky variantov kola (pozícia na začiatku kola)
const WHEN = {
  same: (p1, p2) => p1.x === p2.x && p1.y === p2.y,
  youDemon: (p1) => !!p1.lastStandBuff,
  else: () => true,
};
// kolo `turn` scenára pre aktuálny stav hráčov ({ p1, p2 }): { bot, solution, next, ... } alebo null
export function trainingRound(sc, turn, players) {
  const r = sc?.rounds?.[turn - 1];
  if (!r) return null;
  if (!r.variants) return r;
  const v = players && r.variants.find(x => WHEN[x.when]?.(players.p1, players.p2));
  return v ? { ...r, ...v } : null;
}

export const trainingScenario = (n) => TRAINING.find(s => s.n === Number(n)) || null;
// "B1" → { x: 0, y: 1 }
export function cellOf(at) { return { x: Number(at[1]) - 1, y: "ABC".indexOf(at[0]) }; }

// zahral hráč predpísané riešenie? locks = jeho fronty (lock_in) po kolách; ANY = hocičo, smer len keď ho riešenie má.
// V poslednom kole (bot v ňom zomrel) sa koncová extra akcia (golden_mana / last_stand) nikdy nevykoná (ide až po
// všetkých akciách a hra skončí skôr) - ak ju riešenie nemá, nesmie z predpísaného riešenia urobiť falošné CREATIVE.
const TRAILING = new Set(["golden_mana", "last_stand"]);
// played = odohrané kolá (trainingRound - pri kole s variantmi nesie zvolený variant; bez neho sc.rounds).
const actOk = (s, x) => !!x && x.type === s.type && (!s.dir || x.dir === s.dir);
const slotOk = (s, x) => s === ANY || (Array.isArray(s) ? s.some(alt => actOk(alt, x)) : actOk(s.opt || s, x));
const slotTypes = (s) => (Array.isArray(s) ? s : [s?.opt || s]).map(x => x?.type);
export function matchesSolution(sc, locks, played = sc.rounds) {
  return sc.rounds.every((_, i) => {
    let q = locks[i], sol = played[i]?.solution;
    if (!Array.isArray(q) || !Array.isArray(sol)) return false;
    // voliteľná posledná akcia (OPT), ktorú hráč nezahral → porovnaj bez nej
    if (sol.at(-1)?.opt && q.length === sol.length - 1) sol = sol.slice(0, -1);
    const last = i === sc.rounds.length - 1;
    if (last && TRAILING.has(q[q.length - 1]?.type) && !slotTypes(sol.at(-1)).some(t => TRAILING.has(t))) q = q.slice(0, -1);
    if (q.length !== sol.length) return false;
    return sol.every((s, k) => slotOk(s, q[k]));
  });
}
