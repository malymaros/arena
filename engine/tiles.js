// engine/tiles.js - Špeciálne dlaždice: efekty na konci kroku, power/block tile, vopred žrebované spawny a IK.
// Továreň dostane E = vnútorný scope enginu (createEngine v engine/game.js): stav hry (E.game) a funkcie
// ostatných sekcií. Vracia svoje funkcie; engine ich zverejní cez E a destrukturuje pre vlastný kód.
import {
  START_HP, MAX_MANA, POWER_TILE_BONUS, SMALL_DELAY_MS, HEAL_TILE_GAIN, IK_DMG,
} from "./constants.js";

export function tilesModule(E) {
// Fire Wizard stojí na Damage dlaždici? Vtedy sa jeho special rozšíri o riadky ±1
// (dlaždice sú trvalé a vznikli v predošlých kolách, takže existujú v čase resolveTurn).
function fireOnDmgTile(me) {
  return !!me && me.char === "fire" &&
    E.game.tiles.some(t => t.type === "dmg" && t.x === me.x && t.y === me.y);
}

function hasTile(x, y) {
  return E.game.tiles.some(t => t.x === x && t.y === y);
}

function hasIK(x, y) {
  return E.game.iks.some(t => t.x === x && t.y === y);
}

// BLOCK tile: figúra na ňom nemôže armovať shield/mirror. Kontroluje majiteľa AJ jeho tieňového klona -
// zdieľaná obrana sa armuje na oboch figúrach naraz, takže klon stojaci na block tile cast tiež zmarí.
// Kontrola je až pri VYKONANÍ (nie vo validQueue) - vlastná pozícia v momente vyhodnotenia nie je pri
// plánovaní istá (charge sa zastavuje o súperovu figúru, trap teleportuje).
function defenseBlockedBy(a) {
  const onBlock = (x, y) => E.game.tiles.some(t => t.type === "block" && t.x === x && t.y === y);
  return !!a && (onBlock(a.x, a.y) || (!!a.clone && onBlock(a.clone.x, a.clone.y)));
}

// POWER tile: caster stojí na ňom v momente vyhodnotenia dmg akcie → vráti +POWER_TILE_BONUS k útoku
// a tile SPOTREBUJE (tile_consume flare). Volá sa hneď po odpočte many - spotreba platí za POUŽITIE útoku,
// aj keď skončí whiffom do steny / blokom / odrazom (rovnaká filozofia ako Fireova konzumácia dmg tile).
// Bonus je flat (NEnásobí sa dealMul/labyrinthMul - klient ho vypisuje ako samostatný „-2" float) a mirror
// ho odráža ako súčasť plného dmg. Narutov klon boost nemá ani tile nespotrebúva (ráta sa LEN majiteľova bunka).
function powerBoost(slot, tl) {
  if (E.frozenActive()) return 0; // THE WORLD (D2): dlaždice sa počas zamrazenia nevyhodnocujú - power inertný, nespotrebuje sa
  const me = E.game.players[slot];
  const idx = E.game.tiles.findIndex(t => t.type === "power" && t.x === me.x && t.y === me.y);
  if (idx < 0) return 0;
  E.game.tiles.splice(idx, 1);
  E.pushStateFrame(tl, [{ kind: "tile_consume", from: slot, cell: [me.x, me.y], tile: "power" }], SMALL_DELAY_MS);
  return POWER_TILE_BONUS;
}

function pickCell(filterFn) {
  const cells = [];
  for (let y = 0; y < E.game.board.h; y++)
    for (let x = 0; x < E.game.board.w; x++)
      if (filterFn(x, y)) cells.push({ x, y });
  return cells.length ? cells[Math.floor(E.rand() * cells.length)] : null;
}

// koniec ťahu: pickupy (heal/mana) a damage políčka (dmg/IK); štít tile damage neblokuje.
// stonedStep = kto bol skamenený na začiatku kroku - skamenená postava sa berie, akoby na políčku nikto nestál
// (žiadny pickup, žiadny dmg/IK), a to aj v kroku, v ktorom jej kameň práve skončil
function endOfStepTileEffects(tl, stonedStep = { p1: false, p2: false }) {
  const order = E.game.starter === "p1" ? ["p1", "p2"] : ["p2", "p1"];
  const stoned = (slot) => stonedStep[slot] || E.game.players[slot].stone > 0;

  // heal/mana - pri oboch hráčoch na rovnakom tile berie ten, kto kolo začína
  for (const slot of order) {
    const p = E.game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue;    // skamenený nezbiera
    if (hasIK(p.x, p.y)) continue; // IK prekrýva => pickup neaktívny
    const idx = E.game.tiles.findIndex(t => (t.type === "heal" || t.type === "mana") && t.x === p.x && t.y === p.y);
    if (idx === -1) continue;
    const tile = E.game.tiles[idx];
    // najprv zvýrazni vyhodnocované políčko, potom aplikuj efekt
    E.pushStateFrame(tl, [{ kind: "tile_proc", tile: tile.type, cell: [p.x, p.y] }], 600);
    E.game.tiles.splice(idx, 1); // jediné spotrebovateľné políčka
    if (tile.type === "heal") {
      // heal dlaždica: +1 HP; postava s kitom healTile "full" (Lightning) sa vylieči na plné HP
      const superHeal = E.kitOf(p.char).healTile === "full";
      const healAmount = superHeal ? START_HP : p.hp + HEAL_TILE_GAIN;
      const healed = Math.min(START_HP, healAmount) - p.hp;
      p.hp += healed;
      if (healed > 0) {
        // Lightning full-heal pasívka: klient ukáže „SUPER HEAL" float namiesto obyčajného +N HP
        E.pushStateFrame(tl, [{ kind: "heal", target: slot, amount: healed, super: superHeal }], SMALL_DELAY_MS);
      } else {
        E.pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnom HP sa spotrebuje naprázdno
      }
    } else {
      const gained = MAX_MANA - p.mana;
      p.mana = MAX_MANA;
      if (gained > 0) {
        E.pushStateFrame(tl, [{ kind: "recharge", from: slot, cells: [[p.x, p.y]], amount: gained }], SMALL_DELAY_MS);
      } else {
        E.pushStateFrame(tl, [], SMALL_DELAY_MS); // pri plnej mane sa spotrebuje naprázdno
      }
    }
  }

  // dmg / IK
  for (const slot of order) {
    const p = E.game.players[slot];
    if (p.hp <= 0) continue;
    if (stoned(slot)) continue; // na skamenenú postavu sa tile dmg/IK nevyhodnocuje
    // (kaster labyrintu dostáva tile dmg/IK normálne ako mimo labyrintu - mazeBuff už nedáva imunitu na dlaždice)
    let dmg = 0, tileType = null;
    if (hasIK(p.x, p.y)) { dmg = IK_DMG; tileType = "ik"; }
    else if (E.game.tiles.some(t => t.type === "dmg" && t.x === p.x && t.y === p.y)) {
      // Fire Wizard už NIE je imunný voči Damage dlaždiciam - dostane bežný 1 dmg;
      // výmenou mu státie na ohnivom políčku rozšíri special o riadky ±1 (viď fireOnDmgTile).
      dmg = E.tileDmg(); tileType = "dmg"; // Portal Realm: 2 (2 ohníky), inak TILE_DMG
    }
    if (dmg > 0) {
      const d = E.recvDmg(slot, dmg);
      // tile dmg labyrint bežne NEkončí - výnimka je smrteľný zásah: pred finálnym dmg sa prehrá
      // rovnaká postupnosť ako pri akciovom zásahu (reveal PRED animáciou, koniec labyrintu po hite),
      // aby smrť nepadla v hmle a hra neskončila s aktívnou redakciou
      const lethalInLab = d >= p.hp && (E.game.players.p1.labyrinth || E.game.players.p2.labyrinth);
      if (lethalInLab) E.revealLabyrinths(tl);
      // najprv zvýrazni vyhodnocované políčko, potom zásah (½ ak má hráč last stand buff - platí aj na tile/IK)
      E.pushStateFrame(tl, [{ kind: "tile_proc", tile: tileType, cell: [p.x, p.y] }], 600);
      p.hp = Math.max(0, p.hp - d);
      E.pushStateFrame(tl, [{ kind: "hit", target: slot, dmg: d }], SMALL_DELAY_MS);
      if (lethalInLab) E.endLabyrinths(tl);
      // prvý mŕtvy okamžite ukončuje hru - druhý tile zásah sa už nevyhodnotí (remíza nemôže nastať)
      if (E.winnerNow()) return;
    }
  }

  // tieňové klony: heal/mana IGNORUJÚ (neberú - nespotrebovaný pickup pod „postavou" klona prezrádza),
  // dmg tile ukáže kozmetický -1 (klona nezabíja), IK tile klona ZNIČÍ (tile dmg labyrint nekončí)
  for (const slot of order) {
    const p = E.game.players[slot];
    if (!p.clone) continue;
    const { x, y } = p.clone;
    if (hasIK(x, y)) {
      E.pushStateFrame(tl, [{ kind: "tile_proc", tile: "ik", cell: [x, y] }], 600);
      E.killClone(slot, tl);
    } else if (E.game.tiles.some(t => t.type === "dmg" && t.x === x && t.y === y)) {
      // rovnaká dramaturgia ako pri hráčovom tile zásahu: NAJPRV rozsvieť políčko (vlastný frame),
      // až POTOM kozmetický zásah na klonovi - inak sa blik políčka „stratí" v spoločnom frame
      E.pushStateFrame(tl, [{ kind: "tile_proc", tile: "dmg", cell: [x, y] }], 600);
      E.pushStateFrame(tl, [{ kind: "clone_hit", target: slot, cell: [x, y], dmg: E.tileDmg() }], SMALL_DELAY_MS);
    }
  }
}

// vyber typ tile podľa percentuálnych váh (dmg/heal/mana/ik/power/block, spolu ~100); null ak sú všetky 0
function rollTileType(weights) {
  const order = ["dmg", "heal", "mana", "ik", "power", "block"];
  const total = order.reduce((a, k) => a + Math.max(0, weights?.[k] || 0), 0);
  if (total <= 0) return null;
  let r = E.rand() * total;
  for (const k of order) {
    r -= Math.max(0, weights?.[k] || 0);
    if (r < 0) return k;
  }
  return order[order.length - 1];
}

// koniec kola: zmaterializuj VOPRED ohlásené zmeny (game.pending - hráči ich celé kolo videli ako preview)
// a hneď vyžrebuj novú sadu na koniec ďalšieho kola. Náhoda sa tak hádže o kolo skôr než dopadne.
function endOfRoundTiles() {
  if (!E.game.config) return;
  commitPendingTiles();
  rollPendingTiles();
}

// vykonaj ohlásené zmeny: presuň každý IK na jeho ohlásený cieľ + spawni ohlásené nové tiles.
// Constraints sa NEprehodnocujú - vyhodnotili sa už pri žrebe (rollPendingTiles) proti budúcemu stavu
// a tiles môžu počas kola už len MIZNÚŤ (pickup, Fireova konzumácia), takže ohlásená bunka ostáva legálna.
function commitPendingTiles() {
  const p = E.game.pending;
  if (!p) return;
  E.game.iks = E.game.iks.map((ik, i) => p.ikMoves[i] ? { ...p.ikMoves[i] } : ik); // pole je paralelné s game.iks
  for (const s of p.spawns) {
    if (s.type === "ik") E.game.iks.push({ x: s.x, y: s.y });
    else E.game.tiles.push({ x: s.x, y: s.y, type: s.type });
  }
  E.game.pending = null;
}

// vyžrebuj zmeny, ktoré dopadnú na konci NASLEDUJÚCEHO kola: cieľ presunu každého IK (dva IK nesmú skončiť
// na rovnakom políčku; ostatné tiles a hráči nevadia) + tilesPerRound nových spawnov podľa percentuálnych váh.
// Všetky constraints sa vyhodnocujú proti BUDÚCEMU stavu dosky (ohlásené IK ciele + ohlásené spawny).
function rollPendingTiles() {
  if (!E.game.config) return;
  const ikMoves = [];
  for (const ik of E.game.iks) {
    const c = pickCell((x, y) => !ikMoves.some(m => m.x === x && m.y === y));
    ikMoves.push(c ? { x: c.x, y: c.y } : { x: ik.x, y: ik.y }); // bez voľného políčka ostane na mieste
  }
  const spawns = [];
  const futureIK = (x, y) => ikMoves.some(m => m.x === x && m.y === y)
    || spawns.some(s => s.type === "ik" && s.x === x && s.y === y);
  const futureTile = (x, y) => hasTile(x, y) || spawns.some(s => s.type !== "ik" && s.x === x && s.y === y);
  const n = Math.max(1, Math.min(3, E.game.config.tilesPerRound || 1));
  for (let k = 0; k < n; k++) {
    const type = rollTileType(E.game.config.tileWeights);
    if (!type) break;
    if (type === "ik") {
      // IK môže vzniknúť hocikde (aj pod hráčom, aj nad iným tile); len nie na budúcej pozícii iného IK
      const c = pickCell((x, y) => !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type: "ik" });
    } else {
      // môže byť aj pod hráčom; nie na existujúcom/ohlásenom tile ani pod budúcim IK
      const c = pickCell((x, y) => !futureTile(x, y) && !futureIK(x, y));
      if (c) spawns.push({ x: c.x, y: c.y, type });
      else {
        // doska je plná special tiles (žiadna bunka pre dmg/heal/mana) → namiesto preskočenia spawnu
        // padne IK BEZ OHĽADU na váhy (IK smie prekryť tiles) - late-game poistka, nech sa hra nezasekne
        const ik = pickCell((x, y) => !futureIK(x, y));
        if (ik) spawns.push({ x: ik.x, y: ik.y, type: "ik" });
      }
    }
  }
  E.game.pending = { ikMoves, spawns };
}

return { fireOnDmgTile, hasTile, hasIK, defenseBlockedBy, powerBoost, pickCell, endOfStepTileEffects, rollTileType, endOfRoundTiles, commitPendingTiles, rollPendingTiles };
}
