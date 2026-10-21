// public/client/touch.js - dotykové ovládanie (telefón aj tablet; docs/MOBILE.md, krok 2). Na zariadení bez
// dotyku nerobí nič - desktop ostáva presne ako bol. Musí sa importovať AŽ PO controls.js / preview-hovers.js /
// char-select.js (presúva ich pickery a spolieha sa na ich už naviazané handlery).
//
//  1. Ťuk = výber + náhľad: prvé ťuknutie na akciu ju označí (.touch-armed), vyvolá jej hover náhľad (zóna na
//     boarde - tie isté mouseenter handlery ako na desktope) a ukáže popis v info riadku; druhé ťuknutie ju
//     vykoná. Tlačidlá, ktoré len otvárajú výber smeru / políčka, reagujú hneď (výberom je až cieľ).
//  2. Výbery smeru sa presunú do vrstvy nad boardom (#touch-layer) a otvárajú sa na postave (jej ghost pozícii
//     po naplánovaných akciách), zväčšené na prst. Šípky pohybu ležia na cieľovom políčku → jedno ťuknutie;
//     šípky útoku / specialov najprv ukážu zónu.
//  3. Výber políčka (Soldier, pasca, Luffy) sa prekryje presne cez board - ťuká sa priamo na políčka.
//  4. Výber postavy: ťuk na kartu = schopnosť + náhľad, tlačidlo PICK <meno> ju vyberie.
//  5. :hover pravidlá sa na dotyku vypnú (po ťuknutí by „viseli").
import { isTouch } from "/client/viewport.js";
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
  if (el.closest("#dir-picker")) return true;
  if (el.closest("#dash-picker")) return !VAMP_CHARS[c]; // Vampire/Onryō: dash = charge so zónou → náhľad
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
function arm(el) {
  disarm();
  armed = el;
  el.classList.add("touch-armed");
  el.dispatchEvent(new MouseEvent("mouseenter")); // tie isté náhľady ako hover na desktope
  if (!el.classList.contains("char-card")) showInfo(describe(el));
}
export function disarm() {
  if (!armed) return;
  const el = armed;
  armed = null;
  el.classList.remove("touch-armed");
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
    if (!el) { if (!ev.target.closest?.("#touch-pick")) disarm(); return; }
    if (el.disabled) return;
    if (previewOnly(el)) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      if (armed === el) disarm(); else arm(el);
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
function initCharPick() {
  if (!selEl) return;
  pickBar = document.createElement("button");
  pickBar.type = "button";
  pickBar.id = "touch-pick";
  pickBar.className = "hidden";
  selEl.appendChild(pickBar);
  pickBar.addEventListener("click", () => {
    const card = armed?.classList.contains("char-card") ? armed : null;
    if (card) card.click(); // armed karta → klik prejde interceptorom ako druhé ťuknutie
  });
}
function syncPickBar() {
  if (!pickBar) return;
  const card = armed?.classList.contains("char-card") ? armed : null;
  const key = card?.dataset.char;
  const dead = card?.classList.contains("dead");
  if (!key || dead) { pickBar.classList.add("hidden"); return; }
  const name = (CHARS_BY_KEY[key]?.meta?.name || key).toUpperCase();
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
