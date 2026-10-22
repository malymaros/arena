// public/client/touch.js - dotykové ovládanie (telefón aj tablet; docs/MOBILE.md, krok 2). Na zariadení bez
// dotyku nerobí nič - desktop ostáva presne ako bol. Musí sa importovať AŽ PO controls.js / preview-hovers.js /
// char-select.js (presúva ich pickery a spolieha sa na ich už naviazané handlery).
//
//  1. Ťuk = výber + náhľad: prvé ťuknutie na akciu bez cieľa (melee, shield, recharge…) ju označí (.touch-armed,
//     štítok TAP AGAIN), vyvolá jej hover náhľad (zóna na boarde - tie isté mouseenter handlery ako na desktope)
//     a ukáže popis v info riadku; druhé ťuknutie ju vykoná. Tlačidlá, ktoré otvárajú výber smeru / políčka,
//     reagujú hneď; kým je výber otvorený, ostatné akcie na ťuknutie nereagujú vôbec (CSS pointer-events na
//     .locked-ui) - nezmení sa ani popis, ani náhľad.
//  2. Výbery smeru sa presunú do vrstvy nad boardom (#touch-layer) a otvárajú sa na postave (jej ghost pozícii
//     po naplánovaných akciách), zväčšené na prst. Šípka útoku / specialu a políčko = rovnako ako akcia: prvé
//     ťuknutie ukáže zónu zásahu + TAP AGAIN, druhé zaradí. Šípky pohybu ležia na cieľovom políčku → jedno ťuknutie.
//  3. Výber políčka (Soldier, pasca, Luffy) sa prekryje presne cez board - ťuká sa priamo na políčka.
//  4. Výber postavy: ťuk na kartu = schopnosť + náhľad (aj opakovaný - kartou sa NIKDY nevyberá), postavu
//     vyberie len tlačidlo PICK <meno> (v turnajovom drafte ADD / REMOVE). Na telefóne je prvá
//     karta predvybraná (bez hlasu), aby pravý panel s náhľadom nikdy nebol prázdny.
//  5. :hover pravidlá sa na dotyku vypnú (po ťuknutí by „viseli").
import { isTouch, isPhone, appScale } from "/client/viewport.js";
import { moveBtn, attackBtn, dashBtn, specialBtn, mirrorBtn, cellToPx, TILE_W, TILE_H, GAP, selEl } from "/client/dom.js";
import { specialTargetOf, uiLocked } from "/client/controls.js";
import { ghostCharAt, ghostPos } from "/client/ghost.js";
import { CHARS_BY_KEY, VAMP_CHARS } from "/chars/index.js";
import { state, me, board } from "/client/session.js";
import { planning } from "/client/planning.js";


/* ---------- 5. :hover pravidlá preč (na dotyku po ťuknutí „visia") - sú len kozmetické ---------- */
function stripHoverRules() {
  const strip = (list) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r.cssRules && !r.selectorText) { strip(r.cssRules); continue; } // @media a pod.
      if (!r.selectorText || !r.selectorText.includes(":hover")) continue;
      const keep = r.selectorText.split(",").filter(s => !s.includes(":hover"));
      if (keep.length) r.selectorText = keep.join(",");
      else if (r.parentRule) r.parentRule.deleteRule(i);
      else r.parentStyleSheet.deleteRule(i);
    }
  };
  for (const sh of document.styleSheets) {
    try { strip(sh.cssRules); } catch { /* cudzí origin (Google Fonts) - nečitateľné, nevadí */ }
  }
}

/* ---------- 2+3. pickery na boarde ---------- */
const PICKER_IDS = ["dir-picker", "dash-picker", "aim-picker", "aim-picker-diag", "special-picker", "wolf-picker", "s1-picker", "cell-picker"];
let layer = null;
function initPickerLayer() {
  const boardEl = document.querySelector(".board");
  if (!boardEl) return;
  // fixná vrstva v body (nad toolbarom - picker na spodnom riadku boardu by inak zakryl), zarovnaná na board
  layer = document.createElement("div");
  layer.id = "touch-layer";
  document.body.appendChild(layer);
  const syncLayer = () => {
    let x = 0, y = 0, e = boardEl; // layout px relatívne k body (transform body to nemení)
    while (e && e !== document.body) { x += e.offsetLeft; y += e.offsetTop; e = e.offsetParent; }
    Object.assign(layer.style, { left: x + "px", top: y + "px", width: boardEl.offsetWidth + "px", height: boardEl.offsetHeight + "px" });
  };
  for (const id of PICKER_IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    layer.appendChild(el);
    // otvorenie pickera (controls.js zhodí .hidden) → umiestni ho na postavu / cez board
    new MutationObserver(() => { if (!el.classList.contains("hidden")) { syncLayer(); placePicker(el); } })
      .observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  window.addEventListener("resize", syncLayer);
  syncLayer();
}
function placePicker(el) {
  if (el.id === "cell-picker") {
    // políčka pickera = presne políčka boardu
    Object.assign(el.style, { left: "0px", top: "0px", gap: GAP + "px",
      gridTemplateColumns: `repeat(${board.w}, ${TILE_W}px)`, gridAutoRows: `${TILE_H}px` });
    return;
  }
  const p = ghostPos() || state?.[me];
  if (!p || p.x == null) return;
  const { left, top } = cellToPx(p.x, p.y);
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top = (top + TILE_H / 2) + "px";
}

/* ---------- 1. ťuk = výber + náhľad, druhý ťuk = vykonať ---------- */
// ťukateľné prvky s výberom/náhľadom; LOCK IN, undo, menu a pod. reagujú normálne
const SELECTABLE = [
  ".controls-row .btn.act", ".controls-row .golden-half", ".controls-row .gm-half", ".controls-row .ls-half",
  "#touch-layer .arrow", "#touch-layer .mini-target", ".q-badge.mine", ".mhead.clickable", "#char-select .char-card",
].join(",");
let armed = null;
let infoEl = null;

// tlačidlá, ktoré len otvárajú výber (cieľ sa volí až potom) a šípky pohybu (ležia na cieli) → jedno ťuknutie
function oneTap(el) {
  if (el === moveBtn || el === attackBtn || el === dashBtn) return true;
  const c = ghostCharAt();
  if (el === specialBtn) return specialTargetOf(c) !== "none";
  if (el === mirrorBtn) return CHARS_BY_KEY[c]?.mirrorSlot === "special1";
  if (el.closest("#dir-picker")) return true;            // pohyb - šípka leží na cieľovom políčku
  if (el.closest("#dash-picker")) return !VAMP_CHARS[c];  // Vampire/Onryō: dash = charge so zónou → náhľad + TAP AGAIN
  return false;
}
// len náhľad (bez akcie): naplánované akcie vo fronte - ťuk zapne / vypne náhľad zóny
const previewOnly = (el) => el.classList.contains("q-badge");

// šípka / políčko pickera: vlastný popis („Shoot Left") + popis akcie z jej tlačidla (cena, dmg)
const PICKER_OPENER = { "dir-picker": moveBtn, "dash-picker": dashBtn, "aim-picker": attackBtn, "aim-picker-diag": attackBtn,
  "special-picker": specialBtn, "wolf-picker": specialBtn, "cell-picker": specialBtn, "s1-picker": mirrorBtn };
function describe(el) {
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const own = clean(el.title || el.closest("[title]")?.title);
  const picker = el.closest(".dir-picker");
  const opener = picker ? clean(PICKER_OPENER[picker.id]?.title) : "";
  return opener && opener !== own ? (own ? `${own} · ${opener}` : opener) : own;
}
function showInfo(text) {
  if (!infoEl) return;
  infoEl.textContent = text;
  infoEl.classList.toggle("hidden", !text);
}
// štítok „TAP AGAIN" nad označenou akciou - aby bolo jasné, že treba ťuknúť ešte raz
let confirmEl = null;
function placeConfirm(el) {
  if (!confirmEl) { confirmEl = document.createElement("div"); confirmEl.id = "touch-confirm"; confirmEl.textContent = "TAP AGAIN"; document.body.appendChild(confirmEl); }
  if (!el || el.classList.contains("char-card") || el.classList.contains("q-badge")) { confirmEl.classList.add("hidden"); return; }
  // súradnice displeja → layout px v body (body je zmenšené transformom, viewport.js)
  const r = el.getBoundingClientRect(), b = document.body.getBoundingClientRect(), k = appScale();
  confirmEl.style.left = ((r.left + r.width / 2 - b.left) / k) + "px";
  confirmEl.style.top = ((r.top - b.top) / k) + "px";
  confirmEl.classList.remove("hidden");
}
function arm(el, silent = false) {
  disarm();
  armed = el;
  el.classList.add("touch-armed");
  const enter = new MouseEvent("mouseenter");
  if (silent) enter.arenaSilent = true; // predvýber karty - náhľad bez hlasu mena (char-select.js)
  el.dispatchEvent(enter); // tie isté náhľady ako hover na desktope
  if (!el.classList.contains("char-card")) showInfo(describe(el));
  placeConfirm(el);
}
export function disarm() {
  if (!armed) return;
  const el = armed;
  armed = null;
  el.classList.remove("touch-armed");
  placeConfirm(null);
  if (el.isConnected) el.dispatchEvent(new MouseEvent("mouseleave"));
  if (el.classList.contains("char-card")) el.closest(".char-cards")?.dispatchEvent(new MouseEvent("mouseleave"));
  showInfo("");
  syncPickBar();
}
function initTapSelect() {
  infoEl = document.createElement("div");
  infoEl.id = "touch-info";
  infoEl.className = "hidden";
  document.body.appendChild(infoEl);

  document.addEventListener("click", (ev) => {
    if (armed && !armed.isConnected) disarm();
    const el = ev.target.closest?.(SELECTABLE);
    if (isPhone && selEl && !selEl.classList.contains("hidden")) setTimeout(keepCardPreview, 30);
    if (!el) {
      // telefón: predvybraná karta ostáva (pravý panel výberu postáv nesmie ostať prázdny)
      if (ev.target.closest?.("#touch-pick") || (isPhone && armed?.classList.contains("char-card"))) return;
      // otvorený výber smeru: ťuk vedľa (aj na zamknuté tlačidlo - prepustí ťuk na lištu) nič neruší
      // (prehliadač pri ťuku inde poslal označenej šípke mouseleave a zmazal jej náhľad - obnov ho)
      if (planning.openPicker) { if (armed?.isConnected) armed.dispatchEvent(new MouseEvent("mouseenter")); return; }
      disarm(); return;
    }
    if (el.disabled) return;
    // otvorený výber smeru / políčka zamyká ostatné akcie: klik prejde bez označenia → controls.js zatrasie tlačidlom
    if (planning.openPicker && el.closest(".controls-row") && !oneTap(el)) { disarm(); return; }
    if (previewOnly(el)) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (armed === el) disarm(); else arm(el);
      return;
    }
    // karta postavy: ťuk ju len označí (aj opakovaný) - vyberá výhradne tlačidlo PICK (pickClick)
    if (el.classList.contains("char-card")) {
      if (pickClick) return;                                   // klik z tlačidla PICK → vykonať výber
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (!el.dataset.char) return;                            // „Coming soon" - na ťuk nereaguje vôbec
      if (armed !== el) arm(el);
      syncPickBar();
      return;
    }
    if (armed === el) { disarm(); return; }                    // druhé ťuknutie → nechaj prejsť = vykonať
    if (oneTap(el) && !uiLocked()) { disarm(); showInfo(describe(el)); return; } // otvorenie výberu / pohyb hneď
    ev.preventDefault(); ev.stopImmediatePropagation();         // prvé ťuknutie → len výber + náhľad
    arm(el);
    syncPickBar();
  }, true);

  // zmena fronty / zatvorenie pickera / nové kolo → označenie stratí zmysel
  const queueEl = document.getElementById("queue");
  if (queueEl) new MutationObserver(() => { if (armed && !armed.classList.contains("q-badge") && !armed.classList.contains("char-card")) disarm(); })
    .observe(queueEl, { childList: true, subtree: true });
  // info riadok nechaj len kým je otvorený výber alebo niečo označené
  setInterval(() => { if (!armed && !planning.openPicker && infoEl && !infoEl.classList.contains("hidden")) showInfo(""); }, 400);
}

/* ---------- 4. výber postavy: PICK <meno> pod náhľadom schopnosti ---------- */
let pickBar = null;
let pickClick = false; // práve prebieha klik vyvolaný tlačidlom PICK (jediná cesta, ako vybrať postavu)
// telefón: výber postáv má náhľad schopnosti v pravom stĺpci - bez označenej karty by ostal prázdny a celý výber
// by pôsobil posunutý doľava. Prvá viditeľná voliteľná karta je preto vždy predvybraná (bez hlasu mena).
const visibleCard = (c) => c && c.isConnected && c.offsetParent !== null && !c.closest(".char-cards.hidden");
// Pri otvorení výberu je predvýber tichý; po prepnutí stránky (šípky, runa → Hidden) hlas mena zaznie
// (doprava → Medusa, doľava → Escanor, Hidden → Vampire / Onryō). Okno 1 s pokryje aj glitch prechod runy.
let voiceUntil = 0;
function autoArmCard() {
  if (!isPhone || !selEl || selEl.classList.contains("hidden")) return;
  if (armed?.classList.contains("char-card") && visibleCard(armed)) { keepCardPreview(); return; }
  const card = [...selEl.querySelectorAll(".char-card[data-char]")].find(c => visibleCard(c) && !c.classList.contains("dead"));
  const voice = performance.now() < voiceUntil;
  voiceUntil = 0;
  if (card) { arm(card, !voice); syncPickBar(); }
}
// pravý panel mohol vyprázdniť mouseleave z prehliadača (dotyk mimo kariet) - obnov náhľad označenej karty
function keepCardPreview() {
  if (!armed?.classList.contains("char-card") || !visibleCard(armed)) return;
  if (document.getElementById("char-ability")?.classList.contains("hidden")) {
    const enter = new MouseEvent("mouseenter"); enter.arenaSilent = true; armed.dispatchEvent(enter);
  }
}
function initCharPick() {
  if (!selEl) return;
  if (isPhone) {
    // otvorenie výberu, zmena stránky (šípky), roster-mode → predvýber prvej karty
    const again = () => setTimeout(autoArmCard, 60);
    document.addEventListener("click", (ev) => {
      if (ev.target.closest?.("#char-page-prev, #char-page-next, #hidden-rune")) voiceUntil = performance.now() + 1000;
    }, true);
    new MutationObserver(again).observe(selEl, { attributes: true, attributeFilter: ["class"] });
    selEl.querySelectorAll(".char-cards").forEach(el => new MutationObserver(again).observe(el, { attributes: true, attributeFilter: ["class"] }));
  }
  pickBar = document.createElement("button");
  pickBar.type = "button";
  pickBar.id = "touch-pick";
  pickBar.className = "hidden";
  selEl.appendChild(pickBar);
  pickBar.addEventListener("click", () => {
    const card = armed?.classList.contains("char-card") ? armed : null;
    if (!card) return;
    pickClick = true;
    try { card.click(); } finally { pickClick = false; }
    syncPickBar(); // draft: ADD ↔ REMOVE
  });
}
function syncPickBar() {
  if (!pickBar) return;
  const card = armed?.classList.contains("char-card") ? armed : null;
  const key = card?.dataset.char;
  const dead = card?.classList.contains("dead");
  if (!key || dead) { pickBar.classList.add("hidden"); return; }
  // bez diakritiky (ONRYŌ → ONRYO): pixel font nemá veľké Ō a náhradný znak by z nápisu trčal
  const name = (CHARS_BY_KEY[key]?.meta?.name || key).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  const team = selEl.classList.contains("team-mode");
  pickBar.textContent = team ? `${card.classList.contains("picked") ? "REMOVE" : "ADD"} ${name}` : `PICK ${name}`;
  pickBar.classList.remove("hidden");
}

// spustenie až na konci modulu (všetky let/const vyššie sú už inicializované)
if (isTouch) {
  stripHoverRules();
  initPickerLayer();
  initTapSelect();
  initCharPick();
}
