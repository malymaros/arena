// public/client/placement.js - otočenie a umiestnenie figúr: smer pohľadu (computeFacing + otočenie po streľbe),
// odstup na zdieľanej bunke (pairShift podľa registra postáv), levelová veľkosť (Escanor pride / vlkolakov
// mesiac) a positionActors (hráči, klony, ghost, YOU značka, figúry z registra fx).
import { SIZE_LEVEL, PAIR_SHIFT, HEAD_TOP, HEAD_CX } from "/chars/index.js";
import { actors } from "/client/actors.js";
import { state, me } from "/client/session.js";
import { actorP1, actorP2, cellToPx, TILE_W, TILE_H, rowZ } from "/client/dom.js";
import { ACTOR_W, ACTOR_H } from "/client/sprites.js";
import { CHAR_FX, fxAll } from "/client/fx-registry.js";
import { cloneEls, youMarker } from "/client/actor-layers.js";
import { MOVE_MS } from "/client/anim.js";

/* ---------- živá pozícia figúr bez čítania DOM (výkon, docs/PERF_PLAN.md etapa 3) ---------- */
// Postavy a klony kĺžu cez CSS transition left/top (lineárne, MOVE_MS = --move-ms). Kto potrebuje ich AKTUÁLNU
// (interpolovanú) pozíciu každý frame (démon za postavou, nabíjacie aury), by inak čítal getComputedStyle - to
// vynúti prepočet štýlov uprostred frame-u. Preto si pri každom zápise cieľa pamätáme pohyb a pozíciu dopočítame.
// Kľúč: "p1"/"p2" = postava, "clone:p1"/"clone:p2" = tieňový klon.
const motion = {};
function trackMove(key, x, y, snap) {
  const now = performance.now();
  const m = motion[key];
  if (snap || !m) { motion[key] = { x0: x, y0: y, x1: x, y1: y, t0: now }; return; }
  if (m.x1 === x && m.y1 === y) return; // rovnaký cieľ → CSS transition sa nereštartuje
  const cur = liveActorPos(key, now);
  motion[key] = { x0: cur.left, y0: cur.top, x1: x, y1: y, t0: now };
}
/** Aktuálna (interpolovaná) left/top figúry v px - rovnaká hodnota, akú by vrátil getComputedStyle. */
export function liveActorPos(key, now = performance.now()) {
  const m = motion[key];
  if (!m) return { left: 0, top: 0 };
  // Portal Realm: figúra práve ide cez trhlinu - poloha = cieľ + posun z dráhy (animatePortalWalk)
  const pp = actors.portalPath[key];
  if (pp) {
    const f = (now - pp.t0) / pp.ms;
    if (f >= 1 || f < 0) delete actors.portalPath[key];
    else {
      let i = 1;
      while (i < pp.pts.length - 1 && pp.pts[i].o < f) i++;
      const a = pp.pts[i - 1], b = pp.pts[i], k = b.o > a.o ? (f - a.o) / (b.o - a.o) : 1;
      return { left: m.x1 + a.x + (b.x - a.x) * k, top: m.y1 + a.y + (b.y - a.y) * k };
    }
  }
  const k = MOVE_MS > 0 ? Math.min(1, Math.max(0, (now - m.t0) / MOVE_MS)) : 1;
  return { left: m.x0 + (m.x1 - m.x0) * k, top: m.y0 + (m.y1 - m.y0) * k };
}

/* ---------- Facing + umiestnenie ---------- */
export function computeFacing(p1, p2) {
  if (!p1 || !p2 || p1.x == null || p2.x == null) return { p1: 1, p2: -1 }; // skrytý súper (labyrint) → default
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
// horizontálny rozostup postáv na ZDIEĽANOM políčku (p1 doľava, p2 doprava) - veľké postavy (Medúza)
// potrebujú väčší, pokojne aj s presahom do susedných políčok, inak sa sprity škaredo prekrývajú
// Escanor: veľkosť rastie o 20 % za pride level; škáluje sa od nôh. FEET_FRAC = kde nohy sedia v ACTOR canvase
// (feet-anchor spritov ~0.97 výšky) - origin škálovania, aby postava ostala na zemi a nedvíhala sa medzera pod ňou.
export const ESC_FEET_FRAC = 0.973;
// levelová veľkosť postavy: Escanor = pride, Vlkolak = fáza mesiaca (rast 1.2^level od nôh);
// vlkolakova ZÁKLADNÁ forma (nov) je zmenšená na 0.7× a rastie z nej (spln ≈ 1.21×), Escanor od 1×.
// actors.escPrideDisplay drží počas prehrávania kola STARÝ level pre oba prípady (nová veľkosť až po floate)
export const escPrideMul = a => {
  const sl = SIZE_LEVEL[a?.char]; // register: sizeLevel { stat, base }
  if (!sl) return 1;
  const lvl = a[sl.stat] || 0;
  const base = sl.base;
  // držanú veľkosť aplikuj len keď patrí TEJ ISTEJ postave (swap v strede kola mení char → inak by
  // sa napr. vlkolakov mesiac 3 aplikoval na čerstvo swapnutého Escanora a nafúkol ho)
  const held = (a.slot && actors.escPrideDisplay[a.slot] != null && actors.escPrideDisplayChar[a.slot] === a.char) ? actors.escPrideDisplay[a.slot] : null;
  const pr = held != null ? held : lvl;
  return base * Math.pow(1.2, Math.max(0, Math.min(3, pr)));
};
export const PAIR_SHIFT_DEFAULT = 22;
// pozn. labyrint: prekliatemu klientovi server skrýva súperovu pozíciu (x null) → pairShift preňho vráti 0.
// Výnimka: keď lovec PRÁVE stojí na mojej ožiarenej bunke (server flag hunterHere - bunka je aj tak
// prezradená), vlastný sprite odstúpi presne ako pri normálnej zdieľanej bunke mimo labyrintu.
export function pairShift(slot, s = state) {
  const p1 = s?.p1, p2 = s?.p2;
  if (!p1 || !p2) return 0;
  const a = s?.[slot];
  const mag = PAIR_SHIFT[a?.char] ?? PAIR_SHIFT_DEFAULT; // konštantný odsun (nezávisí od pride veľkosti)
  if (p1.x != null && p1.x === p2.x && p1.y === p2.y) return slot === "p1" ? -mag : mag;
  if (a?.labyrinth && a.x != null && (a.hunterHere || []).some(([hx, hy]) => hx === a.x && hy === a.y))
    return slot === "p1" ? -mag : mag;
  return 0;
}
export function currentFacing(slot, facing) {
  const ov = actors.facingOverride[slot];
  if (ov && ov.sx && performance.now() < ov.until) return ov.sx;
  return facing[slot];
}
export function positionActors(s, immediate = false) {
  const p1 = s.p1, p2 = s.p2;
  const same = p1 && p2 && p1.x === p2.x && p1.y === p2.y;
  const facing = computeFacing(p1, p2);

  [["p1", actorP1, p1], ["p2", actorP2, p2]].forEach(([slot, el, data]) => {
    // labyrint: súper so skrytou pozíciou (x null) sa nekreslí vôbec
    if (!data || !data.char || data.x == null) { el.style.display = "none"; return; }
    const wasHidden = el.style.display === "none";
    el.style.display = "block";
    el.style.zIndex = rowZ(data.y); // nižší riadok prekrýva vyšší
    const { left, top } = cellToPx(data.x, data.y);
    // canvas je väčší než bunka - horizontálne centrovať, vertikálne ukotviť na spodok bunky
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);

    // wasHidden: odhalenie po labyrinte nesmie doslidovať zo starej pozície - umiestni sa okamžite
    // portalSnap: prechod portálom - cestu cez trhlinu animuje client/portals.js (žiadny sklz naprieč doskou)
    if (immediate || !actors.actorsInitialized || wasHidden || actors.portalSnap[slot]) {
      el.style.transition = "none";
      el.style.left = px + "px";
      el.style.top  = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
      trackMove(slot, px, py, true);
    } else {
      el.style.left = px + "px";
      el.style.top  = py + "px";
      trackMove(slot, px, py, false);
    }

    const shift = pairShift(slot, s);
    const scale = currentFacing(slot, facing);
    // summon póza (Special_2): skutočný Naruto v NORMÁLNEJ výške stojí pri jednom okraji bunky, kópia zrkadlovo
    // pri druhom (orez bočného okraja spritu v raf ich zúži). positionActors sa cez summon beat volá, preto
    // pózu držíme tu (inak by ju hneď prepísal).
    // Escanor: veľkosť postavy = indikátor pride levelu (rastie o 20 % za level, od nôh nahor)
    const prideMul = escPrideMul(data);
    const pose = actors.cloneSummonPose[slot];
    if (pose && performance.now() < pose.until) {
      el.style.transformOrigin = "50% 100%";
      el.style.transform = `translateX(${shift - (facing[slot] || 1) * pose.off}px) scaleX(${facing[slot] || 1})`;
    } else if (prideMul !== 1) {
      el.style.transformOrigin = `50% ${ESC_FEET_FRAC * 100}%`; // rast od pät (nohy ostanú na zemi, žiadna medzera)
      el.style.transform = `translateX(${shift}px) scaleX(${scale * prideMul}) scaleY(${prideMul})`;
    } else {
      el.style.transformOrigin = "";
      // posun tela z registra fx (Jotaro pri útoku cúvne DOZADU na miesto, kde stál stand)
      const backShift = CHAR_FX[data.char]?.bodyShift?.(slot, scale || 1) || 0;
      el.style.transform = `translateX(${shift + backShift}px) scaleX(${scale})`;
    }

    el.dataset.slot = slot;
    if (same) el.dataset.pair = "1"; else el.removeAttribute("data-pair");
  });

  // tieňové klony - pozícia/facing ako majiteľ; klon je VŽDY viditeľný a PLNE KRYCÍ (identická figúra ako Naruto),
  // aby bolo vidno, že Naruto má klona. Na majiteľovej bunke stojí len jemne posunutý (STACK_OFFSET px);
  // pri rozdelení sa obe figúry rozbehnú SÚBEŽNE zo spoločnej bunky (klon vždy KĹŽE - nikdy nezmizne na mieste).
  [["p1", cloneEls.p1, p1, p2], ["p2", cloneEls.p2, p2, p1]].forEach(([slot, el, data, opp]) => {
    const c = data?.clone;
    // klon už puffol (clone_die) - drž ho skrytého, aj keď ho snapshot toho istého framu ešte nesie (žiadny problik)
    // (majiteľ so skrytou pozíciou x null a viditeľným klonom = labyrint peek: odhalený je len klon)
    if (actors.cloneDead[slot] || !data || !data.char || !c) {
      el.style.display = "none";
      el._logCell = null;
      return;
    }
    const { left, top } = cellToPx(c.x, c.y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const onOwner = (c.x === data.x && c.y === data.y);
    const wasHidden = el.style.display === "none";
    const STACK_OFFSET = 18; // klon na majiteľovej bunke: jemný posun, aby bolo vidno dve figúry
    // zdieľaná bunka so súperom → rozostup ako postavy (rovnaká char-aware hodnota ako pairShift majiteľa,
    // inak by sa owner a klon rozišli rôzne ďaleko a prezradili, ktorý je pravý); na majiteľovej bunke + STACK_OFFSET
    // labyrint: lovec (skrytá pozícia) na bunke MÔJHO klona = druhá fakľa (hunterHere) → rovnaký rozostup
    const foeMag = PAIR_SHIFT[data.char] ?? PAIR_SHIFT_DEFAULT;
    const hunterOnClone = !!(data.labyrinth && (data.hunterHere || []).some(([hx, hy]) => hx === c.x && hy === c.y));
    const foeShift = ((opp && opp.x === c.x && opp.y === c.y) || hunterOnClone)
      ? (slot === "p1" ? -foeMag : foeMag) : 0;
    const shift = foeShift + (onOwner ? STACK_OFFSET : 0);

    el.style.display = "block";
    el.style.zIndex = rowZ(c.y);
    el.style.opacity = "1"; // klon nie je priehľadný ani na Narutovej bunke
    if (immediate || !actors.actorsInitialized || wasHidden || actors.portalSnap["clone:" + slot]) {
      // prvé zjavenie (summon) / immediate / prechod portálom - umiestni bez slideu (nie z rohu)
      el.style.transition = "none";
      el.style.left = px + "px"; el.style.top = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
      trackMove("clone:" + slot, px, py, true);
    } else {
      // bežný frame - CSS transition dá súbežný slide s majiteľom (rozdelenie aj zliatie plynulo)
      el.style.left = px + "px"; el.style.top = py + "px";
      trackMove("clone:" + slot, px, py, false);
    }
    el.style.transform = `translateX(${shift}px) scaleX(${currentFacing(slot, facing)})`;
    el._logCell = { x: c.x, y: c.y };
  });

  // ďalšie figúry postáv z registra fx (Jotarov stand Star Platinum - vedľa Jotara, so slideom ako actor)
  fxAll("position", { s, facing, snap: immediate || !actors.actorsInitialized || !!actors.portalSnap.p1 || !!actors.portalSnap.p2 });
  // „YOU" značka nad vlastnou postavou - sleduje aktéra (rovnaké transition ako pohyb)
  const meData = me ? s[me] : null;
  if (meData && meData.char) {
    const { left, top } = cellToPx(meData.x, meData.y);
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);
    const shift = pairShift(me, s);
    // Escanor: sprite je zväčšený podľa pride (rast od pät, origin ESC_FEET_FRAC) → hlava je vyššie a bočný offset väčší
    const prideMul = escPrideMul(meData);
    // vertikálne: vrch hlavy per-mág (HEAD_TOP) - pri pride sa škáluje okolo pät (FEET_FRAC), nie okolo spodku canvasu;
    // značku kotvíme jej spodkom (chevron) tesne nad hlavu cez translateY(-100%)
    const headTop = HEAD_TOP[meData.char] ?? 0.48;
    const headTopScaled = ESC_FEET_FRAC + (headTop - ESC_FEET_FRAC) * prideMul; // prideMul=1 → headTop
    const headY = py + ACTOR_H * headTopScaled - 2;
    // horizontálne: postava nie je v strede rámca; stred hlavy + flip podľa smeru otočenia (offset škáluje pride)
    const headCx = HEAD_CX[meData.char] ?? 0.5;
    const headDx = facing[me] * ACTOR_W * (headCx - 0.5) * prideMul;
    const markerX = px + ACTOR_W / 2 + shift + headDx;
    youMarker.style.display = "block";
    youMarker.style.transform = "translate(-50%, -100%)";
    if (immediate || !actors.actorsInitialized || actors.portalSnap[me]) {
      youMarker.style.transition = "none";
      youMarker.style.left = markerX + "px";
      youMarker.style.top  = headY + "px";
      void youMarker.offsetHeight;
      youMarker.style.transition = "";
    } else {
      youMarker.style.left = markerX + "px";
      youMarker.style.top  = headY + "px";
    }
  } else {
    youMarker.style.display = "none";
  }

  actors.actorsInitialized = true;
}
