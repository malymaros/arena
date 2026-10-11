// public/client/timeline.js - prehrávanie timeline zo servera: frame po frame (delayMs), mapovanie efektov na animácie
// (pohyb, strely, zásahy, obrany, statusy, labyrint, Last Stand, THE WORLD pauza, choreografia z registra fx),
// prechod medzi kolami, koniec hry (game-over sekvencia / medzihra série) a upratanie figúr.
import { playback } from "/client/playback.js";
import { actors } from "/client/actors.js";
import { setAnim, NEW_ROUND_MS, resetActorFade, MOVE_MS, INVALID_MSG, POSE_TAIL_MS, fadeActor, INVALID_MSG_DEFAULT } from "/client/anim.js";
import { me, state, computeWinnerFromState, otherSlot } from "/client/session.js";
import { renderSeriesCrowns } from "/client/phase-ui.js";
import { hudTurn, actorsEl, goOverlay, roundBannerEl, lockBtn, hudP1Mana, hudP2Mana, actorP1, actorP2, hudBoxP1, hudBoxP2 } from "/client/dom.js";
import { clearCharOverlays, fxAll, CHAR_FX, fxOwnsCenter } from "/client/fx-registry.js";
import { tsOverlaySet, hideWorldCenter, spawnWorldCenter, enterTimestopMode } from "/client/the-world.js";
import { hideTsQueue, clearRoundCursor, renderQueue, updateLockButton, qBeatEls, highlightRoundBeat } from "/client/queue.js";
import { hideConnError, updateUiLocks, syncGoldenHalves, syncGoldDualHalves } from "/client/controls.js";
import { stopTurnTimer } from "/client/turn-timer.js";
import { clearActionLogs, appendActionLog } from "/client/action-log.js";
import { clearProjectiles, spawnFloat, cloneFloat, spawnCellFloat, spawnTrapBreak, spawnClonePuff, spawnManaFloat, spawnDamageFloat, spawnChargeAura, spawnTileConsumeFx, spawnStoneShatter, spawnCloneSummonFx } from "/client/board-fx.js";
import { SIZE_LEVEL, ACTION_ANIMS } from "/chars/index.js";
import { renderHUD } from "/client/hud.js";
import { renderGrid } from "/client/grid.js";
import { positionActors, computeFacing } from "/client/placement.js";
import { hideDeathCenter, hideDeathBehind, demonCenterAppear, demonCenterDisappear, hopeCenterAppear, hopeCenterDisappear, lsCenterAppear, lsCenterDisappear, placeDeathBehind } from "/client/last-stand.js";
import { showIntermission } from "/client/intermission.js";
import { planning } from "/client/planning.js";
import { ANIM_DEF } from "/client/sprites.js";
import { cloneEls, spawnSilhouetteFlash, qCursor, cloneGhost, youMarker } from "/client/actor-layers.js";
import { WOLF_DIRS_CLIENT } from "/client/zones.js";
import { spawnMirrorReflect, spawnShieldBlock } from "/client/defense-fx.js";
import { playTeleportExplosion } from "/client/teleport.js";
import { lastStand } from "/client/last-stand-state.js";
import { deathBehind } from "/client/overlays.js";
import { DEATH_SEQ } from "/client/demon-sprites.js";

/* ---------- GameOver sekvencia ---------- */
function showGameOverSequence(winner) {
  if (playback.gameOverShown) return;
  playback.gameOverShown = true;

  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);

  // počkaj, kým dobehne posledná animácia útoku (ak nejaká beží)
  const now = performance.now();
  const lastEnd = Math.max(actors.lastAttackEndAt.p1, actors.lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);

  setTimeout(() => {
    // potom spusti animáciu smrti porazeného (ak nie je remíza)
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) {
      setAnim(loser, "dead", 1200);
      afterDeathWait = 1300; // trvanie death + malý buffer
    }

    setTimeout(() => {
      // verdikt namiesto ROUND n v hud-turn - hlavné okno nič neprekrýva
      let verdict, cls;
      if (winner === "draw")        { verdict = "TIE"; cls = "tie"; }
      else if (me && winner === me) { verdict = "WINNER!"; cls = "win"; }
      else if (me)                  { verdict = "LOSER!"; cls = "lose"; }
      else                          { verdict = `${winner.toUpperCase()} WINS`; cls = "tie"; } // divák
      // pri sérii (BO3/BO5) doplň finálne skóre
      const ser = playback.serverGameResult?.series || state?.series;
      let scoreLine = "";
      if (ser && ser.format && ser.format !== "single") {
        // skóre drží strany (ľavá : pravá), rovnako ako koruny v HUD - nie „ja : oponent"
        scoreLine = `<span class="go-verdict tie">${ser.winsP1 ?? 0} : ${ser.winsP2 ?? 0}</span>`;
        renderSeriesCrowns(ser); // dokresli finálne koruny (server po match_over už neposiela state)
      }
      if (hudTurn) hudTurn.innerHTML = `GAME OVER<span class="go-verdict ${cls}">${verdict}</span>${scoreLine}`;
      // uprac overlay z poslednej akcie (special/melee cast) - po game over ho už renderGrid neuprace
      actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
      clearCharOverlays();
      // víťazova postavička spamuje cast animáciu priamo na svojom políčku (žiadny extra sprite)
      if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
      goOverlay.classList.remove("hidden");
    }, afterDeathWait);
  }, waitAttack);
}

// animácia konca hry (smrť porazeného + víťazstvo) bez finálneho overlayu - pre medzihru série
function playGameEndAnim(winner, after) {
  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);
  const now = performance.now();
  const lastEnd = Math.max(actors.lastAttackEndAt.p1, actors.lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);
  setTimeout(() => {
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) { setAnim(loser, "dead", 1200); afterDeathWait = 1300; }
    actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
    clearCharOverlays();
    if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
    setTimeout(() => { if (after) after(); }, afterDeathWait);
  }, waitAttack);
}

// medzikolová „ROUND N" animácia - round-script zostane vidieť, kým dobehne; potom callback resetuje lištu
function playNewRoundTransition(nextTurn, done) {
  if (!roundBannerEl) { setTimeout(done, NEW_ROUND_MS); return; }
  // ak ďalšie kolo je buffnuté (Last Stand) → „FINAL ROUND" + veľký démon tile (červený okraj) pod nápisom
  const final = !!state?.goldLocked;
  if (final) {
    roundBannerEl.innerHTML = 'FINAL ROUND<span class="rb-demon"><img src="/assets/last_stand.png" alt="" /></span>';
    playback.finalRoundActive = true; // text hore sa prepne až teraz (s bannerom)
  } else {
    roundBannerEl.textContent = `ROUND ${nextTurn}`;
  }
  roundBannerEl.classList.remove("hidden", "show");
  void roundBannerEl.offsetWidth; // reštart animácie
  roundBannerEl.classList.add("show");
  setTimeout(() => {
    roundBannerEl.classList.remove("show");
    roundBannerEl.classList.add("hidden");
    done();
  }, NEW_ROUND_MS);
}

/* ---------- Timeline prehrávanie ---------- */
// len na čítanie pre tools/browser-smoke.mjs (boti čakajú, kým divák dohrá timeline) - na hru bez vplyvu
Object.defineProperty(window, "__arenaPlaying", { get: () => playback.playing });

export function schedulePlayTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return;

  const gen = ++playback.playGen;
  playback.playing = true;
  // Jotaro THE WORLD: nová timeline (vrátane pokračovacej po zmrazení) = pauza sa skončila; overlay + ts-queue
  // + stredový Special_3_P skry (u súpera to je moment „Jotaro klikol EXECUTE"); filter body.timestop-mode
  // nechaj - pokračovacia timeline ho zhasne až efektom timestop_end
  playback.tsPlanning = false; playback.tsFrozen = false; tsOverlaySet(false); hideTsQueue(); hideWorldCenter();
  hideConnError();  // kolo sa vyhodnotilo → prípadná hláška o chybe spojenia je už neaktuálna
  stopTurnTimer(); // kolo sa už vyhodnocuje (server poslal timeline) - zhasni prípadný stale časovač
  updateUiLocks(); // počas vyhodnocovania sú všetky tlačidlá zamknuté a stmavené

  clearActionLogs(); // záznam predošlého kola zmizne so začiatkom nového
  clearProjectiles(); // žiadne staré projektily nesmú prejsť do nového kola
  actors.escPrideDisplay = { p1: null, p2: null }; // zruš prípadné podržanie starej veľkosti z minulého kola
  actors.escPrideDisplayChar = { p1: null, p2: null };

  const first = timeline[0];
  // levelová veľkosť (Escanor pride / Vlkolakova fáza mesiaca) pred kolom - na konci prehrávania porovnáme
  // s novou hodnotou → float (lev ▲▼ / nová fáza mesiaca)
  const lvlOf = (a) => SIZE_LEVEL[a?.char] ? (a[SIZE_LEVEL[a.char].stat] ?? 0) : null;
  const preLvl = { p1: lvlOf(first.p1), p2: lvlOf(first.p2) };
  const preChar = { p1: first.p1?.char || null, p2: first.p2?.char || null }; // char na začiatku kola (swap ho zmení)
  // drž veľkosť podľa levelu NA ZAČIATKU kola cez celé kolo (nová veľkosť sa aplikuje až po kole, keď sa
  // ukáže float) - inak by posledný frame (s novým levelom) zmenil veľkosť ešte pred floatom
  for (const slot of ["p1", "p2"]) if (preLvl[slot] != null) { actors.escPrideDisplay[slot] = preLvl[slot]; actors.escPrideDisplayChar[slot] = preChar[slot]; }
  // kurzor v lište: poradie beatov sa zhoduje so serverovým resolveTurn (štartér je prvý v dvojici)
  const playStarter = first.starter ?? state?.starter ?? "p1";
  // beat counts prežijú pauzu THE WORLD: pokračovacia timeline (playback.tsResumePending) NEresetuje číslovanie,
  // takže kurzor po obnovení času skočí na akciu VPRAVO od THE WORLD (nie na začiatok lišty)
  if (!playback.tsResumePending) playback.roundBeatCounts = { p1: 0, p2: 0 };
  playback.tsResumePending = false;
  const beatCounts = playback.roundBeatCounts;
  // posledná zaznamenaná akcia per slot (badge v logu + beat v lište) - keď príde "invalid", prečiarkneme ju
  const lastActed = { p1: null, p2: null };
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn; state.starter = (first.starter ?? state.starter);
  state.tiles = first.tiles; state.iks = first.iks; state.pending = first.pending;
  renderHUD();
  const NEXT_TURN = (first.turn ?? state.turn) + 1;
  const NEXT_STARTER = playStarter === "p1" ? "p2" : "p1"; // preklop (hru môže začínať aj p2)
  renderGrid(state, first.effects || []);
  positionActors(state, true);

  // úvod kola z registra fx (Escanor: RAZ premena WeakIdle→Stand pred prvými akciami, zruší zvyšky slnka) -
  // timeline sa oneskorí o najdlhší úvod
  const preDelay = Math.max(0, ...fxAll("roundIntro"));

  let i = 1;
  let prev = first;

  const step = () => {
    if (gen !== playback.playGen) return; // medzitým začala novšia timeline - túto slučku ukonči

    if (i >= timeline.length) {
      playback.playing = false;

      // Escanor/Vlkolak: level sa po kole zmenil → veľkosť je stále držaná na starej (od začiatku kola);
      // ukáž float nad ním (lev ▲▼ / nová fáza mesiaca) a AŽ POTOM (po pauze) pusti na novú veľkosť
      // (plynulý prechod). Bez zmeny → hneď pusti hold. Iná postava (swap) → hold len zruš.
      for (const slot of ["p1", "p2"]) {
        const nowLvl = lvlOf(state?.[slot]);
        // swap v strede kola (char sa zmenil) → žiadny float, len pusti držanie starej postavy na novú veľkosť
        const charChanged = (state?.[slot]?.char || null) !== preChar[slot];
        if (nowLvl === null || charChanged) { actors.escPrideDisplay[slot] = null; actors.escPrideDisplayChar[slot] = null; continue; }
        if (preLvl[slot] != null && nowLvl !== preLvl[slot]) {
          // float z registra fx (Escanor: lev ▲▼ NAD ním, veľkosť ešte stará; vlkolak: len nová fáza mesiaca)
          CHAR_FX[state[slot].char]?.levelFloat?.(slot, nowLvl, nowLvl > preLvl[slot]);
          const sl = slot;
          setTimeout(() => { actors.escPrideDisplay[sl] = null; positionActors(state); }, 650); // potom plynulé zväčšenie/zmenšenie
        } else {
          actors.escPrideDisplay[slot] = null; // bez zmeny levelu - pusti hold
        }
      }

      // koniec hry: ak séria pokračuje -> medzihra; ak je rozhodnutá -> game over
      const winner = playback.serverWinner || playback.serverGameResult?.gameWinner || computeWinnerFromState(state);
      if (winner) {
        clearRoundCursor();
        // banish/summon: démon ešte chvíľu drží, potom zmizne - stredový AJ ten za postavou
        // (koniec hry = žiadny démon na ploche, nech už jeho animácie dopadli akokoľvek)
        setTimeout(() => { hideDeathCenter(); hideDeathBehind(); }, 700);
        if (playback.serverGameResult && !playback.serverGameResult.matchOver) {
          playGameEndAnim(winner, () => showIntermission(winner, playback.serverGameResult.series, me));
        } else {
          showGameOverSequence(winner);
        }
        return;
      }

      // bežný koniec kola: round-script (odhalení súperi + kurzor) nechaj vidieť, prehraj
      // „ROUND N" animáciu a až po nej resetuj lištu na ďalšie kolo
      const doneGen = gen;
      playNewRoundTransition(NEXT_TURN, () => {
        if (doneGen !== playback.playGen) return; // medzitým začalo nové prehrávanie - neresetuj
        state.turn = NEXT_TURN;
        state.starter = NEXT_STARTER;
        renderHUD();
        if (state.p1) state.p1.locked = false;
        if (state.p2) state.p2.locked = false;
        renderGrid(state, []);
        planning.myQueue = [];
        planning.goldenArmed = false;
        planning.goldenMirrorArmed = false;
        planning.goldenManaArmed = false;
        planning.lastStandArmed = false;
        planning.lastHopeArmed = false;
        planning.lockedIn = false; // kolo dobehlo - odomkni ovládanie
        resetActorFade(); // po teleporte vráť plnú viditeľnosť postáv pre ďalšie kolo
        syncGoldenHalves();
        syncGoldDualHalves();
        renderQueue(); // až teraz vyčisti round-script pre ďalšie kolo
        lockBtn.disabled = false;
        updateLockButton();
        // časovač ďalšieho kola príde zo servera (turn_timer); displej sa zapne po dohraní timeline
      });
      return;
    }

    const frame = timeline[i++];
    // pózu neslučkovej animácie držíme presne po dobu, čo je tento frame na obrazovke (žiadny presah do ďalšej akcie)
    const frameHold = frame.delayMs ?? 600;

    const beforeP1 = prev?.p1 || state.p1;
    const beforeP2 = prev?.p2 || state.p2;

    state.p1 = frame.p1; state.p2 = frame.p2;
    state.tiles = frame.tiles; state.iks = frame.iks; state.pending = frame.pending;
    if (frame.starter !== undefined) {
      state.starter = frame.starter;
    }
    renderHUD();

    // run aj pri pohybe KLONA (actors.animState je zdieľaný - klon zrkadlí majiteľovu animáciu)
    const cloneMoved = (b, f) => !!(b?.clone && f?.clone && (b.clone.x !== f.clone.x || b.clone.y !== f.clone.y));
    // pohyb postavy pre register fx (Jotarov stand: dash = beh za Jotarom, MOVE = zmizne a zjaví sa na novej bunke)
    const noteStandLoco = (slot, before, frm) => CHAR_FX[frm?.char]?.moved?.(slot, before, frm);
    // Luffy priťiahnutie: ťahaný súper sa NEmá rozbehnúť (nech to nevyzerá, že tam sám beží) - drž ho
    // v idle, len sa sklzne k Luffymu. Ťahaný = súper toho, kto pull vyvolal (e.from).
    const pullEff = (frame.effects || []).find(e => e.kind === "luffy_pull" && (e.from === "p1" || e.from === "p2"));
    const pulledSlot = pullEff ? (pullEff.from === "p1" ? "p2" : "p1") : null;
    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y || cloneMoved(beforeP1, frame.p1))) { setAnim("p1", pulledSlot === "p1" ? "idle" : "run", MOVE_MS); noteStandLoco("p1", beforeP1, frame.p1); }
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y || cloneMoved(beforeP2, frame.p2))) { setAnim("p2", pulledSlot === "p2" ? "idle" : "run", MOVE_MS); noteStandLoco("p2", beforeP2, frame.p2); }

    const shooters = new Set(); // basic strela - jednorazová póza
    const casters  = new Set(); // special - looping, malá postava sa animuje súbežne s veľkým sprite-om
    let tsWait = false;         // Jotaro THE WORLD: tento frame je koniec čiastočnej timeline → pauza
    for (const e of frame.effects || []) {
      // poistka: výnimka v JEDNOM efekte nesmie zaseknúť prehrávanie celého kola (step() beží cez setTimeout -
      // neodchytený throw by reťaz natrvalo prerušil a UI by ostalo zamknuté uprostred kola)
      try {
      if ((e.kind === "charge" || e.kind === "attack_swing") && e.from) shooters.add(e.from);
      // útok do steny (strela nemá kam letieť) - útočná póza sa zahrá cez `shooters`, sem len whiff float;
      // akcia sa NEprečiarkne (minula manu a „vykonala sa"), na rozdiel od starého OFF-BOARD invalidu
      if (e.kind === "attack_swing" && e.offboard && (e.from === "p1" || e.from === "p2")) {
        const [msg, cls] = INVALID_MSG.offboard;
        spawnFloat(e.from, msg, cls);
        cloneFloat(e.from, msg, cls);
      }
      // postava s vlastným stredom specialu (register fx ownCenter - Escanor: vlastná choreografia slnka;
      // Jotaro: figúra hrá Attack_2 a útok vizuálne vedie stand) nie je center-cast
      if (e.kind === "special" && e.from && !fxOwnsCenter(state?.[e.from]?.char, "special")) casters.add(e.from);
      // Jotaro THE WORLD: cast → menace (Special_3_P) hrá v NORMÁLNYCH farbách; čas sa zamrazí (filter +
      // zmrazenie animácií) AŽ po dohraní menace - pri timestop_wait v enterTimestopMode. wait → pauza;
      // ts_hit/ts_mirror → announce float nad zmrazeným súperom (bez zmeny HP); end → vypni filter
      if (e.kind === "timestop_start" && (e.from === "p1" || e.from === "p2")) {
        spawnWorldCenter(e.from); // veľký stredový „menace" sprite (Special_3_P) - hrá až kým nezastane
      }
      if (e.kind === "timestop_wait") tsWait = true;
      if (e.kind === "ts_hit" && (e.target === "p1" || e.target === "p2")) spawnFloat(e.target, `-${e.dmg} HP`, "ts-float");
      if (e.kind === "ts_mirror" && (e.target === "p1" || e.target === "p2")) spawnFloat(e.target, "MIRRORED", "ts-float");
      if (e.kind === "timestop_end") {
        document.body.classList.remove("timestop-mode");
        playback.tsActive = false; playback.tsJotaroSlot = null; hideWorldCenter(); // čas sa rozbehol - animácie zas bežia
      }
      // strelec sa otočí v smere horizontálnej streľby (vertikálna facing nemení; diagonály podľa
      // horizontálnej zložky - Countess/Onre strieľajú šikmo)
      if (e.kind === "charge" && typeof e.dir === "string" && (e.from === "p1" || e.from === "p2")) {
        const sx = e.dir.includes("left") ? -1 : e.dir.includes("right") ? 1 : 0;
        if (sx) actors.facingOverride[e.from] = { sx, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Medúzin/Escanorov special má smer - počas castu je otočená v smere pohľadu, nie na súpera
      if (e.kind === "special" && (e.dir === "left" || e.dir === "right") && (e.from === "p1" || e.from === "p2")) {
        actors.facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Countess/Onre: beh melee-charge (Run) - otočenie podľa horizontálnej zložky smeru
      if (e.kind === "vamp_charge" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "vamprun", frameHold);
        actors.lastAttackEndAt[e.from] = performance.now() + frameHold;
        const sx = e.dir === "left" ? -1 : e.dir === "right" ? 1 : 0;
        if (sx) actors.facingOverride[e.from] = { sx, until: performance.now() + frameHold + POSE_TAIL_MS };
      }
      // Countess/Onre: seknutie na bunke terča - po dobehnutí charge alebo po teleporte pasce.
      // Anim hint zo servera: Countess = va1 (A1 - krvavý bolt zapečený vo framoch, žiadne extra FX),
      // Onre trap = vattack1 (Attack_1), Onre charge = default vampstrike (alias Attack_3)
      if (e.kind === "vamp_strike" && (e.from === "p1" || e.from === "p2")) {
        const key = e.anim && ANIM_DEF[e.anim] ? e.anim : "vampstrike";
        setAnim(e.from, key, frameHold);
        actors.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // Countess: liečivé beaty po dopadnutom melee/trap dmg (A2 → A3 → A4, krvavé efekty vo framoch) -
      // HP sa doplnia až po nich
      if (e.kind === "vamp_heal_cast" && (e.from === "p1" || e.from === "p2")) {
        const key = e.anim && ANIM_DEF[e.anim] ? e.anim : "va2";
        setAnim(e.from, key, frameHold);
        actors.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // pasca položená - značku kreslí renderGrid zo state[slot].trap; float vidí len caster
      // (súperovi server trap_set efekt aj trap v dátach rediguje)
      if (e.kind === "trap_set" && Array.isArray(e.cell)) {
        spawnCellFloat(e.cell, "🩸 TRAP SET", "trap-float");
      }
      // trigger pasce - bunka sa rozžiari (trap-flash rieši renderGrid), float vidia OBAJA
      if (e.kind === "trap_trigger" && Array.isArray(e.cell)) {
        spawnCellFloat(e.cell, "🩸 TRAP!", "trap-float");
      }
      // zničenie pasce (vlastný vstup castera / petrifikovaný caster / rituálna smrť) - vidia OBAJA:
      // súper sa dozvedá, že riziko pasce pominulo
      if (e.kind === "trap_break" && Array.isArray(e.cell)) {
        spawnTrapBreak(e.cell);
      }
      // teleport pasce: caster zmizne na svojej bunke (OUT - pozícia sa mení až IN frame-om)…
      // oblak je krvavočervený (blood=true) - téma Vampire/Onryō, nie Narutov biely dym
      if (e.kind === "trap_tp_out" && (e.from === "p1" || e.from === "p2")) {
        const p = state?.[e.from];
        if (p && p.x != null) spawnClonePuff([p.x, p.y], true);
        fadeActor(e.from, 1, 0, frameHold);
      }
      // …a objaví sa na bunke pasce (IN) - pozíciu snapni (teleport nesmie kĺzať cez board);
      // Onre sa zjavuje s výkrikom (Scream) - bez behania, rovno na bunke pasce
      if (e.kind === "trap_tp_in" && (e.from === "p1" || e.from === "p2")) {
        positionActors(state, true);
        const p = state?.[e.from];
        if (p && p.x != null) spawnClonePuff([p.x, p.y], true);
        fadeActor(e.from, 0, 1, frameHold);
        // zjavenie bez behania v idle - zruš auto-run z posunu pozície (Onre s výkrikom: register fx, effect nižšie)
        setAnim(e.from, "idle");
      }
      // trigger bez many na útok - teleport prebehol, úder nepadol (LOW MANA float bez prečiarknutia)
      if (e.kind === "trap_no_mana" && (e.target === "p1" || e.target === "p2")) {
        const [msg, cls] = INVALID_MSG.mana;
        spawnFloat(e.target, msg, cls);
        const bar = e.target === "p1" ? hudP1Mana : hudP2Mana;
        if (bar) {
          bar.classList.remove("low-warn");
          void bar.offsetWidth;
          bar.classList.add("low-warn");
          setTimeout(() => bar.classList.remove("low-warn"), 1000);
        }
      }
      // Onre: drain many - súperovi ČERVENÝ „−N MANA" (strata), Onremu modrý „+N MANA" (prírastok);
      // rovnaké znenie ako gain float, nech je z textu aj farby jasné, komu efekt patrí. Prírastok je
      // oneskorený - po charge stoja obaja na TEJ ISTEJ bunke a floaty by sa prekryli; takto sa číta
      // sekvencia „súper stráca → Onryō získava"
      if (e.kind === "mana_drain" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, `−${e.drained ?? 0} MANA`, "drain-float");
        if (e.from && (e.gained ?? 0) > 0) setTimeout(() => spawnManaFloat(e.from, e.gained), 400);
      }
      // choreografia autora efektu (register fx: public/chars/fx/<key>.js - Vojak, Vlkolak, Luffy, …)
      CHAR_FX[state?.[e.from]?.char]?.effect?.(e, frameHold);
      if (e.kind === "melee" && (e.from === "p1" || e.from === "p2")) {
        // looping → malá postava sa seká súbežne s veľkým sprite-om (re-triggered každý beat); Medúza = Attack_1
        // (Countess sem už nechodí - jej center melee je jednotný vamp_strike s A1)
        setAnim(e.from, ACTION_ANIMS[state?.[e.from]?.char]?.melee || "attack2_loop", frameHold);
        actors.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) {
        setAnim(e.target, "hurt", frameHold);
        // POWER tile bonus: extra dmg z tile ide ako SAMOSTATNÝ zlatý „⚡-2" float (hlavný float ukazuje
        // základ bez bonusu, HP samozrejme klesli o súčet) - bonus je v e.dmg/e.parts[0] už zarátaný
        const bonus = (typeof e.bonus === "number" && e.bonus > 0) ? e.bonus : 0;
        // stacknutý Naruto+klon = súbežné zásahy spojené do jedného úderu → vypíš rozpis „-3 -3 HP"
        if (Array.isArray(e.parts) && e.parts.length > 1 && e.parts.reduce((a, b) => a + b, 0) > 0) {
          const parts = bonus ? [Math.max(0, e.parts[0] - bonus), ...e.parts.slice(1)] : e.parts;
          spawnFloat(e.target, `-${parts.join(" -")} HP`, "dmg-float");
        } else if (typeof e.dmg === "number" && e.dmg - bonus > 0) {
          spawnDamageFloat(e.target, e.dmg - bonus);
        }
        // zlatý float mierne oneskorený, nech sa neprekryje s hlavným
        if (bonus) { const tgt = e.target; setTimeout(() => spawnFloat(tgt, `⚡ -${bonus}`, "power-float"), 280); }
      }
      if (e.kind === "invalid" && (e.target === "p1" || e.target === "p2")) {
        // flinch (nie hurt) - klon ho zrkadlí, takže pri neplatnej akcii trhnú obaja Naruti rovnako
        setAnim(e.target, "flinch", frameHold);
        // nevykonaná akcia - prečiarkni práve zaznamenaný badge (log) aj beat (lišta) jemným červeným ✕
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        // vždy zobraz dôvod (aj neznámy → default), nech žiadna nevykonaná akcia nie je „tichá“
        const [msg, cls] = INVALID_MSG[e.reason] || INVALID_MSG_DEFAULT;
        spawnFloat(e.target, msg, cls);
        cloneFloat(e.target, msg, cls); // rovnaká hláška nad klonom - nesmie prezradiť, ktorý je pravý
        // nedostatok many - navyše výrazná výstraha: bliknutie mana baru v HUD
        if (e.reason === "mana") {
          const bar = e.target === "p1" ? hudP1Mana : hudP2Mana;
          if (bar) {
            bar.classList.remove("low-warn");
            void bar.offsetWidth; // restart animácie pri opakovanej výstrahe
            bar.classList.add("low-warn");
            setTimeout(() => bar.classList.remove("low-warn"), 1000);
          }
        }
      }
      // náraz do steny - figúra (Naruto ALEBO jeho klon), ktorá sa daným smerom nedá pohnúť, sa strhne
      // k stene + OUT OF BOUNDS; tá druhá sa medzitým pohla. e.clone === true → náraz je na klonovi.
      if (e.kind === "wall_bump" && (e.from === "p1" || e.from === "p2")) {
        const onClone = e.clone === true;
        const el = onClone ? cloneEls[e.from] : (e.from === "p1" ? actorP1 : actorP2);
        // aj diagonálne smery - vlkolakov charge do steny z okrajovej bunky (wall pravidlo)
        const d = WOLF_DIRS_CLIENT[e.dir] || [0,0];
        // translate sa skladá „add" na základný transform (translateX(shift) scaleX(scale)) - scaleX prevracia X,
        // preto horizontálny náraz násobíme znamienkom facingu, aby smeroval do skutočnej steny
        const scale = computeFacing(state?.p1, state?.p2)[e.from] || 1;
        const nx = d[0] * 14 * scale, ny = d[1] * 14;
        if (el && el.style.display !== "none") {
          el.animate(
            [{ transform: "translate(0,0)" }, { transform: `translate(${nx}px,${ny}px)`, offset: 0.4 }, { transform: "translate(0,0)" }],
            { duration: Math.min(frameHold, 420), easing: "ease-out", composite: "add" }
          );
        }
        if (onClone) {
          const c = state?.[e.from]?.clone;
          if (c) spawnCellFloat([c.x, c.y], "🚫 OUT OF BOUNDS", "lowmana-float");
        } else {
          spawnFloat(e.from, "🚫 OUT OF BOUNDS", "lowmana-float");
        }
      }
      if (e.kind === "recharge" && (e.from === "p1" || e.from === "p2")) {
        const amt = (typeof e.amount === "number" ? e.amount : 4);
        const dark = !!e.dark; // Pútnikova pasívna mana = tá istá animácia, len celá v čiernej
        spawnManaFloat(e.from, amt, false, dark);
        spawnChargeAura(e.from, false, false, "actor", dark); // „Goku" nabíjacia aura na postave
        const rechAnim = ACTION_ANIMS[state?.[e.from]?.char]?.recharge; // vlastná recharge póza (Vojak)
        if (rechAnim) setAnim(e.from, rechAnim, frameHold);
        // klon sa „nabíja" naprázdno tiež - aura+float na oboch, nech recharge neprezradí pravého
        cloneFloat(e.from, `+${amt}`, dark ? "mana-float dark" : "mana-float");
        spawnChargeAura(e.from, false, false, "clone", dark);
      }
      // Fire Wizard skonzumoval Damage dlaždicu (boost zo specialu) / caster POWER tile - krátky flare na bunke
      if (e.kind === "tile_consume" && Array.isArray(e.cell)) {
        spawnTileConsumeFx(e.cell, e.tile);
      }
      // Pútnik použil mirror → nedostal pasívnu manu; float, nech hráč vie prečo
      if (e.kind === "wanderer_no_regen" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🪞 MIRROR USED", "wander-nomana-float");
      }
      // skamenený ťah - akcia sa nevykonala: prečiarkni práve zaznamenaný badge/beat + STONED float
      if (e.kind === "stoned" && (e.target === "p1" || e.target === "p2")) {
        const acted = lastActed[e.target];
        if (acted) {
          acted.logEl?.classList.add("act-invalid");
          acted.beatEl?.classList.add("act-invalid");
        }
        spawnFloat(e.target, "🗿 STONED", "stone-float");
      }
      // PASS (vypršaný čas, nevyplnený slot): postava „premýšľa" + úbytok many (oneskorený, nech sa floaty neprekryjú)
      if (e.kind === "pass" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "💭 THINKING", "think-float");
        if ((e.mana ?? 0) > 0) { const who = e.from, m = e.mana; setTimeout(() => spawnFloat(who, `−${m} MANA`, "drain-float"), 400); }
      }
      // zásah Medúziným specialom - postava skamenie (sivú sochu kreslí raf zo state.stone)
      if (e.kind === "petrify" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🗿 PETRIFIED", "stone-float");
      }
      // odkamenenie - socha sa roztrieští (kamenné úlomky) namiesto obyčajného prebliku späť do normálu
      if (e.kind === "unpetrify" && (e.target === "p1" || e.target === "p2")) {
        spawnStoneShatter(e.target);
      }
      // Minotaurov special - zasiahnutý blúdi v labyrinte (hmlu/niť kreslí renderGrid zo state.labyrinth/thread)
      if (e.kind === "labyrinth" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 LOST IN THE LABYRINTH", "maze-float");
      }
      // vzájomný zásah - labyrint končí, board sa prekliatemu odhalí (stav to už nesie, float len ohlási)
      if (e.kind === "labyrinth_end" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, "🌀 ESCAPED THE LABYRINTH", "maze-float");
      }
      // istý zásah ukončí labyrint - server odhalil všetko už PRED animáciou akcie (frame nesie plné dáta):
      // skrytý súper sa prekliatemu zjaví z tmy (fade ako démon/teleport), widget sa odkryl cez state.labReveal
      if (e.kind === "labyrinth_reveal" && (e.target === "p1" || e.target === "p2")) {
        if (me === e.target) fadeActor(otherSlot(), 0, 1, frameHold);
        spawnFloat(e.target, "🌀 REVEALED!", "maze-float");
      }
      // súper vstúpil na Ariadninu niť - perzistentný obrys kreslí raf zo state.threadMark; navyše
      // preblik obrysu na KAŽDEJ prejdenej niťovej bunke - okrem mojej vlastnej (tam lovca vidím naživo/lit,
      // ten sa rieši fade-om v raf, nie preblikom). Žiadne textové/emoji floaty.
      if (e.kind === "thread_mark" && Array.isArray(e.cell)) {
        if (me === e.target) {
          const oppS = otherSlot();
          const oppChar = oppS ? state?.[oppS]?.char : null;
          const mine = state?.[me];
          const onMyCell = mine && mine.x === e.cell[0] && mine.y === e.cell[1];
          if (oppChar && !onMyCell) spawnSilhouetteFlash(e.cell, oppChar, oppS);
        }
      }
      if (e.kind === "shield" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🛡️ SHIELD", "shield-float");
        cloneFloat(e.from, "🛡️ SHIELD", "shield-float"); // klon „bráni" tiež - float nesmie prezradiť pravého
      }
      if (e.kind === "mirror_on" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🪞 MIRROR", "shield-float");
        cloneFloat(e.from, "🪞 MIRROR", "shield-float");
      }
      // Naruto: summon klona - postava + 1 kópia na tej istej bunke tvárou v tvár hrajú Special_2
      if (e.kind === "clone_summon" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "special2", frameHold);
        actors.lastAttackEndAt[e.from] = performance.now() + frameHold;
        spawnCloneSummonFx(e.from, e.cell, frameHold);
      }
      if (e.kind === "clone_born" && (e.from === "p1" || e.from === "p2") && Array.isArray(e.cell)) {
        actors.cloneDead[e.from] = false; // nový klon žije - zruš „mŕtvy" príznak
        spawnCellFloat(e.cell, "👥 SHADOW CLONE", "maze-float");
      }
      // klon zasiahnutý - puffne v OBLAKU DYMU a natrvalo zmizne (žiadny problik späť)
      if (e.kind === "clone_die" && (e.target === "p1" || e.target === "p2")) {
        actors.cloneDead[e.target] = true;           // positionActors ho odteraz drží skrytého
        const cEl = cloneEls[e.target];
        if (cEl) { cEl.getAnimations().forEach(a => a.cancel()); cEl.style.display = "none"; } // sprite hneď preč (dym ho prekryje)
        if (Array.isArray(e.cell)) spawnClonePuff(e.cell);
      }
      // kozmetický tile dmg na klonovi (dmg tile klona nezabíja) - klon sa MUSÍ strhnúť a floatnúť ako pravý,
      // inak by „nezraniteľná" figúrka prezradila, ktorý je klon. Súperovi ukáž „-N HP" (bluff = ako pravý zásah),
      // vlastnému hráčovi „-N" (pravda - je to len kozmetika, HP mu neklesá).
      if (e.kind === "clone_hit" && Array.isArray(e.cell) && (e.target === "p1" || e.target === "p2")) {
        const ownerView = me === e.target;
        spawnCellFloat(e.cell, ownerView ? `-${e.dmg ?? 1}` : `-${e.dmg ?? 1} HP`, "dmg-float");
        actors.cloneFlinch[e.target] = performance.now();
      }
      if (e.kind === "mirror" && (e.target === "p1" || e.target === "p2")) {
        // odraz na KLONOVI (e.cell) vychádza z klonovej bunky, nie z pravého Naruta - inak by prezradil skutočného
        // e.destCell: útok vystrelil útočníkov klon → odraz letí DO klonovej bunky (nie do pravého útočníka)
        spawnMirrorReflect(e.target, e.dmg, e.atk, !!e.gold, Array.isArray(e.cell) ? e.cell : null,
          Array.isArray(e.destCell) ? e.destCell : null);
        if (Array.isArray(e.cell)) spawnCellFloat(e.cell, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
        else spawnFloat(e.target, "🪞 REFLECTED!", e.gold ? "mirror-reflect-text gold" : "mirror-reflect-text");
      }
      if (e.kind === "golden_shield" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to SHIELD, len zlatý - "golden shield" je interné pomenovanie
        spawnFloat(e.from, "🛡️ SHIELD", "golden-float");
        cloneFloat(e.from, "🛡️ SHIELD", "golden-float"); // klon nesmie prezradiť pravého
      }
      if (e.kind === "golden_mirror" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to MIRROR, len zlatý (predťah) - odraz padne neskôr cez mirror frame
        spawnFloat(e.from, "🪞 MIRROR", "golden-float");
        cloneFloat(e.from, "🪞 MIRROR", "golden-float");
      }
      if (e.kind === "golden_mana" && (e.from === "p1" || e.from === "p2")) {
        // rovnaký efekt ako bežná mana (recharge), len v zlatej farbe
        spawnManaFloat(e.from, e.gained ?? 6, true);
        spawnChargeAura(e.from, true);
        spawnChargeAura(e.from, true, false, "clone"); // zlatá aura aj na klonovi
        if (e.hpCost) spawnDamageFloat(e.from, e.hpCost); // HP cena golden many ostáva viditeľná
      }
      // Last Stand - FRAME-DRIVEN: každá fáza je efekt vo svojom frame; WAAPI trvanie = frameHold (= delayMs),
      // takže to v pozadí pauzne/dobehne rovnako ako timeline. HP sa hýbe zo snapshotov (drain/rise), nie lokálne.
      // Démon útok (buffnutý hráč): veľký démon v strede je jediná show - postavička stojí v idle (žiadna casting póza)
      if (e.kind === "demon_summon" && (e.from === "p1" || e.from === "p2")) {
        demonCenterAppear();
      }
      if (e.kind === "demon_center_out" && (e.from === "p1" || e.from === "p2")) {
        demonCenterDisappear();
      }
      // Teleport (výmena maga) - dvojfázovo, postava fade-uje plynulo (ako démon):
      // OUT: starý mág plynulo MIZNE (1→0), IN: nový sa plynulo OBJAVUJE (0→1).
      // Explózia je v OBOCH fázach rovnako semi-transparentná (0.75), nech pôsobí konzistentne.
      if (e.kind === "teleport_out" && (e.from === "p1" || e.from === "p2")) {
        fadeActor(e.from, 1, 0, frameHold);
        playTeleportExplosion(e.from, e.char, frameHold, 0.75);
      }
      if (e.kind === "teleport_in" && (e.from === "p1" || e.from === "p2")) {
        fadeActor(e.from, 0, 1, frameHold);
        playTeleportExplosion(e.from, e.char, frameHold, 0.75);
      }
      // Last Hope: červená „hope" postava v strede → HP→1, mana→10 (HUD zo snapshotov) → zmizne, červený ultra mód ostáva
      if (e.kind === "last_hope_summon" && (e.from === "p1" || e.from === "p2")) {
        hopeCenterAppear();
        spawnChargeAura(e.from, false, true); // červená aura hneď (HUD je už v červenom móde z lastHopeBuff)
      }
      if (e.kind === "last_hope_settle" && (e.from === "p1" || e.from === "p2")) {
        hopeCenterDisappear();
        spawnChargeAura(e.from, false, true); // ďalší červený záblesk
      }
      if (e.kind === "last_stand_summon" && (e.from === "p1" || e.from === "p2")) {
        lsCenterAppear(); // démon sa vynorí v strede
      }
      if (e.kind === "last_stand_kill" && (e.from === "p1" || e.from === "p2")) {
        lsCenterDisappear(); // stredový démon zmizne (smrť/ležanie rieši st.down v raf)
      }
      if (e.kind === "last_stand_revive" && (e.from === "p1" || e.from === "p2")) {
        // démon sa objaví ZA postavou - opacity cez CSS transition (0→1); počas revive/rise hráč LEŽÍ (st.down=true),
        // takže raf sa démona nedotýka. Settle (down=false) potom v rafe plynulo stmaví na 0.25.
        lastStand.banishing = false;
        placeDeathBehind(e.from);
        deathBehind.style.filter = "drop-shadow(0 0 16px #ffd24a)";
        deathBehind.style.opacity = "1"; // CSS transition spraví plynulý nábeh z 0
      }
      if (e.kind === "last_stand_banish" && (e.from === "p1" || e.from === "p2")) {
        // zelená šípka nadíde na démon „end" bunku (krokovanie), potom prebehne banishment
        const demonEl = qBeatEls[7];
        if (demonEl) {
          qBeatEls.forEach(x => x && x.classList.remove("q-now"));
          demonEl.classList.add("q-now");
          qCursor.style.left = (demonEl.offsetLeft + demonEl.offsetWidth / 2) + "px";
          qCursor.classList.add("show");
        }
        // KROK 1: golden OFF (raf to drží cez lastStand.banishing) + zhasni bežiace aury; duch zosilnie 0.25→1 a odíde
        lastStand.banishing = true;
        lastStand.goldenSlot = null;
        hudBoxP1.classList.remove("death-golden"); hudBoxP2.classList.remove("death-golden");
        document.querySelectorAll(".charge-aura.gold").forEach(n => n.remove());
        placeDeathBehind(e.from);
        deathBehind.getAnimations().forEach(a => a.cancel());
        const a = deathBehind.animate([
          { opacity: DEATH_SEQ.behindOpacity, transform: `scale(${DEATH_SEQ.behindRatio})` },
          { opacity: 1, transform: `scale(${DEATH_SEQ.behindRatio})`, offset: .5 },
          { opacity: 0, transform: `scale(${(DEATH_SEQ.behindRatio * 0.92).toFixed(3)})` },
        ], { duration: frameHold, easing: "ease-in", fill: "forwards" });
        a.onfinish = () => { deathBehind.style.opacity = "0"; };
      }
      if (e.kind === "last_stand_banish_center" && (e.from === "p1" || e.from === "p2")) {
        lsCenterAppear(); // duch sa objaví v strede
      }
      if (e.kind === "last_stand_banish_kill" && (e.from === "p1" || e.from === "p2")) {
        lsCenterDisappear(); // smrť/ležanie rieši st.down v raf
      }
      if (e.kind === "action" && (e.from === "p1" || e.from === "p2")) {
        // THE WORLD zmrazená akcia (frozen) - len ju animuj na boarde; round-script kurzor ostáva na THE WORLD
        // (nezaráta sa do beatCounts/logu), tracker tak počas celého time-stopu stojí na akcii THE WORLD
        if (!e.frozen) {
          const logEl  = appendActionLog(e.from, e.action);
          const beatEl = highlightRoundBeat(e.from, e.action, beatCounts, playStarter); // posuň kurzor + odhal súpera
          lastActed[e.from] = { logEl, beatEl }; // ak hneď príde "invalid", prečiarkneme práve tieto
        }
      }
      // prázdny gold beat (golden shield/mirror = pos 0, golden mana = 7/8) - len posuň zelenú šípku naň
      if (e.kind === "beat_empty" && (e.from === "p1" || e.from === "p2")) {
        const pos = e.beat === "lhope" ? 9 : e.beat === "gpre" ? 0 : (e.from === playStarter) ? 7 : 8;
        qBeatEls.forEach(x => x && x.classList.remove("q-now"));
        const el = qBeatEls[pos];
        if (el) {
          el.classList.add("q-now");
          qCursor.style.left = (el.offsetLeft + el.offsetWidth / 2) + "px";
          qCursor.classList.add("show");
        }
      }
      if (e.kind === "block" && (e.target === "p1" || e.target === "p2")) {
        // block na KLONOVI (e.cell) sa ukáže na klonovej bunke - zdieľaný štít sa rozbije na oboch figúrach
        const bcell = Array.isArray(e.cell) ? e.cell : null;
        spawnShieldBlock(e.target, !!e.gold, bcell); // efektný náraz do štítu
        const bcls = e.gold ? "golden-float" : "block-float"; // zlatý text, ak blokoval golden shield
        if (bcell) spawnCellFloat(bcell, "🛡️ BLOCKED", bcls);
        else spawnFloat(e.target, "🛡️ BLOCKED", bcls);
      }
      if (e.kind === "heal" && (e.target === "p1" || e.target === "p2")) {
        // Lightning na heal dlaždici (full-heal pasívka) - „SUPER HEAL" float
        if (e.super) spawnFloat(e.target, "SUPER HEAL", "superheal-float");
        else spawnFloat(e.target, `+${e.amount ?? 1} HP`, "heal-float");
      }
      } catch (err) { console.error("effect handler zlyhal", e?.kind, err); }
    }
    for (const s of ["p1", "p2"]) {
      if (casters.has(s))       { setAnim(s, "casting", frameHold); actors.lastAttackEndAt[s] = performance.now() + frameHold; } // special: malá postava hrá svoj efektový sprite (nie úder)
      // Medúza strieľa s Attack_2 (krátky úder) - Attack_1 má vyhradený pre melee šľah
      else if (shooters.has(s)) { setAnim(s, ACTION_ANIMS[state?.[s]?.char]?.shot || "attack", frameHold); actors.lastAttackEndAt[s] = performance.now() + frameHold; }
    }

    renderGrid(state, frame.effects || []);
    positionActors(state);

    prev = frame;
    // Jotaro THE WORLD: čiastočná timeline skončila na timestop_wait - NEplánuj ďalší krok a NEspusti koncovú
    // vetvu playbacku (UI sa nesmie odomknúť). Prejdi do ts-módu; pokračovacia timeline príde druhým `state`.
    if (tsWait) { playback.playing = false; playback.tsResumePending = true; enterTimestopMode(); return; } // pokračovanie zachová beat counts
    setTimeout(step, frame.delayMs ?? 600);
  };

  if (preDelay > 0) setTimeout(() => { if (gen === playback.playGen) step(); }, preDelay); // počkaj na premenu Escanora
  else step();
}

/* ---------- Actors clear ---------- */
export function clearActors() {
  [actorP1, actorP2, cloneEls.p1, cloneEls.p2, cloneGhost].forEach(el => {
    const ctx = el.getContext("2d");
    ctx.clearRect(0, 0, el.width, el.height);
    el.style.display = "none";
    el.style.left = "0px"; el.style.top = "0px";
    el.style.transform = "translateX(0) scaleX(1)";
    el.style.opacity = "1";
    el.style.zIndex = "";
    clearTimeout(el._hideT); clearTimeout(el._fadeT); el._logCell = null; // reset sledovania klonovej pozície
  });
  actorsEl.querySelectorAll(".sprite-clone-summon").forEach(n => n.remove());
  actorsEl.querySelectorAll(".clone-puff").forEach(n => n.remove());
  actors.cloneSummonFx = [];
  actors.cloneSummonPose = { p1: null, p2: null };
  actors.cloneDead = { p1: false, p2: false };
  fxAll("resetActors"); // figúry postáv z registra fx (Jotarov stand)
  playback.tsActive = false; playback.tsJotaroSlot = null; hideWorldCenter(); // THE WORLD vizuál nesmie prežiť reset/novú hru
  youMarker.style.display = "none";
  actors.actorsInitialized = false;
}
