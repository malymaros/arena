// test/portals.mjs - Portal Realm (docs/PORTAL_PLAN.md, sekcia 5): čistá geometria portálov + cielené scenáre
// priamo nad enginom (bez servera). Portály sa v setup-e kladú ručne (game.portals), odohrá sa jedno kolo a
// kontrolujú sa framy timeline aj výsledný stav.
// Spustenie: node test/portals.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";
import * as G from "../shared/geometry.js";
import { MOVE_DELAY_MS, CHARGE_STEP_MS, PORTAL_SHOT_STEP_MS, portalWalkMs } from "../shared/timing.js";

let failures = 0, passes = 0;
function check(cond, label, detail = "") {
  if (cond) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;
const B = { w: 4, h: 3 };
const P = (id, type, a, b) => ({ id, type, ends: [{ x: a[0], y: a[1], side: a[2] }, { x: b[0], y: b[1], side: b[2] }] });

const CFG = { format: "single", tilesPerRound: 1, timer: "off", tilePreview: false, colorPref: "white", arena: "portal",
  tileWeights: { dmg: 90, heal: 0, mana: 0, ik: 10, power: 0, block: 0 },
  portalWeights: { classic: 40, hp: 15, mana: 15, power: 15, nodef: 15 }, portalsPerRound: 1 };
const R = { type: "recharge" }, S = { type: "shield" }, PASS = { type: "pass" };
const PASS3 = [PASS, PASS, PASS];
const mv = (dir) => ({ type: "move", dir }), dash = (dir) => ({ type: "dash", dir }), atk = (dir) => ({ type: "attack", dir });
const sp = (dir) => ({ type: "special", dir });

// nový zápas v portal realm: osoba A = p1 (biely, začína kolo 1), setup(game) upraví stav pred kolom
function scenario(c1, c2, setup, cfg = CFG) {
  const timelines = [], emits = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); }, emit: (ev, p) => emits.push([ev, p]) });
  e.startMatch(e.sanitizeConfig(cfg));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", c2);
  e.game.portals = [];
  setup?.(e.game);
  return {
    e, emits,
    get game() { return e.game; },
    round(q1, q2) {
      const n = timelines.length;
      e.lockIn("A", q1, e.game.turn, (r) => { if (!r?.ok) throw new Error("p1 lock_in odmietnutý " + J(q1)); });
      e.lockIn("B", q2, e.game.turn, (r) => { if (!r?.ok) throw new Error("p2 lock_in odmietnutý " + J(q2)); });
      return timelines.slice(n).flat();
    },
    more() { return timelines.flat(); },
    last() { return timelines[timelines.length - 1] || []; },
  };
}
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));
const idx = (tl, pred) => tl.findIndex(f => (f.effects || []).some(pred));
const hasEnds = (g, pair) => g.portals.some(p => J(p.ends) === J(pair.ends));
const closedIds = (tl) => fx(tl, "portal_close").flatMap(e => e.ids);

/* ==================== Geometria ==================== */
console.log("Geometria");
{
  const edges = G.boardEdges(B);
  check(edges.length === 14 && new Set(edges.map(e => `${e.x},${e.y},${e.side}`)).size === 14, "G1: 14 unikátnych vonkajších hrán");
  check(G.portalStep(B, [], 1, 1, "up")?.x === 1 && G.portalStep(B, [], 1, 1, "up")?.y === 0, "G2: krok na doske bez zmeny");
  check(G.portalStep(B, [], 0, 1, "left") === null && G.portalStep(B, null, 0, 1, "left") === null, "G2: hrana bez portálu = stena");
  // všetky usporiadané dvojice koncov: prechod pristane na druhom konci smerom dovnútra
  let ok = true, bad = "";
  for (const a of edges) for (const b of edges) {
    if (a === b) continue;
    const st = G.portalStep(B, [P("A", "classic", [a.x, a.y, a.side], [b.x, b.y, b.side])], a.x, a.y, a.side);
    if (!st || st.x !== b.x || st.y !== b.y || st.dir !== G.OPP_DIR[b.side] || st.portal.id !== "A") { ok = false; bad = J([a, b, st]); }
    // aj opačným smerom (vstup druhým koncom)
    const st2 = G.portalStep(B, [P("A", "classic", [a.x, a.y, a.side], [b.x, b.y, b.side])], b.x, b.y, b.side);
    if (!st2 || st2.x !== a.x || st2.y !== a.y || st2.dir !== G.OPP_DIR[a.side]) { ok = false; bad = J([a, b, st2]); }
  }
  check(ok, "G3: 14×13 dvojíc koncov - výstup na druhom konci, smer dovnútra (oboma smermi)", bad);
  const corner = [P("A", "classic", [0, 0, "up"], [0, 0, "left"])];
  const c = G.portalStep(B, corner, 0, 0, "up");
  check(c && c.x === 0 && c.y === 0 && c.dir === "right", "G4: rohový pár - výstup na tom istom políčku, otočený", J(c));
  check(G.portalStep(B, corner, 0, 0, "up", new Set(["A"])) === null, "G5: zatvorený pár = stena");
  // runPathPortals bez portálov == runPath (všetky bunky × smery × pozície súpera)
  let same = true;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) for (const dir of ["up", "down", "left", "right"])
    for (const foe of [null, { x: 3, y: 1 }, { x: 1, y: 1, clone: { x: 2, y: 1 } }]) {
      const a = G.runPath(B, x, y, G.DIR4[dir], foe), b = G.runPathPortals(B, x, y, dir, foe, null);
      if (J(a.path) !== J(b.path) || a.target !== b.target || b.passes.length) same = false;
    }
  check(same, "G6: runPathPortals bez portálov = runPath");
  // escanor / luffy bez portálov = pôvodné správanie
  let esc = true;
  for (let x = 0; x < 4; x++) for (let y = 0; y < 3; y++) for (const pride of [0, 1, 2, 3]) for (const dir of ["left", "right"])
    if (J(G.escanorCells(B, { x, y, pride }, dir)) !== J(G.escanorCells(B, { x, y, pride }, dir, []))) esc = false;
  check(esc, "G7: escanorCells s prázdnymi portálmi = bez portálov");
  const ep = [P("A", "classic", [3, 1, "right"], [0, 1, "left"])];
  const anc = G.escanorAnchor(B, { x: 3, y: 1 }, "right", ep);
  check(anc && anc.x === 0 && anc.y === 1 && anc.portal?.id === "A", "G8: Escanor - F cez portál na druhom konci", J(anc));
  const z2 = G.escanorCells(B, { x: 3, y: 1, pride: 2 }, "right", ep);
  check(z2.length === 6 && z2.every(([x]) => x <= 1), "G8: pride 2 cez portál = 2 krajné stĺpce, bez pretočenia", J(z2));
  check(G.escanorCells(B, { x: 3, y: 1, pride: 3 }, "right", ep).length === 12, "G8: pride 3 cez portál = celá doska");
  check(G.escanorCells(B, { x: 3, y: 1, pride: 3 }, "right", []).length === 0, "G8: hod mimo dosky bez portálu = prázdna zóna");
  const lb = G.luffyBallLanding(B, { x: 0, y: 1 }, "left", [P("B", "hp", [0, 1, "left"], [2, 0, "up"])]);
  check(lb && lb.x === 2 && lb.y === 0 && lb.portal?.type === "hp", "G9: Luffy guľa cez portál", J(lb));
  check(G.luffyBallLanding(B, { x: 0, y: 1 }, "left") === null, "G9: guľa z kraja bez portálu = null");
  const sp3 = G.shotPathPortals(B, [P("A", "classic", [0, 0, "up"], [3, 2, "right"])], 0, 1, "up", 3);
  check(J(sp3.map(s => [s.x, s.y])) === "[[0,0],[3,2],[2,2]]" && sp3[1].portal?.id === "A", "G10: strela cez portál, dolet 3", J(sp3));
  // simulateQueue: pohyb cez portál, druhý vstup do toho istého páru = stena (pár sa po použití zatvorí)
  const sq = G.simulateQueue(B, { x: 0, y: 1, char: "fire" }, [mv("left"), dash("right"), R], null, {}, [P("A", "classic", [0, 1, "left"], [3, 1, "right"])]);
  check(J(sq.map(s => [s.x, s.y])) === "[[0,1],[3,1],[3,1],[3,1]]", "G11: ghost - cez portál, potom zatvorený = stena", J(sq.map(s => [s.x, s.y])));
  // simulateQueue bez portálov: náhodné fronty dávajú rovnaký výsledok s null aj []
  let simOk = true;
  const acts = [mv("up"), mv("down"), mv("left"), mv("right"), dash("up"), dash("left"), dash("right"), R];
  for (let i = 0; i < 300; i++) {
    const q = [acts[i % 8], acts[(i * 3) % 8], acts[(i * 5 + 1) % 8]];
    const st = { x: i % 4, y: i % 3, char: i % 2 ? "countess" : "fire" };
    if (J(G.simulateQueue(B, st, q, { x: 2, y: 1 }, { countess: 1 })) !== J(G.simulateQueue(B, st, q, { x: 2, y: 1 }, { countess: 1 }, []))) simOk = false;
  }
  check(simOk, "G12: simulateQueue bez portálov ([] = null)");
  const cl = G.simulateClone(B, { x: 1, y: 2 }, [mv("up")], [P("A", "classic", [1, 2, "down"], [3, 0, "up"])]);
  check(cl.x === 3 && cl.y === 0, "G13: klon (vertikálne inverzne) cez portál", J(cl));
}

/* ==================== Pohyb a telo ==================== */
console.log("Pohyb");
{
  const A = P("A", "classic", [0, 1, "left"], [2, 0, "up"]);
  const sc = scenario("fire", "fire", (g) => { g.portals = [A]; });
  const tl = sc.round([mv("left"), R, S], PASS3);
  check(sc.game.players.p1.x === 2 && sc.game.players.p1.y === 0, "M1: move cez portál → výstupné políčko", J([sc.game.players.p1.x, sc.game.players.p1.y]));
  const w = fx(tl, "portal_walk")[0];
  check(w && w.from === "p1" && J(w.path) === "[[2,0]]" && w.passes[0].id === "A", "M1: efekt portal_walk s dráhou", J(w));
  check(closedIds(tl).includes("A") && !hasEnds(sc.game, A), "M1: pár sa po prechode zatvoril");
}
{
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 0; g.players.p1.y = 0; g.portals = [A]; });
  const tl = sc.round([mv("up"), R, S], PASS3);
  check(sc.game.players.p1.x === 0 && sc.game.players.p1.y === 0 && fx(tl, "portal_walk").length === 1 && !hasEnds(sc.game, A),
    "M2: rohový pár - ostane na mieste, prechod sa prehrá, pár zanikne");
}
{
  const A = P("A", "classic", [0, 2, "left"], [3, 2, "down"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 0; g.players.p1.y = 2; g.players.p2.x = 3; g.players.p2.y = 0; g.portals = [A]; });
  sc.round([dash("left"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 3 && p.y === 1 && p.mana === 6 - 4 + 4 - 2, "M3: dash - krok 1 cez portál, krok 2 dovnútra (3,1), mana −4", J([p.x, p.y, p.mana]));
}
{
  const A = P("A", "classic", [0, 1, "left"], [3, 1, "right"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p2.x = 1; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([mv("left"), dash("right"), S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 3 && p.y === 1 && fx(tl, "wall_bump").some(e => e.from === "p1") && p.mana === 6 - 4 - 2,
    "M4: druhý vstup do použitého páru = stena (wall_bump, mana sa minie)", J([p.x, p.y, p.mana]));
}
{
  // súper spáli portál skôr v kole → môj pohyb do tej hrany je wall_bump
  const A = P("A", "classic", [0, 1, "left"], [3, 0, "up"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p2.x = 0; g.players.p2.y = 1; g.portals = [A]; });
  const tl = sc.round([S, mv("left"), R], [mv("left"), PASS, PASS]);
  check(sc.game.players.p2.x === 3 && sc.game.players.p2.y === 0, "M5: súper prešiel portálom prvý");
  check(sc.game.players.p1.x === 0 && fx(tl, "wall_bump").some(e => e.from === "p1"), "M5: môj pohyb do zavretej hrany = wall_bump");
}
for (const [label, char, hp, mana, type, expHp, expMana] of [
  ["HP portál +1", "fire", 5, 6, "hp", 6, 6],
  ["HP portál pri plnom HP - bez zmeny", "fire", 10, 6, "hp", 10, 6],
  ["HP portál Lightning → plné HP", "lightning", 3, 6, "hp", 10, 6],
  ["mana portál → max", "fire", 10, 2, "mana", 10, 10],
  ["telo cez powerup portál - bez efektu", "fire", 5, 2, "power", 5, 2],
  ["telo cez Def-breaker portál - bez efektu", "fire", 5, 2, "nodef", 5, 2],
]) {
  const A = P("A", type, [0, 1, "left"], [2, 0, "up"]);
  const sc = scenario(char, "fire", (g) => { g.players.p1.hp = hp; g.players.p1.mana = mana; g.portals = [A]; });
  const tl = sc.round([mv("left"), S, { type: "melee" }], PASS3);
  // mana po kole: S (−2) a melee (−4, ak je mana) - porovnávame stav hneď po pohybe z frame-u zatvorenia
  const fi = idx(tl, e => e.kind === "portal_close");
  const st = tl[fi]?.p1;
  check(st && st.hp === expHp && st.mana === expMana && !hasEnds(sc.game, A), `M6: ${label}`, J(st && [st.hp, st.mana]));
}
{
  // Naruto + klon na spoločnom políčku prejdú tým istým portálom spolu, pár sa zatvorí po oboch
  const A = P("A", "classic", [3, 1, "right"], [0, 2, "left"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; p.clone = { x: 3, y: 1 }; g.players.p2.x = 1; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([mv("right"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 0 && p.y === 2 && p.clone?.x === 0 && p.clone?.y === 2, "N1: majiteľ aj klon cez ten istý portál", J([p.x, p.y, p.clone]));
  check(fx(tl, "portal_walk").length === 2 && closedIds(tl).filter(i => i === "A").length === 1, "N1: dva prechody, pár zatvorený raz");
}
{
  // opačné konce toho istého páru - vymenia si strany
  const A = P("A", "classic", [1, 0, "up"], [1, 2, "down"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 1; p.y = 0; p.clone = { x: 1, y: 2 }; g.portals = [A]; });
  sc.round([mv("up"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 1 && p.y === 2 && p.clone?.x === 1 && p.clone?.y === 0, "N2: opačné konce páru - majiteľ a klon si vymenia strany", J([p.x, p.y, p.clone]));
}
{
  // každý iným portálom iného typu: majiteľ HP, klon mana (klon bonus nedostane, portál spáli)
  const A = P("A", "hp", [0, 0, "up"], [3, 1, "right"]);
  const Bp = P("B", "mana", [0, 2, "down"], [2, 0, "up"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; p.clone = { x: 0, y: 2 }; p.hp = 5; p.mana = 3; g.players.p2.x = 3; g.players.p2.y = 0; g.portals = [A, Bp]; });
  const tl = sc.round([mv("up"), R, S], PASS3);
  const fi = idx(tl, e => e.kind === "portal_close");
  const st = tl[fi]?.p1;
  check(st && st.x === 3 && st.y === 1 && st.clone?.x === 2 && st.clone?.y === 0, "N3: majiteľ aj klon - každý svojím portálom", J(st && [st.x, st.y, st.clone]));
  check(st && st.hp === 6 && st.mana === 3, "N3: HP portál majiteľovi +1, mana portál klona nič nedá", J(st && [st.hp, st.mana]));
  check(J(closedIds(tl).sort()) === '["A","B"]', "N3: oba páry zatvorené", J(closedIds(tl)));
}
{
  // vertikálna inverzia: majiteľ narazí do steny, klon prejde portálom
  const A = P("A", "classic", [1, 2, "down"], [3, 0, "up"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 1; p.y = 0; p.clone = { x: 1, y: 2 }; g.portals = [A]; });
  const tl = sc.round([mv("up"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 1 && p.y === 0 && p.clone?.x === 3 && p.clone?.y === 0 && fx(tl, "wall_bump").some(e => e.from === "p1" && !e.clone),
    "N4: majiteľ wall_bump, klon (inverzne) cez portál", J([p.x, p.y, p.clone]));
}

/* ==================== Strely ==================== */
console.log("Strely");
{
  const A = P("A", "classic", [0, 0, "up"], [3, 2, "right"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p2.x = 2; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([atk("up"), R, S], PASS3);
  check(sc.game.players.p2.hp === 9, "S1: strela cez portál - vzdialenosť 3 → 1 dmg", String(sc.game.players.p2.hp));
  const ch = fx(tl, "charge").filter(e => e.from === "p1");
  check(J(ch.map(c => c.cell)) === "[[0,0],[3,2],[2,2]]" && ch[1].portal?.id === "A" && ch[1].dir === "left", "S1: let so zmenou smeru", J(ch));
  check(!hasEnds(sc.game, A) && idx(tl, e => e.kind === "portal_close") < idx(tl, e => e.kind === "hit"), "S1: portál zavretý hneď po prelete (pred zásahom)");
}
{
  const A = P("A", "classic", [3, 0, "right"], [0, 2, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 0; g.players.p1.y = 0; g.players.p2.x = 1; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  check(hasEnds(sc.game, A) && !fx(tl, "portal_close").length && fx(tl, "charge").filter(e => e.from === "p1").length === 3,
    "S2: dolet minutý na 3. políčku - do portálu nevojde, portál ostane");
}
{
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 0; g.players.p1.y = 0; g.portals = [A]; });
  const tl = sc.round([atk("up"), R, S], PASS3);
  const h = fx(tl, "hit").find(e => e.target === "p1");
  check(h && h.dmg === 3 && h.self, "S3: rohový pár - strelec sa trafí za 3", J(h));
}
{
  // strela cez portál sa vráti na políčko, kde stojí strelec AJ súper → dmg obom, 1. hráč kola prvý
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const both = (g) => { g.players.p1.x = 0; g.players.p1.y = 0; g.players.p2.x = 0; g.players.p2.y = 0; g.portals = [A]; };
  const sc = scenario("fire", "fire", both);
  const tl = sc.round([atk("up"), R, S], PASS3);
  const hits = fx(tl, "hit");
  check(sc.game.players.p1.hp === 7 && sc.game.players.p2.hp === 7 && hits[0]?.target === "p1" && hits[1]?.target === "p2",
    "S3b: spoločné políčko - strela cez portál zasiahne oboch (3+3), najprv 1. hráča kola", J(hits));
  // obaja na 3 HP: strelec je 1. v kole → padne on, súper prežije (žiadna remíza)
  const d1 = scenario("fire", "fire", (g) => { both(g); g.players.p1.hp = 3; g.players.p2.hp = 3; });
  d1.round([atk("up"), R, S], PASS3);
  check(d1.game.players.p1.hp === 0 && d1.game.players.p2.hp === 3, "S3c: smrteľné pre oboch - padne strelec (1. v kole), súper bez zásahu",
    J([d1.game.players.p1.hp, d1.game.players.p2.hp]));
  // strieľa 2. hráč kola → najprv dostane 1. hráč (súper strelca) a padne, strelec prežije
  const d2 = scenario("fire", "fire", (g) => { both(g); g.players.p1.hp = 3; g.players.p2.hp = 3; });
  d2.round([R, PASS, PASS], [atk("up"), R, S]);
  check(d2.game.players.p1.hp === 0 && d2.game.players.p2.hp === 3, "S3d: strieľa 2. hráč kola - padne 1. hráč (súper), strelec bez zásahu",
    J([d2.game.players.p1.hp, d2.game.players.p2.hp]));
}
{
  const A = P("A", "classic", [3, 1, "right"], [3, 0, "up"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 3; g.players.p1.y = 1; g.players.p2.x = 0; g.players.p2.y = 2; g.portals = [A]; });
  sc.round([atk("right"), R, S], PASS3);
  check(sc.game.players.p1.hp === 8, "S4: horizontálna strela cez portál trafí strelca (vzdialenosť 2 → 2 dmg)", String(sc.game.players.p1.hp));
}
{
  const A = P("A", "classic", [3, 1, "right"], [3, 0, "up"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; p.clone = { x: 3, y: 0 }; g.players.p2.x = 0; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  check(!sc.game.players.p1.clone && fx(tl, "clone_die").some(e => e.target === "p1") && sc.game.players.p1.hp === 10,
    "S5: strela cez portál zasiahne vlastného klona - rozplynie sa, strelec bez dmg");
}
{
  const A = P("A", "power", [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 2; g.players.p1.y = 1; g.players.p2.x = 1; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  const h = fx(tl, "hit").find(e => e.target === "p2");
  check(h && h.dmg === 3 && h.portalBonus === 2, "S6: powerup portál - 1 + 2 = 3 dmg, rozpis portalBonus", J(h));
  check(fx(tl, "charge").some(e => e.aura?.power === 2), "S6: strela nesie zlatú auru po prelete");
}
for (const [label, setup, what, gold] of [
  ["štít", (p) => { p.shield = true; }, "shield", false],
  ["zrkadlo", (p) => { p.mirror = true; }, "mirror", false],
  ["golden štít", (p) => { p.shield = true; p.shieldGold = true; }, "shield", true],
  ["golden zrkadlo", (p) => { p.mirror = true; p.mirrorGold = true; }, "mirror", true],
]) {
  const A = P("A", "nodef", [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 2; g.players.p1.y = 1; g.players.p2.x = 1; g.players.p2.y = 0; setup(g.players.p2); g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  const d = fx(tl, "dispel").find(e => e.target === "p2");
  check(d && d.what === what && d.gold === gold, `S7: Def-breaker vs ${label} - dispel`, J(d));
  check(sc.game.players.p2.hp === 9 && sc.game.players.p1.hp === 10 && !fx(tl, "mirror").length && !fx(tl, "block").length,
    `S7: Def-breaker vs ${label} - dmg dopadne, žiadny blok/odraz`, J([sc.game.players.p1.hp, sc.game.players.p2.hp]));
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 2; g.players.p1.y = 1; g.players.p2.x = 1; g.players.p2.y = 0; g.players.p2.mirror = true; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  const beam = fx(tl, "mirror").find(e => e.target === "p2");
  check(beam && beam.void && beam.void.x === 0 && beam.void.y === 0 && beam.void.side === "left", "S8: zrkadlo vs strela cez portál - lúč do steny", J(beam));
  check(fx(tl, "reflect_void").length === 1 && sc.game.players.p1.hp === 10 && sc.game.players.p2.hp === 10, "S8: nikto dmg nedostal");
  check(!sc.game.players.p2.mirror, "S8: zrkadlo sa minulo");
}
{
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 0; g.players.p1.y = 0; g.players.p2.x = 1; g.players.p2.y = 0; g.players.p2.mirror = true; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  check(sc.game.players.p1.hp === 7 && !fx(tl, "reflect_void").length, "S9: zrkadlo bez portálu - normálny odraz (regresia)", String(sc.game.players.p1.hp));
}
for (const type of ["hp", "mana"]) {
  const A = P("A", type, [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { g.players.p1.x = 2; g.players.p1.y = 1; g.players.p1.hp = 5; g.players.p1.mana = 3; g.players.p2.x = 1; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([atk("right"), PASS, PASS], PASS3);
  check(!hasEnds(sc.game, A) && !fx(tl, "heal").length && !fx(tl, "recharge").length && sc.game.players.p1.hp === 5,
    `S10: strela cez ${type} portál - len ho spáli`);
}
{
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; p.pride = 1; g.players.p2.x = 3; g.players.p2.y = 2; g.portals = [A]; });
  sc.round([atk("up"), R, mv("down")], PASS3);
  check(sc.game.players.p1.pride === 0, "S11: zásah sám sebou - Escanor stráca pride", String(sc.game.players.p1.pride));
}
{
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("fire", "minotaur", (g) => {
    const p = g.players.p1; p.x = 0; p.y = 0; p.labyrinth = true; p.thread = [[0, 0]];
    g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.mazeBuff = true; g.portals = [A];
  });
  const tl = sc.round([atk("up"), R, S], PASS3);
  check(sc.game.players.p1.labyrinth && !fx(tl, "labyrinth_end").length && sc.game.players.p1.hp === 7, "S12: zásah sám sebou labyrint NEukončí");
}
{
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; p.hp = 2; g.players.p2.x = 3; g.players.p2.y = 2; g.portals = [A]; });
  sc.round([atk("up"), R, S], PASS3);
  const gr = sc.emits.find(([ev]) => ev === "game_result")?.[1];
  check(sc.game.players.p1.hp === 0 && gr?.gameWinner === "p2", "S13: hráč zabije sám seba - vyhráva súper", J(gr));
}
{
  // Last Stand: 2× výstupný (3 → 6) a ½ prijatý (6 → 3)
  const A = P("A", "classic", [0, 0, "up"], [0, 0, "left"]);
  const sc = scenario("fire", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; p.lastStandBuff = true; g.players.p2.x = 3; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([atk("up"), R, S], PASS3);
  check(fx(tl, "hit").find(e => e.target === "p1" && e.self)?.dmg === 3, "S14: zásah sám sebou s Last Stand - ×2 a ½", J(fx(tl, "hit")));
}
{
  // stacknutý Naruto + klon strieľajú cez ten istý portál - obe strely prejdú, jeden spoločný zásah
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; p.clone = { x: 3, y: 1 }; g.players.p2.x = 1; g.players.p2.y = 1; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  check(sc.game.players.p2.hp === 6 && fx(tl, "charge").filter(e => e.portal?.id === "A").length === 2 && closedIds(tl).filter(i => i === "A").length === 1,
    "S15: dve strely cez ten istý portál naraz - 2+2, pár zatvorený raz", J([sc.game.players.p2.hp, closedIds(tl)]));
}
{
  // klonova strela cez portál dostane auru (powerup) rovnako ako majiteľova
  const A = P("A", "power", [3, 2, "right"], [0, 0, "left"]);
  const sc = scenario("naruto", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 0; p.clone = { x: 3, y: 2 }; g.players.p2.x = 1; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  const h = fx(tl, "hit").find(e => e.target === "p2");
  check(h && h.dmg === 4, "S16: klonova strela cez powerup portál - 2 + 2", J(h));
}
{
  // pre-scan: zásah prekliateho cez portál odhalí labyrint PRED letom
  const A = P("A", "classic", [0, 0, "up"], [3, 2, "right"]);
  const sc = scenario("fire", "fire", (g) => {
    const p2 = g.players.p2; p2.x = 2; p2.y = 2; p2.labyrinth = true; p2.thread = [[2, 2]];
    g.portals = [A];
  });
  const tl = sc.round([atk("up"), R, S], PASS3);
  const ri = idx(tl, e => e.kind === "labyrinth_reveal"), ci = idx(tl, e => e.kind === "charge");
  check(ri >= 0 && ri < ci && sc.game.players.p2.labyrinth === false, "S17: zásah cez portál odhalí labyrint pred letom", J([ri, ci]));
}
{
  // strela zastavená klonom-návnadou (bez obrany) letí ďalej ako dym a portál ešte spáli
  const A = P("A", "classic", [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("fire", "naruto", (g) => { g.players.p1.x = 1; g.players.p1.y = 1; const p2 = g.players.p2; p2.x = 2; p2.y = 2; p2.clone = { x: 2, y: 1 }; g.portals = [A]; });
  const tl = sc.round([atk("right"), R, S], PASS3);
  check(!sc.game.players.p2.clone && sc.game.players.p2.hp === 10, "S18: návnada zožerie strelu");
  check(closedIds(tl).includes("A") && !hasEnds(sc.game, A), "S18: dym letí ďalej a portál ešte spáli");
}

/* ==================== Charge, Escanor, Luffy ==================== */
console.log("Charge / Escanor / Luffy");
{
  const A = P("A", "power", [3, 1, "right"], [0, 0, "left"]);
  const Bp = P("B", "power", [3, 0, "right"], [0, 2, "left"]);
  const sc = scenario("werewolf", "fire", (g) => { g.players.p2.x = 1; g.players.p2.y = 2; g.portals = [A, Bp]; });
  const tl = sc.round([sp("right"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 1 && p.y === 2 && sc.game.players.p2.hp === 8, "C1: vlkolak cez 2 powerup portály - powerup sa na charge nevzťahuje, len moon 2", J([p.x, p.y, sc.game.players.p2.hp]));
  check(J(closedIds(tl).sort()) === '["A","B"]', "C1: oba páry zatvorené");
  // strop rýchlosti: 9 buniek + 2 prechody → frame dlhší než bridge charge (max 3 bunky za MOVE_DELAY_MS)
  const run = tl.find(fr => (fr.effects || []).some(e => e.kind === "wolf_charge"));
  const pw = run.effects.find(e => e.kind === "portal_walk");
  check(pw.path.length >= 8 && run.delayMs === portalWalkMs(pw.path.length, 2) && run.delayMs >= pw.path.length * MOVE_DELAY_MS / 3,
    "TM1: dlhý charge cez portály trvá dlhšie (max rýchlosť = bridge)", J([pw.path.length, run.delayMs]));
}
{
  // krátky pohyb cez portál = rovnaká dĺžka ako na bridge; charge bez portálu = MOVE_DELAY_MS
  const A = P("A", "classic", [0, 1, "left"], [3, 0, "right"]);
  const sc = scenario("fire", "fire", (g) => { g.portals = [A]; });
  const tl = sc.round([mv("left"), R, S], PASS3);
  const fr = tl.find(f2 => (f2.effects || []).some(e => e.kind === "portal_walk"));
  check(fr && fr.delayMs === MOVE_DELAY_MS, "TM2: move cez portál (1 bunka) trvá ako na bridge", J(fr?.delayMs));
  const sc2 = scenario("countess", "fire", (g) => { g.players.p2.x = 3; g.players.p2.y = 1; });
  const tl2 = sc2.round([dash("right"), R, S], PASS3);
  const fr2 = tl2.find(f2 => (f2.effects || []).some(e => e.kind === "vamp_charge"));
  check(fr2 && fr2.delayMs === MOVE_DELAY_MS, "TM2: charge bez portálu = MOVE_DELAY_MS", J(fr2?.delayMs));
}
{
  // krok strely s prechodom portálom má dlhší frame, ostatné kroky normálne
  const A = P("A", "classic", [0, 1, "left"], [3, 0, "right"]);
  const sc = scenario("fire", "fire", (g) => { g.portals = [A]; g.players.p2.x = 2; g.players.p2.y = 0; });
  const tl = sc.round([atk("left"), R, S], PASS3);
  const steps = tl.filter(f2 => (f2.effects || []).some(e => e.kind === "charge"));
  const withP = steps.filter(f2 => f2.effects.some(e => e.kind === "charge" && e.portal));
  check(withP.length === 1 && withP[0].delayMs === PORTAL_SHOT_STEP_MS && steps.filter(f2 => !withP.includes(f2)).every(f2 => f2.delayMs === CHARGE_STEP_MS),
    "TM3: krok strely cez portál = PORTAL_SHOT_STEP_MS, ostatné CHARGE_STEP_MS", J(steps.map(f2 => f2.delayMs)));
}
{
  const A = P("A", "classic", [1, 0, "up"], [3, 2, "down"]);
  const sc = scenario("werewolf", "fire", (g) => { g.players.p2.x = 3; g.players.p2.y = 2; g.portals = [A]; });
  sc.round([sp("up_right"), R, S], PASS3);
  check(sc.game.players.p1.x === 1 && sc.game.players.p1.y === 0 && hasEnds(sc.game, A), "C2: diagonálny charge portály ignoruje");
}
{
  // Vampír: charge cez HP aj mana portál - telo dostane oboje, úder 4 + heal bonus
  const A = P("A", "hp", [0, 1, "left"], [3, 0, "right"]);
  const Bp = P("B", "mana", [0, 0, "left"], [3, 2, "right"]);
  const sc = scenario("countess", "fire", (g) => { const p = g.players.p1; p.hp = 5; p.mana = 5; g.players.p2.x = 2; g.players.p2.y = 2; g.portals = [A, Bp]; });
  const tl = sc.round([dash("left"), PASS, PASS], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 2 && p.y === 2 && sc.game.players.p2.hp === 6, "C3: charge cez 2 portály zastane na súperovi, úder 4", J([p.x, p.y, sc.game.players.p2.hp]));
  check(fx(tl, "heal").some(e => e.target === "p1" && e.portal) && fx(tl, "recharge").some(e => e.from === "p1" && e.portal), "C3: telo dostalo HP aj manu");
  check(fx(tl, "heal").some(e => e.target === "p1" && !e.portal), "C3: heal bonus po zásahu");
}
{
  const A = P("A", "nodef", [0, 1, "left"], [3, 0, "right"]);
  const sc = scenario("countess", "fire", (g) => { const p = g.players.p1; p.hp = 5; g.players.p2.x = 1; g.players.p2.y = 0; g.players.p2.shield = true; g.portals = [A]; });
  const tl = sc.round([dash("left"), PASS, PASS], PASS3);
  check(!fx(tl, "dispel").length && fx(tl, "block").length === 1 && sc.game.players.p2.hp === 10 && !fx(tl, "heal").some(e => e.target === "p1" && !e.portal) && !hasEnds(sc.game, A),
    "C4: charge cez Def-breaker - Def-breaker sa na beh nevzťahuje, štít blokuje, portál sa spáli");
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 0, "left"]);
  const sc = scenario("werewolf", "fire", (g) => { const p = g.players.p1; p.x = 2; p.y = 1; g.players.p2.x = 2; g.players.p2.y = 0; g.players.p2.mirror = true; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, S], PASS3);
  check(!fx(tl, "reflect_void").length && fx(tl, "hit").some(e => e.target === "p1"), "C5: zrkadlo vs charge cez portál - odraz trafí útočníka priamo");
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("werewolf", "fire", (g) => { g.players.p2.x = 2; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, S], PASS3);
  const w = fx(tl, "portal_walk")[0];
  check(sc.game.players.p1.x === 3 && sc.game.players.p1.y === 1 && w?.path.length === 7, "C6: charge sa nezacyklí - ten istý pár druhýkrát = stena", J(w?.path));
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; p.pride = 2; g.players.p2.x = 0; g.players.p2.y = 0; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, mv("down")], PASS3);
  const s = fx(tl, "special").find(e => e.from === "p1");
  check(s?.portal?.id === "A" && s.cells.length === 6 && sc.game.players.p2.hp === 2, "X1: Escanor slnko cez portál - zóna na výstupe, 8 dmg", J(s));
  check(!hasEnds(sc.game, A), "X1: portál sa zatvoril");
}
{
  const A = P("A", "classic", [0, 0, "left"], [0, 0, "up"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; p.pride = 2; g.players.p2.x = 1; g.players.p2.y = 1; g.portals = [A]; });
  sc.round([sp("left"), R, mv("down")], PASS3);
  check(sc.game.players.p1.hp === 10 && sc.game.players.p2.hp === 2, "X2: rohový pár - F je Escanorovo políčko, jeho nezasiahne");
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; g.players.p2.x = 0; g.players.p2.y = 1; g.players.p2.mirror = true; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, mv("down")], PASS3);
  check(fx(tl, "reflect_void").length === 1 && sc.game.players.p1.hp === 10 && sc.game.players.p2.hp === 10, "X3: zrkadlo vs slnko cez portál - odraz do steny");
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; p.pride = 3; g.players.p2.x = 3; g.players.p2.y = 2; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, mv("down")], PASS3);
  check(fx(tl, "special").find(e => e.from === "p1")?.cells.length === 12 && sc.game.players.p2.hp === 2, "X4: pride 3 cez portál = celá doska");
}
{
  const A = P("A", "classic", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 2; p.y = 1; g.players.p2.x = 3; g.players.p2.y = 1; g.portals = [A]; });
  sc.round([sp("right"), R, mv("down")], PASS3);
  check(hasEnds(sc.game, A) && sc.game.players.p2.hp === 2, "X5: F na doske - portál sa nepoužije");
}
{
  const A = P("A", "power", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; g.players.p2.x = 0; g.players.p2.y = 1; g.portals = [A]; });
  sc.round([sp("right"), R, mv("down")], PASS3);
  check(sc.game.players.p2.hp === 0, "X6: slnko cez powerup portál - 8 + 2 = 10", String(sc.game.players.p2.hp));
}
{
  const A = P("A", "nodef", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("escanor", "fire", (g) => { const p = g.players.p1; p.x = 3; p.y = 1; g.players.p2.x = 0; g.players.p2.y = 1; g.players.p2.shield = true; g.portals = [A]; });
  const tl = sc.round([sp("right"), R, mv("down")], PASS3);
  check(!fx(tl, "dispel").length && fx(tl, "block").length === 1 && sc.game.players.p2.hp === 10, "X7: slnko cez Def-breaker - bez efektu, štít blokuje");
}
{
  const A = P("A", "hp", [0, 1, "left"], [2, 0, "up"]);
  const sc = scenario("luffy", "fire", (g) => { g.players.p1.hp = 5; g.players.p2.x = 3; g.players.p2.y = 1; g.portals = [A]; });
  const tl = sc.round([sp("left"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(p.x === 2 && p.y === 0 && p.worldUsed, "L1: guľa cez portál - dopad na druhom konci", J([p.x, p.y]));
  check(fx(tl, "heal").some(e => e.target === "p1" && e.portal) && sc.game.players.p2.hp === 2, "L1: telo +1 HP, výbuch 3×3 zasiahol súpera (8)");
}
{
  const A = P("A", "classic", [0, 0, "left"], [0, 0, "up"]);
  const sc = scenario("luffy", "fire", (g) => { const p = g.players.p1; p.x = 0; p.y = 0; g.players.p2.x = 1; g.players.p2.y = 1; g.portals = [A]; });
  sc.round([sp("left"), R, S], PASS3);
  check(sc.game.players.p1.x === 0 && sc.game.players.p1.y === 0 && sc.game.players.p2.hp === 2 && sc.game.players.p1.hp === 10, "L2: rohový pár - guľa ostane na mieste, výbuch okolo nej");
}
{
  const A = P("A", "classic", [0, 1, "left"], [2, 0, "up"]);
  const sc = scenario("luffy", "fire", (g) => { g.players.p2.x = 3; g.players.p2.y = 1; g.players.p2.mirror = true; g.portals = [A]; });
  const tl = sc.round([sp("left"), R, S], PASS3);
  check(!fx(tl, "reflect_void").length && sc.game.players.p1.hp === 2, "L3: zrkadlo vs guľa cez portál - odraz trafí Luffyho priamo", String(sc.game.players.p1.hp));
}
{
  const A = P("A", "nodef", [0, 1, "left"], [2, 0, "up"]);
  const sc = scenario("luffy", "fire", (g) => { g.players.p2.x = 3; g.players.p2.y = 1; g.players.p2.mirror = true; g.portals = [A]; });
  const tl = sc.round([sp("left"), R, S], PASS3);
  check(!fx(tl, "dispel").length && sc.game.players.p1.hp === 2 && sc.game.players.p2.hp === 10, "L4: guľa cez Def-breaker - bez efektu, zrkadlo odrazí", J([sc.game.players.p1.hp, sc.game.players.p2.hp]));
}

/* ==================== THE WORLD ==================== */
console.log("THE WORLD");
{
  const A = P("A", "mana", [3, 1, "right"], [0, 1, "left"]);
  const sc = scenario("fire", "jotaro", (g) => { g.players.p1.x = 1; g.players.p1.y = 2; g.players.p2.mana = 10; g.portals = [A]; });
  let tl = sc.round([R, S, PASS], [{ type: "special" }, PASS, PASS]);
  check(sc.game.timestop?.mode === "waiting", "T0: THE WORLD pauza");
  // zamrazené: move cez A (3,1)→(0,1), dash späť cez A (0,1)→(3,1)→(2,1); mana efekt len raz, zatvorenie pri obnovení
  sc.e.timestopActions("B", [mv("right"), dash("left"), { type: "shield" }], (r) => { if (!r?.ok) throw new Error("timestop odmietnutý"); });
  tl = sc.last(); // pokračovacia timeline (seed + zvyšok kola)
  const p2 = sc.game.players.p2;
  check(p2.x === 2 && p2.y === 1, "T1: Jotaro v zamrznutí prešiel tým istým portálom dvakrát", J([p2.x, p2.y]));
  const endI = idx(tl, e => e.kind === "timestop_end");
  const manaFx = fx(tl, "recharge").filter(e => e.from === "p2" && e.portal);
  check(manaFx.length === 1 && idx(tl, e => e.kind === "recharge" && e.portal) > endI, "T1: mana efekt raz, až po obnovení času", J(manaFx));
  check(idx(tl, e => e.kind === "portal_close") > endI && !hasEnds(sc.game, A), "T1: portál sa zatvoril až pri obnovení času");
}

/* ==================== Labyrint a pasca ==================== */
console.log("Labyrint / pasca");
{
  const A = P("A", "classic", [1, 0, "up"], [3, 1, "right"]);
  const sc = scenario("fire", "minotaur", (g) => {
    const p = g.players.p1; p.x = 1; p.y = 0; p.labyrinth = true; p.thread = [[2, 1], [1, 1], [1, 0]]; p.threadMark = [2, 1];
    g.players.p2.x = 0; g.players.p2.y = 2; g.players.p2.mazeBuff = true; g.portals = [A];
  });
  const tl = sc.round([mv("up"), R, S], PASS3);
  const p = sc.game.players.p1;
  check(J(p.thread) === "[[3,1]]" && p.threadMark === null && fx(tl, "thread_cut").length === 1, "B1: prekliaty prešiel portálom - niť aj silueta zmizli, nové klbko na výstupe", J([p.thread, p.threadMark]));
  // lovec thread_cut nevidí, prekliaty vidí portal_close
  const hunter = sc.e.redactTimelineFor("p2", tl);
  check(!fx(hunter, "thread_cut").length, "B2: lovec nevidí thread_cut");
  const cursed = sc.e.redactTimelineFor("p1", tl);
  check(fx(cursed, "portal_close").length === 1 && cursed.every(f => Array.isArray(f.portals)), "B2: prekliaty vidí portály aj ich zánik");
}
{
  // skrytý lovec prejde portálom - prekliaty nevidí jeho prechod, ale vidí zánik portálu
  const A = P("A", "classic", [3, 0, "up"], [0, 2, "left"]);
  const sc = scenario("fire", "minotaur", (g) => {
    const p = g.players.p1; p.x = 1; p.y = 1; p.labyrinth = true; p.thread = [[1, 1]];
    g.players.p2.x = 3; g.players.p2.y = 0; g.players.p2.mazeBuff = true; g.portals = [A];
  });
  const tl = sc.round([R, S, PASS], [mv("up"), PASS, PASS]);
  const cursed = sc.e.redactTimelineFor("p1", tl);
  check(!fx(cursed, "portal_walk").length && fx(cursed, "portal_close").length === 1, "B3: prechod skrytého lovca redigovaný, zánik portálu viditeľný");
}
{
  // pasca na výstupnom políčku sa spustí
  const A = P("A", "classic", [3, 0, "up"], [1, 2, "down"]);
  const sc = scenario("countess", "fire", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0; g.players.p1.trap = { x: 1, y: 2 };
    g.players.p2.x = 3; g.players.p2.y = 0; g.portals = [A];
  });
  const tl = sc.round([R, S, PASS], [mv("up"), PASS, PASS]);
  check(fx(tl, "trap_trigger").length === 1 && sc.game.players.p1.x === 1 && sc.game.players.p1.y === 2, "TR1: pasca na výstupnom políčku sa spustí");
}

/* ==================== Generovanie, konfigurácia, dlaždice ==================== */
console.log("Generovanie / config / dlaždice");
{
  const e = createEngine({ seed: 7 });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", "fire"); e.chooseCharacter("B", "fire");
  check(e.game.portals.length === 1 && Array.isArray(e.snapshot().portals) && e.game.arena === "portal-realm", "GN1: štart hry - 1 pár, snapshot nesie portály, aréna portal-realm");
  const e2 = createEngine({ seed: 7 });
  e2.startMatch(e2.sanitizeConfig({ ...CFG, arena: undefined, portalWeights: undefined, tileWeights: { dmg: 75, heal: 5, mana: 5, ik: 5, power: 5, block: 5 } }));
  check(e2.game.portals.length === 0 && !("portals" in e2.snapshot()) && !("arena" in e2.game.config) && !("portalsPerRound" in e2.game.config) && e2.game.arena === "bridge",
    "GN1: stone bridge - žiadne portály, snapshot/config bez nových kľúčov");
}
{
  // po každom kole +1 pár až do 7, hrany unikátne, písmená unikátne; plná doska = nič
  const sc = scenario("fire", "fire", null);
  sc.game.portals = [];
  let okAll = true, max = 0;
  for (let r = 0; r < 9; r++) {
    sc.round([R, S, PASS], [R, S, PASS]);
    const g = sc.game;
    const ends = g.portals.flatMap(p => p.ends.map(e => `${e.x},${e.y},${e.side}`));
    if (new Set(ends).size !== ends.length || new Set(g.portals.map(p => p.id)).size !== g.portals.length) okAll = false;
    if (g.portals.length !== Math.min(7, r + 1)) okAll = false;
    max = Math.max(max, g.portals.length);
    g.players.p1.hp = 10; g.players.p2.hp = 10; g.tiles = []; g.iks = []; g.pending = null; // nech kolo neukončí dlaždica
    g.players.p1.mana = 6; g.players.p2.mana = 6;
  }
  check(okAll && max === 7, "GN2: +1 pár za kolo, max 7, unikátne hrany a písmená", String(max));
}
{
  // „Portals / round": default 2, na štarte hry aj na konci kola pribudne N párov; 7 = plná doska hneď od štartu
  const e = createEngine({ seed: 5 });
  const c = e.sanitizeConfig({ ...CFG, portalsPerRound: undefined });
  check(c.portalsPerRound === 2, "GN8: default 2 páry za kolo", J(c.portalsPerRound));
  check(e.sanitizeConfig({ ...CFG, portalsPerRound: 99 }).portalsPerRound === 7 && e.sanitizeConfig({ ...CFG, portalsPerRound: -3 }).portalsPerRound === 1,
    "GN8: portalsPerRound orezané na 1–7");
  e.startMatch(c);
  e.chooseCharacter("A", "fire"); e.chooseCharacter("B", "fire");
  check(e.game.portals.length === 2, "GN8: default - na štarte hry 2 páry", J(e.game.portals.length));
  const sc = scenario("fire", "fire", (g) => { g.config.portalsPerRound = 3; g.portals = []; });
  let counts = [], spawnFx = [];
  for (let r = 0; r < 4; r++) {
    const tl = sc.round([R, S, PASS], [R, S, PASS]);
    counts.push(sc.game.portals.length); spawnFx.push(fx(tl, "portal_spawn").length);
    const g = sc.game; g.players.p1.hp = 10; g.players.p2.hp = 10; g.tiles = []; g.iks = []; g.pending = null; g.players.p1.mana = 6; g.players.p2.mana = 6;
  }
  check(J(counts) === "[3,6,7,7]" && J(spawnFx) === "[3,3,1,0]", "GN8: 3 za kolo - pribúda po 3, strop 7, plná doska nič", J(counts) + " " + J(spawnFx));
  const e7 = createEngine({ seed: 9 });
  e7.startMatch(e7.sanitizeConfig({ ...CFG, portalsPerRound: 7 }));
  e7.chooseCharacter("A", "fire"); e7.chooseCharacter("B", "fire");
  const ends = e7.game.portals.flatMap(p => p.ends.map(x => `${x.x},${x.y},${x.side}`));
  check(e7.game.portals.length === 7 && new Set(ends).size === 14, "GN8: 7 za kolo - plná doska (7 párov, 14 hrán) hneď na štarte", J(e7.game.portals.length));
  // po zatvorení páru sa v ďalšom kole doplní
  const s7 = scenario("fire", "fire", (g) => { g.config.portalsPerRound = 7; });
  s7.game.portals = []; s7.round([R, S, PASS], [R, S, PASS]);
  s7.game.portals.splice(2, 1);
  s7.game.players.p1.hp = 10; s7.game.players.p2.hp = 10; s7.game.tiles = []; s7.game.iks = []; s7.game.pending = null;
  const tl7 = s7.round([R, S, PASS], [R, S, PASS]);
  check(s7.game.portals.length === 7 && fx(tl7, "portal_spawn").length === 1, "GN8: zmiznutý pár sa doplní v ďalšom kole", J(s7.game.portals.length));
}
{
  // rohový pár sa smie vygenerovať; váha 0 = typ nikdy
  let corner = false, onlyClassic = true;
  for (let seed = 1; seed < 400; seed++) {
    const e = createEngine({ seed });
    e.startMatch(e.sanitizeConfig({ ...CFG, portalWeights: { classic: 100, hp: 0, mana: 0, power: 0, nodef: 0 } }));
    const p = e.game.portals[0];
    if (p.type !== "classic") onlyClassic = false;
    if (p.ends[0].x === p.ends[1].x && p.ends[0].y === p.ends[1].y) corner = true;
  }
  check(corner, "GN3: pár na oboch hranách jedného rohu sa smie vygenerovať");
  check(onlyClassic, "GN4: váha 0 = typ sa nikdy nevygeneruje");
}
{
  const e = createEngine({ seed: 1 });
  const c = e.sanitizeConfig({ ...CFG, tileWeights: { dmg: 90, heal: 50, mana: 0, ik: 10, power: 0, block: 0 } });
  check(c && c.tileWeights.heal === 0 && c.arena === "portal", "GN5: portal realm vynuluje heal/mana/power/block", J(c?.tileWeights));
  check(e.sanitizeConfig({ ...CFG, portalWeights: { classic: 50, hp: 15, mana: 15, power: 15, nodef: 15 } }) === null, "GN5: váhy portálov musia dať 100");
  check(e.sanitizeConfig({ ...CFG, tileWeights: { dmg: 80, heal: 0, mana: 0, ik: 10, power: 0, block: 0 } }) === null, "GN5: váhy dlaždíc musia dať 100");
}
{
  // Damage dlaždica v portal realm = 2 dmg (aj kozmetický zásah klona)
  const sc = scenario("fire", "naruto", (g) => {
    g.tiles = [{ x: 3, y: 1, type: "dmg" }, { x: 3, y: 0, type: "dmg" }];
    g.players.p2.clone = { x: 3, y: 0 };
  });
  const tl = sc.round([R, S, PASS], [R, S, PASS]);
  const hits = fx(tl, "hit").filter(e => e.target === "p2");
  check(hits.length === 3 && hits.every(h => h.dmg === 2) && fx(tl, "clone_hit").every(e => e.dmg === 2), "GN6: Damage dlaždica dáva 2 dmg", J(hits));
}
{
  // ghost validácia: Vojak nesmie mieriť na vlastnú ghost bunku za portálom
  const A = P("A", "classic", [0, 1, "left"], [3, 0, "up"]);
  const sc = scenario("soldier", "fire", (g) => { g.portals = [A]; g.players.p2.x = 1; g.players.p2.y = 2; });
  check(!sc.e.validQueue([mv("left"), { type: "special", cell: { x: 3, y: 0 } }, R], "p1"), "V1: validQueue - ghost za portálom (vlastná bunka) odmietnutá");
  check(sc.e.validQueue([mv("left"), { type: "special", cell: { x: 0, y: 1 } }, R], "p1"), "V1: validQueue - bývalá bunka je platný cieľ");
}

{
  // séria: nová hra začína s čerstvým jedným párom (portály z predošlej hry neprežijú)
  const pending = [];
  const e = createEngine({ seed: 3, schedule: (fn) => pending.push(fn) });
  e.startMatch(e.sanitizeConfig({ ...CFG, format: "bo3" }));
  e.chooseCharacter("A", "fire"); e.chooseCharacter("B", "fire");
  const g = e.game;
  g.portals = [P("A", "classic", [0, 0, "up"], [3, 2, "down"]), P("B", "hp", [1, 0, "up"], [2, 2, "down"])];
  g.players.p2.hp = 1; g.players.p1.x = 2; g.players.p1.y = 1;
  e.lockIn("A", [atk("right"), R, S], g.turn, () => {});
  e.lockIn("B", PASS3, g.turn, () => {});
  pending.forEach(fn => fn());
  check(e.game.series.gameIndex === 2 && e.game.portals.length === 1, "GN7: nová hra série - portály od nuly (1 pár)", J(e.game.portals));
}

console.log(failures ? `\n${failures} PORTÁLOVÝCH TESTOV ZLYHALO (${passes} prešlo)` : `\nPORTÁLY: VŠETKÝCH ${passes} TESTOV PREŠLO`);
process.exit(failures ? 1 : 0);
