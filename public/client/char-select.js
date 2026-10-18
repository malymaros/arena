// public/client/char-select.js - výber postavy: karty s animovanými náhľadmi (preview loop), turnajové HP/mana/mŕtvi
// magovia vlastného tímu, turnajový draft (team_select), náhľad špeciálu pri hoveri, stránkovanie a skrytá
// stránka „Hidden" (easter egg so side-postavami, glitch efekty).
import { selEl, teamConfirmBtn, charAbilityEl, charPageTitle, charPrevBtn, charNextBtn, hiddenRune } from "/client/dom.js";
import { me, board } from "/client/session.js";
import { pixSvg, hydratePix } from "/client/pix.js";
import { charDirFor, ensureSpriteMeta, drawSprite, portraitFill, ANIM_DEF, sideCharBoundTo } from "/client/sprites.js";
import { PREVIEW_CAST, SPECIAL_ANIMS, FX_OFFSET_X, CHARS_BY_KEY, SIDE_CHARS, ABILITY_PREVIEW } from "/chars/index.js";
import { CHAR_FX } from "/client/fx-registry.js";
import { DEATH_DIR, DEATH_ANIM } from "/client/demon-sprites.js";
import { SPECIAL_FPS } from "/chars/common.js";
import { socket } from "/client/net.js";
import { sfx } from "/client/sound.js";
import { cellsForSpecialPreview } from "/client/zones.js";

/* ---------- Char select (preview) ---------- */
export let abilityHoverChar = null;     // mág, ktorého špeciál práve vizualizujeme vo výbere (hover)
let abilityFx = null;            // náhľad specialu z registra fx (preview → { frame, close }; Luffy: cyklenie módu base↔gear3)
let abilityCasterCanvas = null;  // malý canvas v bunke castera mini-dosky (cyklický cast)
// preview loop
let charPreviewRaf = 0;
// tournament: HP magov vlastného draftnutého tímu pre char-select; null mimo tournamentu
let charSelectHp = null;
let charSelectMana = null; // tournament: prenesená mana magov (per vlastný tím)
// turnajový draft (fáza team_select): lokálne rozpracovaný výber tímu v poradí klikov; potvrdí choose_team
let teamPick = [];
const TEAM_SIZE = 3; // musí sedieť so serverovým TEAM_SIZE
// tournament: zobraz HP a prenesenú manu každého maga vlastnej trojice + označ mŕtvych (karta dead + neklikateľná)
export function updateCharSelectHp(s) {
  charSelectHp = (s && s.mageHp) ? s.mageHp : null;
  charSelectMana = (s && s.mageMana) ? s.mageMana : null;
  // tournament: char-select ukazuje LEN draftnutý tím - roster-mode zlúči obe stránky (display:contents)
  // a skryje karty mimo tímu + placeholder; kľúče mageHp = presne vlastný tím
  selEl.classList.toggle("no-paging", !!charSelectHp);
  selEl.classList.toggle("roster-mode", !!charSelectHp);
  if (charSelectHp && (charPage !== 0 || hiddenMode)) setCharPage(0); // roster-mode zatvára aj easter-egg stránku
  // setCharPage sa pri otvorení na stránke 0 nevolá - nadpis drž v synce s režimom aj tu;
  // na Hidden stránke cez setHiddenTitle (textContent by zmazal per-písmenové spany neónu)
  const titleEl = document.getElementById("char-page-title");
  if (titleEl) {
    if (hiddenMode && !charSelectHp) setHiddenTitle();
    else titleEl.textContent = charSelectHp ? "Your Team" : CHAR_PAGES[charPage].title;
  }
  // poradie kariet = poradie draftu (rovnako ako hlavy v HUD - state.roster); stránky sú zlúčené
  // cez display:contents, takže karty sú flex itemy pageru a stačí im nastaviť `order` (1..N)
  const draftOrder = charSelectHp ? (s?.roster?.[me] || Object.keys(charSelectHp)) : null;
  selEl.querySelectorAll(".char-card").forEach((card) => {
    const key = card.dataset.char;
    if (!key) return; // placeholder "Coming soon" - žiadne HP/dead spracovanie
    card.classList.toggle("off-roster", !!charSelectHp && !(key in charSelectHp));
    const orderIdx = draftOrder ? draftOrder.indexOf(key) : -1;
    card.style.order = orderIdx >= 0 ? String(orderIdx + 1) : "";
    const statsEl = card.querySelector(".char-stats");
    const hpEl = card.querySelector(".char-hp");
    const manaEl = card.querySelector(".char-mana");
    if (!charSelectHp) { // single / bo3 - žiadne HP/mana, žiadny dead stav
      card.classList.remove("dead");
      if (statsEl) statsEl.classList.add("hidden");
      return;
    }
    const hp = charSelectHp[key] ?? 0;
    const dead = hp <= 0;
    card.classList.toggle("dead", dead);
    if (statsEl) {
      // mŕtvy mág: žiadne staty (len démon + dead póza); živý: HP (srdiečko) + prenesená mana (kvapka)
      statsEl.classList.toggle("hidden", dead);
      if (!dead) {
        // rovnaké rozloženie ako hráčske widgety v HUD: ikona → číslo (srdiečko #, kvapka #)
        const mana = charSelectMana?.[key] ?? 0;
        if (hpEl) hpEl.innerHTML = `${pixSvg("heart")}<span>${hp}</span>`;
        if (manaEl) manaEl.innerHTML = `${pixSvg("drop")}<span>${mana}</span>`;
      }
    }
  });
  syncRosterGlitch(); // Your Team: rozbehni/zastav glitch mena side-postavy (Countess/Onre)
}

function isMageDead(key) {
  return !!charSelectHp && (charSelectHp[key] ?? 0) <= 0;
}

// Hidden preview postavy (Luffy/Jotaro, previewCast v registri): bez hoveru Idle, po nadídení cast animácia
// RAZ a potom slučka chvosta (loopFrom); obe kreslenia idú cez portraitFill.
const previewHoverT0 = {}; // per-postava čas nadídenia (štart cast animácie)
// offsetY −39 (mágovia −52): ich pásy sú bottom-anchored s malým PAD, mágovia majú vo frame
// väčší spodný okraj - s −52 stáli o ~13 px vyššie; −39 dorovnáva nohy na úroveň mágov (~189 px)
const PREVIEW_OFF_Y = -39;
function drawPreviewCard(ctx, cvs, key, now) {
  const dir = charDirFor(key, me);
  const cast = PREVIEW_CAST[key];
  if (abilityHoverChar === key) {
    if (!previewHoverT0[key]) previewHoverT0[key] = now;
    const fi = Math.floor((now - previewHoverT0[key]) / 1000 * cast.fps);
    const idx = fi < cast.frames ? fi : cast.loopFrom + ((fi - cast.frames) % (cast.frames - cast.loopFrom));
    ensureSpriteMeta(dir, cast.file)
      .then(meta => drawSprite(ctx, meta, { file: cast.file, frames: cast.frames, frameIndex: idx }, now, cvs.width, cvs.height, portraitFill(key, cast.fill), 0.98, true, 0, PREVIEW_OFF_Y))
      .catch(() => {});
  } else {
    previewHoverT0[key] = 0;
    ensureSpriteMeta(dir, ANIM_DEF.idle.file)
      .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, now, cvs.width, cvs.height, portraitFill(key, 1.31), 0.98, true, 0, PREVIEW_OFF_Y))
      .catch(() => {});
  }
}

function drawCharSelectFrame(now) {
  const canvases = selEl.querySelectorAll("canvas.char-canvas");
  canvases.forEach((cvs) => {
    const key = cvs.dataset.char;
    const ctx = cvs.getContext("2d");
    if (CHAR_FX[key]?.drawCard?.(ctx, cvs, now)) return; // register fx (Escanor: vlastné WeakIdle/IntroStand)
    const deadRoster = isMageDead(key) && cvs.closest(".char-card")?.dataset.char; // (turnaj) mŕtvy draftnutý mág
    // Preview štýl (Luffy/Jotaro) - ALE ak je draftnutý mág mŕtvy (turnaj), prednosť má dead póza (nižšie)
    if (PREVIEW_CAST[key] && !deadRoster) { drawPreviewCard(ctx, cvs, key, now); return; }
    const dir = charDirFor(key, me); // hráč vpravo vidí Medúzu v natívnej tmavej palete (Medusa2)
    if (!dir) return;
    // mŕtvy mág (tournament): dead póza mága + death démon prekrytý cez okno karty
    // (len skutočné hrateľné karty - preview karty Hidden stránky nemajú data-char na karte a roster stav)
    if (deadRoster) {
      ensureSpriteMeta(dir, ANIM_DEF.dead.file)
        .then(meta => {
          drawSprite(ctx, meta, ANIM_DEF.dead, now, cvs.width, cvs.height, 1.31, 0.98, true, 0, -52);
          return ensureSpriteMeta(DEATH_DIR, DEATH_ANIM.file);
        })
        .then(meta => {
          if (!meta) return;
          ctx.save();
          ctx.globalAlpha = 0.5; // semi-transparentný démon - dead póza mága ostáva dobre vidno pod ním
          drawSprite(ctx, meta, DEATH_ANIM, now, cvs.width, cvs.height, 1.15, 0.5, false, 0, 0);
          ctx.restore();
        })
        .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
      return;
    }
    // mág, ktorého abilitku pozeráme: cyklicky prehráva animáciu SPECIÁLU (efektový sprite, rovnako ako v hre),
    // v rovnakej veľkosti ako idle (centrovaný, nie zoomnutý)
    const fx = (key === abilityHoverChar) && SPECIAL_ANIMS[key];
    const anim = fx ? { file: SPECIAL_ANIMS[key].file, fps: SPECIAL_FPS, loop: true } : ANIM_DEF.idle;
    // lightning efekt má obsah posunutý vľavo vo frame -> dorovnaj doprava
    const offX = fx ? (FX_OFFSET_X[key] || 0) * cvs.width : 0;
    // canvas vypĺňa celú kartu; sprite väčší, mierne zdvihnutý hore (offsetY), orez je až na ráme karty;
    // Medúza/Minotaur normalizovaní na výšku mágov (PORTRAIT_SCALE)
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height, portraitFill(key, 1.31), 0.98, true, offX, -52))
      .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
  });

  if (abilityHoverChar) abilityFx?.frame(now);                  // register fx (Luffy: cyklí mód base↔gear3 - zóna dáma/veža + dmg 4/8)

  // malý castiaci mág v bunke castera mini-dosky - animácia špeciálu (efektový sprite). Výnimka previewIdleCaster
  // (Jotaro, Luffy): casterom na mini-doske je ON (nie stredová póza), takže kreslíme jeho IDLE (ukotvený na nohy,
  // normalizovaný na výšku mágov cez portraitFill).
  const isIdle = !!CHARS_BY_KEY[abilityHoverChar]?.previewIdleCaster;
  if (abilityHoverChar && abilityCasterCanvas && (SPECIAL_ANIMS[abilityHoverChar] || isIdle)) {
    const dir = charDirFor(abilityHoverChar, me);
    const fxAnim = isIdle ? ANIM_DEF.idle : { file: SPECIAL_ANIMS[abilityHoverChar].file, fps: SPECIAL_FPS, loop: true };
    const offX = isIdle ? 0 : (FX_OFFSET_X[abilityHoverChar] || 0) * abilityCasterCanvas.width;
    const fillUse = isIdle ? portraitFill(abilityHoverChar, 1.1) : 1.1;
    const anchorUse = isIdle ? 0.95 : 0.5; // idle casteri (Jotaro/Luffy) vypĺňajú väčšinu framu → ukotvi na nohy
    if (dir) ensureSpriteMeta(dir, fxAnim.file)
      .then(meta => drawSprite(abilityCasterCanvas.getContext("2d"), meta, fxAnim, now, abilityCasterCanvas.width, abilityCasterCanvas.height, fillUse, anchorUse, true, offX))
      .catch(() => {});
  }

  if (!selEl.classList.contains("hidden")) {
    charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
  } else {
    charPreviewRaf = 0;
  }
}
export function startCharSelectPreview() {
  abilityHoverChar = null; abilityCasterCanvas = null; // bez hoveru žiadny cast; náhľad sa zobrazí až po nadídení
  document.getElementById("char-ability")?.classList.add("hidden");
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
  syncRosterGlitch(); // spusti glitch side-postavy - tu už je výber viditeľný (updateCharSelectHp beží kým je selEl ešte .hidden)
}
export function stopCharSelectPreview() {
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = 0;
  syncRosterGlitch(); // zastav glitch mena side-postavy pri zatvorení výberu (a vráť originál)
}

selEl.addEventListener("click", (e) => {
  const card = e.target.closest(".char-card");
  if (!card) return;
  const key = card.dataset.char;
  if (!key) return; // placeholder "Coming soon" nie je voliteľný
  if (selEl.classList.contains("team-mode")) { toggleTeamPick(key); return; } // draft: klik = toggle výberu
  if (isMageDead(key)) return; // mŕtveho maga (tournament) sa nedá zvoliť
  socket.emit("choose_character", key);
});

/* ---------- Turnajový draft (fáza team_select) ---------- */
// char-select v team-mode: klik na kartu prepína výber (max TEAM_SIZE), potvrdí sa tlačidlom;
// server odhalí súperov tím, až keď potvrdia obaja (dovtedy „TEAM LOCKED" čakačka #team-wait)
function toggleTeamPick(key) {
  // side-postavu smie draftnúť len jej vlastná strana (p1 → countess; p2 → onre|jotaro); druhej strany je zakázaná
  if (SIDE_CHARS[key] && !sideCharBoundTo(key, me)) return;
  const i = teamPick.indexOf(key);
  if (i >= 0) teamPick.splice(i, 1);
  else if (teamPick.length < TEAM_SIZE) teamPick.push(key);
  syncTeamUi();
}
export function syncTeamUi() {
  selEl.querySelectorAll(".char-card").forEach(card => {
    const key = card.dataset.char;
    const idx = key ? teamPick.indexOf(key) : -1;
    card.classList.toggle("picked", idx >= 0);
    card.querySelector(".pick-badge")?.remove();
    if (idx >= 0) { // poradové číslo výberu v rohu karty
      const b = document.createElement("div");
      b.className = "pick-badge";
      b.textContent = String(idx + 1);
      card.appendChild(b);
    }
  });
  if (teamConfirmBtn) {
    teamConfirmBtn.disabled = teamPick.length !== TEAM_SIZE;
    teamConfirmBtn.textContent = teamPick.length === TEAM_SIZE
      ? "CONFIRM TEAM" : `PICK YOUR TEAM (${teamPick.length}/${TEAM_SIZE})`;
  }
}
teamConfirmBtn?.addEventListener("click", () => {
  if (teamPick.length !== TEAM_SIZE) return;
  socket.emit("choose_team", [...teamPick]);
  teamConfirmBtn.disabled = true; // čakačku prepne až state so serverovým rosterReady
});

/* ---------- Náhľad špeciálu mága (hover vo výbere) ---------- */
// pozícia castera a popis náhľadu = abilityPreview postavy v registri
function renderAbilityPreview(char) {
  const def = ABILITY_PREVIEW[char];
  if (!def || !charAbilityEl) return;
  abilityHoverChar = char; // preview loop prepne tohto mága na cyklický cast špeciálu
  abilityFx?.close(); abilityFx = null;
  const w = board.w || 4, h = board.h || 3;
  // hráč vpravo (p2): náhľad zrkadlovo - caster pri pravom okraji, smerový special (Medúza) mieri doľava
  const mirror = me === "p2";
  // secret (Hidden preview): žiadny caster ani zóna - mini-doska ostáva celá prázdna
  const caster = (def.secret || !def.caster) ? { x: -1, y: -1 }
    : mirror ? { x: w - 1 - def.caster.x, y: def.caster.y } : def.caster;
  const dir = (mirror && def.dir) ? (def.dir === "right" ? "left" : "right") : def.dir;
  // Vojak: zóna = príkladová cieľová bunka z definície (zrkadlená pre p2), nie odvodená z pozície castera
  const hit = def.secret
    ? new Set()
    : def.target
      ? new Set([`${mirror ? w - 1 - def.target.x : def.target.x},${def.target.y}`])
      : CHAR_FX[char]?.previewZone
        ? new Set() // zónu kreslí náhľad z registra fx (Escanor pride, Luffy dogúľanie dáma/veža - cyklí sa)
        : new Set(cellsForSpecialPreview({ x: caster.x, y: caster.y, char }, dir).map(([x, y]) => `${x},${y}`));
  const grid = document.getElementById("ca-grid");
  grid.style.gridTemplateColumns = `repeat(${w}, auto)`;
  grid.innerHTML = "";
  abilityCasterCanvas = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = document.createElement("div");
    c.className = "mini-cell";
    c.dataset.gx = x; c.dataset.gy = y;
    if (caster.x === x && caster.y === y) {
      c.classList.add("caster");
      // malý castiaci mág priamo v bunke castera (rAF ho cyklicky kreslí)
      const mini = document.createElement("canvas");
      mini.className = "mini-caster";
      mini.width = 48; mini.height = 34;
      c.appendChild(mini);
      abilityCasterCanvas = mini;
    } else if (hit.has(`${x},${y}`)) {
      c.classList.add("hit");
      c.style.animationDelay = -(performance.now() % 1000) + "ms"; // sync fáza pulzu s neskôr pridanými bunkami
    }
    grid.appendChild(c);
  }
  // náhľad z registra fx (Escanor: cyklenie pride 0→3 + lev; vlkolak: fáza mesiaca + dmg; Luffy: mód base↔gear3 -
  // zóna dáma/veža + badge + dmg 4/8)
  abilityFx = CHAR_FX[char]?.preview?.({ grid, caster, dir }) || null;
  document.getElementById("ca-title").textContent = "SPECIAL ATTACK";
  // desc môže obsahovať herné ikony (data-pix flame/drop) a <br> → obal do JEDNÉHO divu (.ca-text je flex,
  // inak by sa každý textový kúsok/ikona stali samostatným flex-itemom a text sa rozhádže), potom hydratuj ikony
  const caTextEl = document.getElementById("ca-text");
  caTextEl.innerHTML = `<div class="ca-desc">${def.desc}</div>`;
  caTextEl.querySelectorAll(".pix-ico[data-pix]").forEach(el => { el.innerHTML = pixSvg(el.dataset.pix); });
  hydratePix(caTextEl); // prípadné [data-emoji] ikony
  const stats = document.getElementById("ca-stats");
  stats.innerHTML = def.dmg != null
    ? `<span class="ca-dmg"><span class="ca-num">${def.dmg}</span><span class="pix-ico" data-emoji="☠️"></span>${def.bonus ? `<span class="pix-ico" data-emoji="${def.bonus}"></span>` : ""}</span>` // Countess/Onre: bonus ikona (heal ❤️ / drain 💧) hneď za lebkou
    : def.effect
      ? `<span class="ca-dmg"><span class="ca-num">${def.effect.num ?? ""}</span><span class="pix-ico" data-emoji="${def.effect.emoji ?? "✨"}"></span></span>` // bez dmg - ikona efektu (kameň/labyrint)
      : ""; // ani dmg, ani effect (vlkolak - dmg cykluje pod mini-doskou) → žiadny stats riadok
  hydratePix(stats);
  charAbilityEl.classList.remove("hidden");
}
function clearAbilityPreview() {
  abilityHoverChar = null;
  abilityCasterCanvas = null;
  abilityFx?.close(); abilityFx = null;
  charAbilityEl?.classList.add("hidden");
}
let hoverVoice = null; // práve hrajúci hlas mena - ďalšia karta ho utne, nech sa mená neprekrývajú
selEl.querySelectorAll(".char-card").forEach(card => {
  // preview karty Hidden stránky (Luffy/Jotaro) nemajú data-char na karte (neklikateľné) - kľúč nesie canvas
  const key = card.dataset.char || card.querySelector("canvas.char-canvas")?.dataset.char;
  if (!key) return; // placeholder "Coming soon"
  card.addEventListener("mouseenter", () => {
    if (isMageDead(key)) return; // mŕtvy mág nemá náhľad špeciálu
    hoverVoice?.then(h => h?.stop());
    hoverVoice = sfx("ui.hover_char", { char: key });
    renderAbilityPreview(key);
  });
});
selEl.querySelectorAll(".char-cards").forEach(el => el.addEventListener("mouseleave", clearAbilityPreview));

/* ---------- Stránkovanie výberu postáv ---------- */
// str. 0 = základní magovia (Mages), str. 1 = experimentálne postavy (Experimental)
// str. 0 = nové postavy (Escanor + coming soon), str. 1 = základní magovia, str. 2 = experimentálne
const CHAR_PAGES = [{ title: "Experimental" }, { title: "Mages" }, { title: "Experimental" }];
export let charPage = 1; // default landing = Mages (Escanor stránka je vľavo cez šípku späť)
// nové otvorenie výberu - od stránky Mages (str. 1), čistý draft, bez easter-egg stránky
export function resetCharSelectOpen() { teamPick = []; charPage = 1; hiddenMode = false; }
export function setCharPage(p) {
  hiddenMode = false; selEl.classList.remove("hidden-mode"); stopHiddenFx(); // každé normálne stránkovanie opúšťa easter-egg stránku aj jej efekty
  if (selEl.classList.contains("no-paging")) p = 0; // tournament - roster-mode zlúči karty, stránkovanie je vypnuté
  charPage = Math.max(0, Math.min(CHAR_PAGES.length - 1, p));
  selEl.querySelectorAll(".char-cards").forEach(el =>
    el.classList.toggle("hidden", Number(el.dataset.page) !== charPage));
  // tournament (roster-mode): stránky sú zlúčené na vlastný tím - nadpis "Your Team" namiesto názvu stránky
  if (charPageTitle) charPageTitle.textContent = selEl.classList.contains("roster-mode") ? "Your Team" : CHAR_PAGES[charPage].title;
  // krajné šípky sú neviditeľné (visibility) - layout kariet sa pri prepnutí nehýbe
  charPrevBtn?.classList.toggle("off", charPage === 0);
  charNextBtn?.classList.toggle("off", charPage === CHAR_PAGES.length - 1);
  // tooltip šípky = názov CIEĽOVEJ stránky (nie „Back")
  if (charPrevBtn) charPrevBtn.title = charPage > 0 ? CHAR_PAGES[charPage - 1].title : "";
  if (charNextBtn) charNextBtn.title = charPage < CHAR_PAGES.length - 1 ? CHAR_PAGES[charPage + 1].title : "";
  clearAbilityPreview(); // náhľad špeciálu patrí karte z predošlej stránky
}
// na Hidden stránke je ľavá šípka vypnutá a pravá vracia na str. 0 (Hidden je „naľavo od všetkého")
charPrevBtn?.addEventListener("click", () => { if (!hiddenMode) setCharPage(charPage - 1); });
charNextBtn?.addEventListener("click", () => setCharPage(hiddenMode ? 0 : charPage + 1));

/* ---------- Easter egg: skrytá stránka „Hidden" ---------- */
// Runa v ľavom hornom rohu sa zjavuje podľa blízkosti kurzora - len keď je char-select viditeľný,
// nejde o turnajový roster-mode (tam sa stránkovanie núti na „Your Team") a Hidden ešte nie je otvorená.
// Klik spustí glitch prechod (cs-glitch) a uprostred neho prepne karty na blok data-page="hidden".
// Stránka nie je v CHAR_PAGES, takže šípky sa na ňu nedostanú a setCharPage ju vždy zatvorí.
export let hiddenMode = false;
const RUNE_RADIUS = 260; // px od ľavého horného rohu, odkiaľ sa runa začína zjavovať
let hiddenFound = false; // po prvom objavení (localStorage) ostáva runa trvalo slabo viditeľná
try { hiddenFound = localStorage.getItem("arenaHiddenFound") === "1"; } catch {}
function runeActive() {
  // turnaj: v DRAFTE (team-mode) runu PUSTÍME - side-postavu (svojej strany) si tam draftneš cez rovnaký
  // easter-egg ako v single/bo3 (ostáva „tajná"). Roster-mode (výber maga z už draftnutého tímu) ju nepustí:
  // tam sa side-karta zobrazuje priamo v zlúčenom rade kariet, runa je zbytočná a kolidovala by s ním.
  return !selEl.classList.contains("hidden") && !selEl.classList.contains("roster-mode") && !hiddenMode;
}
document.addEventListener("mousemove", (e) => {
  if (!hiddenRune) return;
  if (!runeActive()) { hiddenRune.style.opacity = "0"; hiddenRune.classList.remove("near", "lit"); return; }
  const t = Math.max(0, 1 - Math.hypot(e.clientX, e.clientY) / RUNE_RADIUS);
  // kvadratika - runa sa naplno rozsvieti až tesne pri rohu; po objavení drží slabý základ
  hiddenRune.style.opacity = String(Math.max(hiddenFound ? 0.12 : 0, t * t));
  hiddenRune.classList.toggle("near", t > 0.25);
  hiddenRune.classList.toggle("lit", t > 0.75);
});
function showHiddenPage() {
  hiddenMode = true;
  selEl.classList.add("hidden-mode");
  selEl.querySelectorAll(".char-cards").forEach(el =>
    el.classList.toggle("hidden", el.dataset.page !== "hidden"));
  startHiddenFx(); // nadpis po písmenách (dohasínajúci neón) + občasný glitch + mutujúci text kariet
  charPrevBtn?.classList.add("off");
  charNextBtn?.classList.remove("off");
  if (charNextBtn) charNextBtn.title = CHAR_PAGES[0].title; // z Hidden sa pravou šípkou vracia na str. 0
  clearAbilityPreview();
  hiddenRune?.classList.remove("near", "lit");
  if (hiddenRune) hiddenRune.style.opacity = "0";
}

/* nepravidelné efekty otvorenej Hidden stránky:
   1) nadpis „Hidden" rozbitý na spany - každé písmeno má vlastnú náhodnú fázu letter-die (pokazený neón),
   2) celý char-select občas (3,5–9 s) preblikne rovnakým cs-glitch ako pri vstupe cez runu,
   3) názvy kariet (mená postáv aj „Coming soon") sa každý tick mutujú na glitchnutý secret text (náhodné znaky).
   Všetko sa vypína cez stopHiddenFx() - volá ho setCharPage, ktorý Hidden stránku vždy zatvára. */
export const HIDDEN_GLITCH_CHARS = "#@$%&*+=/\\<>[]{}01?";
let hiddenGlitchTimer = 0, hiddenMutateTimer = 0;
function setHiddenTitle() {
  if (!charPageTitle || charPageTitle.dataset.hiddenTitle === "1") return; // spany už stoja - neresetuj im fázy
  charPageTitle.dataset.hiddenTitle = "1";
  charPageTitle.textContent = "";
  for (const ch of "Hidden") {
    const s = document.createElement("span");
    s.className = "hidden-letter";
    s.textContent = ch;
    s.style.animationDuration = (4 + Math.random() * 6).toFixed(2) + "s"; // každé písmeno zhasína vo vlastnom rytme
    s.style.animationDelay = (-Math.random() * 10).toFixed(2) + "s";
    charPageTitle.appendChild(s);
  }
}
function startHiddenFx() {
  setHiddenTitle();
  clearTimeout(hiddenGlitchTimer);
  (function tick() {
    hiddenGlitchTimer = setTimeout(() => {
      if (!hiddenMode || selEl.classList.contains("hidden")) return;
      selEl.classList.add("cs-glitch");
      setTimeout(() => selEl.classList.remove("cs-glitch"), 520); // musí sedieť s trvaním cs-glitch (.5s)
      tick();
    }, 3500 + Math.random() * 5500);
  })();
  clearInterval(hiddenMutateTimer);
  hiddenMutateTimer = setInterval(() => {
    if (!hiddenMode || selEl.classList.contains("hidden")) return;
    selEl.querySelectorAll('.char-cards[data-page="hidden"] .char-name').forEach(el => {
      // pôvodné meno karty si zapamätaj pri prvom ticku - mutuje sa vždy z originálu, nie z už zglitchnutého textu
      const base = el.dataset.baseName ?? (el.dataset.baseName = el.textContent);
      let out = "";
      for (const ch of base)
        out += (ch !== " " && Math.random() < 0.14)
          ? HIDDEN_GLITCH_CHARS[Math.floor(Math.random() * HIDDEN_GLITCH_CHARS.length)]
          : ch;
      el.textContent = out;
    });
  }, 130);
}
function stopHiddenFx() {
  clearTimeout(hiddenGlitchTimer);
  clearInterval(hiddenMutateTimer);
  if (charPageTitle) delete charPageTitle.dataset.hiddenTitle; // ďalšie otvorenie postaví spany nanovo
  selEl.querySelectorAll('.char-cards[data-page="hidden"] .char-name').forEach(el => {
    if (el.dataset.baseName != null) el.textContent = el.dataset.baseName; // vráť originálne meno karty
  });
}
/* „Your Team" (roster-mode): karta side-postavy (Countess/Onre) glitchuje rovnako ako Hidden screen -
   mutuje písmená mena z originálu na náhodné glitch znaky a občas glitchne aj štvorček (canvas).
   V drafte cez runu to už rieši hiddenMutateTimer; tu je paralelný ticker pre roster-mode.
   Kartu cieli podľa členstva v charSelectHp (vlastný tím) - nezávisle na off-roster/display triedach,
   aby glitchol OBE postavy rovnako (p1 Vampire aj p2 Onryō). Zdieľa dataset.baseName s hidden fx. */
let rosterGlitchTimer = 0;
function rosterGlitchCards() {
  // v „Your Team" (roster-mode) vezmi OBE hidden-char karty (Countess aj Onre) - len jedna je reálne
  // viditeľná (druhú stranu skrýva data-side:none, nedraftnutú off-roster:none), tá neviditeľná sa mutuje
  // neškodne mimo obraz. Žiadna závislosť na off-roster/charSelectHp/layout → glitchne vždy tú viditeľnú.
  if (!selEl.classList.contains("roster-mode") || hiddenMode || selEl.classList.contains("hidden")) return [];
  return [...selEl.querySelectorAll(".char-card.hidden-char:not(.preview-char)")]; // preview karty (Luffy/Jotaro) sa nedraftujú → neglitchujú
}
function syncRosterGlitch() {
  const cards = rosterGlitchCards();
  if (cards.length && !rosterGlitchTimer) {
    rosterGlitchTimer = setInterval(() => {
      const live = rosterGlitchCards();
      if (!live.length) { clearInterval(rosterGlitchTimer); rosterGlitchTimer = 0; return; }
      live.forEach(card => {
        const el = card.querySelector(".char-name");
        if (el) {
          const base = el.dataset.baseName ?? (el.dataset.baseName = el.textContent);
          let out = "";
          for (const ch of base)
            out += (ch !== " " && Math.random() < 0.14)
              ? HIDDEN_GLITCH_CHARS[Math.floor(Math.random() * HIDDEN_GLITCH_CHARS.length)]
              : ch;
          el.textContent = out;
        }
        card.classList.toggle("glitch-flash", Math.random() < 0.16); // občasný glitch štvorčeka (canvas)
      });
    }, 130);
  } else if (!cards.length && rosterGlitchTimer) {
    clearInterval(rosterGlitchTimer); rosterGlitchTimer = 0;
    selEl.querySelectorAll(".char-card.hidden-char").forEach(card => {
      card.classList.remove("glitch-flash");
      const el = card.querySelector(".char-name");
      if (el && el.dataset.baseName != null) el.textContent = el.dataset.baseName; // vráť originálne meno
    });
  }
}
hiddenRune?.addEventListener("click", () => {
  if (!runeActive()) return;
  if (!hiddenFound) { hiddenFound = true; try { localStorage.setItem("arenaHiddenFound", "1"); } catch {} }
  selEl.classList.add("cs-glitch");
  setTimeout(showHiddenPage, 240); // prepnutie v strede glitchu - musí sedieť s trvaním cs-glitch (.5s)
  setTimeout(() => selEl.classList.remove("cs-glitch"), 520);
});
