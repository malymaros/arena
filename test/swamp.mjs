// test/swamp.mjs - Shrek Swamp (docs/SWAMP_PLAN.md): cielené scenáre priamo nad enginom (bez servera).
// Shrekova pozícia, HP a ohlásené skoky sa v setup-e kladú ručne (game.shrek), odohrá sa jedno kolo a kontrolujú
// sa framy timeline aj výsledný stav.
// Spustenie: node test/swamp.mjs  (súčasť npm test)
import { createEngine } from "../engine/game.js";
import { SHREK_HP } from "../shared/balance.js";
import { eventsForFrame, newTracker } from "../public/sounds/events.js";
import { SHREK_HIT_SOUND_MS, SHREK_JUMP_MS, SHREK_CALL_MS } from "../shared/timing.js";

let failures = 0, passes = 0;
function check(cond, label, detail = "") {
  if (cond) { passes++; console.log(`  PASS  ${label}`); }
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const J = JSON.stringify;

const CFG = { format: "single", tilesPerRound: 2, timer: "off", tilePreview: true, colorPref: "white", arena: "swamp",
  tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 } };
const PASS = { type: "pass" }, R = { type: "recharge" }, M = { type: "melee" };
const PASS3 = [PASS, PASS, PASS];
const atk = (dir) => ({ type: "attack", dir }), sp = (extra = {}) => ({ type: "special", ...extra });
// skoky, ktoré netrafia hráčov na štarte (0,1) a (3,1): riadky 0/2, stĺpce 1/2
const QUIET = [[1, 0], [2, 2], [1, 2]];

// nový zápas v bažine: osoba A = p1 (biely, začína kolo 1), setup(game) upraví stav pred kolom
function scenario(c1, c2, setup, cfg = CFG, seed = 1) {
  const timelines = [];
  const e = createEngine({ seed, emitState: (tl) => { if (tl) timelines.push(tl); } });
  e.startMatch(e.sanitizeConfig(cfg));
  e.chooseCharacter("A", c1);
  e.chooseCharacter("B", c2);
  e.game.items = []; // náhodne padnuté itemy by menili HP/manu scenárov - testy itemov si ich kladú samé
  setup?.(e.game);
  return {
    e,
    timelines,
    get game() { return e.game; },
    round(q1, q2) {
      const n = timelines.length;
      e.lockIn("A", q1, e.game.turn, (r) => { if (!r?.ok) throw new Error("p1 lock_in odmietnutý " + J(q1)); });
      e.lockIn("B", q2, e.game.turn, (r) => { if (!r?.ok) throw new Error("p2 lock_in odmietnutý " + J(q2)); });
      return timelines.slice(n).flat();
    },
  };
}
const fx = (tl, kind) => tl.flatMap(f => (f.effects || []).filter(e => e.kind === kind));
const idx = (tl, pred) => tl.findIndex(f => (f.effects || []).some(pred));
const shrekSet = (g, o) => Object.assign(g.shrek, o);

/* ==================== Config / štart ==================== */
console.log("Config a štart hry");
{
  const s = scenario("fire", "lightning");
  const g = s.game;
  check(g.config.arena === "swamp" && g.arena === "shrek-swamp", "C1: config arena swamp → pozadie shrek-swamp", J([g.config.arena, g.arena]));
  check(Object.values(g.config.tileWeights).every(v => v === 0), "C2: bažina nemá špeciálne dlaždice (váhy 0)", J(g.config.tileWeights));
  check(g.shrek && g.shrek.hp === SHREK_HP && !g.shrek.dead, "C3: Shrek má na štarte plné HP");
  check(!["0,1", "3,1"].includes(`${g.shrek.x},${g.shrek.y}`), "C4: Shrek nestojí na štartovom políčku hráča", J(g.shrek));
  const m = g.shrek.marks;
  check(m.length === 3 && new Set([...m, [g.shrek.x, g.shrek.y]].map(String)).size === 4,
    "C5: 3 ohlásené skoky na tri rôzne políčka, žiadne nie je Shrekovo aktuálne", J(m));
  // tri rôzne skoky platia pre každé kolo (300 žrebov)
  {
    let ok = true;
    for (let seed = 1; seed <= 300 && ok; seed++) {
      const t = createEngine({ seed, emitState: () => {} });
      t.startMatch(t.sanitizeConfig(CFG)); t.chooseCharacter("A", "fire"); t.chooseCharacter("B", "lightning");
      const s = t.game.shrek;
      ok = new Set([...s.marks, [s.x, s.y]].map(String)).size === 4;
    }
    check(ok, "C5b: v 300 hrách vždy tri rôzne skoky mimo Shrekovho políčka");
  }
  const tl = s.round(PASS3, PASS3);
  check(!g.tiles.length && !g.iks.length && !(g.pending?.spawns || []).length, "C6: po kole žiadne dlaždice ani ohlásené spawny");
  check(tl.every(f => f.shrek), "C7: každý frame nesie verejný stav Shreka");
  // bridge: kľúč shrek v snapshote nie je (goldeny)
  const b = createEngine({ seed: 1, emitState: () => {} });
  b.startMatch(b.sanitizeConfig({ ...CFG, arena: undefined, tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 } }));
  check(!("shrek" in b.snapshot()) && b.game.shrek === null && !("arena" in b.game.config), "C8: stone bridge bez Shreka a bez kľúča arena");
  // determinizmus: rovnaký seed = rovnaký Shrek a skoky
  const a1 = scenario("fire", "lightning", null, CFG, 7).game.shrek, a2 = scenario("fire", "lightning", null, CFG, 7).game.shrek;
  check(J(a1) === J(a2), "C9: rovnaký seed → rovnaký Shrek a skoky");
}

/* ==================== Skoky a rev ==================== */
console.log("Skoky a rev (veža)");
{
  const s = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, marks: [[0, 0], [3, 2], [2, 1]] }));
  const tl = s.round(PASS3, PASS3);
  const jumps = fx(tl, "shrek_jump");
  check(J(jumps.map(j => [j.n, j.to])) === J([[1, [0, 0]], [2, [3, 2]], [3, [2, 1]]]), "R1: tri skoky v poradí 1-2-3 na ohlásené políčka", J(jumps));
  const roars = fx(tl, "shrek_roar");
  check(roars.length === 3 && J(roars[0].cells) === J([[0, 0], [1, 0], [0, 1]]) && roars[2].cells.length === 5 && roars.every(r => r.dmg === 1),
    "R2: rev = políčko dopadu + ortogonálni susedia (roh 3, stred 5), 1 dmg pri plných HP", J(roars.map(r => r.cells)));
  // krok 1 (0,0): sused (0,1) → p1; krok 2 (3,2): sused (3,1) → p2; krok 3 (2,1): sused (3,1) → p2, (0,1) je ďaleko
  check(s.game.players.p1.hp === 9 && s.game.players.p2.hp === 8, "R3: rev zasiahne len hráčov na kríži (p1 1×, p2 2×)", J([s.game.players.p1.hp, s.game.players.p2.hp]));
  const hits = fx(tl, "hit").filter(h => h.shrek);
  check(hits.length === 3, "R4: zásahy revu sú hit efekty so značkou shrek", J(hits));
  check(s.game.shrek.x === 2 && s.game.shrek.y === 1 && s.game.shrek.done === 0 && s.game.shrek.marks.length === 3, "R5: koniec kola - Shrek na 3. políčku, nové skoky ohlásené");
  // prvý skok ide až po prvom kroku (po akciách oboch hráčov)
  const firstJump = idx(tl, e => e.kind === "shrek_jump");
  const actions = tl.slice(0, firstJump).flatMap(f => (f.effects || []).filter(e => e.kind === "action"));
  check(actions.length === 2, "R6: skok 1 až po 1. akcii oboch hráčov", String(actions.length));
  const c1 = idx(tl, e => e.kind === "shrek_call"), j1 = idx(tl, e => e.kind === "shrek_jump"), r1 = idx(tl, e => e.kind === "shrek_roar");
  check(j1 === c1 + 1 && r1 === j1 + 1 && tl[c1].delayMs === SHREK_CALL_MS && tl[j1].delayMs === SHREK_JUMP_MS
    && J(fx(tl, "shrek_call")[0].cell) === "[0,0]" && tl[c1].shrek.x === 1 && !fx(tl, "shrek_scream").length,
    "R6b: krátky blik cieľa → skok → rev (bez výkriku); počas bliku Shrek stojí", J([c1, j1, r1]));

  for (const [hp, dmg] of [[10, 2], [6, 2], [5, 3], [1, 3]]) {
    const t = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, hp, marks: [[0, 0], [2, 0], [1, 0]] }));
    const r = fx(t.round(PASS3, PASS3), "shrek_roar");
    check(r.every(x => x.dmg === dmg) && t.game.players.p1.hp === 10 - dmg, `R7: pri ${hp} HP rev za ${dmg}`, J(r.map(x => x.dmg)));
  }
  // skamenený hráč: rev ho nezasiahne (ako dlaždice)
  const st = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 1, y: 1, marks: [[0, 0], [2, 2], [1, 2]] }); g.players.p1.stone = 1; });
  st.round([{ type: "stoned" }, PASS, PASS], PASS3);
  check(st.game.players.p1.hp === 10, "R8: skamenený hráč v riadku revu nedostane dmg", String(st.game.players.p1.hp));
}

/* ==================== Strela na spoločné políčko súpera a Shreka ==================== */
console.log("Strela na políčko súpera so Shrekom");
{
  const FAR = [[0, 0], [0, 2], [1, 0]]; // skoky, ktorých rev netrafí (2,1) ani (3,1)
  // p1 (2,1) strieľa doprava na (3,1), kde stojí súper aj Shrek: 3 dmg obom, súper prvý; potom rev (kríž okolo (3,1))
  const s = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 3, y: 1, marks: FAR }); g.players.p1.x = 2; });
  const tl = s.round([atk("right"), PASS, PASS], PASS3);
  const g = s.game, hitAt = idx(tl, e => e.kind === "hit" && e.target === "p2" && !e.shrek), shrekAt = idx(tl, e => e.kind === "shrek_hit");
  check(g.shrek.hp === SHREK_HP - 3, "SH1: Shrek na políčku súpera dostane rovnaký dmg strely", String(g.shrek.hp));
  check(hitAt >= 0 && shrekAt > hitAt, "SH2: najprv zásah súpera, potom Shreka", J([hitAt, shrekAt]));
  check(g.players.p2.hp === 10 - 3 - 1 && g.players.p1.hp === 9, "SH3: potom rev zasiahne súpera aj strelca vedľa", J([g.players.p1.hp, g.players.p2.hp]));
  // štít súpera (p2 začína kolo, štít kryje strelu v tom istom kroku): blok na súperovi, Shrek zásah aj tak dostane
  const s2 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 3, y: 1, marks: FAR }); g.players.p1.x = 2; g.starter = "p2"; });
  s2.round([atk("right"), PASS, PASS], [{ type: "shield" }, PASS, PASS]);
  check(s2.game.shrek.hp === SHREK_HP - 3 && s2.game.players.p2.hp === 9, "SH4: štít kryje súpera, Shrek zásah dostane (súper potom len rev)",
    J([s2.game.shrek.hp, s2.game.players.p2.hp]));
  // klon-návnada Naruta na Shrekovom políčku: klon padne, Shrek dostane zásah (inak by prezradil, že je to klon)
  const s3 = scenario("fire", "naruto", (g) => { shrekSet(g, { x: 3, y: 1, marks: FAR }); g.players.p1.x = 2; g.players.p2.x = 3; g.players.p2.y = 2; g.players.p2.clone = { x: 3, y: 1 }; });
  const tl3 = s3.round([atk("right"), PASS, PASS], PASS3);
  check(fx(tl3, "clone_die").length === 1 && s3.game.shrek.hp === SHREK_HP - 3, "SH5: návnada na Shrekovom políčku - klon padne aj Shrek dostane zásah",
    J([fx(tl3, "clone_die").length, s3.game.shrek.hp]));
}

/* ==================== Rev zabije oboch → bez remízy ==================== */
console.log("Rev smrteľný pre oboch - deterministicky padne 1. hráč kola");
for (const starter of ["p1", "p2"]) {
  // skok 1 na (0,1): rev zasiahne (0,1) aj (1,1) - obaja hráči majú 1 HP
  const s = scenario("fire", "lightning", (g) => {
    shrekSet(g, { x: 3, y: 2, marks: [[0, 1], [2, 2], [1, 2]] });
    g.players.p1.x = 0; g.players.p1.y = 1; g.players.p2.x = 1; g.players.p2.y = 1;
    g.players.p1.hp = 1; g.players.p2.hp = 1; g.starter = starter;
  });
  s.round([R, PASS, PASS], [R, PASS, PASS]);
  const { p1, p2 } = s.game.players, other = starter === "p1" ? "p2" : "p1";
  check(s.game.players[starter].hp === 0 && s.game.players[other].hp === 1, `ND${starter === "p1" ? 1 : 2}: rev zabije len ${starter} (1. v kole), ${other} prežije`, J([p1.hp, p2.hp]));
}

/* ==================== Reakcie ==================== */
console.log("Reakcie na zásah");
{
  // strela → okamžitý rev: Shrek (1,1) zastaví strelu p1 (0,1) → 3 dmg Shrekovi; rev (kríž okolo (1,1)) zasiahne p1 vedľa
  const s = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, marks: QUIET }));
  const tl = s.round([atk("right"), PASS, PASS], PASS3);
  const p1 = s.game.players.p1, p2 = s.game.players.p2;
  check(s.game.shrek.hp === SHREK_HP - 3, "A1: strela sa zastaví o Shreka (3 dmg zblízka)", String(s.game.shrek.hp));
  check(p2.hp === 10, "A2: súper za Shrekom nedostane nič", String(p2.hp));
  const hitAt = idx(tl, e => e.kind === "shrek_hit"), roarAt = idx(tl, e => e.kind === "shrek_roar");
  check(hitAt >= 0 && roarAt === hitAt + 2 && J(fx(tl, "shrek_roar")[0].cell) === "[1,1]" && tl[hitAt].delayMs + tl[hitAt + 1].delayMs === SHREK_HIT_SOUND_MS
    && J(fx([tl[hitAt + 1]], "shrek_scream")[0]?.cell) === "[1,1]",
    "A3: strela → rev po zásahu, až keď dohrá zvuk hitu", J([hitAt, roarAt]));
  check(p1.hp === 9 && p1.mana === 6 - 1 - 2 - 2, "A4: rev zasiahne strelca stojaceho vedľa Shreka (1 dmg), mana sa nemení", J([p1.hp, p1.mana]));
  check(!tl.some(f => (f.effects || []).some(e => e.kind === "shrek_barrel" || e.kind === "shrek_punch" || e.kind === "shrek_mana")), "A5: žiadny sud, punch ani strata many");

  // vzdialená strela: rev okolo Shreka (2,1) zasiahne súpera (3,1) vedľa neho, strelca (0,1) nie
  const s2 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 2, y: 1, marks: QUIET }));
  s2.round([atk("right"), PASS, PASS], PASS3);
  check(s2.game.shrek.hp === SHREK_HP - 2 && s2.game.players.p1.hp === 10 && s2.game.players.p2.hp === 9,
    "A6: rev po vzdialenej strele zasiahne súpera vedľa Shreka, strelca nie", J([s2.game.shrek.hp, s2.game.players.p1.hp, s2.game.players.p2.hp]));

  // melee → okamžitý rev: útočník stojí na Shrekovom políčku, takže ho rev zasiahne
  const s3 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 0, y: 1, marks: QUIET }); g.players.p1.mana = 5; });
  const tl3 = s3.round([M, R, PASS], PASS3);
  check(s3.game.shrek.hp === SHREK_HP - 8, "A7: melee na Shrekovom políčku (8 dmg)", String(s3.game.shrek.hp));
  check(idx(tl3, e => e.kind === "shrek_roar") === idx(tl3, e => e.kind === "shrek_hit") + 2 && s3.game.players.p1.hp === 9,
    "A8: melee → okamžitý rev, zasiahne útočníka na políčku", J([s3.game.players.p1.hp]));

  // special zboku → tackle: Fire (0,1) special na riadok 1 - súper (3,1) aj Shrek (2,1); tackle doľava → prvý v ceste p1
  const s4 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 2, y: 1, marks: QUIET }));
  const tl4 = s4.round([sp(), PASS, PASS], PASS3);
  const tk = fx(tl4, "shrek_tackle")[0];
  check(s4.game.shrek.hp === SHREK_HP - 5 && s4.game.players.p2.hp === 5, "A9: zónový special zasiahne súpera aj Shreka", J([s4.game.shrek.hp, s4.game.players.p2.hp]));
  check(fx(tl4, "shrek_powerup").length === 1 && tk && tk.dir === "left" && J(tk.to) === "[0,1]" && tk.target === "p1",
    "A10: PowerUp + tackle doľava k útočníkovi, zastaví sa na prvej figúre", J(tk));
  check(s4.game.players.p1.hp === 9, "A11: tackle dá rev dmg (1 pri > 10 HP)", String(s4.game.players.p1.hp));
  const ret = fx(tl4, "shrek_return")[0];
  check(ret && J(ret.to) === "[2,1]", "A12: Shrek sa po tackli vráti na štartové políčko", J(ret));
  // tackle na spoločnom políčku zasiahne oboch
  const s5 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 0, y: 1, marks: QUIET }); g.players.p2.x = 3; g.players.p1.x = 3; g.players.p1.y = 1; });
  // p1 na (3,1) s p2: special riadok 1 zasiahne Shreka (0,1) zboku → tackle doprava → na (3,1) stoja obaja
  const tl5 = s5.round([sp(), PASS, PASS], PASS3);
  const v5 = fx(tl5, "hit").filter(h => h.shrek).map(h => h.target).sort();
  check(J(v5.slice(0, 2)) === J(["p1", "p2"]) && J(fx(tl5, "shrek_tackle")[0]?.to) === "[3,1]", "A13: tackle na políčko s oboma hráčmi zasiahne oboch", J(v5));

  // special od útočníka v tom istom stĺpci → okamžitý rev (bez tacklu)
  const s6 = scenario("lightning", "fire", (g) => { shrekSet(g, { x: 1, y: 1, marks: QUIET }); g.players.p1.x = 1; g.players.p1.y = 0; });
  const tl6 = s6.round([sp(), PASS, PASS], PASS3);
  const hitAt6 = idx(tl6, e => e.kind === "shrek_hit"), roarAt6 = idx(tl6, e => e.kind === "shrek_roar");
  check(hitAt6 >= 0 && roarAt6 === hitAt6 + 2 && !fx(tl6, "shrek_tackle").length, "A14: útočník nad Shrekom → rev hneď po zásahu, bez tacklu", J([hitAt6, roarAt6]));
  check(s6.game.shrek.hp === SHREK_HP - 3, "A15: Lightning special zasiahne Shreka na políčku opačnej farby", String(s6.game.shrek.hp));

  // Narutov klon trafí Shreka → okamžitý rev; klon vedľa Shreka dostane len kozmetický zásah a ostane
  const s7 = scenario("naruto", "lightning", (g) => {
    shrekSet(g, { x: 1, y: 0, marks: [[2, 2], [1, 2], [3, 2]] });
    g.players.p1.x = 0; g.players.p1.y = 2; g.players.p1.clone = { x: 0, y: 0 };
  });
  const tl7 = s7.round([atk("right"), R, PASS], PASS3);
  check(s7.game.shrek.hp < SHREK_HP && J(fx(tl7, "shrek_roar")[0]?.cell) === "[1,0]", "A16: strela klona → okamžitý rev", J(s7.game.shrek.hp));
  check(!fx(tl7, "clone_die").length && !!s7.game.players.p1.clone && fx(tl7, "clone_hit").length >= 1, "A17: klon v reve dostane len kozmetický zásah a ostane");
}

/* ==================== Smrť a smrad ==================== */
console.log("Smrť a smrad");
{
  const s = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, hp: 3, marks: QUIET }));
  const tl = s.round([atk("right"), PASS, PASS], PASS3);
  const sh = s.game.shrek;
  check(sh.dead && sh.hp === 0 && fx(tl, "shrek_die").length === 1, "D1: pri 0 HP Shrek padne");
  // zvuk: smrteľný zásah nekričí (bez shrek.hit, bez výkriku), pád hrá zvuk smrti ako pri hráčovi
  {
    const keys = []; const tr = newTracker();
    tl.forEach((f, i) => keys.push(...eventsForFrame(tl, i, { p1: f.p1, p2: f.p2 }, tr).map(e => e.key)));
    check(fx(tl, "shrek_hit")[0]?.lethal === true && !fx(tl, "shrek_scream").length && !keys.includes("shrek.hit") && keys.includes("death"),
      "D1b: smrteľný zásah - bez kriku (shrek.hit), pád so zvukom smrti", J(keys.filter(k => k.startsWith("shrek") || k === "death")));
  }
  check(!fx(tl, "shrek_roar").length && !fx(tl, "shrek_jump").length, "D2: mŕtvy Shrek nereaguje ani neskáče");
  check(sh.marks.length === 0, "D3: mŕtvy Shrek nemá ohlásené skoky");
  // kolo smrti: smrad na jeho políčku; koniec kola: + ortogonálni susedia
  check(sh.stench.length === 5 && fx(tl, "stench_spread").length === 1, "D4: koniec kola smrti - smrad na políčku + 4 susedia", J(sh.stench));
  // (0,1) je susedné → p1 v ďalšom kole dostane 1 dmg po každom kroku
  const tl2 = s.round(PASS3, PASS3);
  check(s.game.players.p1.hp === 7 && s.game.players.p2.hp === 10, "D5: smrad = 1 dmg na konci každého kroku (p1 3×, p2 mimo)", J([s.game.players.p1.hp, s.game.players.p2.hp]));
  check(fx(tl2, "stench_proc").length === 3, "D6: stench_proc pred každým zásahom smradu");
  check(s.game.shrek.stench.length === 10, "D7: ďalšie kolo - smrad sa šíri ďalej (vzdialenosť ≤ 2 od tela = 10 políčok)", J(s.game.shrek.stench));
  // mŕtvy Shrek strely neblokuje
  const s3 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, dead: true, hp: 0, marks: [], stench: [[1, 1]] }));
  s3.round([atk("right"), PASS, PASS], PASS3);
  check(s3.game.players.p2.hp === 9, "D8: strela letí cez mŕtveho Shreka na súpera (1 dmg na 3 políčka)", String(s3.game.players.p2.hp));
  // smrad hru dokončí - smrteľný zásah smradom ukončí hru
  const s4 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 0, y: 1, dead: true, hp: 0, marks: [], stench: [[0, 1]] }); g.players.p1.hp = 2; });
  const tl4 = s4.round(PASS3, PASS3);
  check(s4.game.players.p1.hp === 0 && s4.game.phase === "match_over" && fx(tl4, "stench_proc").length === 2, "D9: smrad zabije - hra končí po 2. kroku", J([s4.game.players.p1.hp, s4.game.phase]));
}

/* ==================== Itemy ==================== */
console.log("Itemy (srdiečko / mana)");
{
  const e0 = createEngine({ seed: 1 });
  const cfg = e0.sanitizeConfig(CFG);
  check(cfg.itemsPerRound === 1 && J(cfg.itemWeights) === J({ heal: 60, mana: 40 }), "I1: default 1 item za kolo, srdiečko 60 / mana 40", J(cfg));
  check(e0.sanitizeConfig({ ...CFG, itemWeights: { heal: 70, mana: 40 } }) === null, "I2: váhy itemov musia dať 100");
  check(e0.sanitizeConfig({ ...CFG, itemsPerRound: 9 }).itemsPerRound === 3, "I3: počet itemov za kolo 1–3");
  // štart hry: 1 item na voľnom políčku (nie pod hráčom ani Shrekom)
  const t0 = createEngine({ seed: 5 });
  t0.startMatch(t0.sanitizeConfig(CFG)); t0.chooseCharacter("A", "fire"); t0.chooseCharacter("B", "lightning");
  const g0 = t0.game, it0 = g0.items[0];
  check(g0.items.length === 1 && !["p1", "p2"].some(s => g0.players[s].x === it0.x && g0.players[s].y === it0.y) && !(g0.shrek.x === it0.x && g0.shrek.y === it0.y),
    "I4: na štarte padne 1 item na voľné políčko", J(g0.items));
  check(Array.isArray(t0.snapshot().items), "I5: itemy sú v snapshote");

  // vstup na srdiečko: +1 HP, item zmizne
  const a = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] }); g.players.p1.hp = 7; g.items = [{ x: 1, y: 1, type: "heal" }]; });
  const tla = a.round([{ type: "move", dir: "right" }, PASS, PASS], PASS3);
  check(a.game.players.p1.hp === 8 && !a.game.items.some(i => i.x === 1 && i.y === 1) && fx(tla, "item_pick").some(e => e.target === "p1" && e.amount === 1),
    "I6: vstup na srdiečko = +1 HP, item zmizne", J([a.game.players.p1.hp, a.game.items]));
  // dash cez kvapku: zoberie ju aj na prebehnutom políčku (mana na plno po zaplatení dashu)
  const b = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] }); g.items = [{ x: 1, y: 1, type: "mana" }]; });
  const tlb = b.round([{ type: "dash", dir: "right" }, PASS, PASS], PASS3);
  check(b.game.players.p1.x === 2 && fx(tlb, "item_pick").some(e => e.type === "mana" && J(e.cell) === "[1,1]" && e.amount === 1), "I7: dash cez kvapku → +1 mana", J([b.game.players.p1.mana, b.game.players.p1.x]));
  // Lightning sa zo srdiečka vylieči do plna
  const c = scenario("lightning", "fire", (g) => { shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] }); g.players.p1.hp = 3; g.items = [{ x: 1, y: 1, type: "heal" }]; });
  c.round([{ type: "move", dir: "right" }, PASS, PASS], PASS3);
  check(c.game.players.p1.hp === 4, "I8: srdiečko dá aj Lightning len +1 HP", String(c.game.players.p1.hp));
  // Narutov klon itemy neberie
  const d = scenario("naruto", "lightning", (g) => {
    shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] });
    g.players.p1.x = 0; g.players.p1.y = 0; g.players.p1.clone = { x: 0, y: 2 }; g.items = [{ x: 1, y: 2, type: "heal" }];
  });
  d.round([{ type: "move", dir: "right" }, PASS, PASS], PASS3);
  check(d.game.players.p1.clone?.x === 1 && d.game.items.some(i => i.x === 1 && i.y === 2), "I9: klon prejde cez item a nechá ho", J(d.game.items));
  // koniec kola: nové itemy (3 za kolo), najviac ITEM_MAX naraz, nikdy dva na jednom políčku
  const f = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] }); g.items = [{ x: 1, y: 0, type: "heal" }, { x: 2, y: 0, type: "mana" }]; },
    { ...CFG, itemsPerRound: 3 });
  const tlf = f.round(PASS3, PASS3);
  const cells = f.game.items.map(i => `${i.x},${i.y}`);
  check(f.game.items.length === 4 && new Set(cells).size === 4 && fx(tlf, "item_drop")[0]?.items.length === 2, "I10: koniec kola - doplní sa po limit 4 (2 nové)", J(f.game.items));
  // labyrint: prekliaty vidí item len na fakľovej bunke
  const l = scenario("fire", "minotaur", (g) => {
    shrekSet(g, { x: 3, y: 0, marks: [[3, 2], [3, 0], [3, 2]] });
    Object.assign(g.players.p1, { labyrinth: true, thread: [[0, 1]] });
    g.items = [{ x: 0, y: 1, type: "mana" }, { x: 2, y: 2, type: "heal" }];
  });
  const snap = l.e.snapshotFor("A");
  check(snap.items.length === 1 && snap.items[0].x === 0, "I11: prekliaty vidí len item pod sebou", J(snap.items));
}

/* ==================== Labyrint ==================== */
console.log("Labyrint (redakcia)");
{
  // p1 prekliaty, lovec p2 (3,1) strelí do Shreka (2,1) → rev zasiahne lovca vedľa Shreka; prekliaty vidí rev (Shrek je
  // verejný), ale nie zásah Shreka lovcom ani zásah lovca
  const s = scenario("fire", "minotaur", (g) => {
    shrekSet(g, { x: 2, y: 1, marks: QUIET });
    g.players.p1.x = 0; g.players.p1.y = 0;
    Object.assign(g.players.p1, { labyrinth: true, thread: [[0, 0]] });
    g.players.p2.mazeBuff = true;
  });
  const tl = s.round(PASS3, [atk("left"), PASS, PASS]);
  const view = JSON.parse(JSON.stringify(s.e.redactTimelineFor("p1", tl)));
  check(fx(tl, "shrek_roar").length >= 1 && fx(tl, "hit").some(h => h.shrek && h.target === "p2"), "L1: lovec trafil Shreka - rev zasiahne lovca");
  check(!fx(view, "shrek_hit").length && !fx(view, "hit").some(h => h.target === "p2"),
    "L2: prekliaty nevidí zásah Shreka lovcom ani zásah lovca");
  check(view.every(f => f.shrek), "L3: Shrek je pre prekliateho verejný (pozícia, HP, skoky)");
  // tackle k skrytému lovcovi: beh aj návrat sa prekliatemu redigujú (zastavenie by prezradilo bunku).
  // Prekliaty je p2, lovec Fire (p1) v riadku Shreka napravo od neho.
  const w = scenario("fire", "minotaur", (g) => {
    shrekSet(g, { x: 0, y: 1, marks: QUIET });
    g.players.p1.x = 2; g.players.p1.y = 1;                 // Fire (lovec) v riadku 1 napravo od Shreka
    g.players.p2.x = 3; g.players.p2.y = 2;
    Object.assign(g.players.p2, { labyrinth: true, thread: [[3, 2]] });
  });
  const tlw = w.round([sp(), PASS, PASS], PASS3);
  const vw = JSON.parse(JSON.stringify(w.e.redactTimelineFor("p2", tlw)));
  check(fx(tlw, "shrek_tackle")[0]?.target === "p1", "L4: special lovca zboku → tackle k lovcovi");
  check(!fx(vw, "shrek_tackle").length && !fx(vw, "shrek_return").length, "L5: prekliaty nevidí tackle ani návrat (bunka lovca)");
}

/* ==================== Obrany proti Shrekovej reakcii ==================== */
console.log("Štít / mirror proti Shrekovi");
{
  // p1 (0,1) strelí do Shreka (2,1), rev zasiahne p2 (3,1) so štítom → blok, štít kryje súperovu akciu
  const s1 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 2, y: 1, marks: QUIET }); g.players.p2.shield = true; });
  const t1 = s1.round([atk("right"), PASS, PASS], PASS3);
  check(s1.game.players.p2.hp === 10 && fx(t1, "block").some(b => b.target === "p2") && !fx(t1, "hit").some(h => h.shrek && h.target === "p2"),
    "D1: štít zablokuje rev, ktorý vyprovokoval súper", J([s1.game.players.p2.hp, fx(t1, "block")]));
  // mirror → odraz do Shreka (bez ďalšej reakcie)
  const s2 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 2, y: 1, marks: QUIET }); g.players.p2.mirror = true; });
  const t2 = s2.round([atk("right"), PASS, PASS], PASS3);
  const m2 = fx(t2, "mirror").find(m => m.target === "p2");
  check(s2.game.players.p2.hp === 10 && s2.game.shrek.hp === SHREK_HP - 2 - 1 && J(m2?.destCell) === "[2,1]"
    && fx(t2, "shrek_hit").length === 2 && fx(t2, "shrek_roar").length === 1 + 3,
    "D2: mirror odrazí rev do Shreka (len zásah, žiadny ďalší rev)", J([s2.game.players.p2.hp, s2.game.shrek.hp, m2]));
  // Fire (0,1) special na riadok: p2 (1,1) so štítom zablokuje priamy zásah → štít sa minie, tackle Shreka (2,1) doľava p2 zasiahne
  const s3 = scenario("fire", "lightning", (g) => {
    shrekSet(g, { x: 2, y: 1, marks: [[3, 0], [3, 2], [2, 0]] }); g.players.p2.x = 1; g.players.p2.shield = true;
  });
  const t3 = s3.round([sp(), PASS, PASS], PASS3);
  check(fx(t3, "block").length === 1 && fx(t3, "shrek_tackle")[0]?.target === "p2" && s3.game.players.p2.hp === 9,
    "D3: štít sa minie na priamom zásahu - tackle tej istej akcie už nekryje", J([fx(t3, "block").length, s3.game.players.p2.hp]));
  const s4 = scenario("fire", "lightning", (g) => {
    shrekSet(g, { x: 2, y: 1, marks: [[3, 0], [3, 2], [2, 0]] }); g.players.p2.x = 1; g.players.p2.mirror = true;
  });
  const t4 = s4.round([sp(), PASS, PASS], PASS3);
  check(fx(t4, "mirror").length === 1 && s4.game.players.p1.hp === 5 && s4.game.players.p2.hp === 9 && s4.game.shrek.hp === SHREK_HP - 5,
    "D4: mirror odrazí priamy zásah, tackle potom dopadne (do Shreka sa nič neodráža)", J([s4.game.players.p1.hp, s4.game.players.p2.hp, s4.game.shrek.hp]));
  // nabitá obrana kryje aj rev, ktorý vyprovokoval sám obranca (A4: strelec vedľa Shreka)
  const s5 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 1, y: 1, marks: QUIET }); g.players.p1.shield = true; });
  s5.round([atk("right"), PASS, PASS], PASS3);
  check(s5.game.players.p1.hp === 10, "D5: nabitý štít kryje aj vlastný vyprovokovaný rev", String(s5.game.players.p1.hp));
  // bežný skok 1-2-3: p2 si nabije štít, rev po kroku 1 ho zasiahne → blok a štít je preč
  // → Shield Breaker p1 v kroku 2 už nemá čo rozbiť
  const s6 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, marks: [[3, 2], [1, 0], [1, 2]] }));
  const t6 = s6.round([PASS, { type: "shield_breaker" }, PASS], [{ type: "shield" }, PASS, PASS]);
  const b6 = idx(t6, e => e.kind === "block" && e.target === "p2"), j6 = idx(t6, e => e.kind === "shrek_roar");
  check(s6.game.players.p2.hp === 10 && b6 > j6 && j6 >= 0, "D6: štít zablokuje bežný skok Shreka", J([s6.game.players.p2.hp, j6, b6]));
  check(t6[b6 + 1]?.p2?.shield === false && fx(t6, "breaker")[0]?.result === "none",
    "D7: Shrek štít minie - súperov Shield Breaker potom nemá efekt", J(fx(t6, "breaker")));
  // mirror na bežnom skoku odrazí do Shreka
  const s8 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, marks: [[3, 2], [1, 0], [1, 2]] }));
  s8.round(PASS3, [{ type: "mirror" }, PASS, PASS]);
  check(s8.game.players.p2.hp === 10 && s8.game.shrek.hp === SHREK_HP - 1, "D8: mirror odrazí bežný skok do Shreka", J([s8.game.players.p2.hp, s8.game.shrek.hp]));
}

/* ==================== Shrek zbiera itemy ==================== */
console.log("Shrek zbiera itemy pri dopade skoku");
{
  const s1 = scenario("fire", "lightning", (g) => {
    shrekSet(g, { x: 1, y: 1, hp: 15, marks: [[1, 0], [2, 2], [1, 2]] });
    g.items = [{ x: 1, y: 0, type: "heal" }, { x: 2, y: 2, type: "mana" }, { x: 2, y: 1, type: "heal" }];
  });
  const t1 = s1.round(PASS3, PASS3);
  const picks = fx(t1, "item_pick").filter(p => p.target === "shrek");
  check(J(picks.map(p => [p.type, p.amount])) === J([["heal", 1], ["mana", 0]]) && s1.game.shrek.hp === 16,
    "S1: srdiečko na dopade = +1 HP Shrekovi, kvapka len zmizne", J([picks, s1.game.shrek.hp]));
  check(s1.game.items.some(i => i.x === 2 && i.y === 1), "S2: item, cez ktorý len preskočil, ostáva", J(s1.game.items));
  const pi = idx(t1, e => e.kind === "item_pick" && e.target === "shrek"), ji = idx(t1, e => e.kind === "shrek_jump"), ri = idx(t1, e => e.kind === "shrek_roar");
  check(ji < pi && pi < ri, "S3: zber medzi dopadom a revom", J([ji, pi, ri]));
  const s2 = scenario("fire", "lightning", (g) => { shrekSet(g, { x: 1, y: 1, marks: QUIET }); g.items = [{ x: 1, y: 0, type: "heal" }]; });
  s2.round(PASS3, PASS3);
  check(s2.game.shrek.hp === SHREK_HP, "S4: plné HP - srdiečko ho nevylieči nad maximum", String(s2.game.shrek.hp));
}

/* ==================== Náhľad skokov ďalšieho kola ==================== */
console.log("Shrek preview (skoky ďalšieho kola)");
{
  const s1 = scenario("fire", "lightning");
  const g = s1.game, snap = s1.e.snapshot().shrek;
  check(g.config.shrekPreview === true && Array.isArray(snap.next) && snap.next.length === 3, "P1: default zapnutý - snapshot nesie 3 skoky ďalšieho kola", J(snap));
  check(new Set([...snap.next, g.shrek.marks[2]].map(String)).size === 4, "P2: ďalšie skoky sú 3 rôzne a žiadny nie je na políčku 3. skoku", J([snap.next, g.shrek.marks]));
  const next = J(snap.next);
  s1.round(PASS3, PASS3);
  check(J(g.shrek.marks) === next && g.shrek.next.length === 3, "P3: po kole platia ohlásené skoky a losuje sa nový náhľad", J([g.shrek.marks, next]));
  const s2 = scenario("fire", "lightning", null, { ...CFG, shrekPreview: false });
  check(s2.game.config.shrekPreview === false && !("next" in s2.e.snapshot().shrek), "P4: vypnutý - snapshot bez náhľadu");
  const b = createEngine({ seed: 1, emitState: () => {} });
  b.startMatch(b.sanitizeConfig({ ...CFG, arena: undefined, tileWeights: { dmg: 100, heal: 0, mana: 0, ik: 0, power: 0, block: 0 } }));
  check(!("shrekPreview" in b.game.config), "P5: stone bridge config bez kľúča shrekPreview");
}

/* ==================== Medúza skamení Shreka ==================== */
console.log("Medúza skamení Shreka");
{
  // Medúza (0,1) special doprava: Shrek (1,0) v zóne → skamenie, 2 skoky vynechá, 3. skočí
  const s1 = scenario("medusa", "lightning", (g) => shrekSet(g, { x: 1, y: 0, marks: [[2, 0], [3, 0], [2, 2]] }));
  const t1 = s1.round([sp({ dir: "right" }), PASS, PASS], PASS3);
  check(fx(t1, "shrek_petrify").length === 1, "M1: Shrek v Medúzinej zóne skamenie", J(fx(t1, "shrek_petrify")));
  check(fx(t1, "shrek_stoned").length === 2 && fx(t1, "shrek_unpetrify").length === 1 && J(fx(t1, "shrek_jump").map(j => j.n)) === "[3]",
    "M2: skamenený vynechá 2 skoky, potom odkamenie a skočí", J(fx(t1, "shrek_jump")));
  check(s1.game.shrek.stone === 0 && s1.game.shrek.x === 2 && s1.game.shrek.y === 2, "M3: koniec kola - odkamenený na 3. políčku", J(s1.game.shrek));
  // skamenený dostane dmg, ale bez výkriku a reakcie
  const s2 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, stone: 2, marks: QUIET }));
  const t2 = s2.round([atk("right"), PASS, PASS], PASS3);
  const h2 = fx(t2, "shrek_hit")[0];
  check(s2.game.shrek.hp === SHREK_HP - 3 && h2?.stone === true && !fx(t2, "shrek_scream").length && fx(t2, "shrek_roar").length === 1
    && s2.game.players.p1.hp === 10, "M4: socha dostane dmg bez výkriku a revu (rev len zo 3. skoku)", J([s2.game.shrek.hp, h2, fx(t2, "shrek_roar").length]));
  // smrteľný zásah sochy - padne normálne
  const s3 = scenario("fire", "lightning", (g) => shrekSet(g, { x: 1, y: 1, hp: 2, stone: 2, marks: QUIET }));
  const t3 = s3.round([atk("right"), PASS, PASS], PASS3);
  check(s3.game.shrek.dead && s3.game.shrek.stone === 0 && fx(t3, "shrek_die").length === 1, "M5: skamenený Shrek môže padnúť (smrad ako vždy)", J(s3.game.shrek));
  // už skamenený - Medúza counter neobnoví
  const s4 = scenario("medusa", "lightning", (g) => shrekSet(g, { x: 1, y: 0, stone: 1, marks: QUIET }));
  const t4 = s4.round([sp({ dir: "right" }), PASS, PASS], PASS3);
  check(!fx(t4, "shrek_petrify").length && fx(t4, "shrek_stoned").length === 1, "M6: už skamenený Shrek sa znova neskamení", J(fx(t4, "shrek_stoned")));
}

/* ==================== THE WORLD (Jotaro) ==================== */
console.log("Shrek počas THE WORLD");
{
  // p2 = Jotaro (nestartér kola 1): THE WORLD ako 1. akcia → pauza → 3 zmrazené akcie → zvyšok kola
  const world = (setup, frozen) => {
    const s = scenario("fire", "jotaro", (g) => { g.players.p2.mana = 10; setup(g); });
    const tl1 = s.round(PASS3, [sp(), PASS, PASS]);
    if (!fx(tl1, "timestop_wait").length) throw new Error("THE WORLD nepozastavil kolo");
    const n = s.timelines.length;
    s.e.timestopActions("B", frozen, (r) => { if (!r?.ok) throw new Error("timestop_actions odmietnuté " + J(r)); });
    return { s, tl: s.timelines.slice(n).flat() };
  };
  const endAt = (tl) => idx(tl, e => e.kind === "timestop_end");
  const PASS_R = () => R; // zmrazená trojica nepozná pass - výplň recharge
  const FAR = [[0, 2], [1, 2], [0, 2]];
  // strela do Shreka v zamrazenom čase: zastaví sa o neho, zásah sa ohlási, dmg + rev až po obnovení času
  {
    const { s, tl } = world((g) => { shrekSet(g, { x: 2, y: 0, marks: FAR }); }, [atk("up_left"), PASS_R(), { type: "shield" }]);
    const ts = idx(tl, e => e.kind === "shrek_ts_hit"), hit = idx(tl, e => e.kind === "shrek_hit"), end = endAt(tl);
    check(ts >= 0 && ts < end, "W1: strela do Shreka v zamrazenom čase sa ohlási (shrek_ts_hit)", J([ts, end]));
    check(hit > end && fx(tl, "shrek_hit")[0]?.dmg === 3 && idx(tl, e => e.kind === "shrek_roar") > hit,
      "W2: dmg (3) a rev dopadnú až po obnovení času", J(fx(tl, "shrek_hit")));
    const shots = fx(tl, "charge").filter(c => c.from === "p2");
    check(shots.length === 1 && shots[0].cell.join() === "2,0" && s.game.shrek.hp <= SHREK_HP - 3, "W3: strela sa o Shreka zastaví (neodrazí sa ďalej)", J(shots));
  }
  // Special 1 (zóna) z iného stĺpca → po obnovení času tackle
  {
    const { tl } = world((g) => { shrekSet(g, { x: 2, y: 0, marks: FAR }); }, [{ type: "special1", dir: "left" }, PASS_R(), { type: "shield" }]);
    check(idx(tl, e => e.kind === "shrek_tackle") > endAt(tl), "W4: Special 1 v zamrazenom čase → tackle po obnovení", J(fx(tl, "shrek_tackle")));
  }
  // Jotaro počas zamrazenia zbiera itemy (pohyb beží naživo)
  {
    const { s, tl } = world((g) => { shrekSet(g, { x: 1, y: 0, marks: FAR }); g.players.p2.hp = 8; g.items = [{ x: 3, y: 0, type: "heal" }]; },
      [{ type: "move", dir: "up" }, PASS_R(), { type: "shield" }]);
    const pick = idx(tl, e => e.kind === "item_pick" && e.target === "p2");
    check(pick >= 0 && pick < endAt(tl) && s.game.players.p2.hp >= 9, "W5: Jotaro zoberie item počas zamrazenia", J(fx(tl, "item_pick")));
  }
}

console.log(`\n${passes} PASS, ${failures} FAIL`);
if (failures) process.exit(1);
