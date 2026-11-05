// shared/training.js - TRAINING GROUND (tutoriál): scenáre navrhol vlastník 2026-11-05, schválený vzhľad
// public/dev/tutorial.html. Hráč (Fire wizard, biely, vľavo) hrá proti Baby botovi (Fire wizard, čierny) s
// ODHALENÝMI akciami bota. Cieľ vždy: neumrieť a zabiť súpera. Výhra predpísaným ťahom = WELL DONE, výhra iným
// ťahom = CREATIVE (hráč našiel vlastné riešenie). Čistý modul - číta ho server (engine/game.js startTraining,
// server.js tréningová miestnosť) aj klient (okno TRAINING GROUND, lišta kola).
//
// Doska 4×3: riadky A (hore) / B / C, stĺpce 1–4 (vľavo → vpravo); "B1" = { x: 0, y: 1 }.
// rounds[k].bot = fronta bota v kole k+1 (ako lock_in: golden pred akcie, last_stand / golden_mana za ne)
// rounds[k].solution = predpísané riešenie hráča v rovnakom tvare; ANY = na tejto akcii nezáleží
// rounds[k].next = zmeny dlaždíc na konci kola (ohlásené ako náhľad): ik = nové pozície IK (paralelne s tiles typu
// "ik" v poradí zápisu), spawn = nové dlaždice. Bez next IK ostávajú, nič nepribudne a hráč nevidí žiadny náhľad.

export const TRAINING_CHAR = "fire";
export const ANY = "*";
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
];

export const trainingScenario = (n) => TRAINING.find(s => s.n === Number(n)) || null;
// "B1" → { x: 0, y: 1 }
export function cellOf(at) { return { x: Number(at[1]) - 1, y: "ABC".indexOf(at[0]) }; }

// zahral hráč predpísané riešenie? locks = jeho fronty (lock_in) po kolách; ANY = hocičo, smer len keď ho riešenie má
export function matchesSolution(sc, locks) {
  return sc.rounds.every((r, i) => {
    const q = locks[i];
    if (!Array.isArray(q) || q.length !== r.solution.length) return false;
    return r.solution.every((s, k) => s === ANY || (q[k]?.type === s.type && (!s.dir || q[k]?.dir === s.dir)));
  });
}
