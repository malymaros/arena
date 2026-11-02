// test/ai-view.mjs - AI bot fáza A1 (docs/AI_PLAN.md): pohľad bota a stav pre simuláciu.
//  1. ÚPLNOSŤ: stav poskladaný (engine/ai/view.js simState) z NEredigovaných payloadov (snapshot + celá timeline)
//     odohrá kolo bit-identicky so skutočným enginom - simulácia nič nevynecháva.
//  2. FÉROVOSŤ: zmena skrytých častí skutočného stavu (súperova pasca, poloha/mana lovca v labyrinte, súperov
//     rozpracovaný draft, budúce dlaždice pri vypnutom preview, herný rand) nezmení NIČ z toho, čo bot dostane
//     (snapshotFor) - bot rozhoduje len z týchto payloadov, takže jeho rozhodnutie od skrytého stavu závisieť nemôže.
// Spustenie: node test/ai-view.mjs [zápasov na dvojicu=1]
import { createEngine } from "../engine/game.js";
import { CHARS, seededRng } from "../engine/constants.js";
import { createBelief, simState } from "../engine/ai/view.js";
import { createSim } from "../engine/ai/sim.js";
import { candidate } from "../tools/random-bot.mjs";

const N = Number(process.argv[2]) || 1;
const P1_POOL = [...CHARS, "countess", "luffy"];
const P2_POOL = [...CHARS, "onre", "jotaro"];
const other = (s) => (s === "p1" ? "p2" : "p1");
let sampled = 0, sampledRejected = 0, fails = 0, rounds = 0, fairChecks = 0, hiddenSeen = { trap: 0, lab: 0, preview: 0 };
const fail = (msg) => { fails++; if (fails <= 5) console.log("  FAIL " + msg); };

function randomQueue(engine, slot, rng) {
  const g = engine.game;
  for (let i = 0; i < 2000; i++) {
    const q = candidate(rng, g.board, g.players[slot].stone, g.starter === slot);
    if (engine.validQueue(q, slot)) return q;
  }
  return null;
}

// porovnávaný výsledok kola (kľúče zoradené; draft = rozpracovaná voľba, ktorú snapshot zámerne nenesie)
// (sloty, nie osoby - simulácia sedí vždy p1=A)
const canon = (v) => v === null || typeof v !== "object" ? JSON.stringify(v)
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]"
  : "{" + Object.keys(v).filter(k => k !== "draft").sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
// bez preview sú budúce dlaždice skryté aj pre „vševediaci" pohľad → porovnaj len hráčov a kolo
const outcome = (g, preview) => canon({ p1: g.players.p1, p2: g.players.p2, turn: g.turn, starter: g.starter,
  ...(preview ? { tiles: g.tiles, iks: g.iks, pending: g.pending } : {}) });

const sim = createSim();
const pairs = P1_POOL.flatMap(a => P2_POOL.map(b => [a, b]));
pairs.forEach(([ch1, ch2], pi) => {
  for (let m = 0; m < N; m++) {
    const seed = 9000 + pi * 100 + m;
    const preview = pi % 3 !== 0; // časť zápasov s vypnutým preview dlaždíc
    let over = false;
    const full = createBelief();                 // „vševediaci" belief - pre test úplnosti
    full.onYouAre({ slot: "p1" });
    const red = { A: createBelief(), B: createBelief() }; // skutočné (redigované) pohľady oboch osôb - ako dostane bot
    const main = createEngine({
      seed, schedule: () => {},
      emit: (ev) => { if (ev === "game_result") over = true; },
      emitState: (tl) => {
        full.onState({ ...main.snapshot(), ...(tl ? { timeline: tl } : {}) });
        for (const person of ["A", "B"]) {
          const slot = main.slotForPerson(person);
          red[person].onState({ ...main.snapshotFor(person), ...(tl ? { timeline: main.redactTimelineFor(slot, tl) } : {}) });
        }
      },
    });
    main.startMatch(main.sanitizeConfig({
      format: "single", tilesPerRound: 2, timer: "off", tilePreview: preview, colorPref: "white",
      tileWeights: { dmg: 36, heal: 15, mana: 15, ik: 4, power: 15, block: 15 },
    }));
    main.chooseCharacter("A", ch1);
    main.chooseCharacter("B", ch2);
    full.onState(main.snapshot());
    for (const person of ["A", "B"]) { red[person].onYouAre({ slot: main.slotForPerson(person) }); red[person].onState(main.snapshotFor(person)); }
    const rng = seededRng(seed * 13 + 1);
    for (let r = 0; r < 40 && !over; r++) {
      const g = main.game;
      if (g.timestop) break;
      const q = { p1: randomQueue(main, "p1", rng), p2: randomQueue(main, "p2", rng) };
      if (!q.p1 || !q.p2) break;

      // --- 2. férovosť: varianty skutočného stavu líšiace sa len skrytými poľami ---
      for (const person of ["A", "B"]) {
        const me = main.slotForPerson(person), opp = other(me);
        const base = JSON.stringify(main.snapshotFor(person));
        const st = main.exportState();
        const o = st.players[opp], mine = st.players[me];
        let mutated = false;
        if (o.trap) { o.trap = { x: (o.trap.x + 1) % 4, y: (o.trap.y + 2) % 3 }; mutated = true; hiddenSeen.trap++; }
        if (mine.labyrinth && !mine.labReveal) {
          // lovec inam (mimo môjho políčka a klona = fakle, tam ho legitímne vidím), iná mana
          const torch = (x, y) => (x === mine.x && y === mine.y) || (mine.clone && x === mine.clone.x && y === mine.clone.y);
          for (let k = 0; k < 12; k++) { const x = k % 4, y = Math.floor(k / 4); if (!torch(x, y) && !torch(o.x, o.y) && (x !== o.x || y !== o.y)) { o.x = x; o.y = y; break; } }
          o.mana = (o.mana + 3) % 11; mutated = true; hiddenSeen.lab++;
        }
        if (!preview && st.pending) { st.pending.spawns = st.pending.spawns.map(s => ({ ...s, x: (s.x + 1) % 4 })); mutated = true; hiddenSeen.preview++; }
        o.draft = { queue: [{ type: "melee" }], golden: true, goldenMirror: false, goldenMana: true, lastStand: false, lastHope: false };
        const alt = createEngine({ schedule: () => {} });
        alt.loadState(st, seededRng(12345));
        fairChecks++;
        if (JSON.stringify(alt.snapshotFor(person)) !== base) fail(`${ch1}/${ch2} seed ${seed} kolo ${r + 1}: skrytý stav presakuje do pohľadu ${person} (mutated=${mutated})`);
      }

      // --- 3. redigovaný pohľad: determinizácie sú platné stavy, simulácia v nich odohrá vlastnú frontu ---
      for (const person of ["A", "B"]) {
        const me = main.slotForPerson(person);
        for (let k = 0; k < 3; k++) {
          const ds = simState(red[person], seededRng(seed + r * 7 + k));
          sampled++;
          const opp = other(me), oq = [{ type: "recharge" }, { type: "move", dir: "up" }, { type: "shield" }];
          let rr = null;
          try { rr = sim.play(ds, { [me]: q[me], [opp]: oq }, seededRng(k)); } catch (e) { fail(`${ch1}/${ch2} seed ${seed}: simulácia determinizácie spadla: ${e.message}`); continue; }
          if (!rr) sampledRejected++;
        }
      }

      // --- 1. úplnosť: simulácia zo „vševediaceho" pohľadu = skutočné kolo ---
      const rs = Math.floor(rng() * 2 ** 31);
      const st = simState(full, seededRng(1));
      const res = sim.play(st, q, seededRng(rs));
      main.loadState(main.game, seededRng(rs));
      let ok = 0;
      main.lockIn(g.seats.p1, q.p1, undefined, (x) => { if (x?.ok) ok++; });
      main.lockIn(g.seats.p2, q.p2, undefined, (x) => { if (x?.ok) ok++; });
      if (ok !== 2) { fail(`${ch1}/${ch2} hlavný engine neprijal fronty`); break; }
      rounds++;
      if (main.game.timestop) break; // THE WORLD: simulácia dohrá kolo s vlastnou politikou - neporovnateľné
      if (!res) { fail(`${ch1}/${ch2} seed ${seed} kolo ${r + 1}: simulácia neprijala fronty`); continue; }
      if (outcome(res, preview) !== outcome(main.game, preview)) { if (process.env.AI_DBG) for (const sl of ["p1","p2"]) for (const k in main.game.players[sl]) if (JSON.stringify(res.players[sl][k]) !== JSON.stringify(main.game.players[sl][k])) console.log(sl, k, JSON.stringify(res.players[sl][k]), "real", JSON.stringify(main.game.players[sl][k])); fail(`${ch1}/${ch2} seed ${seed} kolo ${r + 1}: simulácia ≠ skutočné kolo`); }
    }
  }
});

console.log(`ai-view: ${sampled} determinizácií (${sampledRejected} s odmietnutou frontou), ${rounds} kôl úplnosti, ${fairChecks} kontrol férovosti (skryté: pasca ${hiddenSeen.trap}, labyrint ${hiddenSeen.lab}, preview ${hiddenSeen.preview})`);
if (fails) { console.log(`ai-view: ${fails} CHÝB`); process.exit(1); }
console.log("ai-view: OK");
