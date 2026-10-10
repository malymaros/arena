// test/engine-scenarios.mjs - cielené scenáre priamo nad enginom (bez servera): presná pozícia figúr,
// obrany a klonov sa nastaví v stave, odohrá sa jedno kolo a kontrolujú sa framy timeline.
// Spustenie: node test/engine-scenarios.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const CFG = { format: "single", tilesPerRound: 1, timer: "off", tilePreview: false, colorPref: "white",
  tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 } };
const R = { type: "recharge" }, S = { type: "shield" }, ML = { type: "melee" };

// nový zápas: osoba A = p1 (biely, začína kolo 1), setup(game) upraví stav pred kolom
function scenario(c1, c2, setup) {
  const timelines = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", c2);
  setup?.(e.game);
  return {
    game: e.game,
    round(q1, q2) {
      const n = timelines.length;
      e.lockIn("A", q1, e.game.turn, (r) => { if (!r?.ok) throw new Error("p1 lock_in odmietnutý " + JSON.stringify(q1)); });
      e.lockIn("B", q2, e.game.turn, (r) => { if (!r?.ok) throw new Error("p2 lock_in odmietnutý " + JSON.stringify(q2)); });
      return timelines.slice(n).flat();
    },
  };
}
const frames = (tl, pred) => tl.filter(f => (f.effects || []).some(pred));
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));

/* ---- Rozhodnutie 9: nekrytý stacknutý pár - poof klona a zásah majiteľa v JEDNOM beate ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1;
    g.players.p2.x = 2; g.players.p2.y = 1; g.players.p2.clone = { x: 2, y: 1 };
  });
  const tl = sc.round([{ type: "attack", dir: "right" }, R, S], [R, S, { type: "move", dir: "up" }]);
  const beat = frames(tl, e => e.kind === "clone_die" && e.target === "p2");
  const hits = fx(tl, "hit").filter(e => e.target === "p2");
  check(beat.length === 1 && beat[0].effects.some(e => e.kind === "hit" && e.target === "p2"),
    "R9: strela do nekrytého stacknutého páru - hit + clone_die v jednom frame", JSON.stringify(beat.map(f => f.effects)));
  check(hits.length === 1 && hits[0].dmg === 2, "R9: majiteľ dostane 3 - CLONE_DMG = 2", JSON.stringify(hits));
}

/* ---- Rozhodnutie 10: krytý stacknutý pár v zóne = JEDNA reakcia (jeden blok bez bunky) ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p2.clone = { x: 3, y: 1 };            // p2 na (3,1), klon stacknutý
    g.players.p2.shield = true;                      // obrana kryje najbližšiu p1 akciu (fire special - celý riadok)
  });
  const tl = sc.round([{ type: "special" }, R, S], [R, S, { type: "move", dir: "up" }]);
  const blocks = fx(tl, "block").filter(e => e.target === "p2");
  check(blocks.length === 1 && !blocks[0].cell, "R10: fire special na krytý stacknutý pár - jeden blok", JSON.stringify(blocks));
  check(!fx(tl, "clone_die").length && sc.game.players.p2.clone, "R10: klon prežil (štít kryje pár)");
}
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p2.clone = { x: 3, y: 1 };
    g.players.p2.mirror = true;
  });
  const tl = sc.round([{ type: "special" }, R, S], [R, S, { type: "move", dir: "up" }]);
  const beams = fx(tl, "mirror").filter(e => e.target === "p2");
  const refl = fx(tl, "hit").filter(e => e.target === "p1");
  check(beams.length === 1 && !beams[0].cell, "R10: mirror stacknutého páru v zóne - jeden lúč", JSON.stringify(beams));
  check(refl.length === 1 && refl[0].dmg === 10 && JSON.stringify(refl[0].parts) === "[5,5]",
    "R10: odraz oboch figúr naraz (5+5)", JSON.stringify(refl));
}

/* ---- Rozhodnutie 8: sek do klona-návnady s mirrorom odrazí PLNÝ melee dmg (vrátane maze 2×) ---- */
{
  const sc = scenario("naruto", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1;
    g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.clone = { x: 1, y: 1 }; // návnada na p1 bunke
    g.players.p2.mirror = true;
  });
  const tl = sc.round([ML, R, S], [R, S, { type: "move", dir: "up" }]);
  const beam = fx(tl, "mirror").find(e => e.target === "p2");
  check(beam && JSON.stringify(beam.cell) === "[1,1]" && beam.dmg === 8, "R8: odraz z návnady = plný MELEE_DMG 8", JSON.stringify(beam));
}
{
  const sc = scenario("minotaur", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mazeBuff = true;           // Minotaur s maze buffom (2×)
    g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.clone = { x: 1, y: 1 };
    g.players.p2.mirror = true;
  });
  const tl = sc.round([ML, R, S], [R, S, { type: "move", dir: "up" }]);
  const beam = fx(tl, "mirror").find(e => e.target === "p2");
  check(beam && beam.dmg === 16, "R8: sek Minotaura s maze buffom do návnady - odraz 16 (8 × 2)", JSON.stringify(beam));
}

/* ---- Rozhodnutie 11: klon útočí aj odraz dostáva ako normálny hráč - odraz klonovej strely sa vráti
        útočníkovmu klonovi (rozplynie sa), aj keď strela trafila obrancovu návnadu či krytý pár ---- */
for (const [label, p2setup] of [
  ["návnada", (p2) => { p2.x = 2; p2.y = 1; p2.clone = { x: 2, y: 2 }; }],      // klon-návnada na (2,2), Naruto mimo
  ["stacknutý pár", (p2) => { p2.x = 2; p2.y = 2; p2.clone = { x: 2, y: 2 }; }], // pár na (2,2)
]) {
  const sc = scenario("naruto", "naruto", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0; g.players.p1.clone = { x: 0, y: 2 }; // Naruto strieľa riadkom 0, klon riadkom 2
    p2setup(g.players.p2);
    g.players.p2.mirror = true;
  });
  const tl = sc.round([{ type: "attack", dir: "right" }, R, S], [R, S, { type: "move", dir: "up" }]);
  const beams = fx(tl, "mirror").filter(e => e.target === "p2");
  check(beams.length >= 1 && beams.every(b => JSON.stringify(b.destCell) === "[0,2]"),
    `R11 (${label}): odraz letí do útočníkovho klona`, JSON.stringify(beams));
  check(fx(tl, "clone_die").some(e => e.target === "p1") && !sc.game.players.p1.clone, `R11 (${label}): útočníkov klon sa rozplynul`);
  check(!fx(tl, "hit").some(e => e.target === "p1"), `R11 (${label}): skutočný útočník nedostal dmg`,
    JSON.stringify(fx(tl, "hit")));
  check(!!sc.game.players.p2.clone, `R11 (${label}): obrancov klon prežil (mirror ho kryl)`);
}

console.log(failures ?`\n${failures} ENGINE SCENÁROV ZLYHALO` : "\nENGINE SCENÁRE PREŠLI");
process.exit(failures ? 1 : 0);
