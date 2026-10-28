// public/client/grid.js - doska: bunky (tiles, pending tiles, fog/niť labyrintu, náhľad zón), pasce, projektily
// a stredový cast pri každom renderi.
import { gridEl, TILE_W, TILE_H, GAP } from "/client/dom.js";
import { board, me } from "/client/session.js";
import { actors } from "/client/actors.js";
import { fxOwnsCenter, CHAR_FX } from "/client/fx-registry.js";
import { ANIM_DEF } from "/client/sprites.js";
import { ACTION_ANIMS } from "/chars/index.js";
import { cellsForSpecialPreview } from "/client/zones.js";
import { tileSvg } from "/client/pix.js";
import { FLAME2_SVG } from "/client/portal-art.js";
import { renderPortals } from "/client/portals.js";
import { renderTrapMarkers, renderThreadLines } from "/client/trap-markers.js";
import { reconcileProjectiles } from "/client/board-fx.js";
import { updateSpecialCenter } from "/client/center-cast.js";

/* ---------- Grid (efekty + anim. objekty) ---------- */
export function renderGrid(s, effects = []) {
  gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
  gridEl.style.gridTemplateRows    = `repeat(${board.h}, ${TILE_H}px)`;
  const boardEl = gridEl.parentElement;
  boardEl.style.width  = (board.w * TILE_W + (board.w - 1) * GAP) + "px";
  boardEl.style.height = (board.h * TILE_H + (board.h - 1) * GAP) + "px";
  gridEl.innerHTML = "";
  const portalRealm = s?.config?.arena === "portal";

  // labyrint (Minotaurov special): prekliaty hráč vidí len vlastnú bunku, svoju niť, obrys na nití
  // a špeciálne tiles; dáta o súperovi už rediguje server - hmla je len vizuál nad tým.
  // Aréna sa stmaví OBOM hráčom (aj Minotaurovi), nech je očividné, že hra beží v labyrinte.
  const anyLab = !!(s?.p1?.labyrinth || s?.p2?.labyrinth);
  document.body.classList.toggle("labyrinth-mode", anyLab); // stmavenie arény za boardom - obaja hráči
  const mineLab = me ? s?.[me] : null;
  // labReveal: istý zásah v tomto ťahu - hmla padá už PRED animáciou akcie (aréna ostáva stmavená do labyrinth_end)
  const fogged = !!(mineLab && mineLab.labyrinth && !mineLab.labReveal);
  boardEl.classList.toggle("labyrinth", fogged);
  const fogVisible = new Set();
  // fakľové bunky: vlastná + bunka vlastného tieňového klona (klon = druhá fakľa, osvetľuje rovnako ako hráč)
  const torchCells = new Set();
  if (fogged) {
    if (mineLab.x != null) torchCells.add(`${mineLab.x},${mineLab.y}`);
    if (mineLab.clone) torchCells.add(`${mineLab.clone.x},${mineLab.clone.y}`);
    torchCells.forEach(k => fogVisible.add(k));
    (mineLab.thread || []).forEach(([x, y]) => fogVisible.add(`${x},${y}`));
    if (mineLab.threadMark) fogVisible.add(`${mineLab.threadMark[0]},${mineLab.threadMark[1]}`);
    // špeciálne tiles svietia cez tmu - slepý hráč ich musí vidieť (heal/mana zbiera, dmg/IK sa vyhýba)
    (s?.tiles || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    (s?.iks || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    // preview na ďalšie kolo svieti cez tmu rovnako (server heal/mana spawny mimo fakľových buniek už zredigoval)
    (s?.pending?.spawns || []).forEach(t => fogVisible.add(`${t.x},${t.y}`));
    (s?.pending?.ikMoves || []).forEach(c => fogVisible.add(`${c.x},${c.y}`));
  }
  // Ariadnina niť - bunky s niťou (vlastná niť prekliateho; lovec vidí súperovu, server mu ju posiela)
  const threadSet = new Set();
  for (const sl of ["p1", "p2"]) (s?.[sl]?.thread || []).forEach(([x, y]) => threadSet.add(`${x},${y}`));

  actors.castingNow.p1 = false;
  actors.castingNow.p2 = false;

  const charges  = [];
  const specials = [];
  const meleeCasts = [];
  const procs    = [];
  const cloneHitCells = []; // klon zasiahnutý tile-om → blik jeho bunky (ako hit-blink u hráča)
  const trapFlashCells = []; // trigger pasce (Countess/Onre) - rozžiarenie bunky pre oboch
  let hitTarget  = null;

  // špeciálne políčka (dmg/heal/mana + IK overlay)
  const tileMap = new Map();
  (s?.tiles || []).forEach(t => tileMap.set(`${t.x},${t.y}`, t.type));

  // preview na začiatok ďalšieho kola (config.tilePreview): nové spawny + cieľové bunky presunu IK -
  // kreslí sa ako malý polopriehľadný ghost v rohu bunky (žiadny blik, žiadne podfarbenie - len jemný náznak)
  const pendingMap = new Map();
  (s?.pending?.spawns || []).forEach(t => pendingMap.set(`${t.x},${t.y}`, t.type));
  (s?.pending?.ikMoves || []).forEach(c => pendingMap.set(`${c.x},${c.y}`, "ik"));

  const previewSet = new Set();

  for (const e of effects) {
    if (e?.kind === "charge")    charges.push(e);
    if (e?.kind === "special")   specials.push(e);
    if (e?.kind === "special1")  specials.push(e); // Jotarov útok v mirror slote - rovnaké zvýraznenie zóny + center cast
    if (e?.kind === "timestop_start" && Array.isArray(e.cells)) e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`)); // THE WORLD cast - celoplošný blik
    if (e?.kind === "hit")       hitTarget = e.target;
    if (e?.kind === "tile_proc") procs.push(e);
    if (e?.kind === "clone_hit" && Array.isArray(e.cell)) cloneHitCells.push(e.cell);
    // melee úder - zvýrazni zasahované bunky (server ich posiela v efekte; Medúza má aj diagonály)
    // + zväčšená postava v strede so sekacou animáciou (analógia special overlay)
    if (e?.kind === "melee") {
      const caster = s?.[e.from];
      const cells = Array.isArray(e.cells) ? e.cells : (caster ? [[caster.x, caster.y]] : []);
      cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
      // stredový overlay: Medúza = Attack_1, ostatní Attack_2; vlastný stred z registra fx (Jotaro: PÁR cez centerCast)
      if (!fxOwnsCenter(caster?.char, "melee")) {
        const atk = ANIM_DEF[ACTION_ANIMS[caster?.char]?.melee || "attack2_loop"];
        meleeCasts.push({ from: e.from, file: atk.file, fps: atk.fps });
      }
    }
    // démon útok - blikajú zasahované bunky (všetky okrem kasterovej)
    if (e?.kind === "demon_attack" && Array.isArray(e.cells)) {
      e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
    }
    // vlkolakovo seknutie - zvýrazni bunku terča (ako melee)
    if (e?.kind === "wolf_strike" && Array.isArray(e.cell)) previewSet.add(`${e.cell[0]},${e.cell[1]}`);
    // Luffy: guľa - dopadová bunka bliká počas kotúľa, pri výbuchu celá zóna 3×3; ruka - cieľová bunka pri naťahovaní a údere
    if (e?.kind === "luffy_roll" && Array.isArray(e.target)) previewSet.add(`${e.target[0]},${e.target[1]}`);
    if (e?.kind === "luffy_explode" && Array.isArray(e.cells)) e.cells.forEach(([x, y]) => previewSet.add(`${x},${y}`));
    if ((e?.kind === "luffy_punch" || e?.kind === "luffy_punch_hold") && Array.isArray(e.target)) previewSet.add(`${e.target[0]},${e.target[1]}`);
    // Countess/Onre: seknutie po charge/teleporte - zvýrazni bunku terča; trigger pasce - bunka sa rozžiari
    if (e?.kind === "vamp_strike" && Array.isArray(e.cell)) previewSet.add(`${e.cell[0]},${e.cell[1]}`);
    // efekt autora zrkadlený do veľkého stredového spritu (register fx centerCast; Countess: úder A1 a liečivé
    // beaty A2–A4 ako one-shot od začiatku svojho beatu; Onre stredový overlay nemá; Jotaro: pár pri melee/Special 2)
    const fxCast = e && CHAR_FX[s?.[e.from]?.char]?.centerCast?.(e);
    if (fxCast) meleeCasts.push(fxCast);
    if (e?.kind === "trap_trigger" && Array.isArray(e.cell)) trapFlashCells.push(e.cell);
  }

  for (const sp of specials) {
    const caster = s?.[sp.from];
    if (!caster || !caster.char) continue;
    actors.castingNow[sp.from] = true;
    // Medúzin special posiela zasahované bunky priamo v efekte (majú smer); ostatné sa dopočítajú
    const cells = Array.isArray(sp.cells) ? sp.cells : cellsForSpecialPreview(caster, sp.dir);
    cells.forEach(([x,y]) => previewSet.add(`${x},${y}`));
  }

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const key = `${x},${y}`;
      if (previewSet.has(key)) cell.classList.add("preview-red");
      if (fogged && !fogVisible.has(key)) cell.classList.add("fogged"); // labyrint: tma mimo vlastnej bunky a nite
      else if (fogged && torchCells.has(key)) cell.classList.add("torch-lit"); // vlastná + klonova bunka ožiarené fakľami
      if (threadSet.has(key)) cell.classList.add("thread-cell");

      // tile podfarbenie + ikona; IK prekrýva všetko
      const tileType = tileMap.get(key);
      const isIK = Array.isArray(s?.iks) && s.iks.some(t => t.x === x && t.y === y);
      if (isIK) {
        cell.classList.add("tile-ik");
      } else if (tileType) {
        cell.classList.add(`tile-${tileType}`);
      }
      if (isIK || tileType) {
        const m = document.createElement("span");
        m.className = "tile-marker";
        // Portal Realm: Damage dlaždica dáva 2 dmg → 2 ohníky
        if (!isIK && tileType === "dmg" && portalRealm) { m.classList.add("dmg2"); m.innerHTML = FLAME2_SVG; }
        else m.innerHTML = tileSvg(isIK ? "ik" : tileType);
        cell.appendChild(m);
      }

      // preview budúceho tile - malý ghost v rohu (plná centrovaná ikona = tile ktoré UŽ platí);
      // môže sa krížiť s existujúcim tile len pri cieli presunu IK (IK smie prekryť iné tiles)
      const pendType = pendingMap.get(key);
      if (pendType) {
        const pm = document.createElement("span");
        pm.className = "tile-pending";
        if (pendType === "dmg" && portalRealm) { pm.classList.add("dmg2"); pm.innerHTML = FLAME2_SVG; }
        else pm.innerHTML = tileSvg(pendType);
        cell.appendChild(pm);
      }

      // práve vyhodnocované tile - výrazný blik
      if (procs.some(pc => pc.cell?.[0] === x && pc.cell?.[1] === y)) {
        cell.classList.add("tile-proc");
      }
      // trigger pasce - rozžiarenie bunky (od tohto momentu ju vidia obaja hráči)
      if (trapFlashCells.some(c => c[0] === x && c[1] === y)) cell.classList.add("trap-flash");

      // projektil basic útoku sa NEkreslí do bunky (renderGrid maže grid každý frame → poskakoval by);
      // rieši ho perzistentný plynulý element v #actors cez reconcileProjectiles() nižšie

      // zásahový blik
      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");
      if (cloneHitCells.some(c => c[0] === x && c[1] === y)) cell.classList.add("hit-blink"); // klon na dmg dlaždici - blik bunky
      // aktívne obrany (shield/mirror) sa už nekreslia na bunku - pulzujúci glow je per-postavu (actorFilter)

      gridEl.appendChild(cell);
    }
  }

  renderTrapMarkers(s); // pasca Countess/Onre - statická hlava castera v bunke (vidí ju len on)
  renderPortals(s);     // Portal Realm: portály na hranách dosky (otvorenie/zatvorenie podľa rozdielu snapshotov)

  reconcileProjectiles(charges, s); // plynulé projektily kĺžu v #actors (mimo mazaného gridu)

  renderThreadLines(s);
  // stred, ktorý vlastní register fx (ownCenter), sa vynechá - Escanor: vlastná necyklená choreografia slnka;
  // Jotaro: Special 2 pár cez centerCast, Special 1 ZÁMERNE bez stredu (THE WORLD má vlastný menace spawnWorldCenter)
  updateSpecialCenter(
    specials.filter(sp => !fxOwnsCenter(s?.[sp.from]?.char, sp.kind))
      .concat(meleeCasts)
  );
}
