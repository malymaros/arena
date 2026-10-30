// Luffy (skrytá postava viazaná na p1) - zrkadlo Jotara: diagonálny basic, slabšie melee, v mirror slote Special 1,
// special raz za hru a po ňom natrvalo Special 2.
//   Special 1 (mirror slot) = naťahovacia ruka: úder na ĽUBOVOĽNÚ bunku okrem vlastnej (aj na súperovu aktuálnu),
//                             zasiahne toho, kto na nej stojí v momente úderu. Cez obrany ako každý dmg special.
//   Special (guľa)          = nafúkne sa do gule, prekotúľa sa o 1 bunku ←/→ a vybuchne na 3×3 okolo dopadovej
//                             bunky (vrátane nej, Luffyho nezraní). Kotúľ z krajného stĺpca von = spálený special
//                             (wall rule: mana preč, guľa narazí do steny, bez výbuchu). Raz za hru (worldUsed).
//   Special 2               = po guli: susedná bunka ←/→ (ako Jotarov Special 2), ale v SPECIAL_REPEAT úderoch ako
//                             bežné speciály (gatling 3×, zásah po poslednom) - nie jeden krátky beat ako Jotaro.
import { LUFFY_MELEE_DMG, LUFFY_S1_COST, LUFFY_S1_DMG, LUFFY_BALL_DMG, LUFFY_S2_COST, LUFFY_S2_DMG,
         SPECIAL_COST, SPECIAL_REPEAT, SMALL_DELAY_MS, MOVE_MS, ANIM_SLOW } from "../constants.js";
import * as G from "../../shared/geometry.js";
import { lr, zoneStrike } from "./jotaro.js";
import { portalCharge } from "./portal-charge.js";

const LUFFY_BALL_FORM_MS   = Math.round(900 * ANIM_SLOW); // premena na guľu (Special_1) - veľká v strede aj malá na doske
const LUFFY_ROLL_MS        = MOVE_MS;                     // kotúľ o bunku = sklz figúry na klientovi
const LUFFY_EXPLODE_MS     = Math.round(340 * ANIM_SLOW); // výbuch (Special_2) na dopadovej bunke, potom zásah
const LUFFY_PUNCH_REACH_MS = Math.round(320 * ANIM_SLOW); // ruka sa naťahuje k cieľovej bunke
const LUFFY_PUNCH_HIT_MS   = 360;                         // úder + záblesk na cieli (zásah padne v tomto frame)
const LUFFY_PUNCH_BACK_MS  = Math.round(320 * ANIM_SLOW); // ruka sa sťahuje späť

const validCell = (ctx, c) => !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && ctx.inBounds(c.x, c.y);
// kto zo súpera stojí na bunke: hráč a/alebo jeho klon (strikeZone rieši návnadu aj stacknutý pár)
function foeOn(ctx, slot, cells) {
  const foe = ctx.game.players[ctx.other(slot)];
  return {
    inZone: !!(foe && cells.some(([x, y]) => x === foe.x && y === foe.y)),
    cloneStruck: !!(foe?.clone && cells.some(([x, y]) => x === foe.clone.x && y === foe.clone.y)),
  };
}

// Special 1: ruka sa natiahne z Luffyho bunky na cieľ, udrie, stiahne sa. Luffy stojí.
function punch(ctx, slot, tl, { cell }) {
  const me = ctx.game.players[slot];
  // vlastná bunka nie je cieľ (validQueue ju odmietne podľa ghost pozície; sem sa dostane, len ak sa Luffy
  // nepohol podľa plánu - napr. dash bez many) → neprebehne, mana ostáva
  if (!validCell(ctx, cell) || (cell.x === me.x && cell.y === me.y)) { ctx.pushInvalid(tl, slot); return; }
  if (me.mana < LUFFY_S1_COST) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= LUFFY_S1_COST;
  const pBonus = ctx.powerBoost(slot, tl);
  const cells = [[cell.x, cell.y]];
  const { inZone, cloneStruck } = foeOn(ctx, slot, cells);
  if (inZone) ctx.revealLabyrinths(tl); // istý zásah reálneho hráča odhalí labyrint pred animáciou
  const origin = [me.x, me.y], target = [cell.x, cell.y];
  ctx.pushStateFrame(tl, [{ kind: "luffy_punch", from: slot, origin, target }], LUFFY_PUNCH_REACH_MS);
  ctx.pushStateFrame(tl, [{ kind: "luffy_punch_hold", from: slot, origin, target }], LUFFY_PUNCH_HIT_MS);
  const dmg = LUFFY_S1_DMG * ctx.dealMul(slot) + pBonus;
  if (inZone || cloneStruck) ctx.strikeZone(ctx.other(slot), inZone, cloneStruck, dmg, tl, { kind: "special", bonus: pBonus });
  ctx.shrekZone(slot, cells, dmg, tl); // Shrek Swamp: ruka trafila Shreka
  ctx.pushStateFrame(tl, [{ kind: "luffy_punch_back", from: slot, origin, target }], LUFFY_PUNCH_BACK_MS);
}

// Special (guľa, raz za hru): premena → kotúľ o bunku ←/→ → výbuch 3×3 → zásah
function ball(ctx, slot, tl, dir) {
  const me = ctx.game.players[slot];
  me.mana -= SPECIAL_COST;
  me.worldUsed = true; // special sa natrvalo mení na Special 2 (aj keď guľa narazí do steny)
  const pBonus = ctx.powerBoost(slot, tl); // POWER tile sa počíta zo ŠTARTOVEJ bunky (kotúľ až potom)
  // Portal Realm: kotúľ z krajného stĺpca cez hranu s portálom → dopad na druhom konci (guľa = telo AJ útok)
  const landing = G.luffyBallLanding(ctx.game.board, me, dir, ctx.portalList());
  const cells = G.luffyBallCells(ctx.game.board, me, dir, ctx.portalList());
  const passes = landing?.portal ? [{ at: 0, ...landing.portal }] : [];
  const pc = portalCharge(passes);
  const { inZone, cloneStruck } = foeOn(ctx, slot, cells);
  if (inZone) ctx.revealLabyrinths(tl);
  ctx.pushStateFrame(tl, [{ kind: "luffy_ball_form", from: slot, dir }], LUFFY_BALL_FORM_MS);
  if (!landing) {
    // kotúľ z krajného stĺpca von: guľa narazí do steny, nevybuchne - special je spálený
    ctx.pushStateFrame(tl, [{ kind: "luffy_roll", from: slot, dir, wall: true }, { kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
    return;
  }
  me.x = landing.x; me.y = landing.y;
  const fx = [{ kind: "luffy_roll", from: slot, dir, target: [landing.x, landing.y], ...(landing.portal ? { portal: landing.portal } : {}) }];
  ctx.trackPath(slot, [[landing.x, landing.y]], passes, fx);
  if (passes.length) fx.push({ kind: "portal_walk", from: slot, clone: false, dir, path: [[landing.x, landing.y]], passes, charge: "ball" });
  ctx.pushStateFrame(tl, fx, LUFFY_ROLL_MS);
  for (const ps of passes) ctx.bodyEffect(slot, ps, tl);
  ctx.closePortals(passes.map(ps => ps.id), tl);
  ctx.pushStateFrame(tl, [{ kind: "luffy_explode", from: slot, target: [landing.x, landing.y], cells }], LUFFY_EXPLODE_MS);
  const dmg = LUFFY_BALL_DMG * ctx.dealMul(slot) + pBonus + pc.power;
  if (inZone || cloneStruck) ctx.strikeZone(ctx.other(slot), inZone, cloneStruck, dmg, tl, { kind: "special", bonus: pBonus, ...pc.opts });
  else ctx.pushStateFrame(tl, [], SMALL_DELAY_MS);
  ctx.shrekZone(slot, cells, dmg, tl); // Shrek Swamp: Shrek vo výbuchu
}

export default {
  key: "luffy",
  kit: { attack: "diag", mirrorSlot: "special1", meleeDmg: LUFFY_MELEE_DMG }, // ako Jotaro: diagonálny basic, Special 1 v mirror slote, slabšie melee
  special1: {
    args: "cell",
    // cieľ nesmie byť vlastná GHOST bunka (pozícia v čase úderu); súperova aktuálna bunka je platný cieľ
    validate: (ctx, a, { x, y }) => !(a.cell.x === x && a.cell.y === y),
    resolve: punch,
  },
  special: {
    // guľa aj Special 2 sú smerové (left/right)
    validate: (ctx, a) => lr(a.dir),
    resolve(ctx, slot, tl, { dir }) {
      const me = ctx.game.players[slot];
      if (!lr(dir)) { ctx.pushInvalid(tl, slot); return; }
      if (!me.worldUsed) { ball(ctx, slot, tl, dir); return; }
      zoneStrike(ctx, slot, tl, { dir, cells: G.jotaroS2Cells(ctx.game.board, me, dir), cost: LUFFY_S2_COST, dmg: LUFFY_S2_DMG, kind: "special", beats: SPECIAL_REPEAT });
    },
  },
};
