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
//  3. Výber políčka (Soldier, pasca, Luffyho ruka) sa prekryje presne cez board - ťuká sa priamo na políčka.
//  4. Výber postavy: ťuk na kartu = schopnosť + náhľad (aj opakovaný - kartou sa NIKDY nevyberá), postavu
//     vyberie len tlačidlo PICK <meno> (v turnajovom drafte ADD / REMOVE). Na telefóne je prvá
//     karta predvybraná (bez hlasu), aby pravý panel s náhľadom nikdy nebol prázdny.
//  5. :hover pravidlá sa na dotyku vypnú (po ťuknutí by „viseli").
//  6. Telefón: namiesto popisu štítok s cenou a účinkom (touch-label.js) nad tlačidlom - pri otvorenom výbere
//     smeru nad tlačidlom, ktoré ho otvorilo; žltá linka = varovanie; málo many = červený štítok, blikajúci obrys
//     mana baru a sivé tlačidlo - zaradiť sa dá aj tak (server ju preškrtne). Zablokované = zámok v strede.
import { isTouch, appScale } from "/client/viewport.js";
import { moveBtn, attackBtn, dashBtn, specialBtn, mirrorBtn, lockBtn, undoBtn, TILE_W, TILE_H, GAP, selEl } from "/client/dom.js";
import { specialTargetOf, uiLocked } from "/client/controls.js";
import { ghostCharAt } from "/client/ghost.js";
import { CHARS_BY_KEY, VAMP_CHARS } from "/chars/index.js";
import { board } from "/client/session.js";
import { planning } from "/client/planning.js";
import { stripActive, stripCenterCard } from "/client/char-strip.js";
import { slotOf, labelInfo, openerOf, MANA_BUTTONS } from "/client/touch-label.js";
import { costMarkup } from "/client/balance-ui.js";
import { hydratePix } from "/client/pix.js";
import { state, me } from "/client/session.js";


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
const PICKER_IDS = ["dir-picker", "dash-picker", "aim-picker", "aim-picker-diag", "special-picker", "wolf-picker", "s1-picker", "cell-picker", "s1-cell-picker"];
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
    new MutationObserver(() => { if (!el.classList.contains("hidden")) { syncLayer(); placePicker(el); } refreshLabel(); })
      .observe(el, { attributes: true, attributeFilter: ["class"] });
  }
  window.addEventListener("resize", syncLayer);
  syncLayer();
}
function placePicker(el) {
  if (el.id === "cell-picker" || el.id === "s1-cell-picker") {
    // políčka pickera = presne políčka boardu
    Object.assign(el.style, { left: "0px", top: "0px", gap: GAP + "px",
      gridTemplateColumns: `repeat(${board.w}, ${TILE_W}px)`, gridAutoRows: `${TILE_H}px` });
    return;
  }
  // smerové pickery pevne v strede boardu (nie pri postave - na krajnom riadku/stĺpci by šípky trčali mimo plochy
  // cez nadpis, HUD či lištu); smery sú absolútne, poloha pickera na nich nič nemení
  el.style.left = (board.w * TILE_W + (board.w - 1) * GAP) / 2 + "px";
  el.style.top = (board.h * TILE_H + (board.h - 1) * GAP) / 2 + "px";
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
  "special-picker": specialBtn, "wolf-picker": specialBtn, "cell-picker": specialBtn, "s1-picker": mirrorBtn, "s1-cell-picker": mirrorBtn };
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
function placeConfirm(el, warn = null) {
  if (!confirmEl) { confirmEl = document.createElement("div"); confirmEl.id = "touch-confirm"; document.body.appendChild(confirmEl); }
  if (!el || el.classList.contains("char-card") || el.classList.contains("q-badge")) { confirmEl.classList.add("hidden"); return; }
  confirmEl.innerHTML = (warn ? `<span class="tc-warn">⚠ ${warn}</span>` : "") + "TAP AGAIN";
  confirmEl.classList.remove("hidden");
  placeAbove(confirmEl, el);
}
// bublina nad prvkom: súradnice displeja → layout px v body (body je zmenšené transformom, viewport.js);
// vodorovne sa drží na obrazovke (krajné zlaté tlačidlá), šípka bubliny ostáva nad prvkom (--tip-x)
function placeAbove(box, el) {
  const r = el.getBoundingClientRect(), b = document.body.getBoundingClientRect(), k = appScale();
  const cx = (r.left + r.width / 2 - b.left) / k;
  const half = box.offsetWidth / 2, maxX = b.width / k;
  const x = Math.min(Math.max(cx, half + 6), maxX - half - 6);
  box.style.left = x + "px";
  box.style.top = ((r.top - b.top) / k) + "px";
  box.style.setProperty("--tip-x", (cx - x + half) + "px");
}

/* ---------- 6. telefón: štítok cena + účinok (touch-label.js) ---------- */
let labelEl = null;
let flashBar = null;
function openPickerEl() {
  if (!planning.openPicker) return null;
  return PICKER_IDS.map(id => document.getElementById(id)).find(p => p && !p.classList.contains("hidden")) || null;
}
function setFlash(on) {
  const bar = on && me ? document.getElementById(`${me}-mana`) : null;
  if (flashBar && flashBar !== bar) flashBar.classList.remove("no-mana-flash");
  flashBar = bar;
  bar?.classList.add("no-mana-flash");
}
// sivé tlačidlá akcií, na ktoré na ďalšom mieste fronty nebude mana
function syncNoMana() {
  const playing = state?.phase === "playing" && !!state?.[me]?.char && !uiLocked();
  for (const b of MANA_BUTTONS()) b.classList.toggle("no-mana", playing && !b.disabled && labelInfo(slotOf(b), b).noMana);
}
function refreshLabel() {
  if (!isTouch) return;
  if (!labelEl) {
    labelEl = document.createElement("div");
    labelEl.id = "touch-label";
    labelEl.className = "hidden";
    document.body.appendChild(labelEl);
  }
  // štítok visí nad tlačidlom, ktoré otvorilo výber, inak nad označeným tlačidlom akcie
  const opener = openerOf(openPickerEl());
  const host = slotOf(opener) ? opener : (armed && slotOf(armed) ? armed : null);
  const info = host ? labelInfo(slotOf(host), host) : null;
  const inPicker = !!armed?.closest?.("#touch-layer");
  const pick = inPicker && host ? labelInfo(slotOf(host), armed) : null;
  const noMana = !!info?.noMana || !!pick?.noMana;
  // pri otvorenom výbere smeru sú zamknuté aj LOCK IN a ↩ (rovnaký zámok ako akcie)
  for (const b of [lockBtn, undoBtn]) b?.classList.toggle("touch-locked", !!planning.openPicker);
  if (info?.text) {
    const tap = host === armed;
    const html = `<div class="tl-main">${costMarkup(info.text)}</div>`
      + (info.warn ? `<div class="tl-warn">⚠ ${info.warn}</div>` : "")
      + (tap ? `<div class="tl-tap">TAP AGAIN</div>` : "");
    if (labelEl.dataset.html !== html) { labelEl.dataset.html = html; labelEl.innerHTML = html; hydratePix(labelEl); }
    labelEl.classList.toggle("no-mana", noMana);
    labelEl.classList.remove("hidden");
    placeAbove(labelEl, host);
  } else labelEl.classList.add("hidden");
  // bublina nad šípkou / políčkom / hlavou maga: TAP AGAIN (+ varovanie závislé od smeru)
  if (!armed || (host === armed && info?.text)) placeConfirm(null);
  else placeConfirm(armed, pick?.warn && pick.warn !== info?.warn ? pick.warn : null);
  setFlash(noMana && !!info?.text);
  syncNoMana();
}
function arm(el, silent = false) {
  disarm();
  armed = el;
  el.classList.add("touch-armed");
  const enter = new MouseEvent("mouseenter");
  if (silent) enter.arenaSilent = true; // predvýber karty - náhľad bez hlasu mena (char-select.js)
  el.dispatchEvent(enter); // tie isté náhľady ako hover na desktope
  if (isTouch) { refreshLabel(); return; } // telefón: štítok namiesto popisu
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
  refreshLabel();
}
function initTapSelect() {
  infoEl = document.createElement("div");
  infoEl.id = "touch-info";
  infoEl.className = "hidden";
  document.body.appendChild(infoEl);

  document.addEventListener("click", (ev) => {
    if (armed && !armed.isConnected) disarm();
    const el = ev.target.closest?.(SELECTABLE);
    if (isTouch && selEl && !selEl.classList.contains("hidden")) setTimeout(keepCardPreview, 30);
    if (!el) {
      // telefón: predvybraná karta ostáva (pravý panel výberu postáv nesmie ostať prázdny)
      if (ev.target.closest?.("#touch-pick") || (isTouch && armed?.classList.contains("char-card"))) return;
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
    if (oneTap(el) && !uiLocked()) { disarm(); if (!isTouch) showInfo(describe(el)); return; } // otvorenie výberu / pohyb hneď
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
  // telefón: štítok, sivé tlačidlá a obrys mana baru sledujú manu a frontu (zmena stavu, golden, Last Hope…)
  if (isTouch) setInterval(refreshLabel, 400);
}

/* ---------- 4. výber postavy: PICK <meno> pod náhľadom schopnosti ---------- */
let pickBar = null;
let pickClick = false; // práve prebieha klik vyvolaný tlačidlom PICK (jediná cesta, ako vybrať postavu)
// telefón: výber postáv má náhľad schopnosti v pravom stĺpci - bez označenej karty by ostal prázdny a celý výber
// by pôsobil posunutý doľava. Prvá viditeľná voliteľná karta je preto vždy predvybraná (bez hlasu mena).
// trieda .hidden stránky neplatí v páse postáv (char-strip.js - všetky bežné stránky naraz, okrem Hidden) ani vo
// výbere z turnajového tímu (roster-mode zlúči všetky stránky, aj Hidden; mimo tímu sú karty display: none)
const visibleCard = (c) => {
  if (!c || !c.isConnected || c.offsetParent === null) return false;
  if (selEl.classList.contains("roster-mode")) return true;
  return stripActive() ? !c.closest('[data-page="hidden"]') : !c.closest(".char-cards.hidden");
};
// Predvybraná karta povie meno (intro postavy) - pri otvorení výberu aj po prepnutí stránky (šípky, runa → Hidden).
// Označená karta, ktorá ostáva (napr. draft → výber z tímu), sa znova neohlási.
function autoArmCard() {
  if (!isTouch || !selEl || selEl.classList.contains("hidden")) return;
  // losovanie farieb (koleso) ešte beží nad výberom - predvýber s hlasom mena až po ňom
  if (!document.getElementById("color-roll")?.classList.contains("hidden")) { setTimeout(autoArmCard, 300); return; }
  // označená karta ostáva (napr. draft → výber z tímu): obnov PICK (ADD/REMOVE → PICK) aj náhľad, aj keď ho
  // char-select.js pri prepnutí režimu zmaže až po tomto volaní
  if (armed?.classList.contains("char-card") && visibleCard(armed)) { keepCardPreview(); syncPickBar(); setTimeout(keepCardPreview, 300); return; }
  const card = stripActive() ? stripCenterCard()
    : [...selEl.querySelectorAll(".char-card[data-char]")].find(c => visibleCard(c) && !c.classList.contains("dead"));
  if (card) { arm(card); syncPickBar(); }
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
  if (isTouch) {
    // otvorenie výberu, zmena stránky (šípky), roster-mode → predvýber prvej karty
    const again = () => setTimeout(autoArmCard, 60);
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
