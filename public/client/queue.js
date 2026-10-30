// public/client/queue.js - lišta kola (round-script): naplánované akcie oboch strán po beatoch, kurzor počas
// prehrávania, varovania plánu, LOCK IN tlačidlo a odomykanie UI.
import { ARROW_DIR, displayDir } from "/client/action-log.js";
import { LS_BADGE_IMG, LH_BADGE_IMG, breakerIco, hydratePix } from "/client/pix.js";
import { mageHeadHtml } from "/client/mage-head.js";
import { usesAltColor } from "/client/sprites.js";
import { ghostPos, showPreviewCells, cellsForAimPreview, ghostCharAt, clearPreviewCells, planWarnings, foeMirrorImmune, MIRROR_IMMUNE_WARN } from "/client/ghost.js";
import { VAMP_CHARS, CHARS_BY_KEY } from "/chars/index.js";
import { cellsForVampChargePreview, cellsForSpecialPreview, cellsForJotaroS1, cellsForMeleePreview, cellsForDemonPreview } from "/client/zones.js";
import { state, otherSlot, me, isSpectator } from "/client/session.js";
import { playback } from "/client/playback.js";
import { planning } from "/client/planning.js";
import { queueEl, moveBtn, dirPicker, attackBtn, aimPicker, dashBtn, dashPicker, aimPickerDiag, meleeBtn, specialBtn, specialPicker, cellPicker, wolfPicker, s1Picker, s1CellPicker, lockBtn } from "/client/dom.js";
import { syncGoldenHalves, updateGoldenButton, updateUiLocks } from "/client/controls.js";
import { qCursor } from "/client/actor-layers.js";
import { renderMageHeads } from "/client/hud.js";
import { socket } from "/client/net.js";
import { isTouch } from "/client/viewport.js";

/* ---------- Queue + Lock ---------- */
// ikona/farba akcie pre lištu (zdieľané: moje akcie aj odhalené súperove); ownerSlot kvôli alt-color hláv p2
function actionBadgeView(a, ownerSlot) {
  // telefón: v lište len piktogramy, bez smerových šípok (na malej bunke sú nečitateľné; smer ukáže náhľad / ghost)
  const arrow = isTouch ? {} : ARROW_DIR;
  const dd = arrow[displayDir(a, ownerSlot)] || ""; // Narutov vertikálny smer (move/dash/attack) súperovi anonymizovaný (↕)
  const noDir = isTouch ? "" : "?";
  switch (a?.type) {
    case "move":          return { cls: "move",    text: `🚶${dd || noDir}` };
    case "dash":          return { cls: "dash", text: `🏃${dd || noDir}` };
    case "recharge":      return { cls: "mana",    text: "🙏" };
    case "attack":        return { cls: "attack",  text: `🏹${dd}` };
    case "melee":         return { cls: "melee",   text: "🗡️" };
    case "special":       return { cls: "special", text: `✨${arrow[a.dir] || ""}` }; // smer: Medúza/Escanor/Jotaro(S2); Vojakov cieľ (cell) sa neukazuje - bunku ukáže hover
    case "special1":      return { cls: "mirror",  text: "🪞" }; // Special 1 (Jotaro, Luffy) v mirror slote sa tvári ako mirror (analógia k charge=dash u Vampire/Onryō)
    case "shield":        return { cls: "shield",  text: "🛡️" };
    case "mirror":        return { cls: "mirror",  text: "🪞" };
    // Shield/Mirror Breaker (návrh): ikona obrany preškrtnutá čiernou trhlinou, farba svojej obrany
    case "shield_breaker":        return { cls: "breaker", html: breakerIco("🛡️") };
    case "mirror_breaker":        return { cls: "breaker", html: breakerIco("🪞") };
    case "golden_shield_breaker": return { cls: "breaker-gold", html: breakerIco("🛡️", "g-ico") };
    case "golden_mirror_breaker": return { cls: "breaker-gold", html: breakerIco("🪞", "g-ico") };
    case "golden_shield": return { cls: "golden",  html: '<span class="g-ico">🛡️</span>' };
    case "golden_mirror": return { cls: "golden",  html: '<span class="g-ico mirror">🪞</span>' };
    case "golden_mana":   return { cls: "golden",  html: '<span class="g-ico">🙏</span>' };
    case "last_stand":    return { cls: "golden",   html: LS_BADGE_IMG };
    case "demon":         return { cls: "demon",    html: LS_BADGE_IMG };
    case "stoned":        return { cls: "stoned",   text: "🗿" };
    case "pass":          return { cls: "pass",     text: "💭" }; // vypršaný čas - nevyplnený slot
    case "swap":          return { cls: "swap",     html: mageHeadHtml(a.to || "", usesAltColor(a.to, ownerSlot) ? "alt-color" : "", ownerSlot) };
    case "last_hope":     return { cls: "lasthope", html: LH_BADGE_IMG };
    case "unknown":       return { cls: "unknown",  text: "❓" }; // labyrint - redigovaná akcia súpera
    default:              return { cls: "",        text: a?.type || "" };
  }
}

// hover náhľad dosahu pre moje útok/special/melee badge (z ghost pozície v danom kroku)
function attachQueueHover(el, a, idx) {
  if (a.type === "attack") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForAimPreview(p, a.dir, ghostCharAt(idx))); });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "dash") {
    // Vampire/Onryō: dash = charge - hover ukáže dráhu behu (stop na viditeľnej figúre súpera)
    el.addEventListener("mouseenter", () => {
      const p = ghostPos(idx); const char = ghostCharAt(idx);
      if (p && VAMP_CHARS[char]) showPreviewCells(cellsForVampChargePreview(p, a.dir, state?.[otherSlot()]));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "special") {
    // pride: Escanorova zóna závisí od AKTUÁLNEHO pride levelu (rovnako ako hover na šípkach pickeru) -
    // bez neho by náhľad ukazoval vždy pride 0; pride sa mení až na konci kola, takže current je správny
    // Vojak: akcia nesie cieľovú bunku - zvýrazni presne ju (zóna sa nedá odvodiť z pozície)
    // Vlkolak: dráha charge sa zastaví na viditeľnej figúre súpera → preview potrebuje foe
    el.addEventListener("mouseenter", () => {
      if (a.cell) { showPreviewCells([[a.cell.x, a.cell.y]]); return; }
      const char = ghostCharAt(idx); const p = ghostPos(idx);
      if (char && p) showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char, pride: state?.[me]?.pride, worldUsed: state?.[me]?.worldUsed, foe: state?.[otherSlot()] }, a.dir));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "special1") {
    // Special 1: Luffy nesie cieľovú bunku (zvýrazni ju), Jotaro smer - obe diagonálne bunky strany z ghost pozície
    el.addEventListener("mouseenter", () => {
      if (a.cell) { showPreviewCells([[a.cell.x, a.cell.y]]); return; }
      const p = ghostPos(idx); if (p) showPreviewCells(cellsForJotaroS1(p, a.dir));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "melee") {
    el.addEventListener("mouseenter", () => {
      const p = ghostPos(idx); if (!p) return;
      showPreviewCells(cellsForMeleePreview(p, ghostCharAt(idx)));
    });
    el.addEventListener("mouseleave", clearPreviewCells);
  } else if (a.type === "demon") {
    el.addEventListener("mouseenter", () => { const p = ghostPos(idx); if (p) showPreviewCells(cellsForDemonPreview(p)); });
    el.addEventListener("mouseleave", clearPreviewCells);
  }
}

// lišta = celá interleave kostra kola v reálnom poradí vyhodnotenia:
// [golden shield] | a1(štartér) a1(nestartér) | a2 a2 | a3 a3 | golden mana(š) golden mana(n)
// moje sloty vypĺňam (zlatý lining), súperove sú "?" placeholdery (odhalia sa počas animácie)
export let qBeatEls = []; // sloty podľa pozície 0..8 (pre kurzor + odhalenie súpera počas animácie)

// skamenené ťahy nového kola sú vopred zamknuté ako pass (🗿) - predvyplnia sa na začiatok fronty
// a nedajú sa odobrať (undo poistka); hráč plánuje len zvyšné sloty
function ensureStonePrefix() {
  if (!me || isSpectator || playback.playing || planning.lockedIn) return;
  const mine = state?.[me];
  if (!mine || !mine.char || mine.locked || state?.phase !== "playing") return;
  const need = Math.min(3, mine.stone || 0);
  const have = planning.myQueue.filter(a => a.type === "stoned").length;
  if (have === need && planning.myQueue.slice(0, need).every(a => a.type === "stoned")) return;
  const rest = planning.myQueue.filter(a => a.type !== "stoned");
  planning.myQueue = [...Array.from({ length: need }, () => ({ type: "stoned" })), ...rest].slice(0, 3);
}

// Jotaro THE WORLD: samostatný placeholder pre 3 zmrazené akcie - pôvodná lišta kola (queueEl) ostáva
// viditeľná ako „vykonáva sa THE WORLD", tu sa zadávajú nové akcie.
const tsQueueEl = document.createElement("div");
tsQueueEl.id = "ts-queue";
tsQueueEl.className = "ts-queue hidden";
queueEl.parentElement?.appendChild(tsQueueEl);
function renderTsQueue() {
  tsQueueEl.classList.remove("hidden");
  queueEl.classList.add("ts-executing"); // pôvodná lišta: „stojí na vykonávaní THE WORLD"
  tsQueueEl.innerHTML = "";
  const label = document.createElement("div");
  label.className = "ts-queue-label";
  label.textContent = "⏱ THE WORLD - 3 frozen actions";
  tsQueueEl.appendChild(label);
  const slots = document.createElement("div");
  slots.className = "ts-queue-slots";
  for (let i = 0; i < 3; i++) {
    const el = document.createElement("span");
    el.className = "a-badge ts-slot";
    const a = planning.myQueue[i];
    if (a) {
      const v = actionBadgeView(a, me);
      el.classList.add(v.cls);
      if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
    } else { el.classList.add("empty"); el.textContent = String(i + 1); }
    slots.appendChild(el);
  }
  tsQueueEl.appendChild(slots);
}
export function hideTsQueue() { tsQueueEl.classList.add("hidden"); queueEl.classList.remove("ts-executing"); }

export function renderQueue() {
  // THE WORLD plánovanie: NEprestavuj pôvodnú lištu (ostáva „executing"), zadávaj do samostatného placeholdera
  if (playback.tsPlanning) { renderTsQueue(); updateActionButtons(); syncGoldenHalves(); updateGoldenButton(); updateLockButton(); return; }
  hideTsQueue();
  ensureStonePrefix();
  queueEl.innerHTML = "";
  qBeatEls = [];

  const starterSlot = state?.starter || "p1";
  const otherS = starterSlot === "p1" ? "p2" : "p1";
  const lastRound = !!state?.goldLocked; // buffnuté posledné kolo - namiesto 2 gold-mana placeholderov jedna démon „end" bunka
  const buffSlot = state?.p1?.lastStandBuff ? "p1" : state?.p2?.lastStandBuff ? "p2" : null;
  const hopeSlot = buffSlot ? (buffSlot === "p1" ? "p2" : "p1") : null; // nebuffnutý hráč - vlastník Last Hope bunky
  // beaty v reálnom poradí; owner = komu beat patrí (golden shield iba nestartérovi)
  const layout = [];
  if (lastRound && hopeSlot) layout.push({ pos: 9, kind: "lasthope", owner: hopeSlot }); // úplne vľavo, len vo final kole
  layout.push(
    { pos: 0, kind: "gshield", owner: otherS },
    { pos: 1, kind: "act", idx: 0, owner: starterSlot },
    { pos: 2, kind: "act", idx: 0, owner: otherS },
    { pos: 3, kind: "act", idx: 1, owner: starterSlot },
    { pos: 4, kind: "act", idx: 1, owner: otherS },
    { pos: 5, kind: "act", idx: 2, owner: starterSlot },
    { pos: 6, kind: "act", idx: 2, owner: otherS },
  );
  if (lastRound) layout.push({ pos: 7, kind: "demon" }); // jedna zvýraznená démon bunka pre oboch (hra tu končí)
  else layout.push({ pos: 7, kind: "gmana", owner: starterSlot }, { pos: 8, kind: "gmana", owner: otherS });
  const warnings = planWarnings();

  layout.forEach((b) => {
    // predely: [last_hope] | golden shield | akcie | golden mana / démon
    if ((b.pos === 0 && lastRound && hopeSlot) || b.pos === 1 || b.pos === 7) {
      const d = document.createElement("div");
      d.className = "q-divider";
      queueEl.appendChild(d);
    }
    if (b.kind === "demon") {
      const el = document.createElement("div");
      el.dataset.pos = "7";
      el.className = "q-badge demon";
      el.innerHTML = LS_BADGE_IMG;
      el.title = "Last Stand - hra tu končí (banishment)";
      queueEl.appendChild(el);
      qBeatEls[7] = el;
      return;
    }
    if (b.kind === "lasthope") {
      const mine = b.owner === me;
      const el = document.createElement("div");
      el.dataset.pos = "9";
      el.className = "q-badge lasthope " + (mine ? "mine" : "opp");
      if (mine && planning.lastHopeArmed) {
        el.innerHTML = LH_BADGE_IMG;
        el.title = "Last Hope (navolené)";
      } else {
        el.classList.add("q-slot");
        el.innerHTML = '<span class="lh-dim">?</span>';
        el.title = mine ? "Last Hope (final round)" : "Opponent (hidden until it resolves)";
      }
      queueEl.appendChild(el);
      qBeatEls[9] = el;
      return;
    }
    const mine = !!me && b.owner === me;
    const el = document.createElement("div");
    el.dataset.pos = String(b.pos);
    // veľkosť = dôležitosť: 3 hlavné akcie "main" (veľké), golden "opt" (malé, voliteľné)
    el.className = "q-badge " + (mine ? "mine" : "opp") + " " + (b.kind === "act" ? "main" : "opt");

    let filled = null;
    if (mine) {
      if (b.kind === "gshield")    filled = planning.goldenArmed ? { type: planning.goldenBreaker ? "golden_shield_breaker" : "golden_shield" }
                                        : planning.goldenMirrorArmed ? { type: planning.goldenBreaker ? "golden_mirror_breaker" : "golden_mirror" } : null;
      else if (b.kind === "gmana") filled = planning.goldenManaArmed ? { type: "golden_mana" } : planning.lastStandArmed ? { type: "last_stand" } : null;
      else                         filled = planning.myQueue[b.idx] || null;
    }

    if (filled) {
      const v = actionBadgeView(filled, me);
      if (v.cls) el.classList.add(v.cls);
      if (v.html) { el.innerHTML = v.html; hydratePix(el); } else el.textContent = v.text;
      if (b.kind === "act") attachQueueHover(el, filled, b.idx);
      // akcia podľa plánu nebude mať efekt → žltý ⚠ v rohu + dôvod v tooltipe
      const warn = b.kind === "act" ? warnings[b.idx]
        : (filled.type === "golden_mirror" && foeMirrorImmune()) ? MIRROR_IMMUNE_WARN : null;
      if (warn) {
        el.classList.add("q-warn");
        el.title = "⚠ " + warn;
        const w = document.createElement("span");
        w.className = "q-warn-ico";
        w.textContent = "⚠️";
        el.appendChild(w);
      }
    } else {
      el.classList.add("q-slot");
      // súperov skamenený ťah je DETERMINISTICKÝ (stun prenesený z minulého kola) - namiesto skrytého „?"
      // ukáž 🗿 na presných akciách, ktoré súper vynechá, nech kaster Medúzy vidí dokedy súper stojí
      const oppStone = (!mine && b.kind === "act") ? Math.min(3, state?.[b.owner]?.stone || 0) : 0;
      const oppStoned = oppStone > 0 && b.idx < oppStone;
      if (b.kind === "gshield")    el.innerHTML = '<span class="g-ico dim">🛡️</span>';
      else if (b.kind === "gmana") el.innerHTML = '<span class="g-ico dim">🙏</span>';
      else if (oppStoned) { el.classList.add("stoned"); el.textContent = "🗿"; }
      // ja kružok, súper holé cifry; telefón holé cifry obom (krúžky sú tam nečitateľné - odlíši zlatý rámik)
      else el.textContent = mine && !isTouch ? ["①", "②", "③"][b.idx] : String(b.idx + 1);
      el.title = oppStoned ? "Opponent is petrified - this action is skipped (carry-over stun)"
        : mine ? "Your action (required)" : "Opponent (hidden until it resolves)";
    }

    queueEl.appendChild(el);
    qBeatEls[b.pos] = el;
  });
  qCursor.classList.remove("show"); // počas plánovania skrytá; zobrazí ju až animácia
  queueEl.appendChild(qCursor);     // zelená šípka (mimo flex flow, absolútna)

  if (state?.series?.format === "tournament") renderMageHeads(); // drž „armed" stav hláv v HUD v sync s frontou (hlavy animuje raf)
  updateActionButtons();
  syncGoldenHalves(); // drž zamknutie zlatých polovíc v sync s frontou (shield/mirror ↔ golden)
  updateGoldenButton(); // drž démon tlačidlo (armed/disabled podľa fronty) v sync aj pri úprave fronty
  updateLockButton();
  sendDraft(); // priebežne posli rozpracovanú voľbu serveru (pre backstop pri vypršaní času)
}

// počas animácie: posuň kurzor na práve vyhodnocovaný beat a odhal súperovu akciu
export function highlightRoundBeat(from, action, counts, starterSlot) {
  let pos;
  // labyrint: redigovaná akcia ("unknown") nesie beat, aby padla na správny slot lišty (gold pre/post vs. bežná)
  const maskedBeat = action.type === "unknown" ? (action.beat || "act") : null;
  if (action.type === "last_hope" || maskedBeat === "lhope") pos = 9;
  else if (action.type === "golden_shield" || action.type === "golden_mirror" || maskedBeat === "gpre") pos = 0;
  else if (action.type === "golden_mana" || action.type === "last_stand" || maskedBeat === "gmana") pos = (from === starterSlot) ? 7 : 8;
  else { const k = counts[from]++; pos = (from === starterSlot) ? [1, 3, 5][k] : [2, 4, 6][k]; }
  if (pos == null) return null;
  qBeatEls.forEach(e => e && e.classList.remove("q-now"));
  const el = qBeatEls[pos];
  if (!el) return null;
  // odhal súperovu akciu (moje sú už vyplnené z plánovania)
  if (el.classList.contains("opp")) {
    const v = actionBadgeView(action, from);
    el.classList.remove("q-slot");
    el.classList.add("revealed");
    if (v.cls) el.classList.add(v.cls);
    if (v.html) el.innerHTML = v.html; else el.textContent = v.text;
    el.title = "Opponent"; // swap badge hlavu animuje raf (canvas.mage-head)
  }
  el.classList.add("q-now");
  // zelená šípka pod lištou sa presunie pod aktuálny beat
  qCursor.style.left = (el.offsetLeft + el.offsetWidth / 2) + "px";
  qCursor.classList.add("show");
  return el;
}
export function clearRoundCursor() {
  qBeatEls.forEach(e => e && e.classList.remove("q-now"));
  qCursor.classList.remove("show");
}
// pošli serveru aktuálnu rozpracovanú frontu + golden flagy (server ju pri timeoute zahrá a doplní chýbajúce)
function sendDraft() {
  if (!me || state?.phase !== "playing" || planning.lockedIn || state?.[me]?.locked) return;
  socket.emit("draft_queue", { queue: planning.myQueue, golden: planning.goldenArmed, goldenMirror: planning.goldenMirrorArmed, goldenMana: planning.goldenManaArmed, lastStand: planning.lastStandArmed, lastHope: planning.lastHopeArmed });
}
// zneaktívni tlačidlá akcií, ktoré už sú v queue (každá max 1× za kolo)
function updateActionButtons() {
  document.querySelectorAll(".controls button[data-act]").forEach(btn => {
    const type = btn.dataset.act.split(":")[0];
    // mirror slot = Special 1 (register mirrorSlot - Jotaro, Luffy) → „used" podľa special1 a golden mirror ho NEZAMYKÁ
    const isJotaroMirror = type === "mirror" && CHARS_BY_KEY[ghostCharAt()]?.mirrorSlot === "special1";
    const effType = isJotaroMirror ? "special1" : type;
    const used = planning.myQueue.some(a => a.type === effType);
    btn.disabled = used; // skutočne navolené v kole = sivé „použité"
    // golden predťah blokuje bežnú akciu rovnakého druhu ZÁMKOM (nie ako „použité") - klik shake-ne cez poistku v handleri
    const goldenLock = ((type === "shield" && planning.goldenArmed) || (type === "mirror" && planning.goldenMirrorArmed)) && !isJotaroMirror;
    btn.classList.toggle("locked-golden", goldenLock && !used);
  });
  const moveUsed = planning.myQueue.some(a => a.type === "move");
  moveBtn.disabled = moveUsed;
  if (moveUsed) dirPicker.classList.add("hidden");
  const attackUsed = planning.myQueue.some(a => a.type === "attack");
  attackBtn.disabled = attackUsed;
  if (attackUsed) aimPicker.classList.add("hidden");
  const dashUsed = planning.myQueue.some(a => a.type === "dash");
  dashBtn.disabled = dashUsed;
  if (dashUsed) dashPicker.classList.add("hidden");
  if (attackUsed) aimPickerDiag?.classList.add("hidden"); // diagonálny aim picker (Countess/Onre)
  const meleeUsed = planning.myQueue.some(a => a.type === "melee");
  if (meleeBtn) meleeBtn.disabled = meleeUsed;
  // special už nemá data-act (kvôli Medúzinmu pickeru) - zneaktívni ho rovnako ako move/attack/dash
  const specialUsed = planning.myQueue.some(a => a.type === "special");
  specialBtn.disabled = specialUsed;
  if (specialUsed) { specialPicker.classList.add("hidden"); cellPicker?.classList.add("hidden"); wolfPicker?.classList.add("hidden"); }
  if (planning.myQueue.some(a => a.type === "special1")) { s1Picker?.classList.add("hidden"); s1CellPicker?.classList.add("hidden"); }
}
export function updateLockButton() {
  // Jotaro THE WORLD: počas plánovania zmrazenej trojice je button „EXECUTE" (ignoruj stale state[me].locked
  // z pôvodného locku kola - inak by ho renderQueue po prvej akcii zamkol a hráč by nemohol odoslať)
  if (playback.tsPlanning) {
    lockBtn.classList.remove("locked");
    lockBtn.textContent = "EXECUTE";
    lockBtn.disabled = false;
    lockBtn.classList.toggle("ready", planning.myQueue.length === 3);
    updateUiLocks();
    return;
  }
  const locked = !!state?.[me]?.locked;
  if (locked) {
    lockBtn.classList.add("locked"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  } else {
    lockBtn.classList.remove("locked"); lockBtn.textContent = "LOCK IN"; lockBtn.disabled = false;
  }
  // počas prehrávania kola sa nedá lockovať (zabráni súbežným timeline)
  if (playback.playing && !locked) {
    lockBtn.disabled = true;
    lockBtn.classList.remove("ready");
    updateUiLocks();
    return;
  }
  // pulzuj, keď je queue plná a čaká sa už len na potvrdenie
  lockBtn.classList.toggle("ready", !locked && planning.myQueue.length === 3);
  updateUiLocks();
}
