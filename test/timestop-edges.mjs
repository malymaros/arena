// test/timestop-edges.mjs - THE WORLD (Jotaro) × okrajové mechaniky priamo nad enginom (bez servera):
// dlaždice (TJ9), labyrint (TJ10), pasca Countess (TJ15) a Last Stand (TJ16). Stav (pozície, dlaždice,
// labyrint, pasca, buffy) sa nastaví priamo, odohrá sa kolo s pauzou a kontrolujú sa framy timeline.
// Spustenie: node test/timestop-edges.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
// dlaždice: spawny len heal (žiadny dmg šum); stav dlaždíc si scenár nastaví sám
const CFG = { format: "single", tilesPerRound: 1, timer: "off", tilePreview: false, colorPref: "white",
  tileWeights: { dmg: 0, heal: 100, mana: 0, ik: 0, power: 0, block: 0 } };
const R = { type: "recharge" }, S = { type: "shield" }, ML = { type: "melee" }, SP = { type: "special" };
const M = (dir) => ({ type: "move", dir }), D = (dir) => ({ type: "dash", dir }), A = (dir) => ({ type: "attack", dir });

// osoba A = p1 (začína kolo 1), osoba B = p2 = Jotaro (nestartér → THE WORLD ako jeho 1. akcia beží v kroku 0)
function scenario(c1, setup) {
  const timelines = [];
  const e = createEngine({ seed: 1, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(CFG));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", "jotaro");
  e.game.tiles = []; e.game.iks = [];
  e.game.players.p2.mana = 10;
  setup?.(e.game);
  return {
    engine: e,
    game: e.game,
    // kolo s THE WORLD: lock oboch → timeline #1 (končí timestop_wait) → zmrazené akcie → timeline #2
    round(q1, q2, frozen) {
      const n = timelines.length;
      const ok = (who) => (r) => { if (!r?.ok) throw new Error(`${who} odmietnutý ${JSON.stringify(r)}`); };
      e.lockIn("A", q1, e.game.turn, ok("p1 lock_in"));
      e.lockIn("B", q2, e.game.turn, ok("p2 lock_in"));
      const tl1 = timelines.slice(n).flat();
      if (!fx(tl1, "timestop_wait").length) throw new Error("THE WORLD nepozastavil kolo");
      const m = timelines.length;
      e.timestopActions("B", frozen, ok("timestop_actions"));
      return { tl1, tl2: timelines.slice(m).flat() };
    },
  };
}
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));
const idxOf = (tl, kind) => tl.findIndex(f => (f.effects || []).some(e => e.kind === kind));
const before = (tl, kind) => { const i = idxOf(tl, kind); return i < 0 ? tl : tl.slice(0, i); };
const after = (tl, kind) => { const i = idxOf(tl, kind); return i < 0 ? [] : tl.slice(i); };

/* ---- TJ9a: dlaždice sú počas zamrazenia inertné; po obnovení času bežia normálne ---- */
{
  // dmg na (2,1), heal na (1,1). Zmrazene: dash doľava cez dmg na heal, späť na dmg. Fire ďaleko na (0,0).
  const sc = scenario("fire", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0;
    g.players.p2.hp = 8;
    g.tiles = [{ type: "dmg", x: 2, y: 1 }, { type: "heal", x: 1, y: 1 }];
  });
  const { tl2 } = sc.round([R, ML, S], [SP, R, S], [D("left"), M("right"), R]);
  const frozen = before(tl2, "timestop_end");
  check(!fx(frozen, "tile_proc").length, "TJ9: počas zamrazenia žiadny tile_proc", JSON.stringify(fx(frozen, "tile_proc")));
  check(frozen.every(f => f.p2.hp === 8), "TJ9: prechod cez dmg dlaždicu v zamrazení bez ticku");
  check(frozen.some(f => f.p2.x === 1 && f.p2.y === 1), "TJ9: Jotaro v zamrazení stál na heal dlaždici");
  check(sc.game.tiles.some(t => t.type === "heal" && t.x === 1 && t.y === 1), "TJ9: heal dlaždica v zamrazení NEzobratá");
  const firstProc = fx(after(tl2, "timestop_end"), "tile_proc")[0];
  check(firstProc && firstProc.tile === "dmg" && JSON.stringify(firstProc.cell) === "[2,1]",
    "TJ9: po obnovení času dmg dlaždica tickne normálne", JSON.stringify(firstProc));
  const hpAfterFirstTick = after(tl2, "timestop_end").find(f => f.p2.hp < 8)?.p2.hp;
  check(hpAfterFirstTick === 7, "TJ9: prvý tick po obnovení = 1 dmg", `hp=${hpAfterFirstTick}`);
}

/* ---- TJ9b: power dlaždica počas zamrazenia nedá bonus a nespotrebuje sa ---- */
{
  const sc = scenario("fire", (g) => {
    g.players.p1.x = 2; g.players.p1.y = 0;            // na trase up_left z (3,1), vzdialenosť 1 → 3 dmg
    g.tiles = [{ type: "power", x: 3, y: 1 }];          // Jotaro na nej stojí pri zmrazenom výstrele
  });
  const { tl2 } = sc.round([R, M("down"), S], [SP, R, S], [A("up_left"), R, M("down")]);
  const ts = fx(tl2, "ts_hit");
  check(ts.length === 1 && ts[0].dmg === 3, "TJ9: zmrazený výstrel z power dlaždice bez +2", JSON.stringify(ts));
  check(!fx(tl2, "tile_consume").length, "TJ9: power dlaždica sa v zamrazení nespotrebovala");
  check(sc.game.tiles.some(t => t.type === "power" && t.x === 3 && t.y === 1), "TJ9: power dlaždica ostala na doske");
  const hit = fx(tl2, "hit").filter(h => h.target === "p1");
  check(hit.length === 1 && hit[0].dmg === 3 && !hit[0].bonus, "TJ9: kumulatívny zásah 3 bez bonusu", JSON.stringify(hit));
}

/* ---- TJ10a: prekliaty Jotaro trafí lovca v zamrazení → reveal až pri obnovení, potom hit a koniec labyrintu ---- */
{
  const sc = scenario("minotaur", (g) => {
    g.players.p1.x = 2; g.players.p1.y = 0; g.players.p1.mazeBuff = true;
    const j = g.players.p2; j.labyrinth = true; j.thread = [[3, 1]]; j.threadMark = null;
  });
  const { tl2 } = sc.round([R, ML, S], [SP, R, S], [A("up_left"), R, M("down")]);
  const iReveal = idxOf(tl2, "labyrinth_reveal"), iEnd = idxOf(tl2, "timestop_end"),
    iHit = tl2.findIndex(f => (f.effects || []).some(e => e.kind === "hit" && e.target === "p1")),
    iLabEnd = idxOf(tl2, "labyrinth_end");
  check(fx(tl2, "ts_hit").length === 1, "TJ10: zásah lovca v zamrazení ohlásený (ts_hit)");
  check(iReveal > 0 && iReveal < iEnd, "TJ10: reveal až pri obnovení (tesne pred timestop_end)", `reveal=${iReveal} end=${iEnd}`);
  check(before(tl2, "labyrinth_reveal").every(f => f.p2.labyrinth && !f.p2.labReveal), "TJ10: počas zamrazenia labyrint beží neodhalený");
  check(before(tl2, "labyrinth_reveal").some(f => (f.p2.thread || []).some(c => c[0] === 3 && c[1] === 2)),
    "TJ10: zmrazený pohyb prekliateho pletie niť ďalej (D5)");
  check(iHit > iEnd && iLabEnd > iHit, "TJ10: kumulatívny hit, až potom labyrinth_end", `hit=${iHit} labEnd=${iLabEnd}`);
  check(!sc.game.players.p2.labyrinth && !sc.game.players.p1.mazeBuff, "TJ10: labyrint skončil, lovec stratil maze buff");
  // redakcia: prekliaty Jotaro nesmie v zamrazených framoch vidieť lovca ani zásah na ňom
  const red = sc.engine.redactTimelineFor("p2", tl2);
  const redFrozen = before(red, "labyrinth_reveal");
  check(redFrozen.every(f => f.p1.x == null), "TJ10: lovec počas zamrazenia skrytý prekliatemu");
  check(!fx(redFrozen, "ts_hit").length, "TJ10: ts_hit na lovcovi redigovaný v timeline prekliateho");
}

/* ---- TJ10b: zmrazené akcie lovca netrafia → labyrint beží ďalej ---- */
{
  const sc = scenario("minotaur", (g) => {
    g.players.p1.x = 2; g.players.p1.y = 0; g.players.p1.mazeBuff = true;
    const j = g.players.p2; j.labyrinth = true; j.thread = [[3, 1]]; j.threadMark = null;
  });
  const { tl2 } = sc.round([R, ML, S], [SP, R, S], [A("down_left"), R, M("down")]);
  check(!fx(tl2, "ts_hit").length && !fx(tl2, "labyrinth_reveal").length && !fx(tl2, "labyrinth_end").length,
    "TJ10: miss v zamrazení - žiadny reveal ani koniec labyrintu");
  check(sc.game.players.p2.labyrinth && sc.game.players.p1.mazeBuff, "TJ10: labyrint po kole stále beží");
}

/* ---- TJ15: pasca Countess sa počas zamrazenia nespustí (D4) ---- */
{
  const sc = scenario("countess", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0;
    g.players.p1.trap = { x: 2, y: 1 };
  });
  // zmrazene: krok NA pascu, potom dash cez (1,1) na (0,1) - vstup aj prechod
  const { tl2 } = sc.round([R, ML, S], [SP, R, S], [M("left"), D("left"), R]);
  check(!fx(tl2, "trap_trigger").length && !fx(tl2, "trap_break").length, "TJ15: vstup/prechod pascou v zamrazení ju nespustí",
    JSON.stringify([...fx(tl2, "trap_trigger"), ...fx(tl2, "trap_break")]));
  check(JSON.stringify(sc.game.players.p1.trap) === JSON.stringify({ x: 2, y: 1 }), "TJ15: pasca po kole ostáva nastavená",
    JSON.stringify(sc.game.players.p1.trap));
  check(sc.game.players.p1.x === 0 && sc.game.players.p1.y === 0, "TJ15: Countess sa neteleportovala");
}

/* ---- TJ16a: Last Stand na Jotarovi - zmrazený zásah nesie ×2 (dealMul) ---- */
{
  const sc = scenario("fire", (g) => {
    g.players.p1.x = 2; g.players.p1.y = 0;
    g.players.p2.lastStandBuff = true;
  });
  const { tl2 } = sc.round([R, M("down"), S], [SP, R, S], [A("up_left"), R, M("down")]);
  const ts = fx(tl2, "ts_hit");
  check(ts.length === 1 && ts[0].dmg === 6, "TJ16: ts_hit s Last Stand ×2 = 6", JSON.stringify(ts));
  const hit = fx(tl2, "hit").filter(h => h.target === "p1");
  check(hit.length === 1 && hit[0].dmg === 6, "TJ16: kumulatívny zásah 6", JSON.stringify(hit));
}

/* ---- TJ16b: Last Stand na súperovi - kumulatívny zásah polovičný, doom po kole s pauzou dopadne ---- */
{
  const sc = scenario("fire", (g) => {
    g.players.p1.x = 2; g.players.p1.y = 0;
    g.players.p1.lastStandBuff = true; g.players.p1.lastStandDoom = true; // buffnuté (posledné) kolo
  });
  const { tl2 } = sc.round([R, M("down"), S], [SP, R, S], [A("up_left"), R, M("down")]);
  const hit = fx(tl2, "hit").filter(h => h.target === "p1");
  check(hit.length === 1 && hit[0].dmg === 1, "TJ16: súper v Last Stand dostane ⌊3/2⌋ = 1", JSON.stringify(hit));
  const iEnd = idxOf(tl2, "timestop_end"), iBanish = idxOf(tl2, "last_stand_banish");
  check(iBanish > iEnd, "TJ16: doom (banish) sa po obnovení času na konci kola vyhodnotí", `end=${iEnd} banish=${iBanish}`);
  check(sc.game.players.p1.hp === 0 && sc.game.players.p2.hp > 0, "TJ16: doom zabil súpera - Jotaro vyhral",
    `p1=${sc.game.players.p1.hp} p2=${sc.game.players.p2.hp}`);
}

/* ---- TJ16c: Last Stand doom na Jotarovi - kolo s THE WORLD ho neobíde ---- */
{
  const sc = scenario("fire", (g) => {
    g.players.p1.x = 0; g.players.p1.y = 0;
    g.players.p2.lastStandBuff = true; g.players.p2.lastStandDoom = true;
  });
  const { tl2 } = sc.round([R, ML, S], [SP, R, S], [M("left"), R, S]);
  check(idxOf(tl2, "last_stand_banish") > idxOf(tl2, "timestop_end"), "TJ16: Jotarov doom dopadne aj v kole s THE WORLD");
  check(sc.game.players.p2.hp === 0, "TJ16: Jotaro po doome mŕtvy", `hp=${sc.game.players.p2.hp}`);
}

console.log(failures ? `\n${failures} FAIL` : "\nTHE WORLD okraje: všetko OK");
process.exit(failures ? 1 : 0);
