// public/client/phase-ui.js - obrazovky podľa fázy zápasu: lobby (host) / čakanie / výber postavy / draft tímu / hra,
// skóre série.
import { isSpectator, isHost, me } from "/client/session.js";
import { lobbyEl, hostWaitEl, lobbyWaitEl, teamWaitEl, selEl, crownsP1El, crownsP2El } from "/client/dom.js";
import { showLobby } from "/client/lobby.js";
import { updateCharSelectHp, resetCharSelectOpen, hiddenMode, setCharPage, charPage, syncTeamUi, startCharSelectPreview, stopCharSelectPreview } from "/client/char-select.js";
import { hideDeathCenter } from "/client/last-stand.js";
import { renderMageHeads } from "/client/hud.js";
import { pixSvg } from "/client/pix.js";

/* ---------- Phase UI (lobby / waiting / char-select) ---------- */

export function applyPhaseUI(s) {
  const phase = s?.phase || "playing";
  const controls = document.querySelector(".controls-row");

  // lobby: host vidí nastavenia; po START ak súper nie je → „čakám na druhého hráča"; druhý hráč čaká na hosta
  if (phase === "lobby" && !isSpectator) {
    if (isHost) {
      if (s?.awaitingOpponent) { lobbyEl.classList.add("hidden"); hostWaitEl?.classList.remove("hidden"); }
      else { showLobby(s); hostWaitEl?.classList.add("hidden"); }
      lobbyWaitEl.classList.add("hidden");
    } else {
      lobbyEl.classList.add("hidden"); lobbyWaitEl.classList.remove("hidden"); hostWaitEl?.classList.add("hidden");
    }
  } else {
    lobbyEl.classList.add("hidden");
    lobbyWaitEl.classList.add("hidden");
    hostWaitEl?.classList.add("hidden");
  }

  // turnajový draft: kým nepotvrdím tím, char-select beží v team-mode (toggle výber + confirm);
  // po potvrdení „TEAM LOCKED" čakačka, kým tím nepotvrdí aj súper (server vtedy prepne na playback.playing)
  const teamPhase = phase === "team_select" && !isSpectator && me;
  const needTeam = teamPhase && !s?.rosterReady?.[me];
  teamWaitEl?.classList.toggle("hidden", !(teamPhase && !needTeam));
  selEl.classList.toggle("team-mode", needTeam);

  // char-select v hernej fáze (kým nemám zvolenú postavu) alebo draft tímu (team-mode)
  const needChar = phase === "playing" && !isSpectator && me && !s?.[me]?.char;
  if (needChar || needTeam) {
    updateCharSelectHp(s); // tournament: HP magov + mŕtvi (musí byť pred preview loopom); v drafte null → bez statov
    selEl.classList.toggle("p2-side", me === "p2"); // hráč vpravo vidí svojich magov v alternatívnom vykreslení
    if (selEl.classList.contains("hidden")) resetCharSelectOpen(); // nové otvorenie - od stránky Mages (str. 1), čistý draft, bez easter-egg stránky
    if (!hiddenMode) setCharPage(charPage); // sync stránky/šípok/nadpisu - aj po Ctrl+F5; state update nesmie zhodiť otvorenú Hidden stránku
    if (needTeam) syncTeamUi();
    else selEl.querySelectorAll(".char-card.picked").forEach(c => { c.classList.remove("picked"); c.querySelector(".pick-badge")?.remove(); });
    hideDeathCenter(); selEl.classList.remove("hidden"); startCharSelectPreview(); // démon nesmie visieť cez výber
  } else if (!selEl.classList.contains("hidden")) { selEl.classList.add("hidden"); stopCharSelectPreview(); }

  if (controls && !isSpectator) controls.style.display = (phase === "playing") ? "" : "none";
}

// séria: v HUD boxe každého hráča rad placeholderov - BO3 = koruny za výhry,
// tournament = hlavy 3 magov (mŕtvy = lebka, aktuálny = zvýraznený, živí ostatní = klikateľní na výmenu)
export function renderSeriesCrowns(ser) {
  const single = !ser || !ser.format || ser.format === "single";
  if (single) {
    crownsP1El.classList.add("hidden"); crownsP2El.classList.add("hidden");
    crownsP1El.innerHTML = ""; crownsP2El.innerHTML = "";
    return;
  }
  if (ser.format === "tournament") { renderMageHeads(); return; }
  const needed = ser.needed || 1;
  const tournament = false;
  const onIcon  = tournament ? "skull" : "crown";
  const offIcon = tournament ? "skull_outline" : "crown_outline";
  // neobsadený slot -> obrys; obsadený -> plná pixel-art ikona
  const build = (filled) => Array.from({ length: needed },
    (_, i) => `<span class="crown${tournament ? " skull" : ""}${i < filled ? " won" : ""}">${pixSvg(i < filled ? onIcon : offIcon)}</span>`).join("");
  // koruny = výhry daného slotu; lebky = prehry daného slotu (= výhry súpera)
  const fillP1 = tournament ? (ser.winsP2 || 0) : (ser.winsP1 || 0);
  const fillP2 = tournament ? (ser.winsP1 || 0) : (ser.winsP2 || 0);
  crownsP1El.innerHTML = build(fillP1);
  crownsP2El.innerHTML = build(fillP2);
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
}
export function updateMatchScore(s) {
  renderSeriesCrowns(s?.phase === "lobby" ? null : s?.series);
}
