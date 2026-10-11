// public/client/controls.js - akčné tlačidlá a pickery (move/dash/attack/melee/special/mirror/recharge, golden,
// Last Stand/Hope, démon), skiny z registra postáv, odoslanie lock_in.
import * as G from "/shared/geometry.js";
import { dirPicker, aimPicker, aimPickerDiag, dashPicker, specialPicker, cellPicker, wolfPicker, s1Picker, moveBtn, attackBtn, dashBtn, specialBtn, mirrorBtn, rechargeBtn, meleeBtn, undoBtn, goldenBtn, goldDualBtn, demonBtn, lastHopeBtn, gmCostEl, connErrorEl, lockBtn } from "/client/dom.js";
import { CHAR_BUTTONS, CHAR_LIST, CHARS_BY_KEY, SIDE_CHARS } from "/chars/index.js";
import { pixelizeEmoji, hydratePix, miniPix } from "/client/pix.js";
import { costHtml } from "/client/hud.js";
import { buttonUi, planning } from "/client/planning.js";
import { playback } from "/client/playback.js";
import { state, me, board, otherSlot } from "/client/session.js";
import { clearPreviewCells, ghostCharAt, ghostPos, showPreviewCells } from "/client/ghost.js";
import { renderQueue, updateLockButton } from "/client/queue.js";
import { cellsForDemonPreview } from "/client/zones.js";
import { socket } from "/client/net.js";

/* ---------- Controls ---------- */

function shakeBtn(btn) {
  btn.classList.add("shake");
  setTimeout(() => btn.classList.remove("shake"), 400);
}

// otvorený smerový picker blokuje všetky ostatné akčné tlačidlá;
// odblokuje sa opätovným klikom na to isté tlačidlo (picker sa zavrie)
const PICKERS = { move: dirPicker, attack: aimPicker, attack_diag: aimPickerDiag, dash: dashPicker, special: specialPicker, special_cell: cellPicker, special_wolf: wolfPicker, special1: s1Picker };
const PICKER_BTNS = { move: moveBtn, attack: attackBtn, attack_diag: attackBtn, dash: dashBtn, special: specialBtn, special_cell: specialBtn, special_wolf: specialBtn, special1: mirrorBtn };

// Vampire/Onryō: dash slot = CHARGE - tlačidlo dostane fialový „Hidden" skin s preblikávaním a ???
// namiesto bežca (tajomná akcia v štýle skrytej stránky); pre ostatných mágov sa vráti bežný dash.
// Attack tooltip navyše vysvetlí odraz strely. Volané zo state handlera pri každom snapshote.
// bežný vzhľad tlačidiel, ktoré postava môže preskinovať (buttons.<slot> v registri)
export const BTN_BASE = {
  dash:     { emoji: "🏃", title: "Dash - move up to 2 cells in a direction (−4 mana)", cost: "−4{💧}" },
  recharge: { emoji: "🙏", title: "Recharge (+4 mana)", cost: "+4{💧}" },
  mirror:   { emoji: "🪞", title: "Mirror (−4 mana, reflects all damage of the opponent's next action back at them)", cost: "−4{💧}" },
  melee:    { title: "Melee (−4 mana, 8 dmg, hits only an opponent on your cell)", cost: "−4{💧} 8{☠️}" },
};
const ATTACK_TITLE_DEFAULT = "Range Attack - choose a direction (−1 mana, damage by distance: 3/2/1, can't hit your own cell)";
// skin tlačidla podľa postavy: def.skin = trieda tlačidla aj jeho pickera + fialová „???" ikona
// (Vampire/Onryō charge, Jotarov Special 1, Luffyho prepínač gearu); bez skinu bežná ikona/cena/tooltip
function applyBtnSkin(slot, btn, picker, char) {
  if (!btn) return;
  const base = BTN_BASE[slot], def = CHAR_BUTTONS[char]?.[slot];
  // všetky skiny tohto slotu v registri - aktívny len ten postavin
  for (const sk of new Set(Object.values(CHAR_BUTTONS).map(b => b[slot]?.skin).filter(Boolean))) {
    btn.classList.toggle(sk, def?.skin === sk);
    picker?.classList.toggle(sk, def?.skin === sk);
  }
  const ico = btn.querySelector(".pix-ico");
  const cost = btn.querySelector(".cost");
  if (!ico) return;
  if (def?.skin) {
    delete ico.dataset.emoji;
    delete ico.dataset.done;
    ico.classList.add("charge-mark");
    ico.textContent = "???";
  } else {
    ico.classList.remove("charge-mark");
    if (ico.dataset.emoji !== base.emoji) {
      ico.dataset.emoji = base.emoji;
      ico.innerHTML = "";
      delete ico.dataset.done;
      pixelizeEmoji(ico);
    } else if (!ico.dataset.done) {
      pixelizeEmoji(ico);
    }
  }
  if (cost) { cost.innerHTML = costHtml(def?.cost ?? base.cost); hydratePix(cost); }
  btn.title = def?.title ?? base.title;
}
export function syncDashBtn(char) {
  applyBtnSkin("dash", dashBtn, dashPicker, char);
  attackBtn.title = CHAR_BUTTONS[char]?.attack?.title ?? ATTACK_TITLE_DEFAULT;
}

// Luffy: recharge slot = prepínač módu (base↔Gear3) - fialový ❔ „Hidden" skin ako vamp charge.
// Doplní manu A prepne mód (aj pri plnej mane). Pre ostatných mágov vráti bežný recharge.
export function syncRechargeBtn(char) { applyBtnSkin("recharge", rechargeBtn, null, char); }

// odznak stavu postavy na tlačidlách z registra (buttonBadge - Luffy: gear3.png na range attack + special,
// aj keď je v tomto kole naplánovaný recharge, aby hráč videl, že basic/special budú v gear3)
export function syncButtonBadges(char) {
  const btns = { attack: attackBtn, special: specialBtn };
  for (const c of CHAR_LIST) {
    const bb = c.buttonBadge; if (!bb) continue;
    const on = c.key === char && !!bb.on(buttonUi());
    for (const sl of bb.slots) { const b = btns[sl]; if (b) bb.cls.forEach(k => b.classList.toggle(k, on)); }
  }
}

// Jotaro nemá mirror - tento slot je Special 1 (Star Platinum): fialový ❔ skin, cost 4, L/R picker.
// Pre ostatné postavy vráti bežný mirror. Volané zo state handlera pri každom snapshote.
export function syncMirrorBtn(char) { applyBtnSkin("mirror", mirrorBtn, s1Picker, char); }

// po LOCK IN aj počas prehrávania kola sú všetky tlačidlá zamknuté a stmavené
export function uiLocked() {
  if (playback.tsPlanning) return false; // Jotaro počas THE WORLD plánuje zmrazené akcie - ovládanie odomknuté
  return planning.lockedIn || playback.playing || playback.tsFrozen || !!state?.[me]?.locked;
}

// vizuálne zámky: otvorený picker zamyká ostatné akčné tlačidlá, LOCK IN zamyká všetky
function actionButtonsAll() {
  const generic = [...document.querySelectorAll(".controls .actions button[data-act]")]
    .filter(b => !b.closest(".dir-picker"));
  return [
    moveBtn, attackBtn, dashBtn, meleeBtn, specialBtn,
    document.getElementById("golden-btn"),
    document.getElementById("gold-dual-btn"),
    document.getElementById("demon-btn"),
    document.getElementById("last-hope-btn"),
    ...generic
  ].filter(Boolean);
}
export function updateUiLocks() {
  const openBtn = planning.openPicker ? PICKER_BTNS[planning.openPicker] : null;
  const locked = uiLocked();
  actionButtonsAll().forEach(b => {
    let bl = locked || (!!planning.openPicker && b !== openBtn);
    // počas THE WORLD plánovania (playback.tsPlanning): special (THE WORLD práve beží) + golden/gold-dual/démon/last-hope
    // sú v zmrazenej trojici zakázané → zamkni ich (special1 v mirror slote a základné akcie ostávajú)
    if (playback.tsPlanning && (b === specialBtn || b.id === "golden-btn" || b.id === "gold-dual-btn" || b.id === "demon-btn" || b.id === "last-hope-btn")) bl = true;
    b.classList.toggle("locked-ui", bl);
  });
  undoBtn.classList.toggle("locked-ui", locked && !playback.tsPlanning);
}

export function closePickers() {
  Object.values(PICKERS).forEach(p => p.classList.add("hidden"));
  planning.openPicker = null;
  clearPreviewCells();
  updateUiLocks();
}
function togglePicker(kind, btn, usedType) {
  if (uiLocked()) return;
  if (planning.openPicker === kind) { closePickers(); return; } // opätovný klik = zavrieť
  if (planning.openPicker) { shakeBtn(btn); return; }           // iný picker je otvorený -> blokované
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === usedType)) {
    shakeBtn(btn);
    return;
  }
  PICKERS[kind].classList.remove("hidden");
  planning.openPicker = kind;
  updateUiLocks();
}

// Move / Attack / Dash: najprv výber smeru v mini-popupe
moveBtn.addEventListener("click",   () => togglePicker("move", moveBtn, "move"));
// Countess/Onre strieľajú diagonálne - attack otvára diagonálny picker namiesto ortogonálneho
attackBtn.addEventListener("click", () => {
  const c = ghostCharAt();
  // typ pickera z registra (attackPicker - Luffy: base diag, gear3 len ←/→); inak side-postavy diagonálne
  const ap = CHARS_BY_KEY[c]?.attackPicker;
  const pk = (typeof ap === "function" ? ap(buttonUi()) : ap) || (SIDE_CHARS[c] ? "diag" : "ortho");
  const kind = pk === "diag" ? "attack_diag" : "attack";
  aimPicker.classList.toggle("lr-only", pk === "lr"); // lr = ortogonálny picker bez ↑/↓
  togglePicker(kind, attackBtn, "attack");
});
dashBtn.addEventListener("click",   () => togglePicker("dash", dashBtn, "dash"));
// Melee: priama akcia bez pickera (Vampire/Onryō sekajú tiež len na vlastnej bunke)
meleeBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(meleeBtn); return; }
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "melee")) { shakeBtn(meleeBtn); return; }
  planning.myQueue.push({ type: "melee" });
  renderQueue();
});
// Vojak: mini mapa plochy pod special tlačidlom - klik vyberie cieľovú bunku lúča. Blokované:
// vlastná GHOST pozícia (kde budem v čase specialu po naplánovaných move/dash) a súperova aktuálna
// bunka + jeho tieňový klon (obe figúry - blokovanie len pravej by prezradilo, ktorá je skutočná).
// V labyrinte má súper x=null (server rediguje) → neblokuje sa nič okrem vlastnej bunky (streľba naslepo).
// reach (register specialReach - Luffy): len bunky, kam special z ghost pozície dosiahne
function buildCellPicker(freeAll = false, reach = null) {
  if (!cellPicker) return;
  cellPicker.innerHTML = "";
  cellPicker.style.gridTemplateColumns = `repeat(${board.w}, auto)`;
  const gp = ghostPos(); // pozícia, z ktorej sa special vykoná (po akciách už vo fronte)
  const opp = state?.[otherSlot()];
  const myTrap = state?.[me]?.trap || null; // Countess/Onre: kde už leží moja pasca (recast ju nahradí)
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn mini-target";
    // reach (Luffy): cieľ musí ležať na platnej línii (dáma/veža) z ghost pozície; ostatné bunky zamknuté.
    // Vlastná aj súperova bunka SÚ platné ciele (dogúľa sa naň a udrie, kto tam stojí).
    if (reach) {
      // len rozlíšenie platná línia vs mimo - ŽIADNE značky mojej/súperovej pozície
      // (tie dávajú zmysel u Soldiera, nie tu - Luffy sa smie dogúľať aj na vlastnú aj na súperovu bunku).
      const ok = !!(gp && reach({ G, board, ui: buttonUi(), g: gp, x, y }));
      if (!ok) { b.disabled = true; b.classList.add("off-line"); }
      b.addEventListener("mouseenter", () => showPreviewCells([[x, y]]));
      b.addEventListener("mouseleave", clearPreviewCells);
      b.addEventListener("click", () => {
        if (uiLocked() || b.disabled) return;
        if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) return;
        planning.myQueue.push({ type: "special", cell: { x, y } });
        closePickers();
        renderQueue();
      });
      cellPicker.appendChild(b);
      continue;
    }
    // freeAll (pasca Countess/Onre): ŽIADNE blokované bunky - aj súperova aktuálna, aj vlastná
    const isMe  = !freeAll && !!(gp && gp.x === x && gp.y === y);
    const isFoe = !freeAll && (!!(opp && opp.x === x && opp.y === y) || !!(opp?.clone && opp.clone.x === x && opp.clone.y === y));
    if (isMe)       { b.disabled = true; b.classList.add("own"); b.textContent = "▲"; b.title = "Your position at that point of the queue"; }
    else if (isFoe) { b.disabled = true; b.classList.add("foe"); b.textContent = "✕"; b.title = "Opponent's current cell - they're hit only if they move"; }
    else if (freeAll && myTrap && myTrap.x === x && myTrap.y === y) { b.classList.add("trap-here"); b.textContent = "◆"; b.title = "Your current trap - recasting replaces it"; }
    b.addEventListener("mouseenter", () => showPreviewCells([[x, y]]));
    b.addEventListener("mouseleave", clearPreviewCells);
    b.addEventListener("click", () => {
      if (uiLocked() || b.disabled) return;
      if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) return;
      planning.myQueue.push({ type: "special", cell: { x, y } });
      closePickers();
      renderQueue();
    });
    cellPicker.appendChild(b);
  }
}
// Special: Medúza/Escanor si najprv vyberú smer pohľadu (←/→), Vlkolak jeden z 8 smerov charge,
// Vojak cieľovú bunku; ostatní pridajú akciu priamo
// typ cieľa specialu z registra (specialTarget, prípadne podľa stavu - Jotaro po THE WORLD smerový)
export function specialTargetOf(char) {
  const t = CHARS_BY_KEY[char]?.specialTarget;
  return (typeof t === "function" ? t(buttonUi()) : t) || "none";
}
specialBtn.addEventListener("click", () => {
  const target = specialTargetOf(ghostCharAt());
  if (target === "dir") { togglePicker("special", specialBtn, "special"); return; } // smerový special (left/right)
  if (target === "wolf") { togglePicker("special_wolf", specialBtn, "special"); return; } // charge - 8 smerov
  if (target === "cell") {
    if (planning.openPicker !== "special_cell") buildCellPicker(); // obsah podľa aktuálnych pozícií + ghost fronty
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (target === "reach") {
    // mini mapa s bunkami len tam, kam special dosiahne (Luffy: pohyb-a-úder ako dáma base / veža gear3)
    if (planning.openPicker !== "special_cell") buildCellPicker(false, CHARS_BY_KEY[ghostCharAt()].specialReach);
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (target === "trap") {
    // pasca: rovnaká mini mapa ako Vojak, ale BEZ blokovaných buniek (aj súperova aktuálna, aj vlastná)
    if (planning.openPicker !== "special_cell") buildCellPicker(true);
    togglePicker("special_cell", specialBtn, "special");
    return;
  }
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(specialBtn); return; }
  if (planning.myQueue.length >= 3 || planning.myQueue.some(a => a.type === "special")) { shakeBtn(specialBtn); return; }
  planning.myQueue.push({ type: "special" });
  renderQueue();
});

// Golden predťah: jedno tlačidlo predelené na 2 rovnako široké polovice - ŠTÍT (−3) | MIRROR (−5).
// Vzájomne výlučné; rozsvieti sa vždy len zvolená polovica. Starterovi zamknuté (vizuálny zámok).
const goldenShieldHalf = goldenBtn.querySelector(".shield-half");
const goldenMirrorHalf = goldenBtn.querySelector(".mirror-half");

// rozsvietenie polovíc podľa armed flagov
export function syncGoldenHalves() {
  goldenShieldHalf?.classList.toggle("armed", planning.goldenArmed);
  goldenMirrorHalf?.classList.toggle("armed", planning.goldenMirrorArmed);
  // bežný štít/mirror vo fronte zamkne príslušnú zlatú polovicu (vzájomné vylúčenie)
  goldenShieldHalf?.classList.toggle("locked", !planning.goldenArmed && planning.myQueue.some(a => a.type === "shield"));
  goldenMirrorHalf?.classList.toggle("locked", !planning.goldenMirrorArmed && planning.myQueue.some(a => a.type === "mirror"));
}

function toggleGoldenHalf(mode) {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(goldenBtn); return; }
  if (!me || state?.starter === me || isStonedNow()) { shakeBtn(goldenBtn); return; }
  // golden shield/mirror sa vzájomne vylučuje s bežnou akciou rovnakého druhu vo fronte (zamknuté, kým ju nezrušíš)
  if (mode === "shield") {
    if (!planning.goldenArmed && planning.myQueue.some(a => a.type === "shield")) { shakeBtn(goldenBtn); return; }
    planning.goldenArmed = !planning.goldenArmed; planning.goldenMirrorArmed = false;
  } else {
    if (!planning.goldenMirrorArmed && planning.myQueue.some(a => a.type === "mirror")) { shakeBtn(goldenBtn); return; }
    planning.goldenMirrorArmed = !planning.goldenMirrorArmed; planning.goldenArmed = false;
  }
  syncGoldenHalves();
  renderQueue();
}
goldenShieldHalf?.addEventListener("click", () => toggleGoldenHalf("shield"));
goldenMirrorHalf?.addEventListener("click", () => toggleGoldenHalf("mirror"));

// Golden Mana | Last Stand - duálne tlačidlo (2 polovice, vzájomne výlučné, ako golden shield/mirror).
// Vykoná sa po konci kola; dostupné obom hráčom; v poslednom (buffnutom) kole zamknuté pre oboch.
const gmHalf = goldDualBtn.querySelector(".gm-half");
const lsHalf = goldDualBtn.querySelector(".ls-half");

export function syncGoldDualHalves() {
  gmHalf?.classList.toggle("armed", planning.goldenManaArmed);
  lsHalf?.classList.toggle("armed", planning.lastStandArmed);
}
function toggleGoldDual(mode) {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(goldDualBtn); return; }
  if (!me || !state?.[me]?.char) return;
  if (state?.goldLocked) { shakeBtn(goldDualBtn); return; } // posledné kolo - zamknuté
  if (mode === "mana") { planning.goldenManaArmed = !planning.goldenManaArmed; planning.lastStandArmed = false; }
  else                 { planning.lastStandArmed  = !planning.lastStandArmed;  planning.goldenManaArmed = false; }
  syncGoldDualHalves();
  renderQueue();
}
gmHalf?.addEventListener("click", () => toggleGoldDual("mana"));
lsHalf?.addEventListener("click", () => toggleGoldDual("laststand"));

// Démon útok - tlačidlo dostupné len buffnutému hráčovi v poslednom kole (namiesto zamknutého gold dual buttonu).
// Správa sa ako bežná akcia: pridá/odoberie {type:"demon"} do/z planning.myQueue (max 3, raz za kolo).
demonBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(demonBtn); return; }
  if (!me || !state?.[me]?.char || !state?.[me]?.lastStandBuff) return;
  const idx = planning.myQueue.findIndex(a => a.type === "demon");
  if (idx >= 0) { planning.myQueue.splice(idx, 1); } // opätovný klik = odober z fronty
  else {
    if (planning.myQueue.length >= 3) { shakeBtn(demonBtn); return; }
    planning.myQueue.push({ type: "demon" });
  }
  renderQueue();
});
demonBtn?.addEventListener("mouseenter", () => {
  if (!me || !state?.[me]?.lastStandBuff) return;
  const p = ghostPos();
  if (p) showPreviewCells(cellsForDemonPreview(p));
});
demonBtn?.addEventListener("mouseleave", clearPreviewCells);

// Last Hope - len nebuffnutý hráč vo final kole; toggle úvodnej akcie (ako armed flag, nie do planning.myQueue)
// skamenený na začiatku kola → úvodné zlaté akcie (Last Hope, golden shield/mirror) sa na serveri nevykonajú
// (vyhodnocujú sa pred prvou akciou, kým kameň ešte trvá) - tlačidlá sú preto zamknuté, nie len varované
function isStonedNow() {
  return (state?.[me]?.stone || 0) > 0;
}
function canPlayLastHope() {
  return !!me && !!state?.[me]?.char && !!state?.goldLocked && !state?.[me]?.lastStandBuff;
}
lastHopeBtn?.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.openPicker) { shakeBtn(lastHopeBtn); return; }
  if (!canPlayLastHope() || isStonedNow()) { shakeBtn(lastHopeBtn); return; }
  planning.lastHopeArmed = !planning.lastHopeArmed;
  renderQueue();
});

export function updateGoldenButton() {
  if (goldenBtn) {
    // viditeľný obom hráčom; starterovi zamknutý (zámok + neaktívny vzhľad)
    const inGame = !!me && !!state?.[me]?.char;
    goldenBtn.classList.toggle("hidden", !inGame);
    const isStarter = !!me && state?.starter === me;
    const goldLocked = isStarter || isStonedNow(); // skamenený: zlatý predťah by sa nevykonal
    goldenBtn.classList.toggle("locked-perm", goldLocked);
    if (goldLocked && (planning.goldenArmed || planning.goldenMirrorArmed)) {
      planning.goldenArmed = false;
      planning.goldenMirrorArmed = false;
    }
    syncGoldenHalves();
  }
  if (goldDualBtn) {
    const available = !!me && !!state?.[me]?.char;
    const locked = !!state?.goldLocked; // posledné (buffnuté) kolo - duálny button zamknutý pre oboch
    goldDualBtn.classList.toggle("hidden", !available);
    goldDualBtn.classList.toggle("locked-perm", locked); // rovnaký zámok (🔒 + sivé) ako golden shield/mirror pre startera
    if (locked) { planning.goldenManaArmed = false; planning.lastStandArmed = false; }
    // cena golden many v HP (srdiečka) rastie s každým použitím (1, 2, 3…); +6 mana je nad ňou (statické)
    const cost = (state?.[me]?.manaRefills ?? 0) + 1;
    if (gmCostEl) { gmCostEl.innerHTML = `−${cost}${miniPix("❤️")}`; hydratePix(gmCostEl); }
    syncGoldDualHalves();
  }
  // démon útok - v poslednom (FINAL) kole pre buffnutého hráča; nahrádza inak zamknutý gold dual button
  if (demonBtn) {
    const buffed = !!me && !!state?.[me]?.lastStandBuff;
    const showDemon = !!me && !!state?.[me]?.char && !!state?.goldLocked && buffed;
    demonBtn.classList.toggle("hidden", !showDemon);
    if (showDemon) {
      if (goldDualBtn) goldDualBtn.classList.add("hidden"); // duálny button je aj tak zamknutý - schovaj ho
      const used = planning.myQueue.some(a => a.type === "demon");
      demonBtn.classList.toggle("armed", used);
      demonBtn.disabled = !used && planning.myQueue.length >= 3; // plná fronta a démon nie je v nej → nedá sa pridať
    } else {
      demonBtn.disabled = false;
      demonBtn.classList.remove("armed");
    }
  }
  // Last Hope tlačidlo - len nebuffnutý hráč vo final kole (naľavo od golden shield/mirror)
  if (lastHopeBtn) {
    const showHope = canPlayLastHope();
    lastHopeBtn.classList.toggle("hidden", !showHope);
    const hopeStoned = showHope && isStonedNow();
    lastHopeBtn.classList.toggle("locked-perm", hopeStoned);
    if (lastHopeBtn.dataset.baseTitle === undefined) lastHopeBtn.dataset.baseTitle = lastHopeBtn.title;
    lastHopeBtn.title = hopeStoned ? "Last Hope - locked: you are petrified, it would have no effect" : lastHopeBtn.dataset.baseTitle;
    if (hopeStoned && planning.lastHopeArmed) planning.lastHopeArmed = false;
    if (showHope) {
      lastHopeBtn.classList.toggle("armed", planning.lastHopeArmed);
    } else {
      if (planning.lastHopeArmed) planning.lastHopeArmed = false; // mimo final kola nesmie ostať navolené
      lastHopeBtn.classList.remove("armed");
    }
  }
}

document.querySelectorAll(".controls button[data-act]").forEach(btn => {
  btn.addEventListener("click", () => {
    const [type, arg] = btn.dataset.act.split(":");

    // mirror slot je Special 1 (register mirrorSlot - Jotaro) → klik TOGGLUJE L/R picker (togglePicker rieši
    // open→close aj „iný picker otvorený"); musí byť PRED guardom otvoreného pickera, inak by re-klik len shakoval
    if (type === "mirror" && CHARS_BY_KEY[ghostCharAt()]?.mirrorSlot === "special1") {
      togglePicker("special1", mirrorBtn, "special1");
      return;
    }

    if (uiLocked()) return;
    if (planning.myQueue.length >= 3) return;

    // pri otvorenom pickeri sú klikateľné len jeho šípky - ostatné tlačidlá sú blokované
    const isPickerArrow = !!btn.closest(".dir-picker");
    if (planning.openPicker && !isPickerArrow) { shakeBtn(btn); return; }

    // každá akcia max 1× za kolo
    if (planning.myQueue.some(a => a.type === type)) {
      shakeBtn(btn);
      return;
    }
    // vzájomné vylúčenie s golden predťahom: golden shield zamyká štít, golden mirror zamyká mirror
    if ((type === "shield" && planning.goldenArmed) || (type === "mirror" && planning.goldenMirrorArmed)) {
      shakeBtn(btn);
      return;
    }

    if (type === "move")      planning.myQueue.push({ type: "move", dir: arg });
    if (type === "dash")      planning.myQueue.push({ type: "dash", dir: arg });
    if (type === "recharge")  planning.myQueue.push({ type: "recharge" });
    if (type === "attack")    planning.myQueue.push({ type: "attack", dir: arg });
    if (type === "melee")     planning.myQueue.push({ type: "melee" });
    if (type === "special")   planning.myQueue.push(arg ? { type: "special", dir: arg } : { type: "special" }); // smer (←/→): Medúza/Escanor/Jotaro(S2)
    if (type === "special1")  planning.myQueue.push({ type: "special1", dir: arg }); // Jotarov útok v mirror slote
    if (type === "shield")    planning.myQueue.push({ type: "shield" });
    if (type === "mirror")    planning.myQueue.push({ type: "mirror" });

    if (isPickerArrow) closePickers();
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  if (planning.myQueue[planning.myQueue.length - 1]?.type === "stoned") return; // skamenený pass sa nedá odobrať
  planning.myQueue.pop();
  renderQueue();
});
// hláška o chybe spojenia (server nepotvrdil prijatie ťahu)
function showConnError() { connErrorEl?.classList.remove("hidden"); }
export function hideConnError() { connErrorEl?.classList.add("hidden"); }
connErrorEl?.addEventListener("click", hideConnError); // klikom sa dá zavrieť

// server nepotvrdil ťah ani po opakovaniach → odomkni ovládanie a nechaj usera potvrdiť znova
function unlockAfterConnError() {
  planning.lockedIn = false;
  lockBtn.classList.remove("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCK IN";
  lockBtn.disabled = false;
  updateUiLocks();
  updateLockButton();
  showConnError();
}

// pošli lock_in spoľahlivo: čakaj na ack od servera a pri strate packetu (timeout) zopakuj.
// rieši „dal som LOCKED, ale súper/server ťah nezaznamenal" pri blikajúcej sieti.
// ak ani po MAX_TRIES nepríde potvrdenie → odblokuj tlačidlá a oznám userovi chybu spojenia.
export function emitLockIn(payload) {
  let tries = 0;
  const MAX_TRIES = 6; // ~9 s pokusov (6 × 1,5 s), potom to vyhlásime za chybu spojenia
  const forTurn = state?.turn; // kolo, pre ktoré táto voľba platí - server zahodí zopakovanie, ak sa už posunulo
  const send = () => {
    tries++;
    socket.timeout(1500).emit("lock_in", payload, forTurn, (err) => {
      if (!err) { hideConnError(); return; }   // server POTVRDIL prijatie ťahu → hotovo
      if (!planning.lockedIn || playback.playing) return;         // kolo sa medzitým vyriešilo/odomklo → nič nerob
      if (tries < MAX_TRIES) { send(); return; } // stratený packet → skús znova
      unlockAfterConnError();                    // vyčerpané pokusy → odomkni + oznám chybu
    });
  };
  send();
}
