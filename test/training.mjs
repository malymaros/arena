// test/training.mjs - TRAINING GROUND (shared/training.js): každý scenár priamo na engine.
// Predpísané riešenie musí vyhrať (hráč žije, bot mŕtvy), známe zlé ťahy prehrať a známe kreatívne riešenia
// vyhrať. Zmeny dlaždíc medzi kolami idú zo scenára (žiadna náhoda).
import assert from "node:assert/strict";
import { createEngine } from "../engine/game.js";
import { TRAINING, ANY, matchesSolution, trainingScenario } from "../shared/training.js";

const mv = (type, dir) => (dir ? { type, dir } : { type });
// ANY v riešení nahradí bezpečná akcia (scenár:kolo:slot; typ akcie sa v kole nesmie opakovať)
const FILL = { "4:0:3": mv("move", "up"), "6:0:2": mv("recharge"), "6:1:0": mv("move", "up"), "6:1:2": mv("recharge") };

// zahrá scenár: plays[k] = hráčova fronta v kole k+1; vráti "win" | "fail" + fronty hráča
function play(sc, plays) {
  const e = createEngine({});
  e.startTraining(sc);
  const g = () => e.game;
  const locks = [];
  for (let k = 0; k < sc.rounds.length; k++) {
    const q = plays[k];
    if (!q) break;
    let ok = null;
    e.lockIn("A", q, g().turn, (r) => { ok = r; });
    assert.ok(ok?.ok, `scenár ${sc.n} kolo ${k + 1}: engine odmietol hráčovu frontu ${JSON.stringify(q)} (${JSON.stringify(ok)})`);
    locks.push(q);
    let okB = null;
    e.lockIn("B", sc.rounds[k].bot, g().turn, (r) => { okB = r; });
    assert.ok(okB?.ok, `scenár ${sc.n} kolo ${k + 1}: engine odmietol frontu bota (${JSON.stringify(okB)})`);
    const { p1, p2 } = g().players;
    if (p1.hp <= 0) return { result: "fail", locks };
    if (p2.hp <= 0) return { result: "win", locks };
  }
  return { result: "fail", locks };
}
const solution = (sc) => sc.rounds.map((r, k) => r.solution.map((a, i) => (a === ANY ? FILL[`${sc.n}:${k}:${i}`] : a)));

for (const sc of TRAINING) {
  const r = play(sc, solution(sc));
  assert.equal(r.result, "win", `scenár ${sc.n} (${sc.name}): predpísané riešenie nevyhralo`);
  assert.ok(matchesSolution(sc, r.locks), `scenár ${sc.n}: riešenie sa nerozpozná ako predpísané`);
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
];
for (const [n, plays] of bad) {
  const r = play(trainingScenario(n), plays);
  assert.equal(r.result, "fail", `scenár ${n}: zlý ťah ${JSON.stringify(plays)} mal prehrať`);
}

// kreatívne riešenia (výhra iným ťahom → CREATIVE)
const creative = [
  [6, [[mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], [mv("move", "down"), mv("special"), mv("recharge")]]], // IK na B1 s buffom + special
  [6, [[mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], [mv("dash", "right"), mv("special"), mv("recharge")]]], // dmg dlaždica → special ±1 riadok
];
for (const [n, plays] of creative) {
  const sc = trainingScenario(n);
  const r = play(sc, plays);
  assert.equal(r.result, "win", `scenár ${n}: kreatívne riešenie ${JSON.stringify(plays)} malo vyhrať`);
  assert.ok(!matchesSolution(sc, r.locks), `scenár ${n}: kreatívne riešenie sa nesmie rozpoznať ako predpísané`);
}

// scenár 6: zmeny dlaždíc na konci 1. kola zo scenára (IK A2 → B1, mana na B4), žiadne náhodné dlaždice
{
  const e = createEngine({});
  e.startTraining(trainingScenario(6));
  assert.deepEqual(e.game.pending, { ikMoves: [{ x: 0, y: 1 }], spawns: [{ x: 3, y: 1, type: "mana" }] });
  e.lockIn("A", [mv("dash", "up"), mv("shield"), mv("recharge"), mv("last_stand")], 1);
  e.lockIn("B", trainingScenario(6).rounds[0].bot, 1);
  assert.deepEqual(e.game.iks, [{ x: 0, y: 1 }]);
  assert.ok(e.game.tiles.some(t => t.type === "mana" && t.x === 3 && t.y === 1));
  assert.deepEqual(e.game.pending, { ikMoves: [{ x: 0, y: 1 }], spawns: [] });
  assert.ok(e.game.players.p1.lastStandBuff, "Last Stand mal vyjsť");
}
console.log(`training: ${TRAINING.length} scenárov OK (riešenia, ${bad.length} zlých ťahov, ${creative.length} kreatívne)`);
