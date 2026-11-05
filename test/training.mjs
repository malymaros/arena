// test/training.mjs - TRAINING GROUNDS (shared/training.js): každý scenár priamo na engine.
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

// predpísané riešenie + koncová extra akcia (golden mana / Last Stand) v poslednom kole: hra skončí skôr, extra sa
// nevykoná → stále WELL DONE, nie falošné CREATIVE (videné v hre na scenári 4)
for (const sc of TRAINING) {
  const last = sc.rounds.length - 1;
  if (["golden_mana", "last_stand"].includes(sc.rounds[last].solution.at(-1)?.type)) continue;
  for (const extra of ["golden_mana", "last_stand"]) {
    const plays = solution(sc);
    plays[last] = [...plays[last], mv(extra)];
    let r;
    try { r = play(sc, plays); } catch (err) {
      if (/odmietol hráčovu frontu/.test(err.message)) continue; // extra tu engine nepustí (napr. kolo s démonom)
      throw err;
    }
    assert.equal(r.result, "win", `scenár ${sc.n}: riešenie + ${extra} malo vyhrať`);
    assert.ok(matchesSolution(sc, r.locks), `scenár ${sc.n}: riešenie + ${extra} sa musí rozpoznať ako predpísané (nie creative)`);
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
