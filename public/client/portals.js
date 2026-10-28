// public/client/portals.js - Portal Realm na doske: portály (pixel trhliny s runami páru na oboch koncoch a ikonou typu),
// ich otvorenie (nový pár na konci kola) a zatvorenie (po prechode) podľa rozdielu snapshotov, záblesk trhliny,
// prechod figúry (move/dash/charge/guľa - efekt portal_walk) a strely (charge efekt s `portal`) cez trhlinu.
// Vizuál schválený v etape 0 (docs/PORTAL_PLAN.md 2.14). Animuje len transform/opacity (individuálne vlastnosti
// translate/scale cez WAAPI - skladajú sa s inline transform postavy, ktorý drží facing/pairShift/pride).
import { gridEl, actorsEl, cellToPx, TILE_W, TILE_H } from "/client/dom.js";
import { PORTAL_TYPES, riftDataUrl, glyphSvg, typeIconSvg, RIFT_PAD } from "/client/portal-art.js";
import { board } from "/client/session.js";
import { portalWalkPlan, PORTAL_SHOT_PHASES as SP } from "/shared/timing.js";
import { actors } from "/client/actors.js";

const PT = 32;              // hrúbka trhliny (8 pixelov po 4 px)
const POFF = PT / 2 + 4;    // stred trhliny je kúsok von od hrany políčka
const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let layer = null;
const shown = new Map();    // kľúč páru (id + konce) → [element, element]
let inited = false;

function ensureLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement("div");
  layer.id = "portal-layer";
  gridEl.parentElement.insertBefore(layer, actorsEl); // nad bunkami, pod figúrami a projektilmi
  return layer;
}
const pairKey = (p) => p.id + ":" + p.ends.map(e => `${e.x},${e.y},${e.side}`).join("|");

// stred bunky / bod na hrane (out = odsadenie von od hrany) v px vrstvy dosky
export function cellCenter(x, y) { const { left, top } = cellToPx(x, y); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; }
export function edgePoint(x, y, side, out = POFF) {
  const c = cellCenter(x, y), [dx, dy] = DIR[side] || [0, 0];
  return { x: c.x + dx * (TILE_W / 2 + out), y: c.y + dy * (TILE_H / 2 + out) };
}

function portalEl(pair, i) {
  const end = pair.ends[i], T = PORTAL_TYPES[pair.type] || PORTAL_TYPES.classic;
  const horiz = end.side === "up" || end.side === "down";
  const len = Math.round((horiz ? TILE_W : TILE_H) * 0.62);
  const p = edgePoint(end.x, end.y, end.side);
  const el = document.createElement("div");
  // spodná hrana VNÚTORNÝCH stĺpcov leží v páse lišty kola pod doskou → stlmená; rohové stĺpce nič neprekrývajú
  const underUi = end.side === "down" && end.x > 0 && end.x < board.w - 1;
  el.className = "portal side-" + end.side + (underUi ? " under-ui" : "");
  el.dataset.pair = pair.id;
  el.style.cssText = `left:${p.x}px;top:${p.y}px;width:${len}px;height:${PT}px;--rot:${horiz ? 0 : 90}deg;--pc:${T.pc};--pc2:${T.pc2};--pad:${RIFT_PAD}px`;
  const frames = [0, 1, 2].map(f => `<img class="rift-f" alt="" src="${riftDataUrl(len, PT, pair.type, f)}">`).join("");
  let sparks = "";
  for (let k = 0; k < 4; k++) {
    const sx = Math.round((k - 1.5) * len * 0.22), up = k % 2 ? -1 : 1;
    sparks += `<i class="rift-spark" style="--sx:${sx}px;--ex:${(k % 3 - 1) * 8}px;--ey:${up * (16 + k * 4)}px;--d:${1.1 + k * 0.25}s;--dl:${k * 0.33}s"></i>`;
  }
  const icon = typeIconSvg(pair.type);
  const rune = glyphSvg(pair.id, T.pc2);
  el.innerHTML = `<div class="p-body">${frames}${sparks}${icon ? `<div class="p-ico">${icon}</div>` : ""}</div>`
    + `<div class="p-tag start">${rune}</div><div class="p-tag end">${rune}</div>`;
  return el;
}

// zosúlaď portály na doske so snapshotom: nové páry sa otvoria (nie pri prvom vykreslení / reconnecte),
// zmiznuté sa zatiahnu. Mimo portal realm (s.portals chýba) vrstva ostane prázdna.
export function renderPortals(s) {
  const list = Array.isArray(s?.portals) ? s.portals : [];
  if (!list.length && !shown.size) { inited = true; return; }
  const root = ensureLayer();
  const want = new Map(list.map(p => [pairKey(p), p]));
  for (const [key, els] of shown) {
    if (want.has(key)) continue;
    shown.delete(key);
    els.forEach(el => closeAnim(el));
  }
  for (const [key, pair] of want) {
    if (shown.has(key)) continue;
    const els = [0, 1].map(i => portalEl(pair, i));
    els.forEach(el => { root.appendChild(el); if (inited) openAnim(el); });
    shown.set(key, els);
  }
  inited = true;
}
// nová hra / reset: portály zmiznú bez animácie (ďalší render ich nakreslí znova)
export function clearPortals() {
  for (const els of shown.values()) els.forEach(el => el.remove());
  shown.clear();
  inited = false;
}

function openAnim(el) {
  el.querySelector(".p-body")?.animate(
    [{ transform: "scaleX(0) scaleY(.3)", filter: "brightness(3)" }, { transform: "scaleX(1.2) scaleY(1)", filter: "brightness(2)", offset: 0.6 },
     { transform: "scaleX(1)", filter: "brightness(1)" }], { duration: 700, easing: "ease-out" });
  el.querySelectorAll(".p-tag").forEach(t => t.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: 250, fill: "backwards" }));
}
function closeAnim(el) {
  el.classList.add("closing");
  const a = el.querySelector(".p-body")?.animate(
    [{ transform: "scaleX(1)", filter: "brightness(1)" }, { transform: "scaleX(1.15)", filter: "brightness(2.5)", offset: 0.2 },
     { transform: "scaleX(0) scaleY(.4)", filter: "brightness(3)" }], { duration: 520, easing: "ease-in", fill: "forwards" });
  el.querySelectorAll(".p-tag").forEach(t => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }));
  const done = () => el.remove();
  if (a) a.onfinish = done; else done();
  setTimeout(done, 900); // poistka (skrytá karta - animácie sa nedokončia)
}

// záblesk trhliny na konci portálu (vstup/výstup) - samostatný bod, nezávislý od toho, či element ešte žije
export function portalFlash(end, type = "classic") {
  if (!end) return;
  const T = PORTAL_TYPES[type] || PORTAL_TYPES.classic;
  const p = edgePoint(end.x, end.y, end.side);
  const f = document.createElement("div");
  f.className = "portal-flash";
  f.style.cssText = `left:${p.x}px;top:${p.y}px;--pc:${T.pc}`;
  actorsEl.appendChild(f);
  const a = f.animate([{ opacity: 0, transform: "translate(-50%,-50%) scale(.3)" }, { opacity: 1, transform: "translate(-50%,-50%) scale(1)", offset: 0.35 },
    { opacity: 0, transform: "translate(-50%,-50%) scale(1.4)" }], { duration: 420, easing: "ease-out", fill: "forwards" });
  a.onfinish = () => f.remove();
  setTimeout(() => f.remove(), 800);
}

// pulzujúci „maják" na konci portálu (výstup strely) - ms = dokedy; len opacity/transform
function portalBeacon(end, type, ms) {
  if (!end) return;
  const T = PORTAL_TYPES[type] || PORTAL_TYPES.classic;
  const p = edgePoint(end.x, end.y, end.side);
  const f = document.createElement("div");
  f.className = "portal-flash portal-beacon";
  f.style.cssText = `left:${p.x}px;top:${p.y}px;--pc:${T.pc}`;
  actorsEl.appendChild(f);
  const pulse = Math.max(120, ms / 2);
  f.animate([{ opacity: 0.25, transform: "translate(-50%,-50%) scale(.45)" }, { opacity: 0.9, transform: "translate(-50%,-50%) scale(.85)" },
    { opacity: 0.25, transform: "translate(-50%,-50%) scale(.45)" }], { duration: pulse, iterations: 2, easing: "ease-in-out", fill: "forwards" });
  setTimeout(() => f.remove(), ms);
}

/* ---------- prechod figúry (portal_walk) ---------- */
// Postavu positionActors umiestni rovno na cieľovú bunku (bez CSS sklzu); cestu prehrá WAAPI na vlastnostiach
// translate/scale/opacity relatívne k cieľu: dráha k hrane → zmiznutie v trhline → vynorenie z druhého konca → zvyšok
// dráhy. el = canvas figúry, start = [x, y] pred akciou, e = efekt (path, passes), ms = dĺžka framu.
// key = "p1"/"p2"/"clone:p1"… - dráha sa zaregistruje do actors.portalPath, aby liveActorPos (démon za postavou, aury)
// sledoval figúru cez trhlinu a nie jej cieľ. Vracia { kf, ms } pre ďalšie prvky, ktoré figúru sledujú
// (followPortalWalk: značka YOU, Jotarov stand) - inak by prezradili cieľ behu ešte pred animáciou.
export function animatePortalWalk(el, start, e, ms, key = null) {
  if (!el || !Array.isArray(start) || !Array.isArray(e?.path) || !e.path.length) return null;
  const fin = cellCenter(e.path[e.path.length - 1][0], e.path[e.path.length - 1][1]);
  const rel = (p) => ({ x: p.x - fin.x, y: p.y - fin.y });
  // body dráhy: { p, kind: "walk" | "sink" | "jump" | "emerge" }
  const pts = [{ p: rel(cellCenter(start[0], start[1])), kind: "start" }];
  let prev = start;
  e.path.forEach(([x, y], idx) => {
    const ps = (e.passes || []).find(q => q.at === idx);
    if (ps) {
      const a = edgePoint(prev[0], prev[1], ps.enter.side, 0), b = edgePoint(ps.exit.x, ps.exit.y, ps.exit.side, 0);
      pts.push({ p: rel(a), kind: "walk", enter: ps });
      pts.push({ p: rel(a), kind: "sink" });
      pts.push({ p: rel(b), kind: "jump" });
      pts.push({ p: rel(b), kind: "emerge", exit: ps });
    }
    pts.push({ p: rel(cellCenter(x, y)), kind: "walk" });
    prev = [x, y];
  });
  // čas: sklzy podľa dĺžky, zmiznutie/vynorenie pevne
  // čas každého bodu = spoločný plán (shared/timing.js portalWalkPlan) - zvuk vletu (events.js) z neho číta ten istý
  // moment; ms = dĺžka framu = portalWalkMs → sklzy nikdy nie rýchlejšie než najrýchlejší beh na bridge
  const plan = portalWalkPlan(e.path.length, (e.passes || []).map(q => q.at), ms);
  const kf = [];
  pts.forEach((q, i) => {
    const t = i ? (plan[i - 1]?.t ?? ms) : 0;
    const hidden = q.kind === "sink" || q.kind === "jump";
    kf.push({ offset: Math.min(1, t / ms), translate: `${q.p.x}px ${q.p.y}px`, scale: hidden ? "0.15 0.05" : "1", opacity: hidden ? 0 : 1 });
    // záblesk trhliny pri vstupe (figúra na hrane) a výstupe (začiatok vynorenia)
    if (q.kind === "walk" && q.enter) setTimeout(() => portalFlash(q.enter.enter, q.enter.type), t);
    if (q.kind === "jump" && pts[i + 1]?.exit) setTimeout(() => portalFlash(pts[i + 1].exit.exit, pts[i + 1].exit.type), t);
  });
  // offsety musia rásť a končiť na 1
  for (let i = 1; i < kf.length; i++) if (kf[i].offset < kf[i - 1].offset) kf[i].offset = kf[i - 1].offset;
  kf[kf.length - 1].offset = 1;
  if (key) actors.portalPath[key] = { t0: performance.now(), ms, pts: kf.map((k, i) => ({ o: k.offset, x: pts[i].p.x, y: pts[i].p.y })) };
  followPortalWalk(el, kf, ms);
  return { kf, ms };
}
// ten istý pohyb cez trhlinu pre prvok, ktorý figúru sleduje (relatívne k jeho cieľovej pozícii)
export function followPortalWalk(el, kf, ms) {
  if (!el || !kf) return;
  el.style.transformOrigin = el.style.transformOrigin || "50% 100%";
  el.getAnimations?.().forEach(a => { if (a.id === "portal-walk") a.cancel(); });
  const anim = el.animate(kf, { duration: ms, easing: "linear" });
  anim.id = "portal-walk";
}

/* ---------- prechod strely ---------- */
// projektil (canvas v #actors s left/top na strede bunky) prejde trhlinou: k hrane → zmizne → vynorí sa na druhom
// konci → na výstupnú bunku. from/to = {left, top} px; enter/exit = konce portálu; ms = krok letu.
export function animateProjectilePortal(el, from, to, portal, ms, yOff = 0) {
  if (!el || !portal) return;
  const a = edgePoint(portal.enter.x, portal.enter.y, portal.enter.side, 0);
  const b = edgePoint(portal.exit.x, portal.exit.y, portal.exit.side, 0);
  el.style.transition = "none";
  el.style.left = to.left + "px"; el.style.top = (to.top + yOff) + "px";
  const k = (x, y, s, o, off) => ({ offset: off, left: x + "px", top: (y + yOff) + "px", scale: s, opacity: o });
  // k vstupu (0–30 %) → zmiznutie (30–40 %) → skrytá (výstup pulzuje) → vynorenie (58–68 %) → výstupná bunka
  const anim = el.animate([
    k(from.left, from.top, "1", 1, 0), k(a.x, a.y, "1", 1, SP.enter), k(a.x, a.y, "0.1", 0, SP.gone),
    k(b.x, b.y, "0.1", 0, SP.out), k(b.x, b.y, "1", 1, SP.emerged), k(to.left, to.top, "1", 1, 1),
  ], { duration: ms, easing: "linear" });
  // výstup sa rozsvieti hneď na začiatku kroku (oko vie, kam sa pozrieť, ešte kým strela letí k vstupu)
  portalBeacon(portal.exit, portal.type, ms * (SP.emerged - 0.02));
  setTimeout(() => portalFlash(portal.enter, portal.type), ms * SP.enter);
  setTimeout(() => portalFlash(portal.exit, portal.type), ms * SP.out);
  anim.onfinish = () => { el.style.transition = ""; };
  setTimeout(() => { el.style.transition = ""; }, ms + 50);
}

// bod na hrane konca portálu (odraz zrkadla do steny - lúč končí tu)
export function voidPoint(v) { return v ? edgePoint(v.x, v.y, v.side, 0) : null; }

// float na ľubovoľnom bode dosky (hrana portálu) - rovnaké triedy ako spawnFloat
export function spawnPointFloat(pt, text, cls) {
  if (!pt) return;
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = text;
  el.style.left = pt.x + "px"; el.style.top = (pt.y - 30) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}
// odraz zrkadla narazil do steny (portál sa za útokom zavrel) - iskry na hrane + „LOST IN THE VOID"
export function spawnVoidHit(v) {
  const pt = voidPoint(v);
  if (!pt) return;
  const [dx, dy] = DIR[v.side] || [0, 0];
  for (let k = 0; k < 9; k++) {
    const s = document.createElement("div");
    s.className = "void-spark";
    s.style.left = pt.x + "px"; s.style.top = pt.y + "px";
    actorsEl.appendChild(s);
    const ang = (k / 9) * Math.PI - Math.PI / 2;
    // iskry odletia späť DO dosky (od steny)
    const ox = dx ? -dx * Math.abs(Math.cos(ang)) * 70 : Math.sin(ang) * 70;
    const oy = dy ? -dy * Math.abs(Math.cos(ang)) * 70 : Math.sin(ang) * 70;
    s.animate([{ transform: "translate(0,0)", opacity: 1 }, { transform: `translate(${ox}px,${oy}px)`, opacity: 0 }], { duration: 520, fill: "forwards" })
      .onfinish = () => s.remove();
    setTimeout(() => s.remove(), 900);
  }
  spawnPointFloat({ x: pt.x - dx * 110, y: pt.y - dy * 40 }, "LOST IN THE VOID", "void-float");
}
