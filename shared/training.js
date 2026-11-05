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
// rounds[k].variants = [{ id, when, bot, solution }] namiesto bot/solution: fronta bota (a predpísané riešenie) závisí
// od stavu na začiatku kola - platí prvý variant, ktorého podmienka `when` sedí (whenOk, trainingRound). Variant bez
// solution = koniec mimo predpísaného postupu (výhra je vždy CREATIVE).
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
  // s čím skončil. Bot v 1. kole ostáva na C1 (special bije riadok C); strela hore trestá útek na B1. Hráč začína
  // bez many - najprv nabiť, mana dlaždica na C3 zaplatí obranu.
  { n: 7, name: "Pick your POISON", starter: "you",
    you: { at: "C1", hp: 10, mana: 0 }, bot: { at: "C1", hp: 10, mana: 10 },
    tiles: [{ type: "ik", at: "A1" }, { type: "ik", at: "B3" }, { type: "ik", at: "C2" },
      { type: "dmg", at: "A3" }, { type: "dmg", at: "A4" }, { type: "dmg", at: "B2" }, { type: "dmg", at: "C1" },
      { type: "block", at: "B4" }, { type: "mana", at: "C3" }, { type: "mana", at: "C4" }, { type: "heal", at: "B1" }],
    rounds: [
      { bot: [a("melee"), a("attack", "up"), a("special"), a("last_stand")],
        solution: [a("recharge"), a("dash", "right"), [a("shield"), a("mirror")], OPT(a("last_stand"))],
        // staré IK sa vymenia medzi sebou (A1 → B3, B3 → C2, C2 → A1), nové IK na B1 a C4
        next: { ik: ["B3", "C2", "A1"], spawn: [{ type: "ik", at: "B1" }, { type: "ik", at: "C4" }] } },
      // 2. kolo: pre každý koniec 1. kola najťažšia odpoveď bota (prepočet hrubou silou 2026-11-05, schválil
      // vlastník): po predpísanom postupe čo najmenej výhier, ale riešiteľné; odchýlky čo najťažšie / bez výhry.
      { variants: [
        // ★ C3, démon má hráč: bot Last Hope + shield na hráčovu 1. akciu → mirror (odrazí special 4×) alebo
        // shield breaker (rozbije shield, bot má 1 HP) hneď v 1. akcii; démon / melee / special nevyhrajú
        { id: "c3-demon", when: { you: "C3", youDemon: true }, bot: [a("last_hope"), a("shield"), a("special"), a("dash", "right")],
          solution: [[a("mirror"), a("shield_breaker")], ANY, ANY] },
        // ★ C3, démon má bot: special bije riadok C, hore je IK / dmg dlaždica → Last Hope (½ dmg = 0) + dash hore
        // na A3, prežiť - bota zabije doom
        { id: "c3", when: { you: "C3" }, bot: [a("shield"), a("special"), a("attack", "right")],
          solution: [a("last_hope"), a("dash", "up"), ANY, ANY] },
        // útek na B1 s démonom
        { id: "b1-demon-8", when: { you: "B1", youDemon: true, botHp: 8 }, bot: [a("recharge"), a("dash", "right"), a("shield")] },
        { id: "b1-demon", when: { you: "B1", youDemon: true }, bot: [a("last_hope"), a("dash", "right"), a("special"), a("mirror")] },
        // útek na B1 bez démona: bot odíde z IK a démona zahrá až po golden obrane → istá prehra
        { id: "b1", when: { you: "B1" }, bot: [a("move", "right"), a("demon"), a("attack", "up")] },
        // rovnaké políčko (C1)
        { id: "same-demon", when: { same: true, youDemon: true }, bot: [a("last_hope"), a("shield"), a("special"), a("attack", "right")] },
        { id: "same-1hp", when: { same: true, youHp: 1 }, bot: [a("dash", "right"), a("special"), a("attack", "left")] },
        { id: "same", when: { same: true }, bot: [a("shield"), a("special"), a("attack", "right")] },
        // poistka (iný koniec 1. kola nie je možný - test/training.mjs)
        { id: "else-demon", when: { youDemon: true }, bot: [a("last_hope"), a("shield"), a("special"), a("dash", "right")] },
        { id: "else", when: {}, bot: [a("demon"), a("recharge"), a("melee")] },
      ] },
    ] },
];

// podmienka variantu kola (stav na začiatku kola) - všetky uvedené musia sedieť: same = hráč a bot na jednom
// políčku, you / bot = bunka, youDemon / botDemon = Last Stand buff, youHp / botHp / youMana = presná hodnota
const cellIs = (p, at) => { const c = cellOf(at); return p.x === c.x && p.y === c.y; };
function whenOk(w, p1, p2) {
  return (w.same === undefined || (p1.x === p2.x && p1.y === p2.y) === w.same)
    && (w.you === undefined || cellIs(p1, w.you)) && (w.bot === undefined || cellIs(p2, w.bot))
    && (w.youDemon === undefined || !!p1.lastStandBuff === w.youDemon)
    && (w.botDemon === undefined || !!p2.lastStandBuff === w.botDemon)
    && (w.youHp === undefined || p1.hp === w.youHp) && (w.botHp === undefined || p2.hp === w.botHp)
    && (w.youMana === undefined || p1.mana === w.youMana);
}
// kolo `turn` scenára pre aktuálny stav hráčov ({ p1, p2 }): { bot, solution, next, id, ... } alebo null
export function trainingRound(sc, turn, players) {
  const r = sc?.rounds?.[turn - 1];
  if (!r) return null;
  if (!r.variants) return r;
  const v = players && r.variants.find(x => whenOk(x.when || {}, players.p1, players.p2));
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
