// public/client/char-strip.js - výber postáv na TELEFÓNE ako jeden plynulý cyklický pás (namiesto 3 stránok so šípkami).
// Karty všetkých bežných stránok (0, 1, 2) sa zoradia do jedného pásu, ktorý sa ťahá prstom; za poslednou postavou
// nasleduje znova prvá. Karta, ktorá zastane v strede, sa sama označí (klik → touch.js: náhľad + hlas mena).
// Ťuk na bočnú kartu ju označí a pás ju dotočí do stredu. Mimo pásu ostáva: turnajový výber z vlastného tímu
// (roster-mode, 3 karty) a skrytá stránka (hidden-mode - otvára aj zatvára ju runa v rohu, char-select.js).
// DOM sa nepresúva: kontajnery stránok majú v pásovom režime display: contents a karty sú absolútne v .char-pager
// (CSS „Telefón - pás postáv" v styles.css); pozíciu karty píše len tento modul (inline transform).
import { selEl, charPageTitle } from "/client/dom.js";
import { isPhone, appScale } from "/client/viewport.js";

const SPACING = 272;     // rozostup kariet v pase (šírka karty 250 + medzera) - virtuálne px
const CENTER_SCALE = 1.08;
const DRAG_START_PX = 8; // posun prsta, od ktorého ide o ťahanie (nie ťuk)
const FLICK_VEL = 0.8;   // px/ms (virtuálne) - rýchlejší pohyb prsta pri pustení = švih s dobehom
const pager = selEl?.querySelector(".char-pager");

let cards = [];
let pos = 0, target = 0;  // index karty v strede (desatinný počas pohybu)
let raf = 0;
let drag = null;          // { id, x0, pos0, moved, lastX, lastT, vel }
let suppressClickUntil = 0;
let settleArm = false;    // po dobehnutí označ kartu v strede
let savedPos = null;      // poloha pásu pri odchode na Hidden stránku - runa vráti hráča presne sem

export const stripActive = () => selEl?.classList.contains("strip-mode") || false;
const wrap = (d, n) => ((d % n) + n + n / 2) % n - n / 2; // rozdiel indexov do <-n/2, n/2)
const nearestIndex = () => ((Math.round(pos) % cards.length) + cards.length) % cards.length;
export function stripCenterCard() { return cards.length ? cards[nearestIndex()] : null; }

function collect() {
  cards = [...selEl.querySelectorAll('.char-cards:not([data-page="hidden"]) .char-card[data-char]')];
}
function layout() {
  const n = cards.length;
  cards.forEach((c, i) => {
    const d = wrap(i - pos, n);
    const a = Math.abs(d);
    const s = a < 1 ? CENTER_SCALE - (CENTER_SCALE - 1) * a : 1;
    // karty ďalej než 2,6 miesta od stredu sú za okrajom pásu - skryť (inak by preskok na druhý koniec bolo vidieť)
    c.style.visibility = a > 2.6 ? "hidden" : "";
    c.style.zIndex = String(10 - Math.round(a));
    c.style.transform = `translate(-50%, -50%) translateX(${(d * SPACING).toFixed(1)}px) scale(${s.toFixed(3)})`;
  });
}
// nadpis podľa stránky karty v strede (Mages / Experimental)
function syncTitle() {
  const page = stripCenterCard()?.closest(".char-cards")?.dataset.page;
  if (charPageTitle && page != null) charPageTitle.textContent = page === "1" ? "Mages" : "Experimental";
}
function tick() {
  raf = 0;
  if (!drag) {
    const diff = target - pos;
    pos = Math.abs(diff) < 0.002 ? target : pos + diff * 0.22;
  }
  layout();
  if (drag || pos !== target) { raf = requestAnimationFrame(tick); return; }
  // dobehol: normalizuj pozíciu do 0..n-1 (nekonečný pás), nadpis, označ kartu v strede
  const n = cards.length;
  pos = target = ((pos % n) + n) % n;
  syncTitle();
  if (settleArm) {
    settleArm = false;
    const c = stripCenterCard();
    if (c && !c.classList.contains("touch-armed")) c.click(); // touch.js: označí + náhľad + hlas mena
  }
}
const run = () => { if (!raf) raf = requestAnimationFrame(tick); };

// pás dotočí kartu `card` do stredu najkratšou cestou
function goTo(card, arm) {
  const i = cards.indexOf(card);
  if (i < 0) return;
  target = pos + wrap(i - pos, cards.length);
  settleArm = arm;
  run();
}

/* ---------- zapnutie / vypnutie pásového režimu ---------- */
function sync() {
  const on = isPhone && !selEl.classList.contains("hidden") && !selEl.classList.contains("roster-mode")
    && !selEl.classList.contains("hidden-mode");
  if (on === stripActive()) return;
  if (on) {
    collect();
    selEl.classList.add("strip-mode");
    // stred = označená karta pásu, inak miesto, kde hráč bol pred Hidden stránkou, inak Fire Wizard (stránka Mages)
    const armed = selEl.querySelector(".char-card.touch-armed");
    if (cards.includes(armed)) pos = cards.indexOf(armed);
    else if (savedPos != null) pos = savedPos;
    else pos = Math.max(0, cards.indexOf(selEl.querySelector('.char-card[data-char="fire"]')));
    target = pos;
    layout();
    syncTitle();
  } else {
    savedPos = target;
    drag = null;
    selEl.classList.remove("strip-mode");
    for (const c of cards) { c.style.transform = ""; c.style.visibility = ""; c.style.zIndex = ""; }
  }
}

if (isPhone && selEl && pager) {
  new MutationObserver(sync).observe(selEl, { attributes: true, attributeFilter: ["class"] });
  sync();

  pager.addEventListener("pointerdown", (e) => {
    if (!stripActive()) return;
    drag = { id: e.pointerId, x0: e.clientX, pos0: pos, moved: false, lastX: e.clientX, lastT: e.timeStamp, vel: 0 };
  });
  pager.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x0) / appScale(); // skutočné px obrazovky → virtuálne px stránky
    if (!drag.moved && Math.abs(dx) < DRAG_START_PX) return;
    drag.moved = true;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.vel = 0.7 * drag.vel + 0.3 * ((e.clientX - drag.lastX) / appScale() / dt); // px/ms
    drag.lastX = e.clientX; drag.lastT = e.timeStamp;
    pos = target = drag.pos0 - dx / SPACING;
    run();
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.moved) return; // ťuk - rieši ho click nižšie (a touch.js)
    // prichytenie na celú kartu; len rýchly švih (nad FLICK_VEL) dobehne ďalej (max 3 karty) - pomalé potiahnutie
    // o jednu kartu skončí presne na nej
    const flick = Math.abs(d.vel) > FLICK_VEL ? Math.max(-3, Math.min(3, -d.vel * 150 / SPACING)) : 0;
    target = Math.round(pos + flick);
    settleArm = true;
    suppressClickUntil = performance.now() + 400; // klik po ťahaní nesmie označiť kartu pod prstom
    run();
  };
  pager.addEventListener("pointerup", end);
  pager.addEventListener("pointercancel", end);

  // window capture beží PRED touch.js (document capture): po ťahaní klik zahoď; ťuk na kartu ju dotočí do stredu
  window.addEventListener("click", (e) => {
    if (!stripActive() || !pager.contains(e.target)) return;
    if (e.isTrusted && performance.now() < suppressClickUntil) { e.stopImmediatePropagation(); e.preventDefault(); suppressClickUntil = 0; return; }
    const card = e.target.closest?.(".char-card[data-char]");
    if (card && cards.includes(card)) goTo(card, false); // označenie spraví touch.js (ten istý klik)
  }, true);
}
