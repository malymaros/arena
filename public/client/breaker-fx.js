// public/client/breaker-fx.js - Shield/Mirror Breaker (NÁVRH, docs: pamäť breaker-design): súvislý červený lúč
// z útočníka do súperovej nabitej obrany - bariéra sa zohrieva (farba obrany → oranžová → červená → biely žiar),
// postupne praská a nakoniec sa roztriešti; bez obrany lúč len zasyčí o postavu (NO GUARD).
// Zatiaľ ho používa len náhľad ?breakerdebug=1 (debug-breaker.js) - do timeline sa zapojí po schválení.
import { state } from "/client/session.js";
import { pairShift, computeFacing } from "/client/placement.js";
import { ACTOR_W } from "/client/sprites.js";
import { HEAD_CX } from "/chars/index.js";
import { cellToPx, TILE_W, TILE_H, actorsEl, gridEl } from "/client/dom.js";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// stred tela figúry (rovnaký bod ako blok štítu v defense-fx.js) + bod ruky útočníka
function bodyPt(slot) {
  const p = state?.[slot];
  if (!p || p.x == null) return null;
  const facing = computeFacing(state?.p1, state?.p2)[slot] || 1;
  const headDx = facing * ACTOR_W * ((HEAD_CX[p.char] ?? 0.5) - 0.5);
  const { left, top } = cellToPx(p.x, p.y);
  return { x: left + TILE_W / 2 + pairShift(slot) + headDx, y: top + TILE_H * 0.5, facing };
}
function handPt(slot) {
  const b = bodyPt(slot);
  return b && { x: b.x + b.facing * TILE_W * 0.24, y: b.y - TILE_H * 0.06 };
}

// farba lúča = farba breakera (nie súperovej obrany): golden variant zlatý, inak štít / mirror
let colorCls = "";
function add(cls, x, y, style) {
  const el = document.createElement("div");
  el.className = "brk-fx " + colorCls + " " + cls;
  el.style.left = x + "px"; el.style.top = y + "px";
  if (style) Object.assign(el.style, style);
  actorsEl.appendChild(el);
  return el;
}

// praskliny bariéry v 3 vlnách (SVG v súradniciach 100×130, roztiahnuté na bariéru)
const CRACKS = [
  ["M50 10 L46 40 L56 62", "M46 40 L24 50"],
  ["M56 62 L44 88 L52 120", "M56 62 L80 56 L92 76", "M24 50 L12 70"],
  ["M44 88 L18 100", "M52 120 L76 108 L88 124", "M80 56 L88 30", "M12 70 L20 92"],
];

// opts: { kind: "shield"|"mirror" (typ breakera - určuje farbu lúča), gold (golden breaker = zlatý lúč), whiff (súper bez obrany), react (zlá obrana - odraz/blok prehrá volajúci),
// slow (násobok dĺžky, náhľad) }. Vráti Promise - resolve
// v momente roztrieštenia (volajúci hneď pustí hit/float), resp. keď sa lúč pri whiffe rozplynie.
export async function spawnBreakerBeam(fromSlot, toSlot, { kind = "shield", gold = false, whiff = false, react = false, slow = 1 } = {}) {
  const a = handPt(fromSlot), d = bodyPt(toSlot);
  if (!a || !d) return;
  const RAMP = 140 * slow, HEAT = (react ? 420 : 1150) * slow;
  const dx = d.x - a.x, dy = d.y - a.y, len = Math.hypot(dx, dy);
  colorCls = gold ? "c-gold" : kind === "mirror" ? "c-mirror" : "c-shield";

  // lúč: kontajner otočený z ruky do cieľa; vrstvy = široká červená žiara + horúce jadro, blikajú (opacity/scaleY)
  const beam = add("brk-beam", a.x, a.y, { width: len + "px", transform: `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)` });
  beam.style.setProperty("--ramp", RAMP + "ms");
  beam.innerHTML = '<i class="glow"></i><i class="core"></i>';
  const muzzle = add("brk-muzzle", a.x, a.y);

  // súper bez obrany: lúč dorazí k postave a len sa rozplynie - žiadny záblesk dopadu ani iskry (nič neprerazil)
  if (whiff) {
    await sleep(RAMP + 160 * slow);
    beam.style.setProperty("--fade", 420 * slow + "ms");
    beam.classList.add("dissolve"); muzzle.remove();
    for (let i = 0; i < 7; i++) {
      const s = add("brk-smoke", d.x + (Math.random() - .5) * 40, d.y + (Math.random() - .5) * 50, { animationDuration: 700 * slow + "ms" });
      s.style.setProperty("--dx", Math.round((Math.random() - .5) * 30) + "px");
      s.style.setProperty("--dy", -Math.round(25 + Math.random() * 30) + "px");
      setTimeout(() => s.remove(), 750 * slow);
    }
    setTimeout(() => beam.remove(), 450 * slow);
    return;
  }
  const impact = add("brk-impact", d.x, d.y);

  // bariéra (len pri nabitej obrane): zohrievanie = prelínanie vrstiev, praskliny pribúdajú
  let bar = null;
  if (!whiff && !react) {
    const w = Math.round(TILE_W * 0.7), h = Math.round(TILE_H * 0.95);
    bar = add(`brk-barrier ${kind}${gold ? " gold" : ""}`, d.x, d.y, { width: w + "px", height: h + "px" });
    bar.style.setProperty("--heat", HEAT + "ms");
    bar.innerHTML = '<i class="base"></i><i class="hot"></i><i class="white"></i>' +
      `<svg viewBox="0 0 100 130" preserveAspectRatio="none">${CRACKS.map((wave, i) =>
        wave.map(p => `<path class="w${i}" d="${p}"/>`).join("")).join("")}</svg>`;
  }

  // iskry z miesta dopadu počas celého lúča (častejšie, ako sa obrana rozžeravuje)
  const t0 = performance.now();
  let alive = true;
  (function sparks() {
    if (!alive) return;
    const k = Math.min(1, (performance.now() - t0) / (RAMP + HEAT));
    for (let i = 0; i < 1 + Math.round(k * 2); i++) {
      const ang = Math.atan2(-dy, -dx) + (Math.random() - .5) * 2.4;
      const dist = 30 + Math.random() * 50;
      const s = add("brk-spark", d.x, d.y);
      s.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
      s.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
      setTimeout(() => s.remove(), 420);
    }
    setTimeout(sparks, 55);
  })();
  await sleep(RAMP);
  bar?.classList.add("heating");
  await sleep(HEAT);
  alive = false;

  if (react) {
    // zlá obrana (Shield Breaker do mirroru / Mirror Breaker do štítu): lúč len zhasne, reakciu obrany
    // (odraz / blok) prehrá volajúci skutočnými efektmi obrany z defense-fx.js
    beam.classList.add("off"); muzzle.remove(); impact.remove();
    setTimeout(() => beam.remove(), 200);
    return;
  }

  // roztrieštenie: záblesk, rázová vlna, rozžeravené úlomky, otras dosky; lúč zhasne
  bar.remove(); beam.classList.add("off"); muzzle.remove(); impact.remove();
  setTimeout(() => beam.remove(), 200);
  const flash = add("brk-flash", d.x, d.y, { animationDuration: 350 * slow + "ms" }); setTimeout(() => flash.remove(), 400 * slow);
  const ring = add("brk-ring", d.x, d.y, { animationDuration: 550 * slow + "ms" }); setTimeout(() => ring.remove(), 600 * slow);
  const N = 26;
  for (let i = 0; i < N; i++) {
    const ang = Math.PI * 2 * i / N + i * 0.19;
    const dist = 90 + (i % 4) * 42 + Math.random() * 30;
    const sh = add("brk-shard" + (i % 3 === 0 ? " white" : ""), d.x, d.y, {
      width: (14 + Math.random() * 16).toFixed(0) + "px", height: (16 + Math.random() * 18).toFixed(0) + "px",
      animationDuration: 800 * slow + "ms",
    });
    sh.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    sh.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    sh.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2 + 60) + "deg");
    setTimeout(() => sh.remove(), 900 * slow);
  }
  const boardEl = gridEl.parentElement;
  if (boardEl) {
    boardEl.classList.remove("fx-shake"); void boardEl.offsetWidth; boardEl.classList.add("fx-shake");
    setTimeout(() => boardEl.classList.remove("fx-shake"), 500);
  }
}
