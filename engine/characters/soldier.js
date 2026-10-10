// Vojak: snajperský lúč na ZVOLENÚ bunku (akcia nesie cell). 10 dmg tomu, kto na bunke STOJÍ v momente
// výstrelu - súper je zraniteľný, len keď sa pohne (alebo stojaci lovec, keď strieľa prekliaty vojak).
// Ide cez obrany ako každý dmg special; samotného vojaka lúč nikdy nezraní (vlastnú bunku nejde zvoliť).
import { SPECIAL_COST, SMALL_DELAY_MS, SOLDIER_AIM_MS, SOLDIER_BEAM_MS } from "../constants.js";
import { SPECIAL_ZONE_DMG } from "./zone.js";

const validCell = (ctx, c) => !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && ctx.inBounds(c.x, c.y);

export default {
  key: "soldier",
  special: {
    // cieľ nesmie byť vlastná GHOST bunka (pozícia v čase specialu) ani súperova AKTUÁLNA bunka či jeho
    // tieňový klon (obe figúry - blokovanie len pravej by prezradilo, ktorá je skutočná). Výnimka labyrint:
    // prekliaty vojak strieľa naslepo - súperova bunka sa nekontroluje (foe = null), stojaceho lovca trafiť SMIE.
    validate(ctx, a, { x, y, foe }) {
      const c = a.cell;
      if (!validCell(ctx, c)) return false;
      if (c.x === x && c.y === y) return false;
      if (foe) {
        if (foe.x === c.x && foe.y === c.y) return false;
        if (foe.clone && foe.clone.x === c.x && foe.clone.y === c.y) return false;
      }
      return true;
    },
    resolve(ctx, slot, tl, { cell }) {
      const { game } = ctx;
      const actor = game.players[slot];
      if (!validCell(ctx, cell)) { ctx.pushInvalid(tl, slot); return; }
      actor.mana -= SPECIAL_COST;
      const pBonus = ctx.powerBoost(slot, tl); // POWER tile: +2 k lúču; spotreba pri použití - aj keď lúč mine
      const cells = [[cell.x, cell.y]];
      const foeS = ctx.other(slot);
      const foe = game.players[foeS];
      const inZone = !!(foe && foe.x === cell.x && foe.y === cell.y);
      const cloneStruck = !!(foe?.clone && foe.clone.x === cell.x && foe.clone.y === cell.y);
      // istý zásah reálneho hráča (aj do štítu/zrkadla) odhalí prípadný labyrint ešte pred animáciou
      if (inZone) ctx.revealLabyrinths(tl);
      // mierenie: JEDEN dlhý cast frame (sniperka nestrieľa dávkou) - laser sight sa ustáli na cieli
      ctx.pushStateFrame(tl, [{ kind: "special", from: slot, cells }], SOLDIER_AIM_MS);
      // lúč zo zbrane + výbuch na cieľovej bunke - zásah (hit/block/odraz) padne až po dolete
      ctx.pushStateFrame(tl, [{ kind: "soldier_beam", from: slot, cell: [cell.x, cell.y] }], SOLDIER_BEAM_MS);
      const dmg = SPECIAL_ZONE_DMG.soldier * ctx.dealMul(slot) + pBonus;
      // klon-návnada na cieli zomiera (obrana kryje/odráža)
      if (inZone || cloneStruck) ctx.strikeZone(foeS, inZone, cloneStruck, dmg, tl, { kind: "special", bonus: pBonus });
      else ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
    },
  },
};
