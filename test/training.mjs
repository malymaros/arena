// test/training.mjs - TRAINING GROUNDS (shared/training.js): každý scenár priamo na engine.
// Predpísané riešenie musí vyhrať (hráč žije, bot mŕtvy), známe zlé ťahy prehrať a známe kreatívne riešenia
// vyhrať. Zmeny dlaždíc medzi kolami idú zo scenára (žiadna náhoda).
import assert from "node:assert/strict";
import { createEngine } from "../engine/game.js";
import { TRAINING, ANY, matchesSolution, trainingScenario, trainingRound } from "../shared/training.js";

const mv = (type, dir) => (dir ? { type, dir } : { type });
// ANY v riešení nahradí bezpečná akcia (scenár:kolo:slot, pri kole s variantmi scenár:kolo:variant:slot; typ akcie
// sa v kole nesmie opakovať)
const FILL = { "4:0:3": mv("move", "up"), "6:0:2": mv("recharge"), "6:1:0": mv("move", "up"), "6:1:2": mv("recharge"),
  "7:1:c3-demon:1": mv("move", "up"), "7:1:c3-demon:2": mv("dash", "up"),
  "7:1:c3:2": mv("move", "up"), "7:1:c3:3": mv("attack", "up") };
// predpísané riešenie kola ako hrateľná fronta: ANY → FILL, alternatívy → prvá, OPT → vynechať (withOpt = zahrať)
function solve(sc, k, round, withOpt = false) {
  const key = (i) => (round.id ? `${sc.n}:${k}:${round.id}:${i}` : `${sc.n}:${k}:${i}`);
  return round.solution.flatMap((a, i) => (a === ANY ? [FILL[key(i)]] : Array.isArray(a) ? [a[0]] : a.opt ? (withOpt ? [a.opt] : []) : [a]));
}

// zahrá scenár: plays[k] = hráčova fronta v kole k+1, alebo funkcia (kolo) => fronta (kolo s variantmi - variant
// určí pozícia na začiatku kola); vráti "win" | "fail" + fronty hráča + odohrané kolá
function play(sc, plays) {
  const e = createEngine({});
  e.startTraining(sc);
  const g = () => e.game;
  const locks = [], played = [];
  for (let k = 0; k < sc.rounds.length; k++) {
    const round = trainingRound(sc, g().turn, g().players);
    assert.ok(round, `scenár ${sc.n} kolo ${k + 1}: žiadny variant kola nesedí`);
    const q = typeof plays[k] === "function" ? plays[k](round) : plays[k];
    if (!q) break;
    let ok = null;
    e.lockIn("A", q, g().turn, (r) => { ok = r; });
    assert.ok(ok?.ok, `scenár ${sc.n} kolo ${k + 1}: engine odmietol hráčovu frontu ${JSON.stringify(q)} (${JSON.stringify(ok)})`);
    locks.push(q); played.push(round);
    let okB = null;
    e.lockIn("B", round.bot, g().turn, (r) => { okB = r; });
    assert.ok(okB?.ok, `scenár ${sc.n} kolo ${k + 1}: engine odmietol frontu bota${round.id ? ` (variant ${round.id})` : ""} (${JSON.stringify(okB)})`);
    const { p1, p2 } = g().players;
    if (p1.hp <= 0) return { result: "fail", locks, played };
    if (p2.hp <= 0) return { result: "win", locks, played };
  }
  return { result: "fail", locks, played };
}
const solution = (sc, withOpt = false) => sc.rounds.map((_, k) => (round) => solve(sc, k, round, withOpt));

for (const sc of TRAINING) {
  for (const withOpt of [false, true]) {
    const r = play(sc, solution(sc, withOpt));
    assert.equal(r.result, "win", `scenár ${sc.n} (${sc.name}): predpísané riešenie${withOpt ? " s voliteľnou akciou" : ""} nevyhralo`);
    assert.ok(matchesSolution(sc, r.locks, r.played), `scenár ${sc.n}: riešenie sa nerozpozná ako predpísané`);
  }
}

// predpísané riešenie + koncová extra akcia (golden mana / Last Stand) v poslednom kole: hra skončí skôr, extra sa
// nevykoná → stále WELL DONE, nie falošné CREATIVE (videné v hre na scenári 4)
for (const sc of TRAINING) {
  const last = sc.rounds.length - 1;
  if (["golden_mana", "last_stand"].includes(sc.rounds[last].solution?.at(-1)?.type)) continue;
  for (const extra of ["golden_mana", "last_stand"]) {
    const plays = solution(sc);
    const lastFn = plays[last];
    plays[last] = (round) => [...lastFn(round), mv(extra)];
    let r;
    try { r = play(sc, plays); } catch (err) {
      if (/odmietol hráčovu frontu/.test(err.message)) continue; // extra tu engine nepustí (napr. kolo s démonom)
      throw err;
    }
    assert.equal(r.result, "win", `scenár ${sc.n}: riešenie + ${extra} malo vyhrať`);
    assert.ok(matchesSolution(sc, r.locks, r.played), `scenár ${sc.n}: riešenie + ${extra} sa musí rozpoznať ako predpísané (nie creative)`);
  }
}

// zlé ťahy (prehra)
const bad = [
  [1, [[mv("recharge"), mv("move", "up"), mv("attack", "right")]]],          // nabíja na B1 → strela ho zabije
  [2, [[mv("mirror"), mv("shield"), mv("attack", "right")]]],                // pôvodné poradie: bot prežije
  [3, [[mv("move", "right"), mv("recharge"), mv("melee")]]],                 // move na IK
  [4, [[mv("recharge"), mv("special"), mv("move", "up")]]],                    // bez golden shieldu ho special zabije
  [5, [[mv("move", "right"), mv("shield_breaker"), mv("mirror_breaker")]]],  // zlé breakery → odraz
  [6, [[mv("dash", "up"), mv("recharge"), mv("attack", "right"), mv("last_stand")]]], // bez štítu ho special zabije
  [6, [[mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], [mv("demon"), mv("recharge"), mv("attack", "right")]]], // démon do golden štítu
  [7, [[mv("recharge"), mv("dash", "right"), mv("attack", "up")]]],          // bez obrany ho special v riadku C zabije
  [7, [[mv("shield"), mv("recharge"), mv("melee")]]], // bez many shield nevyjde (0 many na štarte) → melee + dmg dlaždica
  // C3, démon má hráč: démon / melee / special v 1. akcii narazia na botov shield, bot (Last Hope 4×) special → doom
  [7, [[mv("recharge"), mv("dash", "right"), mv("mirror"), mv("last_stand")], [mv("demon"), mv("move", "up"), mv("recharge")]]],
  [7, [[mv("recharge"), mv("dash", "right"), mv("shield"), mv("last_stand")], [mv("melee"), mv("recharge"), mv("pass")]]],
  [7, [[mv("recharge"), mv("dash", "right"), mv("shield"), mv("last_stand")], [mv("special"), mv("recharge"), mv("pass")]]],
  // C3, démon má bot: golden obrana nestačí (bot démona nehrá, special v riadku C), dash hore bez Last Hope = dmg dlaždica
  [7, [[mv("recharge"), mv("dash", "right"), mv("shield")], [mv("golden_shield"), mv("recharge"), mv("pass"), mv("attack", "up")]]],
  [7, [[mv("recharge"), mv("dash", "right"), mv("mirror")], [mv("golden_mirror"), mv("recharge"), mv("pass"), mv("attack", "up")]]],
  [7, [[mv("recharge"), mv("dash", "right"), mv("shield")], [mv("dash", "up"), mv("move", "up"), mv("attack", "up")]]],
  // útek na B1 bez démona: bot odíde z IK a démona zahrá až po golden obrane → žiadna výhra
  [7, [[mv("move", "up"), mv("dash", "up"), mv("recharge")], [mv("last_hope"), mv("golden_shield"), mv("move", "down"), mv("dash", "right"), mv("attack", "up")]]],
  [7, [[mv("move", "up"), mv("dash", "up"), mv("recharge")], [mv("golden_shield"), mv("move", "down"), mv("dash", "right"), mv("attack", "up")]]],
];
for (const [n, plays] of bad) {
  const r = play(trainingScenario(n), plays);
  assert.equal(r.result, "fail", `scenár ${n}: zlý ťah ${JSON.stringify(plays)} mal prehrať`);
}

// kreatívne riešenia (výhra iným ťahom → CREATIVE)
const creative = [
  [6, [[mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], [mv("move", "down"), mv("special"), mv("recharge")]]], // IK na B1 s buffom + special
  [6, [[mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], [mv("dash", "right"), mv("special"), mv("recharge")]]], // dmg dlaždica → special ±1 riadok
  // C3, démon má hráč: 1. akcia minie botov shield a uhne z riadku C (IK s buffom = −5), potom démon
  [7, [[mv("recharge"), mv("dash", "right"), mv("shield"), mv("last_stand")], [mv("move", "up"), mv("demon"), mv("dash", "up")]]],
  // útek na B1 s démonom (bot 8 HP): proti recharge / dash / shield
  [7, [[mv("move", "up"), mv("dash", "up"), mv("attack", "up"), mv("last_stand")], [mv("move", "right"), mv("special"), mv("dash", "up")]]],
  // rovnaké políčko s démonom
  [7, [[mv("move", "up"), mv("recharge"), mv("dash", "down"), mv("last_stand")], [mv("golden_shield"), mv("mirror"), mv("recharge"), mv("special")]]],
];
for (const [n, plays] of creative) {
  const sc = trainingScenario(n);
  const r = play(sc, plays);
  assert.equal(r.result, "win", `scenár ${n}: kreatívne riešenie ${JSON.stringify(plays)} malo vyhrať`);
  assert.ok(!matchesSolution(sc, r.locks, r.played), `scenár ${n}: kreatívne riešenie sa nesmie rozpoznať ako predpísané`);
}

// scenár 7: alternatívy predpísaného riešenia (mirror / shield, shield breaker namiesto mirroru) = WELL DONE
{
  const sc = trainingScenario(7);
  const well = [
    [[mv("recharge"), mv("dash", "right"), mv("mirror"), mv("last_stand")], [mv("shield_breaker"), mv("move", "up"), mv("dash", "up")], "c3-demon"],
    [[mv("recharge"), mv("dash", "right"), mv("shield"), mv("last_stand")], [mv("mirror"), mv("move", "up"), mv("dash", "up")], "c3-demon"],
    [[mv("recharge"), mv("dash", "right"), mv("mirror")], [mv("last_hope"), mv("dash", "up"), mv("move", "up"), mv("attack", "up")], "c3"],
  ];
  for (const [r1, r2, id] of well) {
    const r = play(sc, [r1, r2]);
    assert.equal(r.result, "win", `scenár 7: ${JSON.stringify([r1, r2])} malo vyhrať`);
    assert.equal(r.played[1].id, id, "scenár 7: zlý variant 2. kola");
    assert.ok(matchesSolution(sc, r.locks, r.played), `scenár 7: ${JSON.stringify([r1, r2])} je predpísané riešenie (WELL DONE)`);
  }
  // každý koniec 1. kola má svoj variant (nikdy poistku else) a engine prijme botovu frontu
  const A = (t, d) => mv(t, d), D = ["up", "down", "left", "right"], S = [];
  for (const t of ["move", "dash", "attack"]) for (const d of D) S.push(A(t, d));
  for (const t of ["recharge", "melee", "special", "shield", "mirror", "shield_breaker", "mirror_breaker", "pass"]) S.push(A(t));
  const seen = new Map();
  for (const x of S) for (const y of S) for (const z of S) for (const sfx of [[], [mv("last_stand")], [mv("golden_mana")]]) {
    const e = createEngine({});
    e.startTraining(sc);
    let ok = null;
    e.lockIn("A", [x, y, z, ...sfx], 1, (r) => { ok = r; });
    if (!ok?.ok) continue;
    e.lockIn("B", sc.rounds[0].bot, 1);
    const { p1, p2 } = e.game.players;
    if (p1.hp <= 0 || p2.hp <= 0) continue;
    const key = `${p1.x},${p1.y} ${p1.hp}/${p1.mana}${p1.lastStandBuff ? "D" : ""} | ${p2.x},${p2.y} ${p2.hp}/${p2.mana}`;
    if (seen.has(key)) continue;
    const round = trainingRound(sc, 2, e.game.players);
    assert.ok(round && !round.id.startsWith("else"), `scenár 7: koniec 1. kola ${key} nemá vlastný variant (${round?.id})`);
    let okB = null;
    e.lockIn("A", [mv("pass"), mv("pass"), mv("pass")], 2);
    e.lockIn("B", round.bot, 2, (r) => { okB = r; });
    assert.ok(okB?.ok, `scenár 7: engine odmietol botovu frontu variantu ${round.id} (${key})`);
    seen.set(key, round.id);
  }
  assert.equal(seen.size, 22, `scenár 7: čakaných 22 koncov 1. kola, je ${seen.size}`);
  const byId = {};
  for (const id of seen.values()) byId[id] = (byId[id] || 0) + 1;
  assert.deepEqual(byId, { "c3-demon": 2, c3: 2, "b1-demon-8": 1, "b1-demon": 2, b1: 12, "same-demon": 1, "same-1hp": 1, same: 1 }, `scenár 7: rozdelenie koncov ${JSON.stringify(byId)}`);
}

// scenár 6: zmeny dlaždíc na konci 1. kola zo scenára (IK A2 → B1, C4 → B3, mana na B4), žiadne náhodné dlaždice
{
  const e = createEngine({});
  e.startTraining(trainingScenario(6));
  assert.deepEqual(e.game.pending, { ikMoves: [{ x: 0, y: 1 }, { x: 2, y: 1 }], spawns: [{ x: 3, y: 1, type: "mana" }] });
  e.lockIn("A", [mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], 1);
  e.lockIn("B", trainingScenario(6).rounds[0].bot, 1);
  assert.deepEqual(e.game.iks, [{ x: 0, y: 1 }, { x: 2, y: 1 }]);
  assert.ok(e.game.tiles.some(t => t.type === "mana" && t.x === 3 && t.y === 1));
  assert.equal(e.game.pending, null, "posledné kolo bez zmien dlaždíc = žiadny náhľad");
  assert.ok(e.game.players.p1.lastStandBuff, "Last Stand mal vyjsť");
}
console.log(`training: ${TRAINING.length} scenárov OK (riešenia, ${bad.length} zlých ťahov, ${creative.length} kreatívne)`);

// pravidlo (vlastník 2026-11-05): dlaždica prekrytá IK je neaktívna - Fire na dmg dlaždici pod IK nemá special ±1
// riadok (a dlaždicu nespotrebuje), power pod IK nedá +2, Def-blocker pod IK neblokuje shield
{
  const custom = (tiles, you, bot, rounds) => ({ n: 99, starter: "you", you, bot, tiles, rounds });
  const run = (sc, q, botQ) => { const e = createEngine({}); e.startTraining(sc); e.lockIn("A", q, 1); e.lockIn("B", botQ, 1); return e.game; };
  const quiet = [mv("recharge"), mv("shield"), mv("move", "up")]; // bot bez dmg
  // Fire na B1 (dmg + IK), bot na A4 → special zasiahne len riadok B
  let g = run(custom([{ type: "dmg", at: "B1" }, { type: "ik", at: "B1" }], { at: "B1", hp: 10, mana: 10 }, { at: "A4", hp: 10, mana: 0 }, []),
    [mv("special"), mv("recharge"), mv("move", "up")], quiet);
  assert.equal(g.players.p2.hp, 10, "dmg dlaždica pod IK nesmie Fireovi rozšíriť special");
  assert.ok(g.tiles.some(t => t.type === "dmg" && t.x === 0 && t.y === 1), "dmg dlaždica pod IK sa nesmie spotrebovať");
  // bez IK: special ±1 riadok trafí bota na A4
  g = run(custom([{ type: "dmg", at: "B1" }], { at: "B1", hp: 10, mana: 10 }, { at: "A4", hp: 10, mana: 0 }, []),
    [mv("special"), mv("recharge"), mv("move", "up")], quiet);
  assert.equal(g.players.p2.hp, 5, "Fire na dmg dlaždici (bez IK) má special ±1 riadok");
  // power pod IK: strela bez bonusu (B1 → B4 = 1 dmg), power ostáva
  g = run(custom([{ type: "power", at: "B1" }, { type: "ik", at: "B1" }], { at: "B1", hp: 10, mana: 10 }, { at: "B4", hp: 10, mana: 0 }, []),
    [mv("attack", "right"), mv("recharge"), mv("move", "up")], quiet);
  assert.equal(g.players.p2.hp, 9, "power dlaždica pod IK nesmie pridať +2");
  assert.ok(g.tiles.some(t => t.type === "power"), "power pod IK sa nesmie spotrebovať");
  // Def-blocker pod IK: shield sa armuje (strela bota sa zablokuje)
  g = run(custom([{ type: "block", at: "B1" }, { type: "ik", at: "B1" }], { at: "B1", hp: 20, mana: 10 }, { at: "B4", hp: 10, mana: 10 }, []),
    [mv("shield"), mv("move", "up"), mv("recharge")], [mv("attack", "left"), mv("recharge"), mv("move", "up")]);
  // shield zablokuje strelu (1. krok), na konci kroku IK 10, potom hráč z IK odíde → 20 − 10 = 10
  assert.equal(g.players.p1.hp, 10, "Def-blocker pod IK nesmie zablokovať shield");
  console.log("training: dlaždice pod IK neaktívne OK");
}
