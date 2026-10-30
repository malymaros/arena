// test/breaker.mjs - Shield / Mirror Breaker priamo nad enginom (docs/BREAKER_PLAN.md): tabuľka výsledkov
// (zhodná / nezhodná / žiadna obrana), násobiče, klon, labyrint, Escanor, dlaždice, validácia fronty a THE WORLD.
// Spustenie: node test/breaker.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";
import { SHIELD_BREAKER_DMG, MIRROR_BREAKER_DMG, SHIELD_COST, MIRROR_COST, JOTARO_MELEE_DMG } from "../shared/balance.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const CFG = { format: "single", tilesPerRound: 1, timer: "off", tilePreview: false, colorPref: "white",
  tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 } };
const R = { type: "recharge" }, S = { type: "shield" }, MI = { type: "mirror" }, ML = { type: "melee" }, SP = { type: "special" };
const SB = { type: "shield_breaker" }, MB = { type: "mirror_breaker" };
const M = (dir) => ({ type: "move", dir });
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));
const hitsOn = (tl, slot) => fx(tl, "hit").filter(h => h.target === slot);
const idx = (tl, pred) => tl.findIndex(f => (f.effects || []).some(pred));

// osoba A = p1 (začína kolo 1 → jeho 1. akcia je súperova najbližšia po nabitej obrane), B = p2
function scenario(c1, c2, setup) {
  const timelines = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", c2);
  e.game.tiles = []; e.game.iks = [];
  e.game.players.p1.mana = 10; e.game.players.p2.mana = 10;
  setup?.(e.game);
  const lock = (person, q) => new Promise(res => e.lockIn(person, q, e.game.turn, res));
  return {
    e, game: e.game, lock,
    round(q1, q2) {
      const n = timelines.length;
      e.lockIn("A", q1, e.game.turn, (r) => { if (!r?.ok) throw new Error("p1 lock_in odmietnutý " + JSON.stringify(q1)); });
      e.lockIn("B", q2, e.game.turn, (r) => { if (!r?.ok) throw new Error("p2 lock_in odmietnutý " + JSON.stringify(q2)); });
      return timelines.slice(n).flat();
    },
  };
}
const P2_IDLE = [R, M("up"), ML];

/* ---- tabuľka výsledkov ---- */
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p2.shield = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  const b = fx(tl, "breaker")[0];
  check(b?.result === "break" && b.what === "shield", "SB vs štít → break", JSON.stringify(b));
  const h = hitsOn(tl, "p2");
  check(h.length === 1 && h[0].dmg === SHIELD_BREAKER_DMG, `SB vs štít → ${SHIELD_BREAKER_DMG} dmg`, JSON.stringify(h));
  check(!fx(tl, "block").length, "SB vs štít → žiadny blok");
  check(idx(tl, e => e.kind === "breaker") >= 0 && tl[idx(tl, e => e.kind === "hit")].p2.shield === false, "štít po rozbití spotrebovaný");
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p2.mirror = true; });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  check(fx(tl, "breaker")[0]?.result === "break", "MB vs mirror → break");
  const h = hitsOn(tl, "p2");
  check(h.length === 1 && h[0].dmg === MIRROR_BREAKER_DMG, `MB vs mirror → ${MIRROR_BREAKER_DMG} dmg`, JSON.stringify(h));
  check(!fx(tl, "mirror").length && !hitsOn(tl, "p1").length, "MB vs mirror → žiadny odraz");
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p2.mirror = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(fx(tl, "breaker")[0]?.result === "reflect", "SB vs mirror → reflect");
  const h = hitsOn(tl, "p1");
  check(h.length === 1 && h[0].dmg === SHIELD_BREAKER_DMG && !hitsOn(tl, "p2").length, `SB vs mirror → útočník dostane ${SHIELD_BREAKER_DMG}`, JSON.stringify(fx(tl, "hit")));
  check(sc.game.players.p2.mirror === false, "mirror spotrebovaný");
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p2.shield = true; });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  check(fx(tl, "breaker")[0]?.result === "block", "MB vs štít → block");
  check(fx(tl, "block").length === 1 && !fx(tl, "hit").length, "MB vs štít → blok, 0 dmg");
  check(sc.game.players.p2.shield === false, "štít spotrebovaný");
}
{
  const sc = scenario("fire", "lightning");
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(fx(tl, "breaker")[0]?.result === "none" && !fx(tl, "hit").length, "SB bez obrany → nič");
  const manaAfterSB = tl[idx(tl, e => e.kind === "breaker")].p1.mana;
  check(manaAfterSB === 10 - SHIELD_COST, `SB bez obrany → mana minutá (−${SHIELD_COST})`, String(manaAfterSB));
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p1.mana = 3; g.players.p2.mirror = true; });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  check(fx(tl, "invalid").some(e => e.target === "p1" && e.reason === "mana") && !fx(tl, "breaker").length,
    `MB bez many (< ${MIRROR_COST}) → invalid`);
}

/* ---- prierezové pravidlá ---- */
{
  // Vampire: imunita na mirror sa breakera netýka → Shield Breaker sa normálne odrazí
  const sc = scenario("countess", "lightning", (g) => { g.players.p2.mirror = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(fx(tl, "mirror").length === 1 && hitsOn(tl, "p1")[0]?.dmg === SHIELD_BREAKER_DMG, "Vampire: SB do mirroru sa odrazí (imunita neplatí)",
    JSON.stringify([...fx(tl, "mirror"), ...fx(tl, "block")]));
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p1.lastStandBuff = true; g.players.p2.mirror = true; });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  check(hitsOn(tl, "p2")[0]?.dmg === MIRROR_BREAKER_DMG * 2, "Last Stand útočník: MB ×2", JSON.stringify(hitsOn(tl, "p2")));
}
{
  const sc = scenario("fire", "lightning", (g) => { g.players.p2.lastStandBuff = true; g.players.p2.mirror = true; });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  check(hitsOn(tl, "p2")[0]?.dmg === Math.floor(MIRROR_BREAKER_DMG / 2), "Last Stand obranca: MB ½", JSON.stringify(hitsOn(tl, "p2")));
}
{
  // power dlaždica pod útočníkom sa nespotrebuje a nedá bonus; Def-blocker breaker nezakazuje
  const sc = scenario("fire", "lightning", (g) => { g.tiles = [{ type: "power", x: 0, y: 1 }]; g.players.p2.shield = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(hitsOn(tl, "p2")[0]?.dmg === SHIELD_BREAKER_DMG && !fx(tl, "tile_consume").length, "power dlaždica: bez bonusu, nespotrebovaná");
}
{
  const sc = scenario("fire", "lightning", (g) => { g.tiles = [{ type: "block", x: 0, y: 1 }]; g.players.p2.shield = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(fx(tl, "breaker")[0]?.result === "break" && !fx(tl, "invalid").some(e => e.target === "p1"), "Def-blocker dlaždica breaker nezakazuje");
}
{
  // Naruto: zdieľaná obrana - po rozbití dostane majiteľ dmg a klon zanikne (aj návnada mimo bunky)
  const sc = scenario("fire", "naruto", (g) => { g.players.p2.clone = { x: 2, y: 0 }; g.players.p2.shield = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(hitsOn(tl, "p2")[0]?.dmg === SHIELD_BREAKER_DMG && fx(tl, "clone_die").some(e => e.target === "p2") && !sc.game.players.p2.clone,
    "Naruto: majiteľ dostane dmg, klon zanikne", JSON.stringify([...hitsOn(tl, "p2"), ...fx(tl, "clone_die")]));
}
{
  const sc = scenario("fire", "naruto", (g) => { g.players.p2.clone = { x: 2, y: 0 }; g.players.p2.mirror = true; });
  const tl = sc.round([SB, R, M("up")], P2_IDLE);
  check(fx(tl, "mirror").length === 1 && hitsOn(tl, "p1")[0]?.dmg === SHIELD_BREAKER_DMG && !!sc.game.players.p2.clone,
    "Naruto: nezhodný mirror odrazí raz (nie z klona), klon prežije", JSON.stringify(fx(tl, "mirror")));
}
{
  // labyrint: Minotaur s maze buffom rozbije prekliatemu mirror - reveal pred lúčom, 2× dmg, labyrint končí
  const sc = scenario("minotaur", "lightning", (g) => {
    g.players.p1.mazeBuff = true; g.players.p2.mirror = true;
    g.players.p2.labyrinth = true; g.players.p2.thread = [[3, 1]]; g.players.p2.threadMark = null;
  });
  const tl = sc.round([MB, R, M("up")], P2_IDLE);
  const iRev = idx(tl, e => e.kind === "labyrinth_reveal"), iBrk = idx(tl, e => e.kind === "breaker"), iEnd = idx(tl, e => e.kind === "labyrinth_end");
  check(iRev >= 0 && iRev < iBrk && iEnd > iBrk, "labyrint: reveal pred lúčom, koniec po zásahu", `${iRev} ${iBrk} ${iEnd}`);
  check(hitsOn(tl, "p2")[0]?.dmg === MIRROR_BREAKER_DMG * 2, "labyrint: maze buff ×2", JSON.stringify(hitsOn(tl, "p2")));
  // bez obrany sa labyrint neodhalí ani neskončí
  const sc2 = scenario("minotaur", "lightning", (g) => { g.players.p2.labyrinth = true; g.players.p2.thread = [[3, 1]]; g.players.p2.threadMark = null; });
  const tl2 = sc2.round([MB, R, M("up")], P2_IDLE);
  check(!fx(tl2, "labyrinth_reveal").length && sc2.game.players.p2.labyrinth, "labyrinth: breaker bez obrany ho neodhalí");
  // prekliaty obranca breaker súpera bez obrany nevidí (redakcia)
  const red = sc2.e.redactTimelineFor("p2", tl2);
  check(!fx(red, "breaker").length, "labyrint: prekliatemu sa súperov breaker bez obrany nezobrazí");
}
{
  // Escanor: odrazený Shield Breaker je zásah od súpera → −1 pride (inak by bol +1)
  const sc = scenario("escanor", "lightning", (g) => { g.players.p1.pride = 1; g.players.p2.mirror = true; });
  sc.round([SB, R, M("up")], P2_IDLE);
  check(sc.game.players.p1.pride === 0, "Escanor: odrazený SB → −1 pride", String(sc.game.players.p1.pride));
  const sc2 = scenario("escanor", "lightning", (g) => { g.players.p1.pride = 1; });
  sc2.round([SB, R, M("up")], P2_IDLE);
  check(sc2.game.players.p1.pride === 2, "Escanor: breaker nie je obrana (bez zásahu +1)", String(sc2.game.players.p1.pride));
}

/* ---- validácia fronty ---- */
{
  const sc = scenario("fire", "jotaro");
  const ack = (person, q) => { let r; sc.e.lockIn(person, q, sc.game.turn, (x) => { r = x; }); return r?.ok; };
  check(ack("A", [S, SB, R]) === false, "štít + Shield Breaker v jednom kole odmietnuté");
  check(ack("A", [MI, MB, R]) === false, "mirror + Mirror Breaker v jednom kole odmietnuté");
  check(ack("B", [MB, R, S]) === false, "Jotaro nemá Mirror Breaker");
  check(ack("B", [{ type: "golden_shield" }, SB, R, M("up")]) === false, "golden štít + Shield Breaker odmietnuté");
  check(ack("A", [SB, MB, R]) === true, "Shield Breaker + Mirror Breaker v jednom kole sú OK");
}
{
  const sc = scenario("luffy", "fire");
  let r; sc.e.lockIn("A", [MB, R, S], sc.game.turn, (x) => { r = x; });
  check(r?.ok === false, "Luffy nemá Mirror Breaker");
}

/* ---- THE WORLD: zmrazený Shield Breaker - vyhodnotenie po poradí ---- */
function timestop(frozen, foeDef) {
  const timelines = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", "fire"); e.chooseCharacter("B", "jotaro");
  const g = e.game; g.tiles = []; g.iks = [];
  g.players.p2.mana = 10; g.players.p1.x = 3; g.players.p1.y = 1; g.players.p2.x = 3; g.players.p2.y = 1; // spoločná bunka - melee trafí
  Object.assign(g.players.p1, foeDef);
  e.lockIn("A", [R, M("up"), ML], g.turn, () => {});
  e.lockIn("B", [SP, R, M("left")], g.turn, () => {});
  const n = timelines.length;
  let ok; e.timestopActions("B", frozen, (r) => { ok = r?.ok; });
  return { ok, tl: timelines.slice(n).flat(), g };
}
{
  const { ok, tl } = timestop([R, SB, ML], { shield: true });
  const end = idx(tl, e => e.kind === "timestop_end");
  check(ok && idx(tl, e => e.kind === "breaker" && e.result === "break") >= 0 && idx(tl, e => e.kind === "breaker") < end,
    "THE WORLD: Shield Breaker rozbije zachytený štít v zamrazení");
  const h = hitsOn(tl, "p1");
  check(h.length === 1 && h[0].dmg === SHIELD_BREAKER_DMG + JOTARO_MELEE_DMG && !fx(tl, "block").length, "THE WORLD: breaker → melee = obe dopadnú, bez bloku", JSON.stringify(h));
}
{
  const { tl } = timestop([R, ML, SB], { shield: true });
  const h = hitsOn(tl, "p1");
  check(h.length === 1 && h[0].dmg === SHIELD_BREAKER_DMG, "THE WORLD: melee → breaker = 0 + 2 (melee zablokoval štít)", JSON.stringify(h));
}
{
  const { tl } = timestop([R, SB, ML], { mirror: true });
  const h = hitsOn(tl, "p2");
  check(fx(tl, "mirror").length === 1 && h.length === 1 && h[0].dmg === SHIELD_BREAKER_DMG + JOTARO_MELEE_DMG, "THE WORLD: SB do mirroru sa pripočíta k odrazu", JSON.stringify(h));
}
{
  const { ok } = timestop([S, SB, R], { shield: true });
  check(ok === false, "THE WORLD: štít + Shield Breaker v zmrazenej trojici odmietnuté");
}

console.log(failures ? `\n${failures} FAIL` : "\nBREAKER: všetko OK");
process.exit(failures ? 1 : 0);
