// engine/ai/sim.js - simulačný engine AI bota (docs/AI_PLAN.md): odohrá jedno kolo z daného vnútorného stavu
// (view.simState) bez frame-ov a bez vonkajšieho sveta. Stav sa pred kolom skopíruje - vstup ostáva nedotknutý.
// Sloty p1/p2 sedia v simulácii vždy na osobách A/B (simState: seats { p1: "A", p2: "B" }).
import { createEngine } from "../game.js";
import { cloneData } from "../constants.js";

const PERSON = { p1: "A", p2: "B" };

export function createSim() {
  const eng = createEngine({ noFrames: true, schedule: () => {} });

  // platná fronta pre slot v danom stave? (stav sa nemení - validQueue je čistá kontrola)
  function valid(state, slot, queue) {
    eng.loadState(state);
    return eng.validQueue(queue, slot);
  }

  // odohraj kolo: queues = { p1, p2 }; tsPolicy(state, slot) → 3 zmrazené akcie pri THE WORLD pauze.
  // Vráti nový stav po kole alebo null, ak engine niektorú frontu neprijal.
  function play(state, queues, rng, tsPolicy = null) {
    eng.loadState(cloneData(state), rng);
    let ok = 0;
    const ack = (r) => { if (r?.ok) ok++; };
    eng.lockIn(PERSON.p1, queues.p1, undefined, ack);
    eng.lockIn(PERSON.p2, queues.p2, undefined, ack);
    if (ok !== 2) return null;
    for (let guard = 0; eng.game.timestop?.mode === "waiting" && guard < 3; guard++) {
      const slot = eng.game.timestop.slot;
      const q = tsPolicy?.(eng.game, slot) ?? [{ type: "recharge" }, { type: "shield" }, { type: "move", dir: "up" }];
      let accepted = false;
      eng.timestopActions(PERSON[slot], q, (r) => { accepted = !!r?.ok; });
      if (!accepted) eng.timestopActions(PERSON[slot], [{ type: "recharge" }, { type: "shield" }, { type: "move", dir: "up" }]);
    }
    return eng.game;
  }

  return { valid, play, engine: eng };
}
