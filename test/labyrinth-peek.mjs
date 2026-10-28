// test/labyrinth-peek.mjs - labyrint „peek": súperova akcia, ktorá ZAČALA na fakľovej bunke prekliateho
// (jeho vlastnej / bunke jeho klona), sa mu odhalí celá (záznam kola, efekty, pozícia počas akcie) a po nej
// lovec opäť zmizne. Akcia z inej bunky ostáva „?". Odhalí sa len figúra, ktorá na fakli stála - Narutov
// klon/majiteľ mimo ostáva v tme. Mana lovca ostáva skrytá. Priamo nad enginom (redactTimelineFor).
// Spustenie: node test/labyrinth-peek.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const CFG = { format: "single", tilesPerRound: 1, timer: "off", tilePreview: false, colorPref: "white",
  tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 } };
const R = { type: "recharge" }, S = { type: "shield" };
const mv = (dir) => ({ type: "move", dir });
const P1Q = [R, S, { type: "mirror" }]; // prekliaty stojí na mieste (fakľa sa nehýbe)

// osoba A = p1 (začína kolo 1); setup(game) upraví stav pred kolom
function scenario(c1, c2, setup) {
  const timelines = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", c2);
  setup?.(e.game);
  return {
    game: e.game,
    // jedno kolo; vráti surovú timeline aj pohľad oboch hráčov (presne to, čo im server pošle)
    round(q1, q2) {
      const n = timelines.length;
      e.lockIn("A", q1, e.game.turn, (r) => { if (!r?.ok) throw new Error("p1 lock_in odmietnutý " + JSON.stringify(q1) + " " + JSON.stringify(r)); });
      e.lockIn("B", q2, e.game.turn, (r) => { if (!r?.ok) throw new Error("p2 lock_in odmietnutý " + JSON.stringify(q2) + " " + JSON.stringify(r)); });
      const raw = timelines.slice(n).flat();
      // cez JSON ako socket - tag act nesmie presiaknuť
      const view = (slot) => JSON.parse(JSON.stringify(e.redactTimelineFor(slot, raw)));
      return { raw, p1: view("p1"), p2: view("p2") };
    },
  };
}
const curse = (p) => { p.labyrinth = true; p.thread = [[p.x, p.y]]; p.threadMark = null; };
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));
const acts = (tl, slot) => fx(tl, "action").filter(e => e.from === slot).map(e => e.action.type);
// rozdelenie timeline na úseky akcií súpera: [{ type, frames }] od jeho ohlásenia po ďalšie ohlásenie kohokoľvek
function spans(tl, slot) {
  const out = []; let cur = null;
  for (const f of tl) {
    const a = (f.effects || []).find(e => e.kind === "action");
    if (a) { cur = a.from === slot ? { type: a.action.type, dir: a.action.dir, frames: [] } : null; if (cur) out.push(cur); }
    if (cur) cur.frames.push(f);
  }
  return out;
}
const J = JSON.stringify;

/* ---- 1. Minotaur sa stratí v labyrinte ODRAZOM (súper mal golden mirror) - lovec je Fire na jeho bunke ---- */
{
  const sc = scenario("minotaur", "fire", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 10;
    g.players.p2.x = 1; g.players.p2.y = 1; g.players.p2.mana = 10;
  });
  // p2 = non-starter → golden mirror kryje 1. akciu p1 (labyrint) → odrazí sa na Minotaura
  const { raw, p1, p2 } = sc.round([{ type: "special" }, R, S], [{ type: "golden_mirror" }, R, mv("right"), S]);
  check(sc.game.players.p1.labyrinth && !sc.game.players.p2.labyrinth, "mirror: v labyrinte skončil Minotaur (kaster)");
  check(!sc.game.players.p2.mazeBuff && !sc.game.players.p1.mazeBuff, "mirror: maze buff nedostal nikto");
  const sp = spans(p1, "p2");
  const types = sp.map(s => s.type);
  // golden_mirror prebehol ešte pred zakliatím (bežne viditeľný); recharge + move z Minotaurovej bunky odhalené, 3. akcia z (2,1) = „?"
  check(J(types) === J(["golden_mirror", "recharge", "move", "unknown"]), "mirror-obeť: akcie z mojej bunky odhalené, z inej „?\"", J(types));
  const rech = sp[1], move = sp[2], far = sp[3];
  check(rech.frames.every(f => f.p2.x === 1 && f.p2.y === 1 && f.p2.labPeek), "recharge: lovec viditeľný na mojej bunke počas celej akcie");
  check(fx(rech.frames, "recharge").some(e => e.from === "p2"), "recharge: efekt nabíjania odhalený");
  check(!fx(rech.frames, "lab_peek_end").length, "recharge: lovec ostal na mojej bunke → žiadny fade-out (preberie ho ožiarená figúra)");
  check(move.dir === "right", "move: smer v zázname kola odhalený", move.dir);
  check(move.frames.some(f => f.p2.x === 2 && f.p2.y === 1), "move: vidno, kam lovec odišiel");
  const end = fx(move.frames, "lab_peek_end");
  check(end.length === 1 && end[0].owner && !end[0].clone && end[0].target === "p2", "move: po akcii lovec zmizne (lab_peek_end)", J(end));
  check(far.frames.every(f => f.p2.x == null && !f.p2.labPeek), "akcia z inej bunky: lovec ostáva skrytý");
  check(p1.filter(f => f.p2?.labPeek).every(f => f.p2.mana == null), "mana lovca ostáva skrytá aj počas odhalenia");
  check(p1.filter(f => f.p1?.labyrinth && !f.p2?.labPeek).every(f => f.p2.x == null), "mimo odhalenia lovec skrytý");
  // posledný frame odhalenej akcie = pauza za akciou (fade-out tam má čas)
  const lastMove = move.frames.filter(f => f.p2.labPeek).pop();
  check(lastMove && fx([lastMove], "lab_peek_end").length === 1, "fade-out je v poslednom odhalenom frame");
  // lovcov vlastný pohľad a surová timeline: žiadne peek polia, tag act sa neserializuje
  check(!p2.some(f => f.p2?.labPeek || fx([f], "lab_peek_end").length), "lovec (p2) nevidí žiadne peek polia");
  check(!J(raw).includes('"act"'), "neenumerovateľný tag act sa do JSON nedostane");
  check(raw.some(f => f.act), "surové framy tag act nesú");
}

/* ---- 2. Lovec príde na moju bunku z inej (akcia z cudzej bunky) → ostáva „?" ---- */
{
  const sc = scenario("fire", "lightning", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 2; g.players.p2.y = 1; g.players.p2.mana = 5;
  });
  const { p1 } = sc.round(P1Q, [mv("left"), R, { type: "dash", dir: "right" }]);
  const sp = spans(p1, "p2");
  check(J(sp.map(s => s.type)) === J(["unknown", "recharge", "dash"]), "príchod na moju bunku = „?\", ďalšie akcie z mojej bunky odhalené", J(sp.map(s => s.type)));
  check(sp[0].frames.every(f => f.p2.x == null), "príchod: lovec počas akcie skrytý");
  check(sp[0].frames.some(f => (f.p1.hunterHere || []).some(c => c[0] === 1 && c[1] === 1)), "príchod: po vstupe je lovec ožiarený (hunterHere)");
}

/* ---- 3. Naruto-lovec: majiteľ na mojej bunke, klon v tme ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 1; g.players.p2.y = 1; g.players.p2.mana = 10; g.players.p2.clone = { x: 3, y: 0 };
  });
  // útok doľava (majiteľ z (1,1), klon z (3,0) - nikoho netrafí), recharge, pohyb nadol (klon hore → náraz do steny)
  const { p1 } = sc.round(P1Q, [{ type: "attack", dir: "left" }, R, mv("down")]);
  const sp = spans(p1, "p2");
  check(J(sp.map(s => s.type)) === J(["attack", "recharge", "move"]), "Naruto majiteľ: všetky akcie z mojej bunky odhalené", J(sp.map(s => s.type)));
  check(p1.every(f => !f.p2?.clone), "Naruto majiteľ: klon mimo mojej bunky nie je nikdy viditeľný");
  const charges = fx(sp[0].frames, "charge").filter(e => e.from === "p2");
  check(charges.length > 0 && charges.every(e => !e.clone), "Naruto majiteľ: vidno len majiteľovu strelu, klonova je skrytá", J(charges));
  const rc = fx(sp[1].frames, "recharge").find(e => e.from === "p2");
  check(rc && J(rc.cells) === J([[1, 1]]), "Naruto majiteľ: recharge aura len na odhalenej figúre (bunka klona sa neprezradí)", J(rc));
  check(!fx(sp[2].frames, "wall_bump").some(e => e.clone), "Naruto majiteľ: náraz klona do steny sa neprezradí");
  const end = fx(sp[2].frames, "lab_peek_end");
  check(end.length === 1 && end[0].owner && !end[0].clone, "Naruto majiteľ: po odchode zmizne len majiteľ", J(end));
  check(p1.filter(f => f.p1?.labyrinth && !f.p2?.labPeek).every(f => f.p2.x == null && !f.p2.clone), "Naruto majiteľ: mimo odhalenia nič");
}

/* ---- 4. Naruto-lovec: klon na mojej bunke, majiteľ v tme ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.mana = 6; g.players.p2.clone = { x: 1, y: 1 };
  });
  // recharge, útok doľava (klon z (1,1), majiteľ z (3,2)), pohyb hore (majiteľ (3,1), klon (1,2))
  const { p1 } = sc.round(P1Q, [R, { type: "attack", dir: "left" }, mv("up")]);
  const sp = spans(p1, "p2");
  check(J(sp.map(s => s.type)) === J(["recharge", "attack", "move"]), "Naruto klon: akcie súpera odhalené cez klona na mojej bunke", J(sp.map(s => s.type)));
  check(p1.every(f => f.p2 == null || f.p2.x == null), "Naruto klon: majiteľ mimo mojej bunky nie je nikdy viditeľný");
  check(sp[0].frames.every(f => J(f.p2.clone) === J({ x: 1, y: 1 })), "Naruto klon: klon viditeľný na mojej bunke");
  const rc = fx(sp[0].frames, "recharge").find(e => e.from === "p2");
  check(rc && J(rc.cells) === J([[1, 1]]), "Naruto klon: recharge len na klonovi", J(rc));
  const charges = fx(sp[1].frames, "charge").filter(e => e.from === "p2");
  check(charges.length > 0 && charges.every(e => e.clone), "Naruto klon: vidno len klonovu strelu", J(charges));
  check(sp[2].frames.some(f => J(f.p2.clone) === J({ x: 1, y: 2 })), "Naruto klon: vidno, kam klon odišiel");
  const end = fx(sp[2].frames, "lab_peek_end");
  check(end.length === 1 && end[0].clone && !end[0].owner, "Naruto klon: po odchode zmizne klon", J(end));
}

/* ---- 5. Naruto-lovec: klon na mojej bunke, majiteľ v tme recastne special → nový klon sa NEodhalí ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.mana = 10; g.players.p2.clone = { x: 1, y: 1 };
  });
  const { p1 } = sc.round(P1Q, [{ type: "special" }, R, S]);
  const sp = spans(p1, "p2");
  check(sp[0].type === "special", "recast: special odhalený v zázname (klon stál na mojej bunke)", sp[0].type);
  check(fx(sp[0].frames, "clone_die").some(e => e.target === "p2"), "recast: zánik klona na mojej bunke vidno");
  const dieIdx = sp[0].frames.findIndex(f => fx([f], "clone_die").length);
  check(sp[0].frames.slice(dieIdx + 1).every(f => !f.p2.clone && f.p2.x == null), "recast: nový klon pri majiteľovi v tme ostáva skrytý");
  check(!fx(sp[0].frames, "clone_summon").length && !fx(sp[0].frames, "clone_born").length, "recast: summon pri majiteľovi sa neprezradí");
  check(J(sp.slice(1).map(s => s.type)) === J(["unknown", "unknown"]), "recast: ďalšie akcie (z cudzej bunky) = „?\"");
}

/* ---- 6. Naruto-lovec: stacknutý pár na mojej bunke - odhalené obe figúry, obe po odchode zmiznú ---- */
{
  const sc = scenario("fire", "naruto", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 1; g.players.p2.y = 1; g.players.p2.mana = 6; g.players.p2.clone = { x: 1, y: 1 };
  });
  const { p1 } = sc.round(P1Q, [R, { type: "dash", dir: "right" }, S]);
  const sp = spans(p1, "p2");
  check(J(sp.map(s => s.type)) === J(["recharge", "dash", "unknown"]), "pár: akcie z mojej bunky odhalené (vrátane dashu), potom „?\"", J(sp.map(s => s.type)));
  const rc = fx(sp[0].frames, "recharge").find(e => e.from === "p2");
  check(rc && rc.cells.length === 2, "pár: recharge na oboch figúrach", J(rc));
  check(sp[1].frames.some(f => f.p2.x === 3 && J(f.p2.clone) === J({ x: 3, y: 1 })), "pár: vidno dash oboch figúr");
  const end = fx(sp[1].frames, "lab_peek_end");
  check(end.length === 1 && end[0].owner && end[0].clone, "pár: po dashi zmiznú obe figúry", J(end));
  check(sp[2].frames.every(f => f.p2.x == null && !f.p2.clone), "pár: ďalšia akcia skrytá");
}

/* ---- 7. Prekliaty Naruto: lovec na bunke MÔJHO klona (druhá fakľa) → odhalený ---- */
{
  const sc = scenario("naruto", "lightning", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0; g.players.p1.mana = 8; g.players.p1.clone = { x: 2, y: 2 }; curse(g.players.p1);
    g.players.p2.x = 2; g.players.p2.y = 2; g.players.p2.mana = 5;
  });
  const { p1 } = sc.round(P1Q, [R, mv("left"), S]);
  const sp = spans(p1, "p2");
  check(J(sp.map(s => s.type)) === J(["recharge", "move", "unknown"]), "fakľa klona: akcie z bunky môjho klona odhalené", J(sp.map(s => s.type)));
  check(sp[0].frames.every(f => f.p2.x === 2 && f.p2.y === 2), "fakľa klona: lovec viditeľný na bunke môjho klona");
}

/* ---- 8. Zásah z mojej bunky = bežné odhalenie labyrintu (labReveal), nie peek ---- */
{
  const sc = scenario("fire", "lightning", (g) => {
    g.players.p1.x = 1; g.players.p1.y = 1; g.players.p1.mana = 8; curse(g.players.p1);
    g.players.p2.x = 1; g.players.p2.y = 1; g.players.p2.mana = 10;
  });
  const { p1 } = sc.round(P1Q, [{ type: "melee" }, R, S]);
  check(acts(p1, "p2")[0] === "melee", "melee na mojej bunke: akcia viditeľná");
  check(fx(p1, "labyrinth_reveal").length === 1 && fx(p1, "labyrinth_end").length === 1, "melee: labyrint sa odhalí a skončí ako doteraz");
  check(!sc.game.players.p1.labyrinth, "melee: po zásahu už nie je v labyrinte");
}

console.log(failures ? `\n${failures} LABYRINT PEEK TESTOV ZLYHALO` : "\nLABYRINT PEEK TESTY PREŠLI");
process.exit(failures ? 1 : 0);
