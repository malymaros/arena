// Vlkolak: „moon charge" - rozbehne sa jedným z 8 smerov a zastane na PRVEJ figúre súpera v dráhe
// (klon-návnada absorbuje úder skôr než súper) alebo na okraji plochy. Zásah = WOLF_MOON_DMG[moon] bez
// falloffu, cez obrany ako každý dmg special - vlkolak na bunke terča OSTÁVA STÁŤ aj pri bloku/odraze.
// Bez terča je akcia len presun; charge z okrajovej bunky von sa VYKONÁ podľa wall pravidla.
import { SPECIAL_COST, SMALL_DELAY_MS, MOVE_DELAY_MS, WOLF_DIRS, WOLF_CAST_MS, WOLF_STRIKE_MS, WOLF_MOON_DMG, moonLevelFor } from "../constants.js";
import { portalCharge } from "./portal-charge.js";
import * as G from "../../shared/geometry.js";

export default {
  key: "werewolf",
  // fáza mesiaca 0-3 je odvodená z HP: hneď pri nasadení (aj prenesené HP v turnaji) a na KONCI kola
  // (po tiles, golden mane aj Last Stand heale - nesie ju až finálny frame, klient ukáže float s novou fázou)
  on: {
    deploy(ctx, p) { p.moon = moonLevelFor(p.hp); },
    roundEnd(ctx, p) { p.moon = moonLevelFor(p.hp); },
  },
  special: {
    resolve(ctx, slot, tl, { dir }) {
      const { game } = ctx;
      const actor = game.players[slot];
      const delta = WOLF_DIRS[dir];
      if (!delta) { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= SPECIAL_COST;
      // POWER tile: ráta sa ŠTARTOVÁ bunka (beh je až potom); spotreba aj pri behu bez terča či náraze do steny
      const pBonus = ctx.powerBoost(slot, tl);
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      // dráha po prvú figúru: target null | "clone" | "player" | "stacked" (stacknutý pár = soak, nie plný bait);
      // Portal Realm: ortogonálny charge beží aj cez portály (diagonála do portálov nevchádza)
      const { path, target, passes } = G.DIR4[dir] && ctx.portalList()
        ? G.runPathPortals(game.board, actor.x, actor.y, dir, foe, ctx.portalList())
        : { ...G.runPath(game.board, actor.x, actor.y, delta, foe), passes: [] };
      // charge do steny z okrajovej bunky - rozbehová póza + náraz (OUT OF BOUNDS)
      if (!path.length) {
        ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: [] }], WOLF_CAST_MS);
        ctx.pushStateFrame(tl, [{ kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
        return;
      }
      const pc = portalCharge(passes); // Portal Realm: powerup / Def-breaker na úder po dobehnutí
      const raw = WOLF_MOON_DMG[Math.max(0, Math.min(3, actor.moon || 0))] * ctx.dealMul(slot) * ctx.labyrinthMul(slot) + pBonus + pc.power;
      // istý zásah REÁLNEHO hráča odhalí labyrint pred animáciou; zásah klona-návnady nie
      if (target === "player" || target === "stacked") ctx.revealLabyrinths(tl);
      // rozbehový cast: veľký Run+Attack v strede, malá postava tiež (casting), dráha bliká
      ctx.pushStateFrame(tl, [{ kind: "special", from: slot, dir, cells: path.map(c => [...c]) }], WOLF_CAST_MS);
      // beh na cieľovú bunku jedným sklzom (ako dash); niť labyrintu ráta všetky prejdené bunky
      actor.x = path[path.length - 1][0];
      actor.y = path[path.length - 1][1];
      const fx = [{ kind: "wolf_charge", from: slot, dir }];
      ctx.trackPath(slot, path, passes, fx);
      if (passes.length) fx.push({ kind: "portal_walk", from: slot, clone: false, dir, path, passes, charge: "wolf" });
      ctx.pushStateFrame(tl, fx, MOVE_DELAY_MS);
      // Portal Realm: telo dostane HP/manu, použité páry sa zatvoria (charge = telo AJ útok)
      for (const ps of passes) ctx.bodyEffect(slot, ps, tl);
      ctx.closePortals(passes.map(ps => ps.id), tl);
      if (!target) return; // dobehol na okraj bez terča - len presun
      // seknutie (Attack_2) na bunke terča; dmg/block/odraz dopadne až po ňom
      ctx.pushStateFrame(tl, [{ kind: "wolf_strike", from: slot, cell: [actor.x, actor.y] }], WOLF_STRIKE_MS);
      ctx.strikeCell(foeS, target, raw, tl, { kind: "special", bonus: pBonus, ...pc.opts });
    },
  },
};
