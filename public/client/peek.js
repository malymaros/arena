// public/client/peek.js - okno v strede plochy „čo to robí":
//  - dotyk: PODRŽANIE prsta (HOLD_MS) na tlačidle akcie = vysvetlenie tlačidla (BUTTON_TEXT / buttons.<slot>.info
//    postavy, rovnaký text ako tooltip na PC); na portréte postavy v HUD alebo hlavičke mága v turnaji (svojej aj
//    súperovej) = okno postavy. Pustenie prsta okno zavrie a ťuk sa nezaráta (nič sa nezaradí ani neoznačí).
//    Funguje aj na zamknutom tlačidle (výber smeru, po LOCK IN, prehrávanie) - cieľ sa hľadá podľa polohy prsta,
//    nie podľa udalosti (zamknuté tlačidlá majú pointer-events: none).
//  - PC: okno postavy pri prejdení myšou nad portrétom / hlavičkou; tlačidlá majú tooltip s tým istým textom.
// Okno postavy = meno + presne náhľad specialu z výberu postáv (char-select.js showCharPeek), za stranu postavy.
// Special tlačidlo ukáže okno vlastnej postavy (okrem Jotarovho Special 2, ktorý má vlastný text).
import { isTouch } from "/client/viewport.js";
import { BUTTON_TEXT, staticKeyOf, costMarkup } from "/client/balance-ui.js";
import { CHAR_BUTTONS, CHAR_META } from "/chars/index.js";
import { attackBtn, dashBtn, meleeBtn, specialBtn, mirrorBtn, rechargeBtn, selEl } from "/client/dom.js";
import { ghostCharAt } from "/client/ghost.js";
import { buttonUi } from "/client/planning.js";
import { state, me } from "/client/session.js";
import { showCharPeek, hideCharPeek } from "/client/char-select.js";
import { hydratePix } from "/client/pix.js";

const HOLD_MS = 400;   // dĺžka podržania
const MOVE_TOL = 12;   // px displeja - posun prsta nad toto podržanie zruší (posúvanie, ťahanie)

// tlačidlá, ktoré postava môže mať inak (buttons.<slot> v public/chars/<key>.js)
const SLOT_BTNS = [[attackBtn, "attack"], [dashBtn, "dash"], [meleeBtn, "melee"], [mirrorBtn, "mirror"], [rechargeBtn, "recharge"], [specialBtn, "special"]];
// kandidáti pod prstom - od najkonkrétnejšieho (polovica zlatého tlačidla pred celým tlačidlom)
const CHAR_HOSTS = ".series-crowns .mhead, .hud-box .hud-char, .hud-box.in-maze .maze-cover";
const TOUCH_HOSTS = [".series-crowns .mhead", ".hud-box.in-maze .maze-cover", ".hud-box .hud-char",
  ".controls-row .golden-half", ".controls-row .btn"];

const plainName = (n) => (n || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase(); // pixel font nemá Ō

/* ---------- čo ukázať ---------- */
// okno postavy pre portrét / hlavičku: { char, side }
function charOf(el) {
  if (el.classList.contains("mhead")) return el.dataset.char ? { char: el.dataset.char, side: el.dataset.slot } : null;
  const side = el.closest(".hud-box")?.id === "hud-p2" ? "p2" : "p1";
  const char = state?.[side]?.char;
  return char ? { char, side } : null;
}
// vysvetlenie tlačidla: { info } alebo okno vlastnej postavy (special)
function buttonOf(el) {
  const slot = SLOT_BTNS.find(([b]) => b === el)?.[1];
  if (slot) {
    const ch = ghostCharAt() || state?.[me]?.char; // v turnaji po naplánovanom swape platí nový mág
    const d = CHAR_BUTTONS[ch]?.[slot];
    const def = typeof d === "function" ? d(buttonUi()) : d;
    if (def?.info) return { info: def.info };
    if (slot === "special") return ch ? { char: ch, side: me, special: true } : null; // len „SPECIAL ATTACK", bez mena
    return BUTTON_TEXT[slot]?.info ? { info: BUTTON_TEXT[slot].info } : null;
  }
  const key = staticKeyOf(el);
  return key && BUTTON_TEXT[key]?.info ? { info: BUTTON_TEXT[key].info } : null;
}
const whatFor = (el) => (el.matches(CHAR_HOSTS) ? charOf(el) : buttonOf(el));

/* ---------- okno ---------- */
let box = null;
let shown = null; // kľúč práve zobrazeného obsahu (PC hover: rovnaká postava = nič nerob)
function ensureBox() {
  if (box) return box;
  box = document.createElement("div");
  box.id = "peek";
  box.className = "hidden";
  document.body.appendChild(box);
  return box;
}
// stred hracej plochy (layout px v body - body je zmenšené transformom, viewport.js)
function place() {
  const boardEl = document.querySelector(".board");
  if (!boardEl) return;
  let x = 0, y = 0, e = boardEl;
  while (e && e !== document.body) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
  box.style.left = (x + boardEl.offsetWidth / 2) + "px";
  box.style.top = (y + boardEl.offsetHeight / 2) + "px";
}
function open(what) {
  if (!what) return false;
  const key = what.info ? "i:" + what.info.name : `c:${what.char}:${what.side}:${!!what.special}`;
  if (key === shown) return true;
  close();
  ensureBox();
  if (what.info) {
    const { name, cost, text } = what.info;
    box.className = "peek-btn";
    box.innerHTML = `<div class="pk-head"><span class="pk-name">${name}</span>${cost ? `<span class="pk-cost">${costMarkup(cost)}</span>` : ""}</div>`
      + `<div class="pk-text">${text}</div>`;
    hydratePix(box);
  } else {
    if (selEl && !selEl.classList.contains("hidden")) return false; // náhľad práve používa výber postáv
    // portrét / hlavička = meno postavy (bez nadpisu SPECIAL ATTACK); special tlačidlo = len SPECIAL ATTACK (bez mena)
    box.className = "peek-char" + (what.special ? " pk-special" : " pk-portrait") + (what.side === "p2" ? " p2-side" : "");
    box.innerHTML = (what.special ? "" : `<div class="pk-head"><span class="pk-name">${plainName(CHAR_META[what.char]?.name || what.char)}</span></div>`)
      + `<div class="pk-ability"></div>`;
    if (!showCharPeek(box.querySelector(".pk-ability"), what.char, what.side)) { close(); return false; }
  }
  place();
  shown = key;
  return true;
}
function close() {
  if (!box || !shown) return;
  hideCharPeek(); // vráti náhľad do výberu postáv (pred zmazaním obsahu okna)
  box.className = "hidden";
  box.innerHTML = "";
  shown = null;
}

/* ---------- dotyk: podržanie ---------- */
function hostAt(x, y) {
  for (const sel of TOUCH_HOSTS) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest(".hidden")) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
  }
  return null;
}
function initTouch() {
  let timer = 0, start = null, holding = false, swallowUntil = 0, keptOpen = false;
  const cancel = () => { clearTimeout(timer); timer = 0; start = null; };
  document.addEventListener("touchstart", (e) => {
    cancel();
    swallowUntil = 0; // nový dotyk = nový ťuk (poistka platí len pre klik hneď po podržaní)
    if (keptOpen) { keptOpen = false; close(); } // okno nechané po touchcancel zavrie až ďalší dotyk
    if (e.touches.length !== 1) { if (holding) { holding = false; close(); } return; }
    const t = e.touches[0];
    const host = hostAt(t.clientX, t.clientY);
    if (!host) return;
    start = { x: t.clientX, y: t.clientY };
    timer = setTimeout(() => { timer = 0; holding = open(whatFor(host)); }, HOLD_MS);
  }, { capture: true, passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!start || holding) return;
    const t = e.touches[0];
    if (t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > MOVE_TOL) cancel();
  }, { capture: true, passive: true });
  const end = (e) => {
    cancel();
    if (!holding) return;
    holding = false;
    // touchcancel = prehliadač si dotyk vzal (tablet: ťahanie obrázka pri dlhom podržaní - Last Stand / démon)
    // → okno ostane, zavrie ho ďalší dotyk; inak by sa ukázalo a hneď zmizlo
    if (e.type === "touchcancel") { keptOpen = true; swallowUntil = performance.now() + 700; return; }
    close();
    // zruš ťuk, ktorý by prehliadač po pustení poslal (aj s emulovanými mouse udalosťami → hover náhľady)
    if (e.cancelable) e.preventDefault();
    swallowUntil = performance.now() + 700;
  };
  document.addEventListener("touchend", end, { capture: true, passive: false });
  document.addEventListener("touchcancel", end, { capture: true, passive: false });
  // poistka: ak by klik po podržaní predsa prišiel, nezaráta sa (window capture = pred touch.js aj controls.js)
  window.addEventListener("click", (e) => {
    if (performance.now() < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);
  // ťahanie obrázka/odkazu pri dlhom podržaní (tablet) by dotyk zrušilo - v hre sa nič neťahá
  document.addEventListener("dragstart", (e) => e.preventDefault(), true);
  // kontextové menu prehliadača pri dlhom podržaní
  document.addEventListener("contextmenu", (e) => { if (holding || timer) e.preventDefault(); }, true);
}

/* ---------- PC: prejdenie myšou nad portrétom / hlavičkou ---------- */
function initHover() {
  let hoverKey = null;
  document.addEventListener("mouseover", (e) => {
    const host = e.target.closest?.(CHAR_HOSTS);
    const what = host ? charOf(host) : null;
    const key = what ? `${what.char}:${what.side}` : null;
    if (key === hoverKey) return;
    hoverKey = key;
    if (what) { if (!open(what)) hoverKey = null; } else close();
  });
}

if (isTouch) initTouch(); else initHover();
