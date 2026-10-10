// Vampire (countess, p1) a Onryō (onre, p2): special = skrytá PASCA na zvolenej bunke - BEZ obmedzení
// (aj súperova aktuálna bunka; trigger až pri opätovnom vstupe/prechode). Značku vidí len caster. Max 1
// pasca - recast starú nahradí. Trigger rieši resolveTrapsAfterAction/triggerTrap v engine.
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS, VAMP_CAST_MS } from "../constants.js";
import * as G from "../../shared/geometry.js";

const validCell = (ctx, c) => !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && ctx.inBounds(c.x, c.y);

const trapSpecial = (key) => ({
  key,
  kit: { attack: "diag" }, // diagonálny basic s odrazom (vampShotRoute)
  special: {
    validate: (ctx, a) => validCell(ctx, a.cell),
    resolve(ctx, slot, tl, { cell }) {
      const { game } = ctx;
      const actor = game.players[slot];
      if (!validCell(ctx, cell)) { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= SPECIAL_COST;
      // cast bliká CELOU plochou - pasca môže byť hocikde, plný blik jej polohu neprezradí.
      // Countess: JEDEN dlhý frame (A5 sa hrá RAZ od frame 0); Onre: pôvodné beaty (Scream loop).
      const castCells = G.allCells(game.board);
      if (actor.char === "countess") {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells: castCells }], VAMP_CAST_MS);
      } else {
        for (let r = 0; r < SPECIAL_REPEAT; r++) {
          ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells: castCells }], SPECIAL_BEAT_MS);
        }
      }
      actor.trap = { x: cell.x, y: cell.y };
      ctx.pushStateFrame(tl, [{ kind: "trap_set", from: slot, cell: [cell.x, cell.y] }], SMALL_DELAY_MS);
    },
  },
});

export const countess = trapSpecial("countess");
export const onre = trapSpecial("onre");
