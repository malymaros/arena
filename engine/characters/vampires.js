// Vampire (countess, p1) a Onryō (onre, p2): special = skrytá PASCA na zvolenej bunke - BEZ obmedzení
// (aj súperova aktuálna bunka; trigger až pri opätovnom vstupe/prechode). Značku vidí len caster. Max 1
// pasca - recast starú nahradí. Trigger rieši resolveTrapsAfterAction/triggerTrap v engine.
import { SPECIAL_COST, SPECIAL_REPEAT, SPECIAL_BEAT_MS, SMALL_DELAY_MS, VAMP_CAST_MS, START_HP, MAX_MANA, MELEE_COST, MELEE_REPEAT, VAMP_MELEE_DMG, VAMP_CHARGE_DMG, VAMP_CHARGE_BONUS, DASH_COST, MOVE_DELAY_MS, WOLF_STRIKE_MS, VAMP_TRAP_STRIKE_MS, VAMP_HEAL_BEAT_MS } from "../constants.js";
import * as G from "../../shared/geometry.js";
import { portalCharge } from "./portal-charge.js";

const validCell = (ctx, c) => !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && ctx.inBounds(c.x, c.y);

/* ---- vamp kit: melee na vlastnej bunke, charge (dash slot), bonus (Vampire lieči, Onryō drainuje) ---- */
// bonus po REÁLNE dopadnutom dmg (nie pri bloku - mirror sa voči nim správa tiež ako blok):
// Vampire lieči zo skutočne spôsobeného HP lossu; Onryō najprv odoberie súperovu manu.
// Caster si potom doplní len to, čo sa zmestí do capu - presah prepadá.
// Vampire NElieči naraz so zásahom - pri charge/trap bonuse najprv idú beaty A2 → A3 → A4,
// až po nich sa doplnia HP; Onryō drainuje hneď.
// amount: charge VAMP_CHARGE_BONUS, trap VAMP_TRAP_BONUS.
function vampBonus(ctx, slot, tl, amount, hpSource = amount) {
  const p = ctx.game.players[slot];
  const foeS = ctx.other(slot);
  const foe = ctx.game.players[foeS];
  if (p.char === "countess") {
    for (const a of ["va2", "va3", "va4"]) {
      ctx.pushStateFrame(tl, [{ kind: "vamp_heal_cast", from: slot, anim: a }], VAMP_HEAL_BEAT_MS);
    }
    const healed = Math.min(amount, Math.max(0, hpSource), START_HP - p.hp);
    if (healed > 0) {
      p.hp += healed;
      ctx.pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed }], SMALL_DELAY_MS);
    }
    return;
  }
  const drained = Math.min(amount, Math.max(0, foe.mana));
  if (drained <= 0) return;
  const gained = Math.min(drained, MAX_MANA - p.mana);
  foe.mana -= drained;
  p.mana += gained;
  ctx.pushStateFrame(tl, [{ kind: "mana_drain", from: slot, target: foeS, drained, gained }], SMALL_DELAY_MS);
}

// Dopad Vampire/Onryō melee-typu úderu (own-cell melee / charge / trap) na bunku, kde caster PRÁVE stojí.
// Rieši všetky varianty s Narutovým klonom rovnako ako doMelee (stackedMelee):
//   • samotný hráč      → strikeCell "player" (+ bonus z REÁLNE spôsobeného HP lossu)
//   • klon-návnada sám   → strikeCell "clone" (zožerie úder celý, žiadny bonus)
//   • stacknutý pár       → strikeCell "stacked": s obranou kryje pár ako JEDNA postava (bez bonusu);
//     bez obrany klon pohltí CLONE_DMG (zomrie) a ZVYŠOK úderu prejde na majiteľa (bonus z tohto zvyšku)
// Predtým stacknutý pár zabíjal len klona a majiteľ nedostal nič - chyba (klon nemal byť plný bait
// na vlastnej bunke). bonusAmount 0 = melee bez heal/drain bonusu. consumeDefense: len trap beží mimo
// resolveTurn slučky (ktorá inak spotrebuje súperovu obranu za akciu castera), tak si ju spotrebuje sám.
// Vracia true, ak úder na niečo dopadol (na rozlíšenie whiffu naprázdno).
// powerBonus = POWER tile prídavok už obsiahnutý v raw - len na rozpis hit framu (samostatný „-2" float)
// pt = Portal Realm voľby zásahu (Def-breaker / powerup rozpis) - len charge, ktorý prešiel portálom
export function vampMeleeLand(ctx, ownerSlot, raw, bonusAmount, tl, consumeDefense = false, powerBonus = 0, pt = {}) {
  const me   = ctx.game.players[ownerSlot];
  const foeS = ctx.other(ownerSlot);
  const foe  = ctx.game.players[foeS];
  const foeAt   = !!(foe && foe.x === me.x && foe.y === me.y);
  const cloneAt = !!(foe?.clone && foe.clone.x === me.x && foe.clone.y === me.y);
  const stacked    = foeAt && cloneAt;   // Naruto + klon na jednej bunke
  const playerHere = foeAt && !cloneAt;  // len hráč (klon inde alebo žiadny)
  const decoyHere  = cloneAt && !foeAt;  // klon-návnada sám
  const shieldArmed = foe.shield, mirrorArmed = foe.mirror;
  const defended = (shieldArmed || mirrorArmed) && !pt.defBreak; // Def-breaker: obrana sa minie, bonus dopadne
  if (stacked) {
    // s obranou kryje pár ako jednu postavu; bez nej klon pohltí CLONE_DMG a zvyšok na majiteľa (bonus zo zvyšku)
    const hpBefore = foe.hp;
    ctx.strikeCell(foeS, "stacked", raw, tl, { kind: "melee", bonus: powerBonus, ...pt });
    if (!defended && bonusAmount > 0) vampBonus(ctx, ownerSlot, tl, bonusAmount, hpBefore - foe.hp);
  } else if (playerHere) {
    const hpBefore = foe.hp;
    ctx.strikeCell(foeS, "player", raw, tl, { kind: "melee", bonus: powerBonus, ...pt });
    if (bonusAmount > 0 && !defended) vampBonus(ctx, ownerSlot, tl, bonusAmount, hpBefore - foe.hp);
  } else if (decoyHere) {
    ctx.strikeCell(foeS, "clone", raw, tl, { kind: "melee", ...pt }); // klon-návnada zožerie úder celý
  }
  if (consumeDefense && (playerHere || stacked || decoyHere)) {
    if (shieldArmed) { foe.shield = false; foe.shieldGold = false; }
    if (mirrorArmed) { foe.mirror = false; foe.mirrorGold = false; }
  }
  return playerHere || stacked || decoyHere;
}

// Melee Vampire/Onryō: úder LEN na vlastnej bunke (bez smeru) - VAMP_MELEE_DMG, bez bonusu.
// Vampire opakuje A1 v troch beat-och ako Onryō melee; dmg padá až po celej choreografii.
function doVampMelee(ctx, slot, tl) {
  const me  = ctx.game.players[slot];
  const opS = ctx.other(slot);
  const op  = ctx.game.players[opS];
  if (me.mana < MELEE_COST) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= MELEE_COST;
  // POWER tile: +2 k úderu; spotreba pri použití - aj pri whiffe na prázdnej bunke
  const pBonus = ctx.powerBoost(slot, tl);
  const raw = VAMP_MELEE_DMG * ctx.dealMul(slot) * ctx.labyrinthMul(slot) + pBonus;
  // reálny zásah hráča (aj stacknutého páru s klonom) odhalí labyrint PRED údermi
  if (op && op.x === me.x && op.y === me.y) ctx.revealLabyrinths(tl);
  if (me.char === "countess") {
    for (let r = 0; r < MELEE_REPEAT; r++) {
      ctx.pushStateFrame(tl, [{ kind: "vamp_strike", from: slot, cell: [me.x, me.y], anim: "va1" }], VAMP_TRAP_STRIKE_MS);
    }
  } else {
    for (let r = 0; r < MELEE_REPEAT; r++) {
      ctx.pushStateFrame(tl, [{ kind: "melee", from: slot, cells: [[me.x, me.y]] }], SPECIAL_BEAT_MS);
    }
  }
  vampMeleeLand(ctx, slot, raw, 0, tl, false, pBonus); // own-cell melee bez heal/drain bonusu; klon-návnada/stacknutý pár rieši helper
}

// Charge Vampire/Onryō (nahrádza dash, rovnaká cena): pohybové melee - beh zvoleným smerom po PRVÚ
// figúru súpera (klon-návnada pred hráčom) alebo po okraj (bez cieľa = čisté premiestnenie);
// VAMP_CHARGE_DMG + VAMP_CHARGE_BONUS pri dopadnutom dmg. Na bunke terča OSTÁVA STÁŤ aj pri bloku.
// Charge do steny z okrajovej bunky = wall rule (mana preč, náraz, neprečiarkuje sa).
function doVampCharge(ctx, slot, dir, tl) {
  const me  = ctx.game.players[slot];
  const opS = ctx.other(slot);
  const op  = ctx.game.players[opS];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) { ctx.pushInvalid(tl, slot); return; }
  if (me.mana < DASH_COST) { ctx.pushInvalid(tl, slot, SMALL_DELAY_MS, "mana"); return; }
  me.mana -= DASH_COST;
  // POWER tile: ráta sa ŠTARTOVÁ bunka (caster na nej stojí v momente vyhodnotenia akcie, beh je až potom);
  // spotreba pri použití - aj keď charge skončí čistým premiestnením bez terča či nárazom do steny
  const pBonus = ctx.powerBoost(slot, tl);
  const raw = VAMP_CHARGE_DMG * ctx.dealMul(slot) * ctx.labyrinthMul(slot) + pBonus;

  // dráha: krok za krokom po okraj; stop na PRVEJ figúre (klon-návnada / hráč / stacknutý pár);
  // Portal Realm: charge beží aj cez portály (telo dostane HP/manu, úder powerup / Def-breaker)
  const { path, target, passes } = ctx.portalList()
    ? G.runPathPortals(ctx.game.board, me.x, me.y, dir, op, ctx.portalList())
    : { ...G.runPath(ctx.game.board, me.x, me.y, delta, op), passes: [] };
  const pc = portalCharge(passes);
  const hit = !!target;
  if (!path.length) {
    ctx.pushStateFrame(tl, [{ kind: "wall_bump", from: slot, dir }], SMALL_DELAY_MS);
    return;
  }
  me.x = path[path.length - 1][0];
  me.y = path[path.length - 1][1];
  // istý zásah reálneho hráča (aj stacknutého páru, aj do obrany) - odhaľ labyrint pred behom
  if (op && op.x === me.x && op.y === me.y) ctx.revealLabyrinths(tl);
  const fx = [{ kind: "vamp_charge", from: slot, dir }];
  ctx.trackPath(slot, path, passes, fx);
  if (passes.length) fx.push({ kind: "portal_walk", from: slot, clone: false, dir, path, passes, charge: "vamp" });
  ctx.pushStateFrame(tl, fx, MOVE_DELAY_MS);
  for (const ps of passes) ctx.bodyEffect(slot, ps, tl);
  ctx.closePortals(passes.map(ps => ps.id), tl);
  if (!hit) return; // dobehla na okraj bez terča - len presun
  // Vampire seká A1 (jednotný úder podľa attack guide), Onryō pôvodný vampstrike (alias Attack_3)
  ctx.pushStateFrame(tl, [{ kind: "vamp_strike", from: slot, cell: [me.x, me.y],
    ...(me.char === "countess" ? { anim: "va1" } : {}) }], WOLF_STRIKE_MS);
  vampMeleeLand(ctx, slot, raw + pc.power, VAMP_CHARGE_BONUS, tl, false, pBonus, pc.opts); // hráč / klon-návnada / stacknutý pár rieši helper
}

const trapSpecial = (key) => ({
  key,
  // diagonálny basic s odrazom (vampShotRoute); súperov mirror sa voči ich dmg správa ako štít
  kit: { attack: "diag", mirrorImmune: true },
  // dash slot = charge, melee = úder na vlastnej bunke (bez smeru)
  dash: doVampCharge,
  melee: doVampMelee,
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
