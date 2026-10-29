// public/client/socket-handlers.js - herné udalosti zo servera: you_are, color_roll (animácia farebného kolesa), state
// (snapshot / timeline / THE WORLD pauza), game_result, new_game, game_over, reset, spectator, turn_timer.
// Každá udalosť má jediný handler; registrujú sa pri načítaní, pripojenie je asynchrónne.
import { socket, hideRooms, rememberSpectate, forgetSpectate } from "/client/net.js";
import { setIdentity, me, setSpectator, setState } from "/client/session.js";
import { colorRollEl, crResultEl, crArrowEl, selEl, intermissionEl, goOverlay, dirPicker, aimPicker, lockBtn, hudTurn, arenaEl, meleeBtn, specialBtn } from "/client/dom.js";
import { stopCharSelectPreview } from "/client/char-select.js";
import { playback } from "/client/playback.js";
import { preloadChar } from "/client/sprites.js";
import { hideConnError, syncGoldenHalves, syncGoldDualHalves, closePickers, updateUiLocks, syncDashBtn, syncMirrorBtn, BTN_BASE } from "/client/controls.js";
import { resetActorFade } from "/client/anim.js";
import { clearProjectiles } from "/client/board-fx.js";
import { actors, resetPoses } from "/client/actors.js";
import { stopTurnTimer, tlog, setServerTimer } from "/client/turn-timer.js";
import { clearActionLogs } from "/client/action-log.js";
import { resetPlanning } from "/client/planning.js";
import { renderQueue } from "/client/queue.js";
import { clearActors, schedulePlayTimeline } from "/client/timeline.js";
import { renderGrid } from "/client/grid.js";
import { renderHUD, costHtml, applySpecialSkin } from "/client/hud.js";
import { fxAll } from "/client/fx-registry.js";
import { renderArenaLayers } from "/client/arena-bg.js";
import { applyPhaseUI, updateMatchScore } from "/client/phase-ui.js";
import { hideDeathCenter, hideDeathBehind } from "/client/last-stand.js";
import { positionActors } from "/client/placement.js";
import { enterTimestopMode, tsOverlaySet } from "/client/the-world.js";
import { CHAR_BUTTONS } from "/chars/index.js";
import { hydratePix, pixelizeEmoji } from "/client/pix.js";
import { ghostCharAt } from "/client/ghost.js";
import { sfx } from "/client/sound.js";
import { syncMusic } from "/client/sound-map.js";
import { startCharRoll, stopCharRoll } from "/client/char-roll.js";
import { COLOR_ROLL_SPIN_MS, COLOR_ROLL_RESULT_MS, COLOR_ROLL_FADE_MS } from "/shared/timing.js";

/* ---------- Sockets ---------- */
// you_are nesie slot (ľavá/pravá rola, fixná na celú sériu: host=p1) aj či som host
socket.on("you_are", (info) => {
  if (info && typeof info === "object") setIdentity(info.slot, !!info.isHost);
  else setIdentity(info); // spätná kompat.
  hideRooms(); // posadený hráč (join/create alebo reclaim) → preč z room-browsera
  // divák si sadol (TAKE SEAT) → koniec diváckeho režimu; ovládanie vráti applyPhaseUI z nasledujúceho state
  setSpectator(false);
  forgetSpectate();
  document.getElementById("spectator")?.classList.add("hidden");
});

/* ---------- Losovanie farieb (po configure_match) ---------- */
// Server už osoby vylosoval na sloty (p1 = BIELY vľavo a začína každú hru, p2 = ČIERNY vpravo)
// a poslal you_are - tu sa výsledok len ZINSCENUJE: strelka na yin-yang kruhu sa roztočí
// a dobehne na polovici hráčovej farby (biela vľavo 270°, čierna vpravo 90°). Overlay leží
// NAD char-selectom, takže výber postavy čaká, kým ruleta dobehne.
socket.on("color_roll", (info) => {
  if (!colorRollEl || (me !== "p1" && me !== "p2")) return; // divák ruletu nepotrebuje
  // host si zvolil pevnú farbu → žiadna ruleta, char-select sa ukáže rovno (netreba nič skrývať)
  if (info && info.animate === false) { colorRollEl.classList.add("hidden"); return; }
  const white = me === "p1";
  colorRollEl.classList.remove("hidden");
  colorRollEl.style.opacity = "";
  crResultEl.classList.add("hidden");
  crResultEl.innerHTML = "";
  // 4 celé otáčky + dobeh na cieľovú farbu ± rozptyl (len vizuálny - výsledok je daný)
  sfx("ui.color_roll");
  const target = (white ? 270 : 90) + (Math.random() * 40 - 20);
  crArrowEl.getAnimations().forEach(a => a.cancel());
  const spin = crArrowEl.animate(
    [{ transform: "rotate(0deg)" }, { transform: `rotate(${4 * 360 + target}deg)` }],
    { duration: COLOR_ROLL_SPIN_MS, easing: "cubic-bezier(.12,.68,.18,1)", fill: "forwards" }
  );
  spin.onfinish = () => {
    crResultEl.innerHTML = white
      ? `YOU PLAY <span class="cr-white">⚪ WHITE</span> - YOU GO FIRST!`
      : `YOU PLAY <span class="cr-black">⚫ BLACK</span> - YOU GO SECOND`;
    crResultEl.classList.remove("hidden");
    setTimeout(() => {
      const fade = colorRollEl.animate([{ opacity: 1 }, { opacity: 0 }], { duration: COLOR_ROLL_FADE_MS, easing: "ease-in", fill: "forwards" });
      fade.onfinish = () => {
        colorRollEl.classList.add("hidden");
        fade.cancel(); // fill:forwards by inak držal opacity 0 aj pri ďalšom zápase
      };
    }, COLOR_ROLL_RESULT_MS);
  };
});

/* ---------- Losovanie postáv (lobby „RANDOM CHARACTERS“) ---------- */
// server postavy / turnajový tím už pridelil; char_roll prišiel PRED stavom → overlay zakryje plochu
socket.on("char_roll", (info) => { startCharRoll(info); });

// hra je plná - divák hru sleduje, ale nemá výber postavy ani ovládanie (box s hláškou dole)
socket.on("spectator", (info) => {
  setSpectator();
  if (info?.roomId != null) rememberSpectate(info.roomId);
  hideRooms();
  document.getElementById("spectator")?.classList.remove("hidden");
  selEl.classList.add("hidden");
  stopCharSelectPreview();
  const controls = document.querySelector(".controls-row");
  if (controls) controls.style.display = "none";
});

// úplný reset herného UI (plánovaná fronta, golden/Last Stand voľby, game-over stavy, figúry): server ho
// pošle pri retry; volá sa aj pri návrate na room-browser - nová roomka nesmie zdediť ťahy z poslednej hry
function resetGameUi() {
  stopCharRoll();            // rozbehnuté losovanie postáv nesmie prežiť reset / odchod z roomky
  playback.playGen++;        // zruš prípadné bežiace prehrávanie
  playback.playing = false;
  hideConnError();
  resetActorFade();
  clearProjectiles(); // žiadny letiaci projektil nesmie prežiť reset

  // reset game-over stavov ešte pred renderHUD - inak by guard nechal visieť GAME OVER text
  playback.serverWinner = null;
  playback.serverGameResult = null;
  playback.gameOverShown = false;
  actors.lastAttackEndAt = { p1:0, p2:0 };
  stopTurnTimer();
  intermissionEl.classList.add("hidden");

  goOverlay.classList.add("hidden");
  dirPicker.classList.add("hidden");
  aimPicker.classList.add("hidden");
  clearActionLogs();
  resetPlanning();
  syncGoldenHalves();
  syncGoldDualHalves();
  closePickers();
  renderQueue();
  resetPoses();
  clearActors();
  lockBtn.classList.remove("locked");
  lockBtn.disabled = false;
  lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
  // char-select / lobby riadi applyPhaseUI z nasledujúceho state eventu
  renderGrid({}, []);
  renderHUD();
}
socket.on("reset", resetGameUi);
// admin reset roomky (alebo všetkých): server žiada obnovenie stránky - nová verzia klienta, potom room-browser
socket.on("force_reload", () => { forgetSpectate(); location.reload(); });
// room-browser (opustil som roomku / skončila) - „rooms" dostáva len socket mimo roomky, takže reset
// nikdy nezasiahne rozohranú hru; ďalšia roomka tak začne s prázdnou frontou (nie s ťahmi z poslednej hry)
socket.on("rooms", () => { setSpectator(false); resetGameUi(); });

socket.on("state", (s) => {
  tlog("recv state", { phase: s.phase, timerMs: s.timerMs, timeline: !!s.timeline, p1c: s.p1?.char, p2c: s.p2?.char, playing: playback.playing });
  setState(s);
  for (const slot of ["p1", "p2"]) {
    const c = s?.[slot]?.char || null;
    // register fx: postava sa na slote (znova) objavila - Escanor: reset premeny (nasadenie / turnajový swap),
    // Jotaro: summon intro standu znova
    fxAll("stateChar", slot, c, s);
    if (c) preloadChar(c, slot); // sprity vopred - prvý pohyb / útok nesmie čakať na stiahnutie (sprites.js)
    for (const rc of s?.roster?.[slot] || []) preloadChar(rc, slot); // turnaj: aj mágovia na swap
  }
  // FINAL ROUND hore podľa plánovacieho/refresh stavu (stavy s timeline = summon nechávame, prepne ho až banner)
  if (!s.timeline) playback.finalRoundActive = !!s.goldLocked;
  syncMusic(s, playback.finalRoundActive);

  // arena
  if (s.arena && s.arena !== arenaEl.dataset.key) {
    arenaEl.dataset.key = s.arena;
    const ARENAS_CLIENT = { bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"], "portal-realm": ["portal-realm-hd.webp"] };
    renderArenaLayers(s.arena, ARENAS_CLIENT[s.arena] || []);
  }

  // lobby / čakanie / char-select podľa fázy hry
  applyPhaseUI(s);
  updateMatchScore(s);

  if (s.timeline) {
    // finálny stav (vrátane nových tiles) nevykresľuj hneď - ukáže ho až posledný frame timeline
    schedulePlayTimeline(s.timeline);
  } else if (!playback.playing) {
    // čerstvý stav mimo prehrávania → stredový démon nemá čo visieť (objaví sa len počas timeline);
    // toto ho po reconnecte/refreshi spoľahlivo schová bez nutnosti F5
    hideDeathCenter();
    renderGrid(s);
    renderHUD();
    positionActors(s, true);
    renderQueue(); // prekresli round-script lištu (zlatý skeleton mojich slotov hneď, bez interakcie)
  }
  // počas prehrávania snapshot bez timeline nevykresľuj - framy bežiacej timeline majú prednosť

  // Jotaro THE WORLD: reload/reclaim počas čakania → snapshot nesie timestop (bez timeline) → obnov ts-mód;
  // ak timestop zmizol (kolo pokračuje inou cestou) → vypni prípadný zaseknutý filter/overlay
  if (s.timestop && !s.timeline) enterTimestopMode();
  else if (!s.timestop && !s.timeline && (playback.tsPlanning || playback.tsFrozen)) {
    playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); document.body.classList.remove("timestop-mode"); updateUiLocks();
  }

  // dash/attack tlačidlá podľa mága - Vampire/Onryō: dash = fialový charge, attack = strela s odrazom
  syncDashBtn(s[me]?.char);
  // mirror slot podľa mága - Jotaro a Luffy tu majú Special 1 (fialový ❔ skin + vlastný picker)
  syncMirrorBtn(s[me]?.char);
  // label melee podľa mága - Medúza má širší dosah (diagonály) za nižší dmg; Vampire/Onryō majú center strike bez bonusu
  const mineMelee = s[me];
  if (mineMelee?.char && meleeBtn) {
    const def = CHAR_BUTTONS[mineMelee.char]?.melee ?? BTN_BASE.melee;
    meleeBtn.title = def.title;
    const mCost = meleeBtn.querySelector(".cost");
    if (mCost) { mCost.innerHTML = costHtml(def.cost); hydratePix(mCost); }
  }
  // label special podľa mága - v turnaji po naplánovanom swape platí nový mág (ghostCharAt), nie ten na štarte kola
  const specChar = ghostCharAt();
  if (specChar && specialBtn) {
    specialBtn.classList.remove("hidden-question");
    const specIco = specialBtn.querySelector(".pix-ico:not(.mini)");
    specialBtn.classList.remove("vamp-charge");
    if (specIco) {
      specIco.classList.remove("charge-mark");
      if (specIco.dataset.emoji !== "✨") {
        specIco.dataset.emoji = "✨";
        specIco.innerHTML = "";
        delete specIco.dataset.done;
        pixelizeEmoji(specIco);
      } else if (!specIco.dataset.done) {
        pixelizeEmoji(specIco);
      }
    }
    // title + cena podľa postavy (register: buttons.special; vlkolak per-frame cez syncDynamicSpecialBtn)
    applySpecialSkin(specChar, true);
  }

  setServerTimer(s.timerMs ?? null); // synchronizuj odpočet so serverom (drží aj po refreshi)
});

// server posiela zostávajúci čas na ťah - klient sa naň synchronizuje (displej + auto-lock)
socket.on("turn_timer", ({ ms }) => { tlog("recv turn_timer", ms); setServerTimer(ms); });

// Server stále posiela "game_over" – len si zapamätáme, nezobrazíme hneď overlay.
// Overlay zobrazíme až po dobehnutí útoku a animácii smrti.
socket.on("game_over", ({ winner }) => {
  playback.serverWinner = winner;
});

// výsledok jednej hry série - vyhodnotí sa až na konci prehrávania timeline
socket.on("game_result", (r) => { playback.serverGameResult = r; });

// medzi hrami série: resetuj UI kola (skóre ostáva), char-select pre ďalšiu hru riadi nasledujúci state
socket.on("new_game", () => {
  tlog("recv new_game");
  playback.playGen++; playback.playing = false;
  playback.serverWinner = null; playback.serverGameResult = null; playback.gameOverShown = false;
  actors.lastAttackEndAt = { p1:0, p2:0 };
  hideDeathCenter(); // démon zo summon/banish nesmie prejsť do ďalšej hry
  hideDeathBehind(); // ani ten za postavou (banish ho mohol nechať visieť pri race s koncom hry)
  resetActorFade();  // teleport fade nesmie prejsť do ďalšej hry
  clearProjectiles(); // ani letiaci projektil
  stopTurnTimer();
  intermissionEl.classList.add("hidden");
  goOverlay.classList.add("hidden");
  dirPicker.classList.add("hidden"); aimPicker.classList.add("hidden");
  clearActionLogs();
  resetPlanning();
  syncGoldenHalves();
  syncGoldDualHalves();
  closePickers(); renderQueue();
  resetPoses();
  clearActors();
  lockBtn.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
});
