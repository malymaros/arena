// public/client/hud.js - HUD: HP/mana bary, portréty, ťah a štartér, koruny série, odznaky postáv
// (háčik hud registra fx) a turnajové hlavy magov (swap klikom, glitch zamknutých side-postáv).
import { turnStatusEl, hudTurn, hudP1Hp, hudP1Mana, hudP2Hp, hudP2Mana, flagP1, flagP2, hudBoxP1, hudBoxP2, crownsP1El, crownsP2El, actorP2, hudCharP2, specialBtn } from "/client/dom.js";
import { me, state } from "/client/session.js";
import { playback } from "/client/playback.js";
import { usesAltColor } from "/client/sprites.js";
import { actorGhost } from "/client/actor-layers.js";
import { ghostCharAt } from "/client/ghost.js";
import { fxAll } from "/client/fx-registry.js";
import { updateGoldenButton, uiLocked } from "/client/controls.js";
import { miniPix, hydratePix, pixSvg } from "/client/pix.js";
import { CHAR_BUTTONS, SIDE_CHARS, CHAR_META } from "/chars/index.js";
import { buttonUi, planning } from "/client/planning.js";
import { mageHeadHtml } from "/client/mage-head.js";
import { HIDDEN_GLITCH_CHARS } from "/client/char-select.js";
import { renderQueue } from "/client/queue.js";

/* ---------- HUD ---------- */
// spojitý bar s 10 zárezmi: hlavná výplň + biely „trail", ktorý sa pri strate stiahne s oneskorením
function renderBar(el, value) {
  if (!el) return;
  if (!el.querySelector(".fill")) {
    el.innerHTML = '<div class="fill-trail"></div><div class="fill"></div>';
  }
  // labyrint: server hodnotu skryl (mana súpera = null) → prázdny bar s "?" namiesto čísla
  const hidden = value == null;
  el.classList.toggle("masked", hidden);
  const v = hidden ? 0 : Math.max(0, Math.min(10, Number(value) || 0));
  const prev = el.dataset.prev === undefined ? v : Number(el.dataset.prev);
  el.dataset.prev = String(v);

  const fill  = el.querySelector(".fill");
  const trail = el.querySelector(".fill-trail");
  fill.style.height  = (v * 10) + "%";
  trail.style.height = (v * 10) + "%"; // trail má oneskorený transition - pri strate sa stiahne neskôr

  // pri zisku výplň blikne do jasu
  if (v > prev) {
    fill.classList.remove("gain");
    void fill.offsetWidth; // reflow = reštart animácie
    fill.classList.add("gain");
    fill.addEventListener("animationend", () => fill.classList.remove("gain"), { once: true });
  }

  // presná hodnota pod barom - bez počítania dielikov; skrytá hodnota (labyrint) = "?"
  const num = el.closest(".hud-stat")?.querySelector(".bar-num");
  if (num) num.textContent = hidden ? "?" : String(v);
}

// banner pod ROUND textom: ja som locknutý a čaká sa na súpera / súper je locknutý a rad je na mne
function updateTurnStatus() {
  if (!turnStatusEl) return;
  const opSlot = me === "p1" ? "p2" : me === "p2" ? "p1" : null;
  const mine = me ? state?.[me] : null;
  const opp  = opSlot ? state?.[opSlot] : null;

  const timerMode = !!state?.config?.timer && state.config.timer !== "off";
  let txt = null, cls = null;
  if (!playback.playing && !playback.gameOverShown && mine?.char && opp?.char) {
    if (mine.locked && !opp.locked) {
      // „locked - waiting" - vo fixnom časovom režime skry; v quickdraw a bezčasovom nechaj
      if (!timerMode || state.config.timer === "quickdraw") { txt = "✔ LOCKED - WAITING FOR OPPONENT…"; cls = "waiting"; }
    } else if (!mine.locked && opp.locked) {
      // „your move" - nechaj v quickdraw (spúšťa časovač) a v bezčasovom režime; vo fixnom časovom skry
      if (!timerMode || state.config.timer === "quickdraw") { txt = "⚠️ OPPONENT IS READY - YOUR MOVE! ⚠️"; cls = "your-move"; }
    }
  }

  if (!txt) { turnStatusEl.classList.add("hidden"); return; }
  turnStatusEl.textContent = txt;
  turnStatusEl.classList.remove("hidden", "waiting", "your-move");
  turnStatusEl.classList.add(cls);
}

export function renderHUD() {
  if (hudTurn && !playback.gameOverShown) {
    // posledné (buffnuté) kolo po Last Stand → „FINAL ROUND"; prepne sa až s bannerom (playback.finalRoundActive)
    hudTurn.textContent = (state?.phase === "playing")
      ? (playback.finalRoundActive ? "FINAL ROUND" : `ROUND ${state.turn}`)
      : "";
  }
  updateTurnStatus();
  renderBar(hudP1Hp,   state?.p1?.hp);
  renderBar(hudP1Mana, state?.p1?.mana);
  renderBar(hudP2Hp,   state?.p2?.hp);
  renderBar(hudP2Mana, state?.p2?.mana);

  // zelená vlajka pri hráčovi, ktorý začína kolo
  flagP1.classList.toggle("on", state.starter === "p1");
  flagP2.classList.toggle("on", state.starter === "p2");

  hudBoxP1.classList.toggle("me", me === "p1");
  hudBoxP2.classList.toggle("me", me === "p2");
  hudBoxP1.classList.toggle("foe", me === "p2");
  hudBoxP2.classList.toggle("foe", me === "p1");
  // divák (me == null) nemá „svoj" box → obe strany dostanú neutrálny štítok s menom (trieda .watch)
  hudBoxP1.classList.toggle("watch", !me);
  hudBoxP2.classList.toggle("watch", !me);
  // štítok nad widgetom = meno hráča (::before content: attr(data-name)); fallback pre chýbajúce meno
  const tagName = (slot) => state?.names?.[slot] || (slot === me ? "YOU" : me ? "OPPONENT" : (slot === "p1" ? "P1" : "P2"));
  hudBoxP1.dataset.name = tagName("p1");
  hudBoxP2.dataset.name = tagName("p2");

  // tournament × labyrint: hlavy magov skryté u oboch, kým kliatba beží - renderHUD beží per frame,
  // takže skrytie/odkrytie sadne aj na labyrint začatý či ukončený uprostred prehrávania kola
  // hlavy magov ukazujú HP/manu PRIEBEŽNE podľa práve prehrávaného framu (nie výsledok kola vopred)
  if (state?.series?.format === "tournament" && state?.roster && state?.phase === "playing") renderMageHeads();

  // pravá strana (p2) má VŽDY alternatívne vykreslenie (postava na boarde, portrét aj ghost);
  // výnimka: postava s natívnou p2 paletou (Medúza) - triedy priebežne prepína raf podľa aktuálneho chara
  actorP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  hudCharP2.classList.toggle("alt-color", usesAltColor(state?.p2?.char, "p2"));
  actorGhost.classList.toggle("alt-color", me === "p2" && usesAltColor(ghostCharAt() || state?.p2?.char, "p2"));
  // vlastné HUD prvky postáv z registra fx (Escanor pride, vlkolakov mesiac) - každá postava, pri inom charaktere ich skryje
  fxAll("hud", "p1", state?.p1); fxAll("hud", "p2", state?.p2);
  syncDynamicSpecialBtn(); // dmg na special tlačidle drž v sync s HUD fázou mesiaca (aj per-frame počas kola)
  updateGoldenButton();
}

// Vlkolak: dmg na SPECIAL tlačidle musí sedieť so zobrazenou fázou mesiaca (HUD ikonou). Prepočítava sa preto
// pri každom renderHUD (aj per-frame počas prehrávania) - nie len raz pri príchode state eventu: vtedy s[me]
// nesie počiatočný frame kola (schedulePlayTimeline ho premutuje späť), takže po zmene fázy ostávalo tlačidlo
// celé plánovanie na starom dmg. Zdroj = state[me].moon, rovnaký ako HUD ikona → obe sa preklopia naraz.
// cena tlačidla z registra: {emoji} → pixelová mini ikona
export function costHtml(cost) { return cost.replace(/\{(.+?)\}/gu, (_, e) => miniPix(e)); }
// title + cena special tlačidla z registra postavy (statické alebo (ui) → {...}); force = prekresli aj bez zmeny kľúča
export function applySpecialSkin(char, force) {
  const def = CHAR_BUTTONS[char]?.special;
  if (!specialBtn || !def) return;
  const ui = buttonUi();
  // specialKey: premenlivý obsah (vlkolakova fáza mesiaca) - prekresli len pri zmene
  const key = CHAR_BUTTONS[char].specialKey?.(ui);
  if (key != null) {
    if (!force && specialBtn.dataset.specialKey === key) return;
    specialBtn.dataset.specialKey = key;
  }
  const v = typeof def === "function" ? def(ui) : def;
  specialBtn.title = v.title;
  const cost = specialBtn.querySelector(".cost");
  if (cost) { cost.innerHTML = costHtml(v.cost); hydratePix(cost); }
}
// per-frame (renderHUD): obsah závislý od stavu počas kola (fáza mesiaca) drž v sync - len postavy so specialKey
export function syncDynamicSpecialBtn() {
  const c = ghostCharAt();
  if (c && CHAR_BUTTONS[c]?.specialKey) applySpecialSkin(c, false);
}

/* ---------- Turnajové hlavy magov v HUD (swap) ---------- */
// tournament: 3 hlavy magov v HUD boxe každého hráča na mieste placeholderov (predtým lebky).
// mŕtvy mág = lebka (nesie info o prehrách), aktuálny = zvýraznený, ostatní živí = klikateľní (len moja strana) na výmenu.
// poradie hláv = draftnutý tím daného slotu (state.roster, poradie výberu); kým tím nie je známy
// (fáza team_select - súperov roster je maskovaný), strana nemá žiadne hlavy
function mageOrderFor(slot) {
  return state?.roster?.[slot]
    || (state?.rosterHp?.[slot] ? Object.keys(state.rosterHp[slot]) : []);
}
// aktuálne HP/mana maga pre daný slot (VEREJNÉ pre oba sloty): nasadený mág = živý stav z boardu (p1/p2),
// lavička = prenesené hodnoty z verejného rosteru (rosterHp/rosterMana)
function headStats(slot, char, isCurrent) {
  const st = state?.[slot];
  if (isCurrent) return { hp: st?.hp, mana: st?.mana };
  const rh = state?.rosterHp?.[slot], rm = state?.rosterMana?.[slot];
  if (rh) return { hp: rh[char], mana: rm?.[char] };
  return null;
}
export function renderMageHeads() {
  // labyrint: hlavy (swap buttony) sú počas kliatby skryté u OBOCH hráčov - objavia sa až s labyrinth_end
  // (flag labyrinth padá až vtedy, reveal ho drží); visibility drží layout HUD boxu bez skoku
  const labActive = !!(state?.p1?.labyrinth || state?.p2?.labyrinth);
  crownsP1El.classList.toggle("lab-hidden", labActive);
  crownsP2El.classList.toggle("lab-hidden", labActive);
  const buildSide = (slot) => {
    const dead = state?.mageDead?.[slot] || [];
    const cur = state?.[slot]?.char || null;
    const mineSlot = slot === me;
    // side-postavy (Countess/Onre/Jotaro) v rostri tejto strany a či je práve nasadená niektorá z nich -
    // swap DO/Z side-postavy je zakázaný, čo reprezentuje GLITCH: (a) je nasadená → celá zvyšná lavička
    // glitchuje (nedá sa od nej odísť), (b) je na lavičke → jej hlava glitchuje (nedá sa k nej prísť).
    // Pozor: p2 môže mať v rostri viac side-postáv naraz (napr. Jotaro + Onryō) - glitchovať musia OBE.
    const curIsSide = !!cur && !!SIDE_CHARS[cur];
    return mageOrderFor(slot).map(char => {
      const isDead = dead.includes(char);
      const isCurrent = cur === char;
      // corrupt = táto hlava je „zamknutá" side-postavou (glitch); mŕtvy mág glitch nemá (má lebku)
      const corrupt = !isDead && (curIsSide ? !isCurrent : !!SIDE_CHARS[char]);
      const armed = mineSlot && planning.myQueue.some(a => a.type === "swap" && a.to === char);
      // Last Stand pakt: buffnutý hráč vo final kole nestrieda - jeho lavička nie je klikateľná;
      // glitchujúca (corrupt) hlava tiež nie je klikateľná (nedá sa swapnúť do/zo side-postavy)
      const clickable = mineSlot && !!cur && !isDead && !isCurrent && !corrupt && !uiLocked() && !state?.[slot]?.lastStandBuff;
      let cls = "mhead";
      if (isDead) cls += " dead";
      if (isCurrent) cls += " current";
      if (corrupt) cls += " corrupt";
      if (armed) cls += " armed";
      if (clickable) cls += " clickable";
      // HP/mana nad hlavou (mŕtvy mág ich nemá; súperova lavička je skrytá → prázdny riadok pre zarovnanie)
      const st = isDead ? null : headStats(slot, char, isCurrent);
      // corrupt hlava: HP/mana prepísané glitch znakmi (ticker ich potom mutuje) - data-* drží ikonu
      const statsHtml = st
        ? (corrupt
            ? `<span class="mh-stats"><span class="mh-hp">${pixSvg("heart")}<span class="mh-glitch">##</span></span><span class="mh-mana">${pixSvg("drop")}<span class="mh-glitch">##</span></span></span>`
            : `<span class="mh-stats"><span class="mh-hp">${pixSvg("heart")}${st.hp ?? "?"}</span><span class="mh-mana">${pixSvg("drop")}${st.mana ?? "?"}</span></span>`)
        : `<span class="mh-stats empty"></span>`;
      const face = isDead ? pixSvg("skull") : mageHeadHtml(char, "mh-canvas" + (usesAltColor(char, slot) ? " alt-color" : ""), slot);
      return `<span class="${cls}" data-slot="${slot}" data-char="${char}" title="${CHAR_META[char]?.name || char}">${statsHtml}<span class="mh-face">${face}</span></span>`;
    }).join("");
  };
  // volá sa aj per-frame počas prehrávania kola (renderHUD) - prepíš len pri zmene (hlavy sú canvasy animované raf)
  for (const [el, slot] of [[crownsP1El, "p1"], [crownsP2El, "p2"]]) {
    const html = buildSide(slot);
    if (el._headsHtml !== html || !el.querySelector(".mhead")) { el.innerHTML = html; el._headsHtml = html; }
  }
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
  crownsP1El.classList.add("mage-heads"); crownsP2El.classList.add("mage-heads");
  syncMageGlitch(); // spusti/zastav glitch ticker podľa toho, či nejaká hlava je corrupt
  // hlavy (canvas.mage-head) animuje raf
}
// glitch ticker pre corrupt hlavy (zamknuté side-postavou): kým existuje .mhead.corrupt, mutuje ich
// HP/mana text náhodnými znakmi a občas prebliká celé hlavy - v štýle Hidden stránky
let mageGlitchTimer = 0;
function syncMageGlitch() {
  const any = document.querySelector(".series-crowns .mhead.corrupt");
  if (any && !mageGlitchTimer) {
    mageGlitchTimer = setInterval(() => {
      const nodes = document.querySelectorAll(".series-crowns .mhead.corrupt .mh-glitch");
      if (!nodes.length) { clearInterval(mageGlitchTimer); mageGlitchTimer = 0; return; }
      nodes.forEach(el => {
        let out = "";
        for (let i = 0; i < 2; i++) out += HIDDEN_GLITCH_CHARS[Math.floor(Math.random() * HIDDEN_GLITCH_CHARS.length)];
        el.textContent = out;
      });
      // občasný silnejší preblik celej hlavy (fialový glitch flash)
      document.querySelectorAll(".series-crowns .mhead.corrupt").forEach(h => {
        h.classList.toggle("flash", Math.random() < 0.22);
      });
    }, 120);
  } else if (!any && mageGlitchTimer) {
    clearInterval(mageGlitchTimer); mageGlitchTimer = 0;
  }
}

// klik na hlavu (moja strana, živý ne-aktuálny mág) = toggle swap akcie vo fronte - presne ako démon button
function toggleSwap(char) {
  if (uiLocked()) return;
  if (planning.openPicker) return;
  if (!me || state?.phase !== "playing" || !state?.[me]?.char) return;
  if (state?.series?.format !== "tournament") return;
  if (state?.p1?.labyrinth || state?.p2?.labyrinth) return;  // počas labyrintu je výmena zakázaná (hlavy sú skryté)
  if (state?.[me]?.lastStandBuff) return;                    // Last Stand pakt: vo final kole sa nestrieda
  if ((state?.mageDead?.[me] || []).includes(char)) return; // mŕtveho maga nemožno nasadiť
  if (state?.[me]?.char === char) return;                    // aktuálneho maga nemožno vymeniť za seba
  if (SIDE_CHARS[char] || SIDE_CHARS[state?.[me]?.char]) return; // side-postavu nemožno swapnúť ani odswapnúť (glitch)
  const idx = planning.myQueue.findIndex(a => a.type === "swap" && a.to === char);
  if (idx >= 0) { planning.myQueue.splice(idx, 1); }                  // opätovný klik = odober z fronty
  else {
    if (planning.myQueue.length >= 3) return;                         // plná fronta
    if (planning.myQueue.filter(a => a.type === "swap").length >= 2) return; // max 2 výmeny za kolo
    planning.myQueue.push({ type: "swap", to: char });
  }
  renderQueue();
}
[crownsP1El, crownsP2El].forEach(el => el.addEventListener("click", (ev) => {
  const span = ev.target.closest(".mhead.clickable");
  if (span) toggleSwap(span.dataset.char);
}));
