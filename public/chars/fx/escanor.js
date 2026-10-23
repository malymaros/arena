// public/chars/fx/escanor.js - klientská choreografia Escanora: premena (WeakIdle → Transform → Stand) pri prvom
// kole po nasadení, special = slnko (WinSun → CruelSunHold → let na cieľ → SunBurst/SunFade), stredové overlaye
// a FX škálované s Pride, HUD pride odznak + minimapka rozsahu, náhľad vo výbere (cyklenie pride) a karta
// (WeakIdle / IntroStand). Továreň dostane C = klientský scope (client.js), háčiky: public/chars/fx/index.js.

// Escanor special - vlastná riadená choreografia (NECYKLÍ). Musí časovo sedieť s ESC_SPECIAL_MS na serveri
// (server podrží zásah presne o dĺžku choreografie, aby dmg dopadol AŽ po dokončení výbuchu):
//   WinSun (raz, visí dlhšie) → CruelSunHold (raz, dohrá celá) → slnko odletí z držanej pozície na cieľ
//   → slow-mo SunBurst (počas neho blikajú všetky aktívne políčka) → [server: dmg] → SunFade.
const WINSUN_FPS = 7, WINSUN_HOLD_MS = 700;                 // fáza 1: WinSun visí dlhšie
const CRUELHOLD_ONCE_MS = Math.round(13 * 1000 / 11);       // CruelSunHold raz (13f @ 11fps) - musí dohrať pred letom
const ESC_TRAVEL_MS = 600;                                  // let slnka na cieľ
const ESC_BURST_FPS = 6, ESC_FADE_FPS = 6;                  // slow-mo výbuch
const TRANSFORM_FPS = 5, TRANSFORM_FRAMES = 17;
const TRANSFORM_MS = Math.round(TRANSFORM_FRAMES * 1000 / TRANSFORM_FPS); // ~3.4s - dramatická premena pred prvým rozohraním
// stredové overlaye (special WinSun aj melee postava) rastú s Pridom - ukotvené za NOHY:
// drawSprite kreslí frame na 95 % canvasu centrovane, takže nohy sedia ~0.95 výšky canvasu. Nohy držíme
// na mieste, kde by boli pri pride0 (centrovaný basePx canvas), rast ide len nahor a do šírky.
// top = pevný bod nôh (nezávislý od px), translateY(-95 %) je relatívny k výške elementu → nohy vždy na top.
// Pri pride0 (px == basePx) je výsledok identický s pôvodným centrovaním translate(-50%,-50%).
const ESC_CENTER_FEET = 0.95;
// karta vo výbere: bez hoveru WeakIdle loop; po nadídení IntroStand (intro raz → loop Stand)
const ESC_INTRO = { file: "IntroStand.png", frames: 22, fps: 9, loopFrom: 17 }; // musí sedieť s export_escanor.cjs
const ESC_WEAK  = { file: "WeakIdle.png", frames: 4, fps: 5, loop: true };

export default function escanorFx(C) {
  // pred premenou je idle WeakIdle; pri prvom rozohraní kola (po nasadení / swape) sa RAZ prehrá Transform,
  // odvtedy je idle Stand. transformed drží, či daný slot už premenu odohral; prevChar deteguje (re)nasadenie.
  let transformed = { p1: false, p2: false };
  const prevChar = { p1: null, p2: null };
  let specialFired = false; // celá choreografia sa spustí len raz za special (nie na každom beate)

  // FX (WinSun, melee center, letiace slnko, výbuch, charge strela) škálujú s Pridom rovnako ako telo:
  // pride0 = súčasná (autorská) veľkosť ako u ostatných postáv, rast NAD ňu (1.2^pride, pride3 ≈ 1.73×) - nikdy menšie.
  // Číta ten istý zdroj Pride ako telo (escPrideDisplay počas prehrávania kola, inak state[slot].pride).
  function fxMul(slot) {
    // držaný level ber len keď patrí Escanorovi (po swape z inej postavy drží char jej level - ignoruj)
    const held = (C.escPrideDisplay[slot] != null && C.escPrideDisplayChar[slot] === "escanor") ? C.escPrideDisplay[slot] : null;
    const pr = held != null ? held : (C.state?.[slot]?.pride || 0);
    return Math.pow(1.2, Math.max(0, Math.min(3, pr)));
  }
  function centerAnchor(el, flip) {
    const basePx = Math.round(C.TILE_H * C.SPECIAL_SCALE);
    el.style.left = "50%";
    el.style.top  = `calc(50% + ${Math.round(basePx * (ESC_CENTER_FEET - 0.5))}px)`;
    el.style.transform = `translate(-50%, -${ESC_CENTER_FEET * 100}%) scaleX(${flip})`;
  }

  // slow-mo výbuch (SunBurst→SunFade) na cieľovej bunke; počas SunBurst blikajú aktívne políčka (zoneCells)
  function spawnSunFxAt(cell, slot, zoneCells) {
    if (!Array.isArray(cell)) return;
    const dir = C.charDirFor("escanor", slot);
    const { left, top } = C.cellToPx(cell[0], cell[1]);
    const size = Math.round(C.TILE_H * 1.8 * fxMul(slot)); // škáluje s Pridom (pride3 = súčasná veľkosť)
    const el = document.createElement("canvas");
    el.width = size; el.height = size; el.className = "sun-fx";
    Object.assign(el.style, { position: "absolute", left: (left + C.TILE_W/2 - size/2) + "px", top: (top + C.TILE_H/2 - size/2) + "px", pointerEvents: "none", zIndex: 7, imageRendering: "pixelated" });
    C.actorsEl.appendChild(el);
    const cellEls = (zoneCells || []).map(([x, y]) => C.gridEl.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)).filter(Boolean);
    cellEls.forEach(c => c.classList.add("esc-burst-cell")); // blik aktívnych políčok počas výbuchu
    const ctx = el.getContext("2d"); ctx.imageSmoothingEnabled = false;
    Promise.all([C.ensureSpriteMeta(dir, "SunBurst.png"), C.ensureSpriteMeta(dir, "SunFade.png")]).then(([bm, fm]) => {
      const bDur = bm.frames * 1000 / ESC_BURST_FPS, fDur = fm.frames * 1000 / ESC_FADE_FPS, t0 = performance.now();
      const step = () => {
        if (!el.isConnected) return;
        const t = performance.now() - t0;
        if (t < bDur)             { C.drawSprite(ctx, bm, { file: "SunBurst.png", frames: bm.frames, frameIndex: Math.min(bm.frames-1, Math.floor(t/1000*ESC_BURST_FPS)) }, 0, size, size); requestAnimationFrame(step); }
        else if (t < bDur + fDur) { cellEls.forEach(c => c.classList.remove("esc-burst-cell")); C.drawSprite(ctx, fm, { file: "SunFade.png", frames: fm.frames, frameIndex: Math.min(fm.frames-1, Math.floor((t-bDur)/1000*ESC_FADE_FPS)) }, 0, size, size); requestAnimationFrame(step); }
        else { cellEls.forEach(c => c.classList.remove("esc-burst-cell")); el.remove(); }
      };
      requestAnimationFrame(step);
    }).catch(() => { cellEls.forEach(c => c.classList.remove("esc-burst-cell")); el.remove(); });
  }
  // veľký stredový sprite (WinSun) sa prehrá RAZ a chvíľu visí, potom onDone
  // flip = smer hodu (left -1 / right 1) - veľký sprite sa otočí na smer útoku, nie k súperovi
  function spawnBigOnce(file, slot, flip, onDone) {
    const dir = C.charDirFor("escanor", slot);
    const px = Math.round(C.TILE_H * C.SPECIAL_SCALE * fxMul(slot)); // WinSun škáluje s Pridom (pride3 = súčasná veľkosť)
    const cvs = document.createElement("canvas");
    cvs.width = px; cvs.height = px; cvs.className = "esc-big"; // VLASTNÁ trieda - NIE .special-center (updateSpecialCenter ju maže každý frame)
    if (C.usesAltColor("escanor", slot)) cvs.classList.add("alt-color");
    Object.assign(cvs.style, { position: "absolute", zIndex: 8, pointerEvents: "none", imageRendering: "pixelated" });
    centerAnchor(cvs, flip); // rastie s Pridom → nohy fixné, rast nahor
    C.actorsEl.appendChild(cvs);
    const ctx = cvs.getContext("2d"); ctx.imageSmoothingEnabled = false;
    C.ensureSpriteMeta(dir, file).then(meta => {
      const dur = meta.frames * 1000 / WINSUN_FPS, t0 = performance.now();
      const step = () => {
        if (!cvs.isConnected) return;
        const t = performance.now() - t0;
        C.drawSprite(ctx, meta, { file, frames: meta.frames, frameIndex: Math.min(meta.frames - 1, Math.floor(t / 1000 * WINSUN_FPS)) }, 0, px, px);
        if (t < dur + WINSUN_HOLD_MS) requestAnimationFrame(step);
        else { cvs.remove(); onDone && onDone(); }
      };
      requestAnimationFrame(step);
    }).catch(() => { cvs.remove(); onDone && onDone(); });
  }
  // slnko odletí Z DRŽANEJ POZÍCIE (nad postavou) do stredu cieľovej bunky, potom slow-mo SunBurst→SunFade;
  // offboard hod: cieľ je bunka MIMO plochy - slnko počas letu vyhasína, žiadny burst, nad casterom OUT OF BOUNDS
  function travelSunThenBurst(slot, target, zoneCells, offboard = false) {
    const c = C.state?.[slot]; if (!c) { if (!offboard) spawnSunFxAt(target, slot, zoneCells); return; }
    const dir = C.charDirFor("escanor", slot);
    const s = C.cellToPx(c.x, c.y), e = C.cellToPx(target[0], target[1]);
    const size = Math.round(C.TILE_H * 1.25 * fxMul(slot)); // letiace slnko škáluje s Pridom (pride3 = súčasná veľkosť)
    const sx = s.left + C.TILE_W / 2 - size / 2, sy = s.top - size * 0.55; // nad hlavou = kde postava drží slnko
    const ex = e.left + C.TILE_W / 2 - size / 2, ey = e.top + C.TILE_H / 2 - size / 2;
    const el = document.createElement("canvas"); el.width = size; el.height = size; el.className = "sun-fx";
    Object.assign(el.style, { position: "absolute", left: sx + "px", top: sy + "px", zIndex: 7, pointerEvents: "none", imageRendering: "pixelated", transition: `left ${ESC_TRAVEL_MS}ms ease-in, top ${ESC_TRAVEL_MS}ms ease-in, opacity ${ESC_TRAVEL_MS}ms ease-in` });
    C.actorsEl.appendChild(el);
    const ctx = el.getContext("2d"); ctx.imageSmoothingEnabled = false;
    let alive = true;
    const spin = () => { if (!alive || !el.isConnected) return; C.ensureSpriteMeta(dir, "Charge.png").then(m => { C.drawSprite(ctx, m, { file: "Charge.png", frames: m.frames, frameIndex: Math.floor(performance.now() / 1000 * 12) % m.frames }, 0, size, size); }); requestAnimationFrame(spin); };
    requestAnimationFrame(spin);
    void el.offsetWidth; // commitni štartovú pozíciu, aby CSS transition animoval pohyb (inak skočí/preblikne bez pohybu)
    el.style.left = ex + "px"; el.style.top = ey + "px"; // sklz na cieľ
    if (offboard) el.style.opacity = "0"; // let do autu = slnko cestou vyhasne
    setTimeout(() => {
      alive = false; el.remove();
      if (offboard) { const [msg, cls] = C.INVALID_MSG.offboard; C.spawnFloat(slot, msg, cls); }
      else spawnSunFxAt(target, slot, zoneCells);
    }, ESC_TRAVEL_MS);
  }
  function runSpecial(slot, dir, zoneCells, offboard = false) {
    const c = C.state?.[slot]; if (!c) return;
    const dx = dir === "left" ? -1 : 1;
    // offboard: cieľ NEclampovať - slnko letí na bunku za okrajom (do autu); inak clamp na plochu
    const target = offboard ? [c.x + dx, c.y] : [Math.max(0, Math.min(C.board.w - 1, c.x + dx)), c.y];
    // fáza 1: malá postava WinSunBoard (zdvih so slnkom RAZ, potom len ústa + preblikávajúce slnko - loopFrom 4)
    // + veľký WinSun raz (visí dlhšie)
    C.setAnim(slot, "winsun", 60000);
    // malá postava pozerá na smer hodu počas CELEJ choreografie (aj let slnka)
    const total = 1e4;
    C.facingOverride[slot] = { sx: dx, until: performance.now() + total };
    spawnBigOnce("WinSun.png", slot, dx, () => {
      // fáza 2: malá postava CruelSunHold - nech DOHRÁ CELÁ (raz) pred letom slnka (nech nie sú dve slnká naraz)
      C.setAnim(slot, "cruelhold", CRUELHOLD_ONCE_MS);
      setTimeout(() => {
        C.setAnim(slot, "wintalk", ESC_TRAVEL_MS + 2000); // ústa bez slnka (žiadny nový zdvih) - slnko už letí samo
        travelSunThenBurst(slot, target, zoneCells, offboard);
        C.facingOverride[slot] = { sx: dx, until: performance.now() + ESC_TRAVEL_MS + C.POSE_TAIL_MS };
      }, CRUELHOLD_ONCE_MS);
    });
  }

  // HUD: pride level (ikona+číslo) vľavo, rozsah abilitky pri aktuálnom pride (minimapka) vpravo v HUD widgete.
  // Smer zóny = kam Escanor pozerá (na súpera). Pri inej postave sa oba prvky skryjú.
  const prideBadge = { p1: document.getElementById("pride-p1"), p2: document.getElementById("pride-p2") };
  const prideRange = { p1: document.getElementById("prange-p1"), p2: document.getElementById("prange-p2") };
  const zoneSet = (x, y, pride, dir) =>
    new Set(C.cellsForSpecialPreview({ x, y, char: "escanor", pride }, dir).map(([cx, cy]) => `${cx},${cy}`));
  function hud(slot, p) {
    const badge = prideBadge[slot], range = prideRange[slot];
    if (!badge || !range) return;
    if (!p || p.char !== "escanor") { badge.classList.add("hidden"); range.classList.add("hidden"); return; }
    const pride = Math.max(0, Math.min(3, p.pride || 0));
    const numEl = badge.querySelector(".pride-num");
    if (numEl) numEl.textContent = pride;
    // lev = indikátor levelu: swap framu (0=biely … 3=celý zlatý); pri 3 pulzuje (max)
    const imgEl = badge.querySelector("img");
    if (imgEl && !imgEl.getAttribute("src").endsWith("_" + pride + ".png")) imgEl.src = "/assets/pride_lion_" + pride + ".png";
    badge.classList.toggle("pride-max", pride >= 3);
    badge.classList.remove("hidden");
    // rozsah zóny na minimapke (aktuálna pozícia + pride + smer k súperovi)
    if (p.x == null) { range.classList.add("hidden"); return; } // labyrint: skrytá pozícia
    const facing = C.computeFacing(C.state?.p1, C.state?.p2)[slot] || 1;
    const dir = facing < 0 ? "left" : "right";
    const hit = zoneSet(p.x, p.y, pride, dir);
    const board = C.board;
    range.style.gridTemplateColumns = `repeat(${board.w}, auto)`;
    range.innerHTML = "";
    for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) {
      const c = document.createElement("div"); c.className = "pr-cell";
      if (hit.has(`${x},${y}`)) c.classList.add("hit");          // range (aj na políčku hráča)
      if (x === p.x && y === p.y) c.classList.add("caster");     // pozícia hráča = červená bodka (navrch range)
      range.appendChild(c);
    }
    range.classList.remove("hidden");
  }

  // výber postáv: pride lev + číslo pod mini-doskou (rovnaký indikátor ako HUD widget - swap framu
  // pride_lion_{0..3}.png, biely → celý zlatý; pri 3 pulz cez .pride-max) + zóna cyklí pride 0→3
  const caEl = () => document.getElementById("ca-pride");
  function syncCa(pride) {
    const el = caEl(); if (!el) return;
    const numEl = el.querySelector(".pride-num");
    if (numEl) numEl.textContent = pride;
    const img = el.querySelector("img");
    if (img && !img.getAttribute("src").endsWith("_" + pride + ".png")) img.src = "/assets/pride_lion_" + pride + ".png";
    el.classList.toggle("pride-max", pride >= 3);
  }
  function preview({ grid, caster, dir }) {
    const s = { pride: 0, last: 0 };
    const frame = (now) => {
      if (!s.last) s.last = now;
      if (now - s.last >= 1500) { s.last = now; s.pride = (s.pride + 1) % 4; syncCa(s.pride); } // ~1.5s na level (pomalšie, nech sa dá zóna prečítať)
      const hit = zoneSet(caster.x, caster.y, s.pride, dir);
      grid.querySelectorAll(".mini-cell").forEach(c => {
        if (c.classList.contains("caster")) return;
        const on = hit.has(`${c.dataset.gx},${c.dataset.gy}`);
        // SYNCHRÓNNY pulz: fáza animácie sa kotví na globálne hodiny (záporný animation-delay = -(now mod 1s)),
        // inak bunky pridané pri rôznych pride leveloch blikajú každá vo vlastnej fáze. Delay sa nastavuje len
        // pri PRIDANÍ triedy - zmena delay na bežiacej animácii by ju reštartovala každý frame.
        if (on && !c.classList.contains("hit")) {
          c.style.animationDelay = -(now % 1000) + "ms"; // mini-hit-pulse má 1s cyklus
          c.classList.add("hit");
        } else if (!on) c.classList.remove("hit");
      });
    };
    caEl()?.classList.remove("hidden");
    syncCa(0);
    frame(performance.now()); // zóna pride 0 hneď (nie až v ďalšom raf)
    return { frame, close: () => caEl()?.classList.add("hidden") };
  }

  let hoverT0 = 0; // čas nadídenia na kartu (štart IntroStand)

  return {
    // special má vlastnú necyklenú choreografiu (runSpecial) - žiadny generický looping stred ani casting póza
    ownCenter: ["special"],
    hud,
    preview,
    previewZone: true, // zónu náhľadu kreslí preview (cyklí s pride)

    // začiatok prehrávania kola: zruš zvyšky choreografie a RAZ prehraj premenu (WeakIdle→Stand) pred prvými
    // akciami; ak sú dvaja Escanori, paralelne. Timeline sa o dĺžku premeny oneskorí (len prvé kolo po nasadení).
    roundIntro() {
      specialFired = false; // choreografia specialu sa spustí max raz za kolo
      C.actorsEl.querySelectorAll(".sun-fx, .esc-big").forEach(n => n.remove());
      let delay = 0;
      for (const slot of ["p1", "p2"]) {
        if (C.state[slot]?.char === "escanor" && !transformed[slot]) {
          C.setAnim(slot, "transform", TRANSFORM_MS); // Transform má fromStart - kreslí sa relatívnym časom od setAnim
          const sl = slot;
          setTimeout(() => { transformed[sl] = true; }, TRANSFORM_MS);
          delay = TRANSFORM_MS;
        }
      }
      return delay;
    },

    effect(e) {
      // special fáza 2: po caste (WinSun+Win) malá postava prejde na CruelSunHold a na cieľovej bunke
      // (políčko pred Escanorom v zvolenom smere) sa prehrá SunBurst→SunFade. Spustí sa RAZ za special.
      if (e.kind === "special" && !specialFired) {
        specialFired = true;
        // offboard = hod do autu: slnko odletí von z plochy a vyhasne (bez burstu), OUT OF BOUNDS float
        runSpecial(e.from, e.dir, e.cells, !!e.offboard); // WinSun (raz) → CruelSunHold → slnko na cieľ → SunBurst (blik políčok) → dmg → SunFade
      }
    },

    // pred premenou (idle) hraj slabú formu WeakIdle (premenu Transform a výhru WinSunBoard riešia anims/victoryAnim)
    boardAnim({ slot, aSt, stoned, lyingDead, anim }) {
      if (!stoned && !lyingDead && !transformed[slot] && aSt.key === "idle") return C.ANIM_DEF.weakidle;
      return anim;
    },

    // keď sa na slote OBJAVÍ (nasadenie na začiatku hry alebo turnajový swap), resetuj premenu - nech sa pri
    // najbližšom rozohraní kola prehrá WeakIdle→Transform→Stand znova (nie mid-hra, char sa medzi kolami nemení)
    stateChar(slot, c, s) {
      if (c === "escanor" && prevChar[slot] !== "escanor") {
        // prevChar === null = čerstvo načítaná stránka (Ctrl+F5) ALEBO nasadenie na začiatku hry (medzi hrami
        // sa char maže na null → char-select). Uprostred hry (turn>1) je Escanor už premenený → ukáž silnú
        // formu (Stand, škálovaný podľa pride), NIE weak. Inak (nová hra) sa premena WeakIdle→Transform→Stand hrá.
        const fromReload = prevChar[slot] === null;
        // SWAP = char sa v rozohranej hre zmenil z INEJ živej postavy (nie null) na Escanora - vtedy premenu
        // preskoč (Stand, pride 0 hneď), nech nekoliduje so swap animáciou. GAME START (fromReload) si premenu
        // ponecháva aj v turnaji.
        const fromSwap = prevChar[slot] !== null; // (swap je len v turnaji; medzi hrami je char null)
        transformed[slot] = fromSwap || (fromReload && (s.turn || 1) > 1);
      }
      prevChar[slot] = c;
    },

    // stredový overlay (melee postava) rastie s Pridom - nohy fixné, rast nahor
    centerScale: (slot) => fxMul(slot),
    centerPlace(cvs, flip) { centerAnchor(cvs, flip); return true; },
    // základná strela (slnko) ostáva relatívne malá: autorská veľkosť = PRIDE 3 (strop), pri nižšom Pride
    // ešte menšia (pride0 ≈ 0.58×) - exponent posunutý o -3 oproti fxMul
    projectileScale: (slot) => fxMul(slot) * Math.pow(1.2, -3),
    // po kole sa zmenil pride → krátky float nad ním. up=true → zelený lev + ▲ (rástol), inak červený + ▼.
    levelFloat(slot, lvl, up) {
      const p = C.state?.[slot]; if (!p || p.x == null) return;
      const { left, top } = C.cellToPx(p.x, p.y);
      const el = document.createElement("div");
      el.className = "pride-float " + (up ? "up" : "down");
      el.innerHTML = `<span class="pf-lion"></span><span class="pf-arrow">${up ? "▲" : "▼"}</span>`; // solídny lev + šípka vedľa
      el.style.left = (left + C.TILE_W / 2) + "px";
      el.style.top = (top - 24) + "px";
      C.actorsEl.appendChild(el);
      setTimeout(() => el.remove(), 1700);
    },

    // karta vo výbere: bez hoveru WeakIdle loop; po nadídení IntroStand (intro raz → loop Stand)
    drawCard(ctx, cvs, now) {
      const dir = C.charDirFor("escanor", C.me); // p2 = escanor_2 (červené oblečenie)
      if (C.abilityHoverChar === "escanor") {
        if (!hoverT0) hoverT0 = now;
        const { frames, fps, loopFrom } = ESC_INTRO;
        const fi = Math.floor((now - hoverT0) / 1000 * fps);
        const idx = fi < frames ? fi : loopFrom + ((fi - frames) % (frames - loopFrom));
        C.ensureSpriteMeta(dir, ESC_INTRO.file)
          .then(meta => C.drawSprite(ctx, meta, { file: ESC_INTRO.file, frames, frameIndex: idx }, now, cvs.width, cvs.height, 1.31, 0.98, true, 0, -52))
          .catch(() => {});
      } else {
        hoverT0 = 0;
        C.ensureSpriteMeta(dir, ESC_WEAK.file)
          .then(meta => C.drawSprite(ctx, meta, ESC_WEAK, now, cvs.width, cvs.height, 1.31, 0.98, true, 0, -52))
          .catch(() => {});
      }
      return true;
    },
  };
}
