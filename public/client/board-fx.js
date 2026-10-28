// public/client/board-fx.js - efekty na doske počas prehrávania: bubliny -HP/+MANA (stackované nad figúrou), aura
// rechargu, projektily (let po bunkách, rotácia, granát), filter figúry (alt-color, golden/hope žiara),
// summon klona, tile flare, spotreba tile a pomocné triedy buniek.
import { actors } from "/client/actors.js";
import { state, me } from "/client/session.js";
import { cellToPx, TILE_W, actorsEl, figuresEl, rowZ, TILE_H } from "/client/dom.js";
import { computeFacing, positionActors, pairShift, liveActorPos } from "/client/placement.js";
import { ACTOR_W, ACTOR_H, usesAltColor, charDirFor, CHARGE_SCALE } from "/client/sprites.js";
import { lastStand } from "/client/last-stand-state.js";
import { cloneEls } from "/client/actor-layers.js";
import { HEAD_CX, PROJECTILE, CHAR_META } from "/chars/index.js";
import { CHAR_FX } from "/client/fx-registry.js";
import { spawnExplosionAt } from "/client/explosion.js";
import { CHARGE_STEP_MS } from "/shared/timing.js";
import { animateProjectilePortal } from "/client/portals.js";
import { perf } from "/client/perf.js";

/* ---------- bubliny -X HP / +Y MANA ---------- */

function floatOffsetFor(slot) {
  const now = performance.now();
  actors.floatTimes[slot] = actors.floatTimes[slot].filter(t => now - t < 1000); // životnosť floatu
  const off = actors.floatTimes[slot].length * 26;
  actors.floatTimes[slot].push(now);
  return off;
}

export function spawnDamageFloat(slot, dmg) {
  const target = state?.[slot];
  if (!target || target.x == null) return; // labyrint: súper so skrytou pozíciou nemá kde floatovať
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = "dmg-float";
  el.textContent = `-${dmg} HP`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
export function spawnFloat(slot, text, className) {
  const target = state?.[slot];
  if (!target || target.x == null) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

export function spawnManaFloat(slot, amount = 4, gold = false, dark = false) {
  const target = state?.[slot];
  if (!target || target.x == null) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = dark ? "mana-float dark" : gold ? "mana-float gold" : "mana-float"; // golden = zlatý, Pútnik = čierny
  el.textContent = `+${amount} MANA`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// Fire Wizard skonzumoval Damage dlaždicu specialom - krátky flare na bunke (dlaždica už zmizla zo state)
export function spawnTileConsumeFx(cell, tile) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const el = document.createElement("div");
  el.className = "tile-consume-fx" + (tile === "power" ? " power" : ""); // power = zlatý odtieň flare

  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + TILE_H / 2) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

// float na konkrétnej bunke (bez väzby na hráča) - napr. stopa na Ariadninej nití
export function spawnCellFloat(cell, text, className) {
  const { left, top } = cellToPx(cell[0], cell[1]);
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// zánik klona - poriadny oblak dymu (kage bunshin puff): niekoľko dymových gúľ vyletí do strán a nahor,
// stredové jadro sa roztiahne. Čisto kozmetické, self-remove; puffne raz (späť už nepreblikne - actors.cloneDead).
// blood=true prefarbí dym do krvavočervenej - teleport pasce Vampire/Onryō (sýtejšia než ružový trap_break)
export function spawnClonePuff(cell, blood = false) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.55;
  const mk = (size, z) => {
    const el = document.createElement("div");
    el.className = "clone-puff";
    el.style.position = "absolute";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.width = size + "px"; el.style.height = size + "px";
    el.style.marginLeft = (-size / 2) + "px"; el.style.marginTop = (-size / 2) + "px";
    el.style.borderRadius = "50%";
    el.style.pointerEvents = "none";
    el.style.zIndex = String(z);
    el.style.background = blood
      ? "radial-gradient(circle, rgba(255,58,72,.95), rgba(150,12,28,.6) 55%, rgba(80,6,16,0) 72%)"
      : "radial-gradient(circle, rgba(240,240,245,.95), rgba(190,192,200,.6) 55%, rgba(160,162,172,0) 72%)";
    actorsEl.appendChild(el);
    return el;
  };
  // stredové jadro - rýchly veľký záblesk dymu
  const core = mk(Math.round(TILE_W * 1.15), 6);
  core.animate(
    [{ transform: "scale(.35)", opacity: .9 }, { transform: "scale(1.5)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" }
  );
  setTimeout(() => core.remove(), 600);
  // dymové gule do strán + nahor
  const N = 12;
  for (let i = 0; i < N; i++) {
    const size = Math.round(TILE_W * (0.34 + (i % 3) * 0.14));
    const el = mk(size, 7);
    const ang = (Math.PI * 2 * i / N) + i * 0.5;
    const dist = TILE_W * (0.32 + (i % 4) * 0.14);
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist - TILE_H * 0.22; // celkovo mierne stúpa (dym)
    const dur = 560 + (i % 5) * 60;
    el.animate(
      [{ transform: "translate(0,0) scale(.3)", opacity: .95 },
       { transform: `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) scale(1.7)`, opacity: 0 }],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
}

// (Pozn.: krvavé Blood_Charge efekty k útokom už NIE sú samostatné overlay FX - sú zapečené priamo
// vo framoch A-sheetov A1–A5, generovaných v tools/sprites-countess-onre/build.cjs podľa attack guide.)

// zničenie pasce (Countess/Onre) - krvavo-fialový oblak: značka praskne a rozplynie sa.
// Vidia ho OBAJA hráči (zámer - súper sa dozvie, že riziko pasce pominulo). Čisto kozmetické, self-remove.
export function spawnTrapBreak(cell) {
  if (!Array.isArray(cell)) return;
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.5;
  const mk = (size, z) => {
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;pointer-events:none;border-radius:50%;" +
      "background:radial-gradient(circle, rgba(255,90,140,.9), rgba(160,30,90,.55) 55%, rgba(90,16,48,0) 72%)";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.width = size + "px"; el.style.height = size + "px";
    el.style.marginLeft = (-size / 2) + "px"; el.style.marginTop = (-size / 2) + "px";
    el.style.zIndex = String(z);
    actorsEl.appendChild(el);
    return el;
  };
  const core = mk(Math.round(TILE_W * 0.9), 6);
  core.animate([{ transform: "scale(.3)", opacity: .95 }, { transform: "scale(1.4)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" });
  setTimeout(() => core.remove(), 600);
  for (let i = 0; i < 8; i++) {
    const el = mk(Math.round(TILE_W * (0.22 + (i % 3) * 0.1)), 7);
    const ang = (Math.PI * 2 * i / 8) + i * 0.4;
    const dist = TILE_W * (0.28 + (i % 3) * 0.12);
    const dur = 520 + (i % 4) * 60;
    el.animate(
      [{ transform: "translate(0,0) scale(.3)", opacity: .9 },
       { transform: `translate(${(Math.cos(ang) * dist).toFixed(0)}px, ${(Math.sin(ang) * dist - TILE_H * 0.15).toFixed(0)}px) scale(1.4)`, opacity: 0 }],
      { duration: dur, easing: "ease-out", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
  spawnCellFloat(cell, "🩸 TRAP DESTROYED", "trap-float");
}

// roztrieštenie sochy - odkamenenie (Medúzin kameň dohral): kamenné úlomky vyletia do strán a padajú
// (gravitácia) + krátky prachový záblesk v strede. Čisto kozmetické, self-remove; deterministické (bez random).
export function spawnStoneShatter(slot) {
  const st = state?.[slot];
  if (!st || st.x == null) return;
  const { left, top } = cellToPx(st.x, st.y);
  const cx = left + TILE_W / 2, cy = top + TILE_H * 0.5;
  // prachový záblesk
  const dust = document.createElement("div");
  dust.style.cssText = "position:absolute;pointer-events:none;z-index:7;border-radius:50%;" +
    "background:radial-gradient(circle, rgba(205,207,214,.6), rgba(160,162,172,0) 70%)";
  const ds = Math.round(TILE_W * 0.95);
  dust.style.width = ds + "px"; dust.style.height = ds + "px";
  dust.style.left = cx + "px"; dust.style.top = cy + "px";
  dust.style.marginLeft = (-ds / 2) + "px"; dust.style.marginTop = (-ds / 2) + "px";
  actorsEl.appendChild(dust);
  dust.animate([{ transform: "scale(.4)", opacity: .8 }, { transform: "scale(1.5)", opacity: 0 }],
    { duration: 520, easing: "ease-out", fill: "forwards" });
  setTimeout(() => dust.remove(), 580);
  // kamenné úlomky - hranaté sivé kúsky, vyletia do strán a padajú s rotáciou
  const N = 14;
  for (let i = 0; i < N; i++) {
    const w = Math.round(TILE_W * (0.10 + (i % 3) * 0.06));
    const h = Math.round(w * (0.7 + (i % 2) * 0.5));
    const el = document.createElement("div");
    el.style.cssText = "position:absolute;pointer-events:none;z-index:8;border-radius:2px;" +
      "background:linear-gradient(140deg, rgba(206,208,216,.98), rgba(140,142,152,.92) 60%, rgba(104,106,117,.88));" +
      "box-shadow:0 0 2px rgba(55,57,66,.55)";
    el.style.width = w + "px"; el.style.height = h + "px";
    el.style.left = cx + "px"; el.style.top = cy + "px";
    el.style.marginLeft = (-w / 2) + "px"; el.style.marginTop = (-h / 2) + "px";
    actorsEl.appendChild(el);
    const ang = (Math.PI * 2 * i / N) + i * 0.7;
    const dist = TILE_W * (0.26 + (i % 4) * 0.12);
    const dx = Math.cos(ang) * dist;
    const dy = -Math.abs(Math.sin(ang)) * TILE_H * 0.22 + TILE_H * 0.5; // mierne hore, potom pád nadol
    const rot = (i % 2 ? 1 : -1) * (120 + (i % 5) * 60);
    const dur = 620 + (i % 5) * 70;
    el.animate(
      [{ transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
       { transform: `translate(${dx.toFixed(0)}px, ${dy.toFixed(0)}px) rotate(${rot}deg) scale(.45)`, opacity: 0 }],
      { duration: dur, easing: "cubic-bezier(.3,.55,.5,1)", fill: "forwards" }
    );
    setTimeout(() => el.remove(), dur + 80);
  }
}

// float aj nad VIDITEĽNÝM tieňovým klonom - obranné/mana hlášky nesmú prezradiť, ktorá postava je pravá
export function cloneFloat(slot, text, className) {
  const o = state?.[slot];
  const c = o?.clone;
  if (!o || !c || o.x == null || (c.x === o.x && c.y === o.y)) return;
  spawnCellFloat([c.x, c.y], text, className);
}

// Naruto summon: jedna kópia na TEJ ISTEJ bunke, otočená proti Narutovi (kage bunshin moment -
// dvaja Naruti na jednom políčku tvárou v tvár); docasný canvas kreslí raf (actors.cloneSummonFx), po dohraní framu sa odstráni
export const SUMMON_CROP = 0.24; // orez prázdneho bočného okraja spritu počas Special_2 (aby sa dvaja Naruti vošli vedľa seba)
export function spawnCloneSummonFx(slot, cell, durMs) {
  const st = state?.[slot];
  if (!st || !st.char || !Array.isArray(cell)) return;
  const facing = computeFacing(state?.p1, state?.p2)[slot] || 1;
  // NORMÁLNA výška (bez zmenšenia) - aby sa dvaja Naruti vošli vedľa seba, orežeme prázdny bočný okraj spritu
  // (SUMMON_CROP) a posunieme ich o štvrtinu bunky na opačné strany; kotva dole (feet), nech stoja na zemi
  const OFFSET = Math.round(TILE_W * 0.24);
  const { left, top } = cellToPx(cell[0], cell[1]);
  const baseLeft = left - (ACTOR_W - TILE_W) / 2;
  const baseTop  = top - (ACTOR_H - TILE_H);

  // pravý Naruto (skutočný actor) na jednu stranu bunky, kópia zrkadlovo na druhú → hľadia na seba, obaja v bunke.
  // Pózu skutočného actora aplikuje positionActors (inak by ju hneď prepísal); tu ju len nastavíme (scale 1 = normálna výška).
  actors.cloneSummonPose[slot] = { off: OFFSET, until: performance.now() + Math.max(400, durMs) - 150 };
  positionActors(state); // hneď premietni pózu (bez čakania na ďalší frame)

  const el = document.createElement("canvas");
  el.className = "sprite-actor sprite-clone-summon";
  el.width = ACTOR_W; el.height = ACTOR_H;
  el.style.width = ACTOR_W + "px"; el.style.height = ACTOR_H + "px";
  el.style.left = baseLeft + "px";
  el.style.top  = baseTop + "px";
  el.style.transformOrigin = "50% 100%";
  el.style.transform = `translateX(${facing * OFFSET}px) scaleX(${-facing})`; // normálna výška, len zrkadlenie
  el.style.pointerEvents = "none";
  el.classList.toggle("alt-color", usesAltColor(st.char, slot));
  el.style.zIndex = rowZ(cell[1]); // vrstva figúr: ako Naruto na tej bunke (DOM poradie → pred ním)
  figuresEl.appendChild(el);
  el.animate(
    [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }],
    { duration: Math.max(400, durMs), easing: "linear", fill: "forwards" }
  );
  actors.cloneSummonFx.push({ el, dir: charDirFor(st.char, slot) });
  setTimeout(() => el.remove(), Math.max(400, durMs) + 120);
}

// glow okolo postavy: obrana (pulzuje) nahrádza zlatý „YOU", inak fallback na zlatý
// VÝKON (docs/PERF_PLAN.md, etapa 2): drop-shadow sa prepočíta vždy, keď sa zmení hodnota filtra ALEBO obsah canvasu.
// Obsah (sprite frame) sa mení ~10×/s, preto pulz krokujeme po GLOW_STEP_MS (nie každý frame) - filter sa tak
// prepočíta zhruba vtedy, keď aj tak treba prekresliť postavu. V úspornom režime (perf.lite) je žiara statická
// a má 2 vrstvy namiesto 7 (rovnaká farba, tenší obrys).
const GLOW_STEP_MS = 100;
const YOU_GOLD_GLOW = "drop-shadow(0 0 1px #fff3b0) drop-shadow(0 0 4px #ffc107) drop-shadow(0 0 8px #ff9100)";
const YOU_GOLD_GLOW_LITE = "drop-shadow(0 0 2px #ffc107) drop-shadow(0 0 7px #ff9100)";
const GLOW_COL = { shield: "#4dd0e1", shieldGold: "#ffca28", mirror: "#ce93d8", mirrorGold: "#ffca28" }; // štít / golden štít / mirror / golden mirror
const glowStep = (now) => Math.floor(now / GLOW_STEP_MS) * GLOW_STEP_MS;
function pulseGlow(color, now) {
  const c = color;
  if (perf.lite) return `drop-shadow(0 0 2px ${c}) drop-shadow(0 0 10px ${c})`;
  const t = 0.5 + 0.5 * Math.sin(glowStep(now) / 240); // 0..1 pulz
  const b1 = (3 + 2 * t).toFixed(1);
  const b2 = (8 + 5 * t).toFixed(1);
  const b3 = (14 + 9 * t).toFixed(1);
  // hrubý plný obrys (viac tesných vrstiev) + pulzujúca žiara
  return `drop-shadow(0 0 1px ${c}) drop-shadow(0 0 1px ${c}) drop-shadow(0 0 2px ${c}) drop-shadow(0 0 2px ${c}) drop-shadow(0 0 ${b1}px ${c}) drop-shadow(0 0 ${b2}px ${c}) drop-shadow(0 0 ${b3}px ${c})`;
}
// filter postavy: alt-color (pravá strana p2, ak nemá natívnu paletu) + kameň (sivá socha) + glow
// isClone = true: klon NEZRKADLÍ Last Stand vizuály (zlatý death-glow) - ostáva neutrálny (rozhodnutie hráča)
export function actorFilter(slot, now, isClone = false) {
  const st = state?.[slot];
  // golden recharge stav (death summon) - žiarivý zlatý pulz postavy, má prednosť pred ostatným (klon ho nemá)
  if (lastStand.goldenSlot === slot && !isClone) {
    if (perf.lite) return "brightness(1.35) saturate(1.5) " + pulseGlow("#ffd24a", now);
    const t = 0.5 + 0.5 * Math.sin(glowStep(now) / 110);
    return `brightness(${(1.15 + 0.45 * t).toFixed(2)}) saturate(1.5) ` + pulseGlow("#ffd24a", now);
  }
  const alt = usesAltColor(st?.char, slot) ? "saturate(.22) brightness(1.4) " : "";
  // skamenená postava - kamenná sivá (prekryje aj alt filter, socha je socha)
  const stone = (st?.stone || 0) > 0 && (st?.hp ?? 1) > 0 ? "grayscale(.92) brightness(.82) contrast(1.12) " : "";
  let glow = "";
  if (st?.shield)      glow = pulseGlow(st.shieldGold ? GLOW_COL.shieldGold : GLOW_COL.shield, now);
  else if (st?.mirror) glow = pulseGlow(st.mirrorGold ? GLOW_COL.mirrorGold : GLOW_COL.mirror, now);
  else if (slot === me) glow = perf.lite ? YOU_GOLD_GLOW_LITE : YOU_GOLD_GLOW;
  return (stone + alt + glow).trim();
}

// umiestni nabíjaciu auru na postavu podľa jej AKTUÁLNEJ (interpolovanej) pozície sprite-u,
// aby aura plynulo kĺzala s postavou počas pohybu (nie teleport na cieľové políčko)
export function placeChargeAura(cont, slot) {
  const p = state?.[slot];
  if (!p || !p.char || p.x == null) return;
  const onClone = cont.dataset.anchor === "clone"; // aura klona sleduje klonov canvas
  if (onClone && (!p.clone || cloneEls[slot].style.display === "none")) { cont.remove(); return; }
  const shift = onClone ? 0 : pairShift(slot);
  // postava nie je v strede bunky - rovnaký horizontálny offset tela ako „YOU" vlajka (HEAD_CX + flip)
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[p.char] ?? 0.5) - 0.5);
  // interpolovaná pozícia počas CSS transition - dopočítaná (placement.js), nie getComputedStyle (výkon)
  const { left: aLeft, top: aTop } = liveActorPos(onClone ? "clone:" + slot : slot);
  const cellLeft = aLeft + (ACTOR_W - TILE_W) / 2;
  const cellTop  = aTop + (ACTOR_H - TILE_H);
  const l = (cellLeft + TILE_W / 2 + shift + headDx) + "px";
  const t = (cellTop + TILE_H) + "px"; // päta postavy = spodok bunky
  if (cont.style.left !== l) cont.style.left = l; // zápis len pri zmene (stojaca postava = žiadny layout)
  if (cont.style.top !== t) cont.style.top = t;
}

// ---- Plynulý projektil basic útoku ----
// Perzistentné canvasy žijú v #actors (nie v bunke, ktorú renderGrid každý frame maže cez innerHTML=""),
// takže projektil KĹŽE po bunkách cez CSS transition (left/top var(--charge-ms) linear) - rovnako ako
// pohyb postavy, bez poskakovania a bez miznutia uprostred letu. Kľúč rozlišuje strelca a jeho klonovu
// strelu (Naruto + klon = dve súbežné strely, klonova s invertovanou vertikálou).
export const projectiles = new Map(); // `${from}-${clone?1:0}` -> { el, retire }
function projCenter(x, y) {
  const { left, top } = cellToPx(x, y);
  return { left: left + TILE_W / 2, top: top + TILE_H / 2 }; // stred bunky v súradniciach #actors (element má translate(-50%,-50%))
}
function projectileOrient(charKey, dir) {
  // Countess/Onre/Jotaro majú úzky diagonálny projektil (Jotaro = letiaca päsť Star Platinum).
  // Nepoužívaj scaleX+rotate kombináciu: pri ľavých diagonálach zrkadlenie mení aj znamienko
  // rotácie a špic (päsť) môže mieriť zle - preto čistá rotácia (base = doprava).
  if (PROJECTILE[charKey]?.orient === "rotate") {
    return {
      right: "rotate(0deg)", down_right: "rotate(45deg)", down: "rotate(90deg)", down_left: "rotate(135deg)",
      left: "rotate(180deg)", up_left: "rotate(-135deg)", up: "rotate(-90deg)", up_right: "rotate(-45deg)",
    }[dir] || "";
  }
  return {
    left: "scaleX(-1)", up: "rotate(-90deg)", down: "rotate(90deg)",
    up_right: "rotate(-45deg)", down_right: "rotate(45deg)",
    up_left: "scaleX(-1) rotate(45deg)", down_left: "scaleX(-1) rotate(-45deg)",
  }[dir] || "";
}
function spawnOrMoveProjectile(c, s) {
  const charKey = s?.[c.from]?.char;
  const dirKey  = charKey ? (CHAR_META[charKey].chargeDir || charDirFor(charKey, c.from)) : null;
  if (!dirKey) return;
  const key = `${c.from}-${c.clone ? 1 : 0}`;
  let entry = projectiles.get(key);
  if (entry && entry.retire) { clearTimeout(entry.retire); entry.retire = null; } // strela ešte letí ďalej
  // Vojakov granát sa kotúľa PO ZEMI (spodok bunky), nie stredom ako mágove strely
  const yOff = Math.round(TILE_H * (PROJECTILE[charKey]?.yOff || 0));
  const dst = projCenter(c.cell[0], c.cell[1]);
  if (!entry) {
    const el = document.createElement("canvas");
    // register fx projectileScale (Escanorova strela - slnko - škáluje s Pridom) alebo projectile.scale
    // (Vojakov granát je MALÝ - kotúľajúci sa projektil veľkosti ~⅓ bunky); ostatné postavy bez zmeny
    const fx = CHAR_FX[charKey]?.projectileScale?.(c.from) ?? (PROJECTILE[charKey]?.scale ?? 1);
    const px = Math.round(TILE_H * CHARGE_SCALE * fx);
    el.width = px; el.height = px;
    el.className = "projectile";
    if (usesAltColor(charKey, c.from)) el.classList.add("alt-color"); // p2 paleta (Medúza/Naruto natívne)
    el.dataset.dir = dirKey;
    el.style.width = px + "px"; el.style.height = px + "px";
    // vznikni na bunke strelca a odtiaľ plynule kĺž na prvú bunku letu (nie zlietni z rohu (0,0));
    // klonova strela štartuje z KLONOVEJ bunky, nie z Narutovej
    const st = s?.[c.from];
    const origin = c.clone ? st?.clone : st;
    const start = (origin && origin.x != null) ? projCenter(origin.x, origin.y) : dst;
    el.style.transition = "none";
    el.style.left = start.left + "px";
    el.style.top  = (start.top + yOff) + "px";
    void el.offsetHeight; // reflow → snap na štart bez sklzu, potom zapni transition
    el.style.transition = "";
    actorsEl.appendChild(el);
    entry = { el, retire: null, pos: { left: start.left, top: start.top } };
    projectiles.set(key, entry);
  }
  entry.charKey = charKey;    // Vojak: na konci letu granát vybuchne (retireProjectile)
  entry.from = c.from;
  entry.lastCell = c.cell;    // posledná bunka letu = miesto výbuchu (zásah súpera/klona alebo okraj plochy)
  // sprite mieri doprava - ostatné smery flip/rotácia; nastavuje sa KAŽDÝ krok, lebo strela
  // Vampire/Onryō mení smer po odraze od steny (transform sa netranzicuje → okamžitý flip špicu);
  // diagonály = rotácia o 45° od horizontály.
  const orient = projectileOrient(charKey, c.dir);
  // Portal Realm: aury po prelete portálom (powerup zlatá, Def-breaker biela) - ostávajú do konca letu
  if (c.aura?.power) entry.el.classList.add("aura-power");
  if (c.aura?.defBreak) entry.el.classList.add("aura-nodef");
  if (c.portal) {
    // prelet trhlinou: k hrane vstupu → zmiznutie → vynorenie na druhom konci → výstupná bunka; špic sa otočí
    // do nového smeru až v trhline (pred ňou letí pôvodným smerom)
    animateProjectilePortal(entry.el, entry.pos || dst, dst, c.portal, CHARGE_STEP_MS, yOff);
    const el = entry.el;
    setTimeout(() => { el.style.transform = `translate(-50%, -50%) ${orient}`.trim(); }, CHARGE_STEP_MS * 0.5);
  } else {
    entry.el.style.transform = `translate(-50%, -50%) ${orient}`.trim();
    entry.el.style.left = dst.left + "px"; // nová cieľová bunka → CSS ju plynule dokĺže za --charge-ms
    entry.el.style.top  = (dst.top + yOff) + "px";
  }
  entry.pos = dst;
}
function retireProjectile(key) {
  const entry = projectiles.get(key);
  if (!entry || entry.retire) return;
  // nechaj dobehnúť posledný sklz na cieľovú bunku, až potom zmizni (nikdy nie uprostred letu)
  entry.retire = setTimeout(() => {
    entry.el.remove(); projectiles.delete(key);
    // Vojakov granát: výbuch na poslednej bunke letu - na súperovi/klonovi, alebo na okraji plochy v smere hodu
    if (PROJECTILE[entry.charKey]?.explodeAtEnd && Array.isArray(entry.lastCell)) spawnExplosionAt(entry.lastCell, entry.from, 1.2);
  }, CHARGE_STEP_MS);
}
// zosúlaď perzistentné projektily s charge efektmi tohto frame-u: nové/pohnuté posuň, chýbajúce stiahni
export function reconcileProjectiles(charges, s) {
  // stacknutý Naruto+klon strieľajúci ROVNAKÝM smerom z jednej bunky = dve identické strely presne na sebe →
  // kresli len majiteľovu (vizuálne JEDEN projektil, dmg aj tak dopadne spojený ako „n+n"); vertikálne
  // rozdelené strely majú inú bunku/smer a ostávajú obe
  const drawn = charges.filter(c => !(c?.clone && charges.some(o => o && !o.clone && o.from === c.from
    && Array.isArray(o.cell) && Array.isArray(c.cell)
    && o.cell[0] === c.cell[0] && o.cell[1] === c.cell[1] && o.dir === c.dir)));
  const live = new Set();
  for (const c of drawn) {
    if (!c || !Array.isArray(c.cell)) continue;
    live.add(`${c.from}-${c.clone ? 1 : 0}`);
    spawnOrMoveProjectile(c, s);
  }
  for (const key of projectiles.keys()) if (!live.has(key)) retireProjectile(key);
}
export function clearProjectiles() {
  for (const { el, retire } of projectiles.values()) { if (retire) clearTimeout(retire); el.remove(); }
  projectiles.clear();
}

// „Goku" nabíjacia aura pri recharge - naviazaná na postavu (sleduje ju per-frame v rafe);
// anchor "clone" ju ukotví na viditeľný tieňový klon (recharge nesmie prezradiť pravého Naruta)
export function spawnChargeAura(slot, gold = false, red = false, anchor = "actor", dark = false) {
  const p = state?.[slot];
  if (anchor === "clone" && (!p?.clone || cloneEls[slot].style.display === "none")) return;
  // labyrint: skrytý súper (x null) auru vôbec nedostane - placeChargeAura by ju nemal kam ukotviť
  // a neumiestnená by svietila v rohu boardu (napr. červená Last Hope aura skrytého Minotaura)
  if (!p || p.x == null) return;
  const cont = document.createElement("div");
  // golden mana = zlatá; Last Hope ultra mód = červená; Pútnikova pasívna mana = čierna
  cont.className = dark ? "charge-aura dark" : red ? "charge-aura red" : gold ? "charge-aura gold" : "charge-aura";
  cont.dataset.slot = slot;            // raf podľa toho auru drží na interpolovanej pozícii postavy
  if (anchor === "clone") cont.dataset.anchor = "clone";
  placeChargeAura(cont, slot);
  fillAura(cont);
  actorsEl.appendChild(cont);
  setTimeout(() => cont.remove(), 1100);
}
// obsah aury: jadro, prstenec a pásiky (lite: menej pásikov, CSS .perf-lite im vypne tiene)
function fillAura(cont) {
  cont.innerHTML = '<span class="ca-core"></span><span class="ca-ring"></span>';
  const n = perf.lite ? 8 : 18;
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "ca-streak";
    s.style.left = ((Math.random() * 2 - 1) * TILE_W * 0.2).toFixed(0) + "px"; // užší rozptyl = na postave
    s.style.height = (TILE_H * (0.55 + Math.random() * 0.6)).toFixed(0) + "px";
    s.style.animationDelay = (Math.random() * 0.55).toFixed(2) + "s";
    cont.appendChild(s);
  }
}

// Trvalá aura (zlatý Last Stand stav, červený Last Hope mód): JEDEN element na celý stav - jadro pulzuje nekonečnou
// CSS animáciou (.persistent), pásiky sú nekonečné tak či tak. Predtým sa každých 950 ms vytvárala nová aura
// (22 elementov, dve naraz) - neustále pridávanie/mazanie DOM stálo veľa prepočtu štýlov a vrstiev (PERF_PLAN etapa 4).
// on = false (alebo skrytý hráč v labyrinte) auru odstráni, nech nesvieti na starej pozícii.
const persistentAuras = {};
export function keepAura(slot, variant, on) {
  const key = slot + ":" + variant;
  const cur = persistentAuras[key];
  const p = state?.[slot];
  if (!on || !p || p.x == null) {
    if (cur) { cur.remove(); delete persistentAuras[key]; }
    return;
  }
  if (cur && cur.isConnected) return; // pozíciu drží raf (placeChargeAura)
  const cont = document.createElement("div");
  cont.className = `charge-aura ${variant} persistent`;
  cont.dataset.slot = slot;
  placeChargeAura(cont, slot);
  fillAura(cont);
  actorsEl.appendChild(cont);
  persistentAuras[key] = cont;
}
