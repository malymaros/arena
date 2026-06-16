// public/client.js
const socket = io();

const gridEl   = document.getElementById("grid");
const actorsEl = document.getElementById("actors");
const actorP1  = document.getElementById("actor-p1");
const actorP2  = document.getElementById("actor-p2");

const queueEl  = document.getElementById("queue");
const undoBtn  = document.getElementById("undo");
const lockBtn  = document.getElementById("lock");

const selEl    = document.getElementById("char-select");
const arenaEl  = document.getElementById("arena");

const hudTurn  = document.getElementById("hud-turn");
const hudBoxP1 = document.getElementById("hud-p1");
const hudBoxP2 = document.getElementById("hud-p2");
const hudP1Hp   = document.getElementById("p1-hp");
const hudP1Mana = document.getElementById("p1-mana");
const hudP2Hp   = document.getElementById("p2-hp");
const hudP2Mana = document.getElementById("p2-mana");
const hudCharP1 = document.getElementById("hud-char-p1");
const hudCharP2 = document.getElementById("hud-char-p2");
const flagP1    = document.getElementById("flag-p1");
const flagP2    = document.getElementById("flag-p2");
const logP1     = document.getElementById("log-p1");
const logP2     = document.getElementById("log-p2");

const goOverlay= document.getElementById("gameover");
const retryBtn = document.getElementById("retry");

const lobbyEl     = document.getElementById("lobby");
const lobbyWaitEl = document.getElementById("lobby-wait");
const intermissionEl = document.getElementById("intermission");
const crownsP1El = document.getElementById("crowns-p1");
const crownsP2El = document.getElementById("crowns-p2");
const turnTimerEl    = document.getElementById("turn-timer");

const cs = getComputedStyle(document.documentElement);
const TILE_W = parseInt(cs.getPropertyValue("--tile-w")) || 260;
const TILE_H = parseInt(cs.getPropertyValue("--tile-h")) || 185;
const GAP  = parseInt(getComputedStyle(gridEl).gap || "10") || 10;

// canvasy postáv — väčšie než bunka (1.5×), v positionActors centrované na bunku
const ACTOR_SCALE = 1.875;
const ACTOR_W = Math.round(TILE_W * ACTOR_SCALE);
const ACTOR_H = Math.round(TILE_H * ACTOR_SCALE);
[actorP1, actorP2].forEach(c => {
  c.width = ACTOR_W; c.height = ACTOR_H;
  c.style.width = ACTOR_W + "px"; c.style.height = ACTOR_H + "px";
});

// ghost — poloprehľadný náhľad vlastnej pozície po naplánovaných movoch vo fronte
const actorGhost = document.createElement("canvas");
actorGhost.id = "actor-ghost";
actorGhost.className = "sprite-actor sprite-ghost";
actorGhost.width = ACTOR_W; actorGhost.height = ACTOR_H;
actorGhost.style.width = ACTOR_W + "px"; actorGhost.style.height = ACTOR_H + "px";
actorGhost.style.display = "none";
actorsEl.appendChild(actorGhost);

// === Timing ===
const MOVE_MS = 700; // musí sedieť s CSS transition left/top na .sprite-actor
const ATTACK_SWING_MS = 1600;
const HURT_MS = 1600;

// Projektil
const CHARGE_SCALE = 1.0;
const CHARGE_ANIM  = { file: "Charge.png", fps: 8, loop: true };

// Special anim
const SPECIAL_SCALE = 4.8;
const SPECIAL_FPS   = 6;
const SPECIAL_ANIMS = {
  fire:      { file: "Flame_jet.png",    fps: SPECIAL_FPS, loop: true },
  lightning: { file: "Light_charge.png", fps: SPECIAL_FPS, loop: true },
  wanderer:  { file: "Magic_sphere.png", fps: SPECIAL_FPS, loop: true },
};
// niektoré efektové sprity majú obsah mimo stredu framu — vodorovná korekcia (zlomok šírky canvasu) v náhľade
const FX_OFFSET_X = { lightning: 0.18 };

const CHAR_META = {
  fire:      { name: "Fire Wizard",      dir: "fire" },
  lightning: { name: "Lightning Mage",   dir: "lightning" },
  wanderer:  { name: "Wanderer Magician",dir: "wanderer" }
};
const ANIM_DEF = {
  idle:    { file: "Idle.png",     fps: 6,  loop: true  },
  run:     { file: "Run.png",      fps: 12, loop: true  },
  attack:  { file: "Attack_1.png", fps: 10, loop: false },
  attack2: { file: "Attack_2.png", fps: 10, loop: false },
  hurt:    { file: "Hurt.png",     fps: 10, loop: false },
  dead:    { file: "Dead.png",     fps: 7,  loop: false },
  victory: { file: "Idle.png", fps: 6, loop: true } // placeholder — raf pre victory kreslí special sprite mága (SPECIAL_ANIMS)
};

let me = null;
let isHost = false;               // prvý pripojený hráč nastavuje zápas v lobby
let serverGameResult = null;      // výsledok poslednej dohranej hry (séria) — vyhodnotí sa na konci timeline
let board = { w: 4, h: 3 };
let state = { p1:null, p2:null, arena:null, turn:1, starter:"p1", phase:"lobby" };
let myQueue = [];
let goldenArmed = false;     // objednaný golden shield (extra akcia pred kolom, len keď som druhý)
let goldenManaArmed = false; // objednaný golden mana refill (extra akcia po konci kola)
let chosenChar = null;
let abilityHoverChar = null;     // mág, ktorého špeciál práve vizualizujeme vo výbere (hover)
let abilityCasterCanvas = null;  // malý canvas v bunke castera mini-dosky (cyklický cast)

// počas special castu skryjeme bežný actor sprite
let castingNow = { p1:false, p2:false };

let animState = { p1: { key:"idle", until:0 }, p2: { key:"idle", until:0 } };
const SPRITES = {};
let actorsInitialized = false;

// --- nový game-over manažment na klientovi
let serverWinner = null;          // koho ohlásil server
let gameOverShown = false;        // či už bolo zobrazené GO
let lastAttackEndAt = { p1:0, p2:0 }; // kedy (v čase performance.now) dobehne posledná animácia útoku

// preview loop
let charPreviewRaf = 0;

// od kedy je postava v HUD widgete mŕtva — Dead anim sa prehrá raz od tohto času
let hudDeadSince = { p1: 0, p2: 0 };

/* ---------- sprite helpers ---------- */
function ensureSpriteMeta(charDir, file) {
  SPRITES[charDir] ||= {};
  if (SPRITES[charDir][file]) return Promise.resolve(SPRITES[charDir][file]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const frames = Math.max(1, Math.round(img.naturalWidth / img.naturalHeight));
      const fw = Math.round(img.naturalWidth / frames);
      const fh = img.naturalHeight;
      SPRITES[charDir][file] = { img, frames, fw, fh };
      resolve(SPRITES[charDir][file]);
    };
    img.onerror = reject;
    img.src = `/assets/${charDir}/${file}`;
  });
}
function drawSprite(ctx, meta, anim, t, dstW=TILE_W, dstH=TILE_H, fill=0.95, anchorY=0.5, clear=true, offsetX=0, offsetY=0) {
  const idx = anim.loop ? Math.floor((t / (1000 / anim.fps)) % meta.frames)
                        : Math.min(meta.frames - 1, Math.floor(t / (1000 / anim.fps)));
  const sx = idx * meta.fw;
  const scale = Math.min(dstW / meta.fw, dstH / meta.fh) * fill;
  const dw = meta.fw * scale, dh = meta.fh * scale;
  // anchorY: 0 = hore, 0.5 = stred, 1 = dole; offsetX/offsetY = posun v px (záporné offsetY dvíha hore)
  const dx = (dstW - dw) / 2 + offsetX, dy = (dstH - dh) * anchorY + offsetY;
  if (clear) ctx.clearRect(0, 0, dstW, dstH); // clear=false -> vrstvenie (efekt navrch mága)
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(meta.img, sx, 0, meta.fw, meta.fh, dx, dy, dw, dh);
}

/* ---------- animation state ---------- */
function setAnim(slot, key, durationMs = 0) {
  const def = ANIM_DEF[key] ?? ANIM_DEF.idle;
  animState[slot].key = key;
  if (durationMs && durationMs > 0) {
    animState[slot].until = performance.now() + durationMs;
  } else if (!def.loop) {
    animState[slot].until = performance.now() + 600;
  } else {
    animState[slot].until = 0;
  }
}
function currentAnim(slot) {
  const now = performance.now();
  const st  = animState[slot];
  const def = ANIM_DEF[st.key] ?? ANIM_DEF.idle;
  if (st.until && now > st.until) {
    if (st.key !== "dead") {
      animState[slot].key = "idle";
      animState[slot].until = 0;
      return ANIM_DEF.idle;
    }
  }
  return def;
}

/* ---------- specials/melee v strede boardu ---------- */
// veľký centrálny overlay — pre special efektový sprite mága, pre melee zväčšená postava so sekaním
function updateSpecialCenter(casts) {
  actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
  if (!Array.isArray(casts) || casts.length === 0) return;

  for (const sp of casts) {
    const caster = state?.[sp.from];
    if (!caster || !caster.char) continue;
    const dirKey = CHAR_META[caster.char].dir;
    const file   = sp.file || SPECIAL_ANIMS[caster.char].file;

    const cvs = document.createElement("canvas");
    const px  = Math.round(TILE_H * SPECIAL_SCALE);
    cvs.width = px; cvs.height = px;
    cvs.className = "special-center";
    if (sp.from === "p2" && sameCharNow()) cvs.classList.add("alt-color");
    cvs.dataset.dir  = dirKey;
    cvs.dataset.file = file;
    if (sp.fps) cvs.dataset.fps = sp.fps;

    const flip = sp.from === "p1" ? 1 : -1;
    cvs.style.left = "50%";
    cvs.style.top  = "50%";
    cvs.style.transform = `translate(-50%, -50%) scaleX(${flip})`;

    actorsEl.appendChild(cvs);
  }
}

/* ---------- bubliny -X HP / +Y MANA ---------- */
function cellToPx(x, y) { return { left: x * (TILE_W + GAP), top: y * (TILE_H + GAP) }; }

// súbežné bubliny nad tým istým hráčom sa stackujú nad seba, aby sa neprekrývali
let floatTimes = { p1: [], p2: [] };
function floatOffsetFor(slot) {
  const now = performance.now();
  floatTimes[slot] = floatTimes[slot].filter(t => now - t < 1000); // životnosť floatu
  const off = floatTimes[slot].length * 26;
  floatTimes[slot].push(now);
  return off;
}

function spawnDamageFloat(slot, dmg) {
  const target = state?.[slot];
  if (!target) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = "dmg-float";
  el.textContent = `-${dmg} HP`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}
function spawnFloat(slot, text, className) {
  const target = state?.[slot];
  if (!target) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

function spawnManaFloat(slot, amount = 4) {
  const target = state?.[slot];
  if (!target) return;
  const { left, top } = cellToPx(target.x, target.y);

  const el = document.createElement("div");
  el.className = "mana-float";
  el.textContent = `+${amount} MANA`;
  el.style.left = (left + TILE_W / 2) + "px";
  el.style.top  = (top + 8 - floatOffsetFor(slot)) + "px";
  actorsEl.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// stred bunky hráča v súradniciach actorsEl
function centerOf(slot) {
  const p = state?.[slot];
  if (!p) return null;
  const { left, top } = cellToPx(p.x, p.y);
  return { x: left + TILE_W / 2, y: top + TILE_H / 2 };
}

// efektná animácia odrazu: zrkadlová tabuľa flashne a praskne pri obrancovi,
// rázová vlna + sklenené úlomky, lúč vystrelí späť do útočníka, board sa otrasie
function spawnMirrorReflect(defenderSlot) {
  const d = centerOf(defenderSlot);
  if (!d) return;
  const a = centerOf(defenderSlot === "p1" ? "p2" : "p1");

  const add = (cls, style) => {
    const el = document.createElement("div");
    el.className = "mirror-fx " + cls;
    Object.assign(el.style, style);
    actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
    return el;
  };

  // 1) zrkadlová tabuľa (glassy flash) za emoji
  add("mirror-pane", {
    left: d.x + "px", top: d.y + "px",
    width: Math.round(TILE_W * 0.6) + "px",
    height: Math.round(TILE_H * 0.92) + "px",
  });

  // 1b) samotné 🪞 emoji ako zdroj lúča — pixelizované ako zvyšok UI
  const emoSize = Math.round(TILE_H * 0.6);
  const emo = add("mirror-emoji pix-ico", {
    left: d.x + "px", top: d.y + "px",
    width: emoSize + "px", height: emoSize + "px",
  });
  emo.dataset.emoji = "🪞";
  pixelizeEmoji(emo, 24);

  // 2) rázová vlna
  const ring = Math.round(TILE_H * 1.1);
  add("mirror-ring", { left: d.x + "px", top: d.y + "px", width: ring + "px", height: ring + "px" });

  // 3) sklenené úlomky letiace do strán
  for (let i = 0; i < 12; i++) {
    const ang  = (Math.PI * 2 * i / 12) + (i * 0.37);          // pseudo-náhodný rozptyl bez Math.random()
    const dist = 46 + (i % 4) * 22;
    const el = add("mirror-shard", { left: d.x + "px", top: d.y + "px" });
    el.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    el.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    el.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2) + "deg");
  }

  // 4) lúč odrazu obranca → útočník
  if (a) {
    const dist = Math.hypot(a.x - d.x, a.y - d.y);
    const ang  = Math.atan2(a.y - d.y, a.x - d.x) * 180 / Math.PI;
    const wrap = add("mirror-beam-wrap", {
      left: d.x + "px", top: (d.y - 7) + "px",
      width: dist + "px", height: "14px",
      transform: `rotate(${ang}deg)`,
    });
    const beam = document.createElement("div");
    beam.className = "mirror-beam";
    wrap.appendChild(beam);
  }

  // 5) otras boardu
  const boardEl = gridEl.parentElement;
  if (boardEl) {
    boardEl.classList.remove("fx-shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("fx-shake");
    setTimeout(() => boardEl.classList.remove("fx-shake"), 450);
  }
}

/* ---------- arena ---------- */
// interné rozlíšenie pozadia — vrstvy sa zmenšia sem a CSS ich roztiahne s pixelated,
// čím vzniknú skutočné veľké pixely (menšie čísla = hrubší pixel art)
const ARENA_RES = { w: 320, h: 180 };
function renderArenaLayers(arenaKey, layerFiles) {
  arenaEl.innerHTML = "";
  if (!arenaKey || !Array.isArray(layerFiles) || !layerFiles.length) return;
  layerFiles.forEach((file, i) => {
    const cvs = document.createElement("canvas");
    cvs.className = "layer";
    cvs.width = ARENA_RES.w; cvs.height = ARENA_RES.h;
    cvs.style.zIndex = String(i);
    const img = new Image();
    img.onload = () => {
      const ctx = cvs.getContext("2d");
      // cover: vyplň celý canvas, prebytok orež — rovnaká logika ako object-fit: cover
      const s  = Math.max(ARENA_RES.w / img.width, ARENA_RES.h / img.height);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (ARENA_RES.w - dw) / 2, (ARENA_RES.h - dh) / 2, dw, dh);
    };
    img.src = `/arenas/${arenaKey}/${file}`;
    arenaEl.appendChild(cvs);
  });
}

/* ---------- pixel-art ikony (tiles, tlačidlá, HUD) ---------- */
// 8×8 mriežka, znak = farba z palety, bodka = priehľadné; kreslí sa ako SVG rect-y (crispEdges)
const PIX = {
  flame: { pal: { a: "#ff7043", b: "#ffd54f" }, rows: [
    "....a...",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aabbaa.",
    ".abbbba.",
    ".abbbba.",
    "..aaaa..",
  ]},
  heart: { pal: { a: "#e53935", b: "#ff8a80" }, rows: [
    "........",
    ".aa..aa.",
    "abaaaaaa",
    "aaaaaaaa",
    "aaaaaaaa",
    ".aaaaaa.",
    "..aaaa..",
    "...aa...",
  ]},
  drop: { pal: { a: "#1e88e5", b: "#82c4ff" }, rows: [
    "...a....",
    "...aa...",
    "..aaaa..",
    "..aaaa..",
    ".aaaaaa.",
    ".baaaaa.",
    ".baaaaa.",
    "..aaaa..",
  ]},
  skull: { pal: { a: "#e8e8e8", b: "#1a1a1a" }, rows: [
    "..aaaa..",
    ".aaaaaa.",
    ".abaaba.",
    ".abaaba.",
    ".aaaaaa.",
    "..abba..",
    "..aaaa..",
    "..a..a..",
  ]},
  boot: { pal: { a: "#e0e0e0", b: "#8d6e63" }, rows: [
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaa...",
    "..aaaa..",
    "..aaaaa.",
    ".bbbbbb.",
    "........",
  ]},
  chevrons: { pal: { a: "#ffffff" }, rows: [
    "aa..aa..",
    ".aa..aa.",
    "..aa..aa",
    ".aa..aa.",
    "aa..aa..",
    "........",
    "........",
    "........",
  ]},
  plus: { pal: { a: "#82c4ff" }, rows: [
    "...aa...",
    "...aa...",
    ".aaaaaa.",
    ".aaaaaa.",
    "...aa...",
    "...aa...",
    "........",
    "........",
  ]},
  shield: { pal: { a: "#00363d", b: "#b2ebf2" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbbba.",
    ".abbbba.",
    "..abba..",
    "..abba..",
    "...aa...",
    "........",
  ]},
  mirror: { pal: { a: "#d4a017", b: "#b2ebf2", c: "#ffffff" }, rows: [
    ".aaaaaa.",
    ".abbbba.",
    ".abbcba.",
    ".abcbba.",
    ".acbbba.",
    ".abbbba.",
    ".aaaaaa.",
    "........",
  ]},
  arrow: { pal: { a: "#fff3c4" }, rows: [
    "........",
    ".....a..",
    "......a.",
    "aaaaaaaa",
    "......a.",
    ".....a..",
    "........",
    "........",
  ]},
  sword: { pal: { a: "#e0e0e0", c: "#6d4c41", d: "#d4a017" }, rows: [
    "...aa...",
    "...aa...",
    "...aa...",
    "...aa...",
    ".dddddd.",
    "...cc...",
    "...cc...",
    "........",
  ]},
  star: { pal: { a: "#e1bee7", b: "#ffffff" }, rows: [
    "...aa...",
    "..aaaa..",
    ".aabbaa.",
    "aabbbbaa",
    ".aabbaa.",
    "..aaaa..",
    "...aa...",
    "........",
  ]},
  // séria — vyhratá hra: plná zlatá koruna s gemmami
  crown: { pal: { a: "#ffcf3f", b: "#c98a17", c: "#ff5a5a" }, rows: [
    ".a.aa.a.",
    ".a.aa.a.",
    ".aaaaaa.",
    ".acaaca.",
    ".abaaba.",
    ".aaaaaa.",
    "........",
    "........",
  ]},
  // séria — nezískaná hra: len obrys koruny (tlmená zlatá)
  crown_outline: { pal: { o: "#7d6526" }, rows: [
    ".o.oo.o.",
    ".o.oo.o.",
    ".oo..oo.",
    ".o....o.",
    ".o....o.",
    ".oooooo.",
    "........",
    "........",
  ]},
};
function pixSvg(name) {
  const def = PIX[name];
  if (!def) return "";
  let rects = "";
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = def.pal[row[x]];
      if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
// malá inline ikonka do cost riadkov — pixelizované emoji, hydratuje hydratePix()
const miniPix = (emoji) => `<span class="pix-ico mini" data-emoji="${emoji}"></span>`;
// špeciálne políčka mapujú na ikony knižnice
const TILE_TO_PIX = { dmg: "flame", heal: "heart", mana: "drop", ik: "skull" };
function tileSvg(type) { return pixSvg(TILE_TO_PIX[type] || type); }

// jemná pixelizácia emoji: nakreslí sa do malého canvasu a CSS ho roztiahne s pixelated
function pixelizeEmoji(el, res) {
  if (el.dataset.done) return;
  el.dataset.done = "1";
  el.innerHTML = "";
  res = res || (el.classList.contains("mini") ? 10 : 20);
  const cvs = document.createElement("canvas");
  cvs.width = res; cvs.height = res;
  const ctx = cvs.getContext("2d");
  ctx.font = `${res - 3}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(el.dataset.emoji, res / 2, res / 2 + 1);
  el.appendChild(cvs);
}
function hydratePix(root = document) {
  root.querySelectorAll(".pix-ico[data-emoji]").forEach(el => pixelizeEmoji(el));
}

/* ---------- HUD ---------- */
// spojitý bar s 10 zárezmi: hlavná výplň + biely „trail", ktorý sa pri strate stiahne s oneskorením
function renderBar(el, value) {
  if (!el) return;
  if (!el.querySelector(".fill")) {
    el.innerHTML = '<div class="fill-trail"></div><div class="fill"></div>';
  }
  const v = Math.max(0, Math.min(10, Number(value) || 0));
  const prev = el.dataset.prev === undefined ? v : Number(el.dataset.prev);
  el.dataset.prev = String(v);

  const fill  = el.querySelector(".fill");
  const trail = el.querySelector(".fill-trail");
  fill.style.height  = (v * 10) + "%";
  trail.style.height = (v * 10) + "%"; // trail má oneskorený transition — pri strate sa stiahne neskôr

  // pri zisku výplň blikne do jasu
  if (v > prev) {
    fill.classList.remove("gain");
    void fill.offsetWidth; // reflow = reštart animácie
    fill.classList.add("gain");
    fill.addEventListener("animationend", () => fill.classList.remove("gain"), { once: true });
  }

  // presná hodnota pod barom — bez počítania dielikov
  const num = el.closest(".hud-stat")?.querySelector(".bar-num");
  if (num) num.textContent = String(v);
}

// obaja hráči majú rovnakého mága → P2 dostane farebný posun (palette swap cez CSS hue-rotate)
function sameCharNow() {
  return !!(state?.p1?.char && state.p1.char === state?.p2?.char);
}

// banner pod ROUND textom: ja som locknutý a čaká sa na súpera / súper je locknutý a rad je na mne
const turnStatusEl = document.getElementById("turn-status");
function updateTurnStatus() {
  if (!turnStatusEl) return;
  const opSlot = me === "p1" ? "p2" : me === "p2" ? "p1" : null;
  const mine = me ? state?.[me] : null;
  const opp  = opSlot ? state?.[opSlot] : null;

  const timerMode = !!state?.config?.timer && state.config.timer !== "off";
  let txt = null, cls = null;
  if (!playing && !gameOverShown && mine?.char && opp?.char) {
    if (mine.locked && !opp.locked) {
      // „locked - waiting" — vo fixnom časovom režime skry; v quickdraw a bezčasovom nechaj
      if (!timerMode || state.config.timer === "quickdraw") { txt = "✔ LOCKED - WAITING FOR OPPONENT…"; cls = "waiting"; }
    } else if (!mine.locked && opp.locked) {
      // „your move" — nechaj v quickdraw (spúšťa časovač) a v bezčasovom režime; vo fixnom časovom skry
      if (!timerMode || state.config.timer === "quickdraw") { txt = "⚠️ OPPONENT IS READY - YOUR MOVE! ⚠️"; cls = "your-move"; }
    }
  }

  if (!txt) { turnStatusEl.classList.add("hidden"); return; }
  turnStatusEl.textContent = txt;
  turnStatusEl.classList.remove("hidden", "waiting", "your-move");
  turnStatusEl.classList.add(cls);
}

function renderHUD() {
  if (hudTurn && !gameOverShown) {
    hudTurn.textContent = (state?.phase === "playing") ? `ROUND ${state.turn}` : "";
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

  // rovnaká postava u oboch → P2 v alternatívnej farbe (postava na boarde, portrét aj ghost)
  const same = sameCharNow();
  actorP2.classList.toggle("alt-color", same);
  hudCharP2.classList.toggle("alt-color", same);
  actorGhost.classList.toggle("alt-color", same && me === "p2");
  updateGoldenButton();
}

/* ---------- záznam akcií kola pod widgetom ---------- */
function actionIcon(action) {
  const arrow = { up: "↑", down: "↓", left: "←", right: "→" };
  switch (action?.type) {
    case "move":     return `🚶${arrow[action.dir] || ""}`;
    case "dash":     return `🏃${arrow[action.dir] || ""}`;
    case "recharge": return "🙏";
    case "attack":   return `🏹${arrow[action.dir] || ""}`;
    case "melee":    return "🗡️";
    case "shield":   return "🛡️";
    case "mirror":   return "🪞";
    case "golden_shield": return "🛡️";
    case "special":  return "✨";
    default:         return "?";
  }
}
// skeleton záznamu kola — rovnaká fixná štruktúra ako fronta: [🛡️] | [1][2][3] | [🙏]
function buildActionLogSkeleton(log) {
  log.innerHTML = "";
  const mkSlot = (cls, inner) => {
    const el = document.createElement("span");
    el.className = `a-badge a-slot ${cls}`;
    el.innerHTML = inner;
    log.appendChild(el);
  };
  const mkDivider = () => {
    const d = document.createElement("span");
    d.className = "log-divider";
    log.appendChild(d);
  };
  mkSlot("slot-pre", '<span class="g-ico dim">🛡️</span>');
  mkDivider();
  for (let i = 0; i < 3; i++) mkSlot("slot-act", String(i + 1));
  mkDivider();
  mkSlot("slot-post", '<span class="g-ico dim">🙏</span>');
}

// akcie postupne vypĺňajú placeholder sloty (golden pre/post, bežné zľava doprava)
function appendActionLog(slot, action) {
  const log = slot === "p1" ? logP1 : logP2;
  if (!log) return;
  if (!log.children.length) buildActionLogSkeleton(log);

  if (action?.type === "golden_shield") {
    const el = log.querySelector(".a-slot.slot-pre");
    if (el) {
      el.className = "a-badge golden_shield";
      el.innerHTML = '<span class="g-ico">🛡️</span>';
    }
    return;
  }
  if (action?.type === "golden_mana") {
    const el = log.querySelector(".a-slot.slot-post");
    if (el) {
      el.className = "a-badge golden_mana";
      el.innerHTML = '<span class="g-ico">🙏</span>';
    }
    return;
  }
  const el = log.querySelector(".a-slot.slot-act");
  if (el) {
    el.className = `a-badge ${action?.type || ""}`;
    el.textContent = actionIcon(action);
  }
}
function clearActionLogs() {
  if (logP1) buildActionLogSkeleton(logP1);
  if (logP2) buildActionLogSkeleton(logP2);
}

/* ---------- Grid (efekty + anim. objekty) ---------- */
function renderGrid(s, effects = []) {
  gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
  gridEl.style.gridTemplateRows    = `repeat(${board.h}, ${TILE_H}px)`;
  const boardEl = gridEl.parentElement;
  boardEl.style.width  = (board.w * TILE_W + (board.w - 1) * GAP) + "px";
  boardEl.style.height = (board.h * TILE_H + (board.h - 1) * GAP) + "px";
  gridEl.innerHTML = "";

  castingNow.p1 = false;
  castingNow.p2 = false;

  const recharge = new Set();
  const charges  = [];
  const specials = [];
  const meleeCasts = [];
  const procs    = [];
  let hitTarget  = null;

  // špeciálne políčka (dmg/heal/mana + IK overlay)
  const tileMap = new Map();
  (s?.tiles || []).forEach(t => tileMap.set(`${t.x},${t.y}`, t.type));

  const previewSet = new Set();

  for (const e of effects) {
    if (e?.kind === "recharge")  for (const [x,y] of e.cells || []) recharge.add(`${x},${y}`);
    if (e?.kind === "charge")    charges.push(e);
    if (e?.kind === "special")   specials.push(e);
    if (e?.kind === "hit")       hitTarget = e.target;
    if (e?.kind === "tile_proc") procs.push(e);
    // melee úder — zvýrazni zasahovanú bunku (bunku útočníka)
    // + zväčšená postava v strede so sekacou animáciou (analógia special overlay)
    if (e?.kind === "melee") {
      const caster = s?.[e.from];
      if (caster) previewSet.add(`${caster.x},${caster.y}`);
      meleeCasts.push({ from: e.from, file: ANIM_DEF.attack2.file, fps: ANIM_DEF.attack2.fps });
    }
  }

  for (const sp of specials) {
    const caster = s?.[sp.from];
    if (!caster || !caster.char) continue;
    castingNow[sp.from] = true;
    const cells = cellsForSpecialPreview(caster);
    cells.forEach(([x,y]) => previewSet.add(`${x},${y}`));
  }

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const key = `${x},${y}`;
      if (recharge.has(key))   cell.classList.add("hl-recharge");
      if (previewSet.has(key)) cell.classList.add("preview-red");

      // tile podfarbenie + ikona; IK prekrýva všetko
      const tileType = tileMap.get(key);
      const isIK = Array.isArray(s?.iks) && s.iks.some(t => t.x === x && t.y === y);
      if (isIK) {
        cell.classList.add("tile-ik");
      } else if (tileType) {
        cell.classList.add(`tile-${tileType}`);
      }
      if (isIK || tileType) {
        const m = document.createElement("span");
        m.className = "tile-marker";
        m.innerHTML = tileSvg(isIK ? "ik" : tileType);
        cell.appendChild(m);
      }

      // práve vyhodnocované tile — výrazný blik
      if (procs.some(pc => pc.cell?.[0] === x && pc.cell?.[1] === y)) {
        cell.classList.add("tile-proc");
      }

      // projektil basic útoku v tejto bunke
      const chargeHere = charges.find(c => c.cell?.[0] === x && c.cell?.[1] === y);
      if (chargeHere) {
        const charKey = s?.[chargeHere.from]?.char;
        const dirKey  = charKey ? CHAR_META[charKey].dir : null;
        if (dirKey) {
          const cvs = document.createElement("canvas");
          const px  = Math.round(TILE_H * CHARGE_SCALE);
          cvs.width = px; cvs.height = px;
          cvs.className = "charge-canvas";
          if (chargeHere.from === "p2" && sameCharNow()) cvs.classList.add("alt-color");
          cvs.dataset.dir = dirKey;
          cvs.style.width  = px + "px";
          cvs.style.height = px + "px";
          // sprite projektilu smeruje doprava — ostatné smery flip/rotácia
          const orient = { left: "scaleX(-1)", up: "rotate(-90deg)", down: "rotate(90deg)" }[chargeHere.dir] || "";
          cvs.style.transform = `translate(-50%, -50%) ${orient}`.trim();
          cell.appendChild(cvs);
        }
      }

      // zásahový blik
      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");

      // aktívne obrany — prstenec na bunke hráča (shield plný, golden zlatý, mirror čiarkovaný)
      if ((isP1 && s?.p1?.shield) || (isP2 && s?.p2?.shield)) {
        cell.classList.add("cell-shielded");
        if ((isP1 && s?.p1?.shieldGold) || (isP2 && s?.p2?.shieldGold)) cell.classList.add("gold");
      }
      if ((isP1 && s?.p1?.mirror) || (isP2 && s?.p2?.mirror)) cell.classList.add("cell-mirrored");

      gridEl.appendChild(cell);
    }
  }

  updateSpecialCenter(specials.concat(meleeCasts));
}

/* ---------- Special preview (hover) ---------- */
function cellsForSpecialPreview(meState){
  if (!meState || !meState.char) return [];
  const { x, y, char } = meState;
  const cells = [];
  if (char === "fire"){
    for (let cx=0; cx<board.w; cx++) cells.push([cx, y]);
  } else if (char === "lightning"){
    // všetky políčka opačnej "šachovej" farby než na ktorej stojí
    const par = (x + y) % 2;
    for (let cy=0; cy<board.h; cy++) for (let cx=0; cx<board.w; cx++){
      if ((cx + cy) % 2 !== par) cells.push([cx, cy]);
    }
  } else if (char === "wanderer"){
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
      const cx=x+dx, cy=y+dy;
      if (cx>=0 && cy>=0 && cx<board.w && cy<board.h) cells.push([cx,cy]);
    });
  }
  return cells;
}
/* ---------- Ghost — simulácia vlastnej pozície počas naplánovaného kola ---------- */
// pozícia po každej akcii vo fronte; movy mimo board pozíciu nemenia (zrkadlí server)
function simulatedPositions(){
  const mine = state?.[me];
  if (!mine) return [];
  let x = mine.x, y = mine.y;
  const out = [];
  for (const a of myQueue){
    const d = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[a.dir];
    if (a.type === "move" && d){
      const nx = x + d[0], ny = y + d[1];
      if (nx >= 0 && ny >= 0 && nx < board.w && ny < board.h){ x = nx; y = ny; }
    }
    if (a.type === "dash" && d){
      // až 2 políčka, na okraji sa skráti (zrkadlí server)
      for (let s = 0; s < 2; s++){
        const nx = x + d[0], ny = y + d[1];
        if (nx >= 0 && ny >= 0 && nx < board.w && ny < board.h){ x = nx; y = ny; }
      }
    }
    out.push({ x, y });
  }
  return out;
}
// pozícia, z ktorej sa vykoná akcia s indexom idx (= po akciách 0..idx-1);
// bez argumentu pozícia po celej fronte — odtiaľ sa vykoná novo pridávaná akcia
function ghostPos(idx = myQueue.length){
  const mine = state?.[me];
  if (!mine) return null;
  if (idx <= 0) return { x: mine.x, y: mine.y };
  const sims = simulatedPositions();
  if (!sims.length) return { x: mine.x, y: mine.y };
  return sims[Math.min(idx, sims.length) - 1];
}

// dráha basic útoku zvoleným smerom z danej pozície (po okraj boardu)
function cellsForAimPreview(meState, dir){
  if (!meState) return [];
  const delta = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] }[dir];
  if (!delta) return [];
  const cells = [];
  let x = meState.x + delta[0], y = meState.y + delta[1];
  while (x >= 0 && y >= 0 && x < board.w && y < board.h){
    cells.push([x, y]);
    x += delta[0]; y += delta[1];
  }
  return cells;
}
function showPreviewCells(cells){
  const kids = gridEl.children;
  for (let i=0;i<kids.length;i++){
    const cell = kids[i];
    const cx = parseInt(cell.dataset.x,10), cy = parseInt(cell.dataset.y,10);
    if (cells.some(([x,y])=>x===cx && y===cy)) cell.classList.add("preview-red");
  }
}
function clearPreviewCells(){
  gridEl.querySelectorAll(".preview-red").forEach(el=>el.classList.remove("preview-red"));
}

/* ---------- Facing + umiestnenie ---------- */
function computeFacing(p1, p2) {
  if (!p1 || !p2) return { p1: 1, p2: -1 };
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
// pri horizontálnom útoku sa mág otočí v smere streľby, aj keď súper stojí inde
let facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
function currentFacing(slot, facing) {
  const ov = facingOverride[slot];
  if (ov && ov.sx && performance.now() < ov.until) return ov.sx;
  return facing[slot];
}
function positionActors(s, immediate = false) {
  const p1 = s.p1, p2 = s.p2;
  const same = p1 && p2 && p1.x === p2.x && p1.y === p2.y;
  const facing = computeFacing(p1, p2);

  [["p1", actorP1, p1], ["p2", actorP2, p2]].forEach(([slot, el, data]) => {
    if (!data || !data.char) { el.style.display = "none"; return; }
    el.style.display = "block";
    const { left, top } = cellToPx(data.x, data.y);
    // canvas je väčší než bunka — horizontálne centrovať, vertikálne ukotviť na spodok bunky
    const px = left - (ACTOR_W - TILE_W) / 2;
    const py = top  - (ACTOR_H - TILE_H);

    if (immediate || !actorsInitialized) {
      el.style.transition = "none";
      el.style.left = px + "px";
      el.style.top  = py + "px";
      void el.offsetHeight;
      el.style.transition = "";
    } else {
      el.style.left = px + "px";
      el.style.top  = py + "px";
    }

    const shift = same ? (slot === "p1" ? -22 : 22) : 0;
    const scale = currentFacing(slot, facing);
    el.style.transform = `translateX(${shift}px) scaleX(${scale})`;

    el.dataset.slot = slot;
    if (same) el.dataset.pair = "1"; else el.removeAttribute("data-pair");
  });

  actorsInitialized = true;
}

/* ---------- Queue + Lock ---------- */
function renderQueue() {
  queueEl.innerHTML = "";
  const arrow = { up: "↑", down: "↓", left: "←", right: "→" };

  // fixná štruktúra fronty: [golden shield][|][akcia 1][akcia 2][akcia 3][|][golden mana]
  // prázdne pozície sú placeholder sloty — šírka sa pridávaním akcií nemení
  const addDivider = () => {
    const d = document.createElement("div");
    d.className = "q-divider";
    queueEl.appendChild(d);
  };
  const addSlot = (innerHTML, title) => {
    const ph = document.createElement("div");
    ph.className = "q-badge q-slot";
    ph.innerHTML = innerHTML;
    if (title) ph.title = title;
    queueEl.appendChild(ph);
  };

  // pre-slot: golden shield (vyhodnotí sa pred kolom)
  if (goldenArmed) {
    const g = document.createElement("div");
    g.className = "q-badge golden";
    g.innerHTML = '<span class="g-ico">🛡️</span>';
    g.title = "Golden Shield - resolves before the round starts";
    queueEl.appendChild(g);
  } else {
    addSlot('<span class="g-ico dim">🛡️</span>', "Golden Shield slot");
  }
  addDivider();

  // 3 sloty bežných akcií — nevyplnené ukazujú poradové číslo
  for (let i = 0; i < 3; i++) {
    const a = myQueue[i];
    if (!a) { addSlot(String(i + 1), "Action slot"); continue; }

    const div = document.createElement("div");
    div.className = "q-badge";
    if (a.type === "move") {
      div.classList.add("move");  div.textContent = `🚶${arrow[a.dir] || "?"}`;
    } else if (a.type === "dash") {
      div.classList.add("dash");  div.textContent = `🏃${arrow[a.dir] || "?"}`;
    } else if (a.type === "recharge") {
      div.classList.add("mana");  div.textContent = "🙏";
    } else if (a.type === "attack") {
      div.classList.add("attack"); div.textContent = `🏹${arrow[a.dir] || ""}`;
    } else if (a.type === "melee") {
      div.classList.add("melee"); div.textContent = "🗡️";
    } else if (a.type === "special") {
      div.classList.add("special"); div.textContent = "✨";
    } else if (a.type === "shield") {
      div.classList.add("shield"); div.textContent = "🛡️";
    } else if (a.type === "mirror") {
      div.classList.add("mirror"); div.textContent = "🪞";
    } else {
      div.textContent = a.type;
    }

    // hover nad badge útoku/specialu ukáže zásah z pozície platnej v tom kroku (ghost)
    if (a.type === "attack") {
      div.addEventListener("mouseenter", () => {
        const p = ghostPos(i);
        if (p) showPreviewCells(cellsForAimPreview(p, a.dir));
      });
      div.addEventListener("mouseleave", clearPreviewCells);
    }
    if (a.type === "special") {
      div.addEventListener("mouseenter", () => {
        const mine = state?.[me];
        const p = ghostPos(i);
        if (mine?.char && p) showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char: mine.char }));
      });
      div.addEventListener("mouseleave", clearPreviewCells);
    }
    if (a.type === "melee") {
      div.addEventListener("mouseenter", () => {
        const p = ghostPos(i);
        if (p) showPreviewCells([[p.x, p.y]]);
      });
      div.addEventListener("mouseleave", clearPreviewCells);
    }

    queueEl.appendChild(div);
  }

  addDivider();
  // post-slot: golden mana refill (vyhodnotí sa po konci kola)
  if (goldenManaArmed) {
    const g = document.createElement("div");
    g.className = "q-badge golden";
    g.innerHTML = '<span class="g-ico">🙏</span>';
    g.title = "Golden Mana Refill - resolves after the round ends";
    queueEl.appendChild(g);
  } else {
    addSlot('<span class="g-ico dim">🙏</span>', "Golden Mana slot");
  }

  updateActionButtons();
  updateLockButton();
  sendDraft(); // priebežne posli rozpracovanú voľbu serveru (pre backstop pri vypršaní času)
}
// pošli serveru aktuálnu rozpracovanú frontu + golden flagy (server ju pri timeoute zahrá a doplní chýbajúce)
function sendDraft() {
  if (!me || state?.phase !== "playing" || lockedIn || state?.[me]?.locked) return;
  socket.emit("draft_queue", { queue: myQueue, golden: goldenArmed, goldenMana: goldenManaArmed });
}
// zneaktívni tlačidlá akcií, ktoré už sú v queue (každá max 1× za kolo)
function updateActionButtons() {
  document.querySelectorAll(".controls button[data-act]").forEach(btn => {
    const type = btn.dataset.act.split(":")[0];
    btn.disabled = myQueue.some(a => a.type === type);
  });
  const moveUsed = myQueue.some(a => a.type === "move");
  moveBtn.disabled = moveUsed;
  if (moveUsed) dirPicker.classList.add("hidden");
  const attackUsed = myQueue.some(a => a.type === "attack");
  attackBtn.disabled = attackUsed;
  if (attackUsed) aimPicker.classList.add("hidden");
  const dashUsed = myQueue.some(a => a.type === "dash");
  dashBtn.disabled = dashUsed;
  if (dashUsed) dashPicker.classList.add("hidden");
}
function updateLockButton() {
  const locked = !!state?.[me]?.locked;
  if (locked) {
    lockBtn.classList.add("locked"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  } else {
    lockBtn.classList.remove("locked"); lockBtn.textContent = "LOCK IN"; lockBtn.disabled = false;
  }
  // počas prehrávania kola sa nedá lockovať (zabráni súbežným timeline)
  if (playing && !locked) {
    lockBtn.disabled = true;
    lockBtn.classList.remove("ready");
    updateUiLocks();
    return;
  }
  // pulzuj, keď je queue plná a čaká sa už len na potvrdenie
  lockBtn.classList.toggle("ready", !locked && myQueue.length === 3);
  updateUiLocks();
}

/* ---------- Winner helper ---------- */
function computeWinnerFromState(s) {
  const dead1 = !s?.p1 || s.p1.hp <= 0;
  const dead2 = !s?.p2 || s.p2.hp <= 0;
  if (dead1 && dead2) return "draw";
  if (dead1) return "p2";
  if (dead2) return "p1";
  return null;
}

/* ---------- GameOver sekvencia ---------- */
function showGameOverSequence(winner) {
  if (gameOverShown) return;
  gameOverShown = true;

  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);

  // počkaj, kým dobehne posledná animácia útoku (ak nejaká beží)
  const now = performance.now();
  const lastEnd = Math.max(lastAttackEndAt.p1, lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);

  setTimeout(() => {
    // potom spusti animáciu smrti porazeného (ak nie je remíza)
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) {
      setAnim(loser, "dead", 1200);
      afterDeathWait = 1300; // trvanie death + malý buffer
    }

    setTimeout(() => {
      // verdikt namiesto ROUND n v hud-turn — hlavné okno nič neprekrýva
      let verdict, cls;
      if (winner === "draw")        { verdict = "TIE"; cls = "tie"; }
      else if (me && winner === me) { verdict = "WINNER!"; cls = "win"; }
      else if (me)                  { verdict = "LOSER!"; cls = "lose"; }
      else                          { verdict = `${winner.toUpperCase()} WINS`; cls = "tie"; } // divák
      // pri sérii (BO3/BO5) doplň finálne skóre
      const ser = serverGameResult?.series || state?.series;
      let scoreLine = "";
      if (ser && ser.format && ser.format !== "single") {
        // skóre drží strany (ľavá : pravá), rovnako ako koruny v HUD — nie „ja : oponent"
        scoreLine = `<span class="go-verdict tie">${ser.winsP1 ?? 0} : ${ser.winsP2 ?? 0}</span>`;
        renderSeriesCrowns(ser); // dokresli finálne koruny (server po match_over už neposiela state)
      }
      if (hudTurn) hudTurn.innerHTML = `GAME OVER<span class="go-verdict ${cls}">${verdict}</span>${scoreLine}`;
      // uprac overlay z poslednej akcie (special/melee cast) — po game over ho už renderGrid neuprace
      actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
      // víťazova postavička spamuje cast animáciu priamo na svojom políčku (žiadny extra sprite)
      if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
      goOverlay.classList.remove("hidden");
    }, afterDeathWait);
  }, waitAttack);
}

// animácia konca hry (smrť porazeného + víťazstvo) bez finálneho overlayu — pre medzihru série
function playGameEndAnim(winner, after) {
  const loser = winner === "p1" ? "p2" : (winner === "p2" ? "p1" : null);
  const now = performance.now();
  const lastEnd = Math.max(lastAttackEndAt.p1, lastAttackEndAt.p2);
  const waitAttack = Math.max(0, lastEnd - now);
  setTimeout(() => {
    let afterDeathWait = 300;
    if (winner !== "draw" && loser) { setAnim(loser, "dead", 1200); afterDeathWait = 1300; }
    actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
    if (winner === "p1" || winner === "p2") setAnim(winner, "victory");
    setTimeout(() => { if (after) after(); }, afterDeathWait);
  }, waitAttack);
}

/* ---------- Timeline prehrávanie ---------- */
let playGen = 0;      // generácia prehrávania — novšia timeline zruší staršiu slučku
let playing = false;  // počas prehrávania neaktualizuj UI zo snapshotov a drž LOCK zamknutý

function schedulePlayTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return;

  const gen = ++playGen;
  playing = true;
  stopTurnTimer(); // kolo sa už vyhodnocuje (server poslal timeline) — zhasni prípadný stale časovač
  updateUiLocks(); // počas vyhodnocovania sú všetky tlačidlá zamknuté a stmavené

  clearActionLogs(); // záznam predošlého kola zmizne so začiatkom nového

  const first = timeline[0];
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn; state.starter = (first.starter ?? state.starter);
  state.tiles = first.tiles; state.iks = first.iks;
  renderHUD();
  const NEXT_TURN = (first.turn ?? state.turn) + 1;
  const NEXT_STARTER = (NEXT_TURN % 2 === 1) ? "p1" : "p2";
  renderGrid(state, first.effects || []);
  positionActors(state, true);

  let i = 1;
  let prev = first;

  const step = () => {
    if (gen !== playGen) return; // medzitým začala novšia timeline — túto slučku ukonči

    if (i >= timeline.length) {
      playing = false;

      // koniec hry: ak séria pokračuje -> medzihra; ak je rozhodnutá -> game over
      const winner = serverWinner || serverGameResult?.gameWinner || computeWinnerFromState(state);
      if (winner) {
        if (serverGameResult && !serverGameResult.matchOver) {
          playGameEndAnim(winner, () => showIntermission(winner, serverGameResult.series));
        } else {
          showGameOverSequence(winner);
        }
        return;
      }

      // inak bežný koniec kola
      state.turn = NEXT_TURN;
      state.starter = NEXT_STARTER;
      renderHUD();

      if (state.p1) state.p1.locked = false;
      if (state.p2) state.p2.locked = false;

      renderGrid(state, []);
      myQueue = [];
      goldenArmed = false;
      goldenManaArmed = false;
      lockedIn = false; // kolo dobehlo — odomkni ovládanie
      document.getElementById("golden-btn")?.classList.remove("armed");
      document.getElementById("golden-mana-btn")?.classList.remove("armed");
      renderQueue();
      lockBtn.disabled = false;
      updateLockButton();
      // časovač ďalšieho kola príde zo servera (turn_timer); displej sa zapne po dohraní timeline
      return;
    }

    const frame = timeline[i++];

    const beforeP1 = prev?.p1 || state.p1;
    const beforeP2 = prev?.p2 || state.p2;

    state.p1 = frame.p1; state.p2 = frame.p2;
    state.tiles = frame.tiles; state.iks = frame.iks;
    if (frame.starter !== undefined) {
      state.starter = frame.starter;
    }
    renderHUD();

    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y)) setAnim("p1", "run", MOVE_MS);
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y)) setAnim("p2", "run", MOVE_MS);

    const shooters = new Set();
    for (const e of frame.effects || []) {
      if ((e.kind === "charge" || e.kind === "attack_swing" || e.kind === "special") && e.from) shooters.add(e.from);
      // strelec sa otočí v smere horizontálnej streľby (vertikálna facing nemení)
      if (e.kind === "charge" && (e.dir === "left" || e.dir === "right") && (e.from === "p1" || e.from === "p2")) {
        facingOverride[e.from] = { sx: e.dir === "left" ? -1 : 1, until: performance.now() + ATTACK_SWING_MS };
      }
      if (e.kind === "melee" && (e.from === "p1" || e.from === "p2")) {
        setAnim(e.from, "attack2", ATTACK_SWING_MS);
        lastAttackEndAt[e.from] = performance.now() + ATTACK_SWING_MS;
      }
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) {
        setAnim(e.target, "hurt", HURT_MS);
        if (typeof e.dmg === "number" && e.dmg > 0) spawnDamageFloat(e.target, e.dmg);
      }
      if (e.kind === "invalid" && (e.target === "p1" || e.target === "p2")) {
        setAnim(e.target, "hurt", HURT_MS);
        // nedostatok many — výrazná výstraha: float + bliknutie mana baru v HUD
        if (e.reason === "mana") {
          spawnFloat(e.target, "⚠️ LOW MANA", "lowmana-float");
          const bar = e.target === "p1" ? hudP1Mana : hudP2Mana;
          if (bar) {
            bar.classList.remove("low-warn");
            void bar.offsetWidth; // restart animácie pri opakovanej výstrahe
            bar.classList.add("low-warn");
            setTimeout(() => bar.classList.remove("low-warn"), 1000);
          }
        }
      }
      if (e.kind === "recharge" && (e.from === "p1" || e.from === "p2")) {
        const amt = (typeof e.amount === "number" ? e.amount : 4);
        spawnManaFloat(e.from, amt);
      }
      if (e.kind === "shield" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🛡️ SHIELD", "shield-float");
      }
      if (e.kind === "mirror_on" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, "🪞 MIRROR", "shield-float");
      }
      if (e.kind === "mirror" && (e.target === "p1" || e.target === "p2")) {
        spawnMirrorReflect(e.target);
        spawnFloat(e.target, "🪞 REFLECTED!", "mirror-reflect-text");
      }
      if (e.kind === "golden_shield" && (e.from === "p1" || e.from === "p2")) {
        // navonok je to SHIELD, len zlatý — "golden shield" je interné pomenovanie
        spawnFloat(e.from, "🛡️ SHIELD", "golden-float");
      }
      if (e.kind === "golden_mana" && (e.from === "p1" || e.from === "p2")) {
        spawnFloat(e.from, `🙏 +${e.gained ?? 6} MANA`, "golden-float");
        if (e.hpCost) spawnDamageFloat(e.from, e.hpCost);
      }
      if (e.kind === "action" && (e.from === "p1" || e.from === "p2")) {
        appendActionLog(e.from, e.action);
      }
      if (e.kind === "block" && (e.target === "p1" || e.target === "p2")) {
        // zlatý text, ak blokoval golden shield
        if (e.gold) spawnFloat(e.target, "🛡️ BLOCKED", "golden-float");
        else spawnFloat(e.target, "🛡️ BLOCKED", "block-float");
      }
      if (e.kind === "heal" && (e.target === "p1" || e.target === "p2")) {
        spawnFloat(e.target, `+${e.amount ?? 1} HP`, "heal-float");
      }
    }
    if (shooters.has("p1")) { setAnim("p1", "attack", ATTACK_SWING_MS); lastAttackEndAt.p1 = performance.now() + ATTACK_SWING_MS; }
    if (shooters.has("p2")) { setAnim("p2", "attack", ATTACK_SWING_MS); lastAttackEndAt.p2 = performance.now() + ATTACK_SWING_MS; }

    renderGrid(state, frame.effects || []);
    positionActors(state);

    prev = frame;
    setTimeout(step, frame.delayMs ?? 600);
  };

  step();
}

/* ---------- Actors clear ---------- */
function clearActors() {
  [actorP1, actorP2].forEach(el => {
    const ctx = el.getContext("2d");
    ctx.clearRect(0, 0, el.width, el.height);
    el.style.display = "none";
    el.style.left = "0px"; el.style.top = "0px";
    el.style.transform = "translateX(0) scaleX(1)";
  });
  actorsInitialized = false;
}

/* ---------- Char select (preview) ---------- */
function drawCharSelectFrame(now) {
  const canvases = selEl.querySelectorAll("canvas.char-canvas");
  canvases.forEach((cvs) => {
    const key = cvs.dataset.char;
    const dir = CHAR_META[key]?.dir;
    if (!dir) return;
    const ctx = cvs.getContext("2d");
    // mág, ktorého abilitku pozeráme: cyklicky prehráva animáciu SPECIÁLU (efektový sprite, rovnako ako v hre),
    // v rovnakej veľkosti ako idle (centrovaný, nie zoomnutý)
    const fx = (key === abilityHoverChar) && SPECIAL_ANIMS[key];
    const anim = fx ? { file: SPECIAL_ANIMS[key].file, fps: SPECIAL_FPS, loop: true } : ANIM_DEF.idle;
    // lightning efekt má obsah posunutý vľavo vo frame -> dorovnaj doprava
    const offX = fx ? (FX_OFFSET_X[key] || 0) * cvs.width : 0;
    // canvas vypĺňa celú kartu; sprite väčší, mierne zdvihnutý hore (offsetY), orez je až na ráme karty
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height, 1.31, 0.98, true, offX, -52))
      .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
  });

  // malý castiaci mág v bunke castera mini-dosky — tiež animácia špeciálu (efektový sprite)
  if (abilityHoverChar && abilityCasterCanvas && SPECIAL_ANIMS[abilityHoverChar]) {
    const dir = CHAR_META[abilityHoverChar]?.dir;
    const fxAnim = { file: SPECIAL_ANIMS[abilityHoverChar].file, fps: SPECIAL_FPS, loop: true };
    const offX = (FX_OFFSET_X[abilityHoverChar] || 0) * abilityCasterCanvas.width;
    if (dir) ensureSpriteMeta(dir, fxAnim.file)
      .then(meta => drawSprite(abilityCasterCanvas.getContext("2d"), meta, fxAnim, now, abilityCasterCanvas.width, abilityCasterCanvas.height, 1.1, 0.5, true, offX))
      .catch(() => {});
  }

  if (!selEl.classList.contains("hidden")) {
    charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
  } else {
    charPreviewRaf = 0;
  }
}
function startCharSelectPreview() {
  abilityHoverChar = null; abilityCasterCanvas = null; // bez hoveru žiadny cast; náhľad sa zobrazí až po nadídení
  document.getElementById("char-ability")?.classList.add("hidden");
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
}
function stopCharSelectPreview() {
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = 0;
}

selEl.addEventListener("click", (e) => {
  const card = e.target.closest(".char-card");
  if (!card) return;
  const key = card.dataset.char;
  chosenChar = key;
  socket.emit("choose_character", key);
});

/* ---------- Náhľad špeciálu mága (hover vo výbere) ---------- */
const charAbilityEl = document.getElementById("char-ability");
// reprezentatívna pozícia castera, ktorá najlepšie ukáže tvar zásahu daného mága + cena many špeciálu
const SPECIAL_MANA = 5;
const ABILITY_PREVIEW = {
  fire:      { caster: { x: 0, y: 1 }, dmg: 5, desc: "Whole row" },
  lightning: { caster: { x: 1, y: 1 }, dmg: 3, desc: "Opposite-colour cells" },
  wanderer:  { caster: { x: 1, y: 1 }, dmg: 8, desc: "Diagonal neighbours" },
};
function renderAbilityPreview(char) {
  const def = ABILITY_PREVIEW[char];
  if (!def || !charAbilityEl) return;
  abilityHoverChar = char; // preview loop prepne tohto mága na cyklický cast špeciálu
  const w = board.w || 4, h = board.h || 3;
  const hit = new Set(cellsForSpecialPreview({ x: def.caster.x, y: def.caster.y, char }).map(([x, y]) => `${x},${y}`));
  const grid = document.getElementById("ca-grid");
  grid.style.gridTemplateColumns = `repeat(${w}, auto)`;
  grid.innerHTML = "";
  abilityCasterCanvas = null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = document.createElement("div");
    c.className = "mini-cell";
    if (def.caster.x === x && def.caster.y === y) {
      c.classList.add("caster");
      // malý castiaci mág priamo v bunke castera (rAF ho cyklicky kreslí)
      const mini = document.createElement("canvas");
      mini.className = "mini-caster";
      mini.width = 48; mini.height = 34;
      c.appendChild(mini);
      abilityCasterCanvas = mini;
    } else if (hit.has(`${x},${y}`)) {
      c.classList.add("hit");
    }
    grid.appendChild(c);
  }
  document.getElementById("ca-title").textContent = "SPECIAL ATTACK";
  document.getElementById("ca-text").textContent = def.desc;
  const stats = document.getElementById("ca-stats");
  stats.innerHTML = `<span class="ca-dmg"><span class="ca-num">${def.dmg}</span><span class="pix-ico" data-emoji="☠️"></span></span>`;
  hydratePix(stats);
  charAbilityEl.classList.remove("hidden");
}
function clearAbilityPreview() {
  abilityHoverChar = null;
  abilityCasterCanvas = null;
  charAbilityEl?.classList.add("hidden");
}
selEl.querySelectorAll(".char-card").forEach(card => {
  card.addEventListener("mouseenter", () => renderAbilityPreview(card.dataset.char));
});
selEl.querySelector(".char-cards")?.addEventListener("mouseleave", clearAbilityPreview);

/* ---------- Controls ---------- */
const moveBtn    = document.getElementById("move-btn");
const dirPicker  = document.getElementById("dir-picker");
const attackBtn  = document.getElementById("attack-btn");
const aimPicker  = document.getElementById("aim-picker");
const dashBtn    = document.getElementById("dash-btn");
const dashPicker = document.getElementById("dash-picker");

function shakeBtn(btn) {
  btn.classList.add("shake");
  setTimeout(() => btn.classList.remove("shake"), 400);
}

// otvorený smerový picker blokuje všetky ostatné akčné tlačidlá;
// odblokuje sa opätovným klikom na to isté tlačidlo (picker sa zavrie)
let openPicker = null; // null | "move" | "attack" | "dash"
const PICKERS = { move: dirPicker, attack: aimPicker, dash: dashPicker };
const PICKER_BTNS = { move: moveBtn, attack: attackBtn, dash: dashBtn };

// po LOCK IN aj počas prehrávania kola sú všetky tlačidlá zamknuté a stmavené
let lockedIn = false;
function uiLocked() {
  return lockedIn || playing || !!state?.[me]?.locked;
}

// vizuálne zámky: otvorený picker zamyká ostatné akčné tlačidlá, LOCK IN zamyká všetky
function actionButtonsAll() {
  const generic = [...document.querySelectorAll(".controls .actions button[data-act]")]
    .filter(b => !b.closest(".dir-picker"));
  return [
    moveBtn, attackBtn, dashBtn,
    document.getElementById("golden-btn"),
    document.getElementById("golden-mana-btn"),
    ...generic
  ].filter(Boolean);
}
function updateUiLocks() {
  const openBtn = openPicker ? PICKER_BTNS[openPicker] : null;
  const locked = uiLocked();
  actionButtonsAll().forEach(b => {
    b.classList.toggle("locked-ui", locked || (!!openPicker && b !== openBtn));
  });
  undoBtn.classList.toggle("locked-ui", locked);
}

function closePickers() {
  Object.values(PICKERS).forEach(p => p.classList.add("hidden"));
  openPicker = null;
  clearPreviewCells();
  updateUiLocks();
}
function togglePicker(kind, btn, usedType) {
  if (uiLocked()) return;
  if (openPicker === kind) { closePickers(); return; } // opätovný klik = zavrieť
  if (openPicker) { shakeBtn(btn); return; }           // iný picker je otvorený -> blokované
  if (myQueue.length >= 3 || myQueue.some(a => a.type === usedType)) {
    shakeBtn(btn);
    return;
  }
  PICKERS[kind].classList.remove("hidden");
  openPicker = kind;
  updateUiLocks();
}

// Move / Attack / Dash: najprv výber smeru v mini-popupe
moveBtn.addEventListener("click",   () => togglePicker("move", moveBtn, "move"));
attackBtn.addEventListener("click", () => togglePicker("attack", attackBtn, "attack"));
dashBtn.addEventListener("click",   () => togglePicker("dash", dashBtn, "dash"));

// Golden Shield: extra akcia pred kolom — toggle; starterovi sa zobrazuje zamknutý (vizuálny zámok)
const goldenBtn = document.getElementById("golden-btn");
goldenBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(goldenBtn); return; }
  if (!me || state?.starter === me) { shakeBtn(goldenBtn); return; }
  goldenArmed = !goldenArmed;
  goldenBtn.classList.toggle("armed", goldenArmed);
  renderQueue();
});

// Golden Mana Refill: extra akcia po konci kola — toggle, dostupný obom hráčom
const goldenManaBtn = document.getElementById("golden-mana-btn");
const gmCostEl = document.getElementById("gm-cost");
goldenManaBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  if (openPicker) { shakeBtn(goldenManaBtn); return; }
  if (!me || !state?.[me]?.char) return;
  goldenManaArmed = !goldenManaArmed;
  goldenManaBtn.classList.toggle("armed", goldenManaArmed);
  renderQueue();
});

function updateGoldenButton() {
  if (goldenBtn) {
    // viditeľný obom hráčom; starterovi zamknutý (zámok + neaktívny vzhľad)
    const inGame = !!me && !!state?.[me]?.char;
    goldenBtn.classList.toggle("hidden", !inGame);
    const isStarter = !!me && state?.starter === me;
    goldenBtn.classList.toggle("locked-perm", isStarter);
    if (isStarter && goldenArmed) {
      goldenArmed = false;
      goldenBtn.classList.remove("armed");
    }
  }
  if (goldenManaBtn) {
    const available = !!me && !!state?.[me]?.char;
    goldenManaBtn.classList.toggle("hidden", !available);
    // cena v HP rastie s každým použitím (1, 2, 3…)
    const cost = (state?.[me]?.manaRefills ?? 0) + 1;
    if (gmCostEl) { gmCostEl.innerHTML = `−${cost}${miniPix("❤️")} +6${miniPix("💧")}`; hydratePix(gmCostEl); }
  }
}

document.querySelectorAll(".controls button[data-act]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (uiLocked()) return;
    if (myQueue.length >= 3) return;

    // pri otvorenom pickeri sú klikateľné len jeho šípky — ostatné tlačidlá sú blokované
    const isPickerArrow = !!btn.closest(".dir-picker");
    if (openPicker && !isPickerArrow) { shakeBtn(btn); return; }

    const [type, arg] = btn.dataset.act.split(":");

    // každá akcia max 1× za kolo
    if (myQueue.some(a => a.type === type)) {
      shakeBtn(btn);
      return;
    }

    if (type === "move")      myQueue.push({ type: "move", dir: arg });
    if (type === "dash")      myQueue.push({ type: "dash", dir: arg });
    if (type === "recharge")  myQueue.push({ type: "recharge" });
    if (type === "attack")    myQueue.push({ type: "attack", dir: arg });
    if (type === "melee")     myQueue.push({ type: "melee" });
    if (type === "special")   myQueue.push({ type: "special" });
    if (type === "shield")    myQueue.push({ type: "shield" });
    if (type === "mirror")    myQueue.push({ type: "mirror" });

    if (isPickerArrow) closePickers();
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => {
  if (uiLocked()) return;
  myQueue.pop();
  renderQueue();
});
lockBtn.addEventListener("click", () => {
  if (playing) return; // počas prehrávania kola nelockuj
  if (uiLocked()) return;
  if (myQueue.length !== 3) {
    lockBtn.classList.add("shake");
    setTimeout(() => lockBtn.classList.remove("shake"), 400);
    return;
  }
  const payload = [...myQueue];
  if (goldenArmed) payload.unshift({ type: "golden_shield" });
  if (goldenManaArmed) payload.push({ type: "golden_mana" });
  socket.emit("lock_in", payload);
  lockedIn = true; // všetky tlačidlá idú do locked stavu až do konca kola
  closePickers();
  lockBtn.classList.add("locked");
  lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED";
  lockBtn.disabled = true;
  stopTurnTimer();
});

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => { socket.emit("retry"); });

/* ---------- Phase UI (lobby / waiting / char-select) ---------- */
const otherSlot = () => (me === "p1" ? "p2" : me === "p2" ? "p1" : null);

function applyPhaseUI(s) {
  const phase = s?.phase || "playing";
  const controls = document.querySelector(".controls-row");

  // lobby: host vidí nastavenia, druhý hráč čaká
  if (phase === "lobby" && !isSpectator) {
    if (isHost) { showLobby(s); lobbyWaitEl.classList.add("hidden"); }
    else { lobbyEl.classList.add("hidden"); lobbyWaitEl.classList.remove("hidden"); }
  } else {
    lobbyEl.classList.add("hidden");
    lobbyWaitEl.classList.add("hidden");
  }

  // char-select len v hernej fáze, kým nemám zvolenú postavu
  const needChar = phase === "playing" && !isSpectator && me && !s?.[me]?.char;
  if (needChar) { selEl.classList.remove("hidden"); startCharSelectPreview(); }
  else if (!selEl.classList.contains("hidden")) { selEl.classList.add("hidden"); stopCharSelectPreview(); }

  if (controls && !isSpectator) controls.style.display = (phase === "playing") ? "" : "none";
}

// séria (BO3/BO5): v HUD boxe každého hráča rad placeholderov, ktoré sa po vyhratej hre menia na koruny
function renderSeriesCrowns(ser) {
  const single = !ser || !ser.format || ser.format === "single";
  if (single) {
    crownsP1El.classList.add("hidden"); crownsP2El.classList.add("hidden");
    crownsP1El.innerHTML = ""; crownsP2El.innerHTML = "";
    return;
  }
  const needed = ser.needed || 1;
  // nezískaná hra -> obrys koruny; získaná -> plná pixel-art koruna
  const build = (won) => Array.from({ length: needed },
    (_, i) => `<span class="crown${i < won ? " won" : ""}">${pixSvg(i < won ? "crown" : "crown_outline")}</span>`).join("");
  // koruny sú viazané na slot (ľavá/pravá strana); osoba si svoje výhry nesie na svoju aktuálnu stranu
  crownsP1El.innerHTML = build(ser.winsP1 || 0);
  crownsP2El.innerHTML = build(ser.winsP2 || 0);
  crownsP1El.classList.remove("hidden"); crownsP2El.classList.remove("hidden");
}
function updateMatchScore(s) {
  renderSeriesCrowns(s?.phase === "lobby" ? null : s?.series);
}

/* ---------- Turn timer (server-riadený displej + auto-lock) ---------- */
// server posiela zostávajúci čas (event `turn_timer` aj `state.timerMs`), takže displej sedí so serverom
// a po refreshi sa zosynchronizuje; klient pri vypršaní auto-lockne (drží už rozpracovanú frontu)
const TIMER_DIRS = ["up", "down", "left", "right"];
let serverTimerEndsAt = 0; // performance.now()-based deadline zo servera (0 = bez limitu)

// DOČASNÁ DIAGNOSTIKA časovača — zapni cez ?tdebug=1; loguje prečo sa časovač (ne)zobrazí
const TDEBUG = new URLSearchParams(location.search).has("tdebug");
const tlog = (...a) => { if (TDEBUG) console.log("[timer]", ...a); };
let _lastPlanning = null;

function setServerTimer(ms) {
  serverTimerEndsAt = (ms == null) ? 0 : performance.now() + ms;
  tlog("setServerTimer", ms);
}
function stopTurnTimer() {
  serverTimerEndsAt = 0;
  turnTimerEl.classList.add("hidden");
  turnTimerEl.classList.remove("urgent", "below-status");
}
// tik (volaný z raf): odpočet zobraz len počas plánovania; pri vypršaní auto-lockne
function tickTurnTimer(now) {
  const mine = state?.[me];
  const planning = !!serverTimerEndsAt && !playing && !gameOverShown && state?.phase === "playing"
    && !isSpectator && mine?.char && state?.[otherSlot()]?.char && !mine.locked;
  if (TDEBUG && planning !== _lastPlanning) {
    _lastPlanning = planning;
    tlog(`planning=${planning}`, {
      timerEndsAt: !!serverTimerEndsAt, playing, gameOverShown, phase: state?.phase,
      isSpectator, me, mineChar: mine?.char, otherChar: state?.[otherSlot()]?.char, mineLocked: mine?.locked,
    });
  }
  if (!planning) {
    turnTimerEl.classList.add("hidden");
    turnTimerEl.classList.remove("urgent", "below-status");
    return;
  }
  const remain = Math.max(0, serverTimerEndsAt - now);
  turnTimerEl.classList.remove("hidden");
  turnTimerEl.classList.toggle("below-status", state?.config?.timer === "quickdraw"); // pod „OPPONENT IS READY"
  turnTimerEl.textContent = `⏱ ${Math.ceil(remain / 1000)}`;
  turnTimerEl.classList.toggle("urgent", remain <= 5000);
  if (remain <= 0) { serverTimerEndsAt = 0; autoLockTimeout(); }
}
// vyprší čas — náhodne doplň nevyplnené z 3 základných akcií a zamkni (gold akcie sa nikdy nepridajú samé)
function autoLockTimeout() {
  if (uiLocked() || playing || !me || state?.[me]?.locked) { stopTurnTimer(); return; }
  const used = new Set(myQueue.map(a => a.type));
  const pool = ["recharge", "shield", "mirror", "melee", "special", "move", "dash", "attack"].filter(t => !used.has(t));
  while (myQueue.length < 3 && pool.length) {
    const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    if (t === "move" || t === "attack" || t === "dash") myQueue.push({ type: t, dir: TIMER_DIRS[Math.floor(Math.random() * 4)] });
    else myQueue.push({ type: t });
  }
  const payload = [...myQueue];
  if (goldenArmed) payload.unshift({ type: "golden_shield" });
  if (goldenManaArmed) payload.push({ type: "golden_mana" });
  socket.emit("lock_in", payload);
  lockedIn = true;
  closePickers();
  renderQueue();
  lockBtn.classList.add("locked"); lockBtn.classList.remove("ready");
  lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  stopTurnTimer();
}

/* ---------- Lobby (host nastavuje zápas) ---------- */
let lobbyBuilt = false;
function showLobby() {
  lobbyEl.classList.remove("hidden");
  if (lobbyBuilt) return;
  lobbyBuilt = true;

  // segmentové prepínače: klik nastaví .active v rámci skupiny
  lobbyEl.querySelectorAll(".opt-row").forEach(row => {
    row.addEventListener("click", (e) => {
      const btn = e.target.closest(".opt");
      if (!btn) return;
      row.querySelectorAll(".opt").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  const sumEl = document.getElementById("lobby-weights-sum");
  const startBtn = document.getElementById("lobby-start");
  const inputs = [...lobbyEl.querySelectorAll("#lobby-weights input")];
  const refreshSum = () => {
    const sum = inputs.reduce((a, i) => a + (parseInt(i.value, 10) || 0), 0);
    sumEl.textContent = `Total: ${sum}%`;
    const ok = sum === 100;
    sumEl.classList.toggle("bad", !ok);
    startBtn.disabled = !ok;
  };
  inputs.forEach(i => i.addEventListener("input", refreshSum));
  refreshSum();

  startBtn.addEventListener("click", () => {
    const pick = (id) => lobbyEl.querySelector(`#${id} .opt.active`)?.dataset.val;
    const weights = {};
    inputs.forEach(i => { weights[i.dataset.key] = parseInt(i.value, 10) || 0; });
    const config = {
      format: pick("lobby-format") || "single",
      tilesPerRound: parseInt(pick("lobby-tiles-count") || "1", 10),
      tileWeights: weights,
      timer: pick("lobby-timer") || "off",
    };
    if (Object.values(weights).reduce((a, b) => a + b, 0) !== 100) return;
    socket.emit("configure_match", config);
  });
}

/* ---------- Intermission (medzi hrami série) ---------- */
function showIntermission(gameWinner, series) {
  const mineWon = me && gameWinner === me;
  document.getElementById("im-title").textContent =
    gameWinner === "draw" ? "TIE" : (mineWon ? "YOU WON THIS GAME!" : "YOU LOST THIS GAME");

  const needed = series?.needed || 1;
  // placeholdery + koruny pre obe strany; práve získaná koruna (posledná na víťaznej strane) sa animuje
  const renderSide = (won, isWinnerSide) => Array.from({ length: needed }, (_, i) => {
    const isWon = i < (won || 0);
    const isNew = isWinnerSide && i === (won || 0) - 1;
    return `<span class="crown${isNew ? " new" : ""}">${pixSvg(isWon ? "crown" : "crown_outline")}</span>`;
  }).join("");
  document.getElementById("im-crowns-l").innerHTML = renderSide(series?.winsP1, gameWinner === "p1");
  document.getElementById("im-crowns-r").innerHTML = renderSide(series?.winsP2, gameWinner === "p2");

  // popisky strán — kde som ja (slot pred swapom), drží strany ako koruny v HUD
  const whoL = document.getElementById("im-who-l");
  const whoR = document.getElementById("im-who-r");
  whoL.textContent = me === "p1" ? "YOU" : "OPPONENT";
  whoR.textContent = me === "p2" ? "YOU" : "OPPONENT";
  whoL.className = "im-who " + (me === "p1" ? "you" : "opp");
  whoR.className = "im-who " + (me === "p2" ? "you" : "opp");

  document.getElementById("im-next").textContent = "Next game starting…";
  intermissionEl.classList.remove("hidden");
}

/* ---------- Sockets ---------- */
// you_are nesie slot (ľavá/pravá rola, mení sa medzi hrami série) aj či som host
socket.on("you_are", (info) => {
  if (info && typeof info === "object") { me = info.slot; isHost = !!info.isHost; }
  else { me = info; } // spätná kompat.
});

// hra je plná — divák hru sleduje, ale nemá výber postavy ani ovládanie (box s hláškou dole)
let isSpectator = false;
socket.on("spectator", () => {
  isSpectator = true;
  document.getElementById("spectator")?.classList.remove("hidden");
  selEl.classList.add("hidden");
  stopCharSelectPreview();
  const controls = document.querySelector(".controls-row");
  if (controls) controls.style.display = "none";
});

socket.on("reset", () => {
  playGen++;        // zruš prípadné bežiace prehrávanie
  playing = false;

  // reset game-over stavov ešte pred renderHUD — inak by guard nechal visieť GAME OVER text
  serverWinner = null;
  serverGameResult = null;
  gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  stopTurnTimer();
  intermissionEl.classList.add("hidden");

  goOverlay.classList.add("hidden");
  chosenChar = null;
  dirPicker.classList.add("hidden");
  aimPicker.classList.add("hidden");
  clearActionLogs();
  myQueue = [];
  goldenArmed = false;
  goldenManaArmed = false;
  lockedIn = false;
  document.getElementById("golden-btn")?.classList.remove("armed");
  document.getElementById("golden-mana-btn")?.classList.remove("armed");
  closePickers();
  renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  castingNow = { p1:false, p2:false };
  facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
  clearActors();
  lockBtn.classList.remove("locked");
  lockBtn.disabled = false;
  lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
  // char-select / lobby riadi applyPhaseUI z nasledujúceho state eventu
  renderGrid({}, []);
  renderHUD();
});

socket.on("state", (s) => {
  tlog("recv state", { phase: s.phase, timerMs: s.timerMs, timeline: !!s.timeline, p1c: s.p1?.char, p2c: s.p2?.char, playing });
  state = s; board = s.board || board;

  // arena
  if (s.arena && s.arena !== arenaEl.dataset.key) {
    arenaEl.dataset.key = s.arena;
    const ARENAS_CLIENT = { bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"] };
    renderArenaLayers(s.arena, ARENAS_CLIENT[s.arena] || []);
  }

  // lobby / čakanie / char-select podľa fázy hry
  applyPhaseUI(s);
  updateMatchScore(s);

  if (s.timeline) {
    // finálny stav (vrátane nových tiles) nevykresľuj hneď — ukáže ho až posledný frame timeline
    schedulePlayTimeline(s.timeline);
  } else if (!playing) {
    renderGrid(s);
    renderHUD();
    positionActors(s, true);
    updateLockButton();
  }
  // počas prehrávania snapshot bez timeline nevykresľuj — framy bežiacej timeline majú prednosť

  // label special podľa mága (len cost badge + tooltip, ikonu nechaj)
  const mine = s[me];
  const dmg = mine?.char ? { fire:5, lightning:3, wanderer:8 }[mine.char] : null;
  const specialBtn = document.getElementById("special-btn");
  if (dmg != null && specialBtn) {
    specialBtn.title = `Special (−5 mana, ${dmg} dmg)`;
    const cost = specialBtn.querySelector(".cost");
    if (cost) { cost.innerHTML = `−5${miniPix("💧")} ${dmg}${miniPix("☠️")}`; hydratePix(cost); }
  }

  setServerTimer(s.timerMs ?? null); // synchronizuj odpočet so serverom (drží aj po refreshi)
});

// server posiela zostávajúci čas na ťah — klient sa naň synchronizuje (displej + auto-lock)
socket.on("turn_timer", ({ ms }) => { tlog("recv turn_timer", ms); setServerTimer(ms); });

// Server stále posiela "game_over" – len si zapamätáme, nezobrazíme hneď overlay.
// Overlay zobrazíme až po dobehnutí útoku a animácii smrti.
socket.on("game_over", ({ winner }) => {
  serverWinner = winner;
});

// výsledok jednej hry série — vyhodnotí sa až na konci prehrávania timeline
socket.on("game_result", (r) => { serverGameResult = r; });

// medzi hrami série: resetuj UI kola (skóre ostáva), char-select pre ďalšiu hru riadi nasledujúci state
socket.on("new_game", () => {
  tlog("recv new_game");
  playGen++; playing = false;
  serverWinner = null; serverGameResult = null; gameOverShown = false;
  lastAttackEndAt = { p1:0, p2:0 };
  stopTurnTimer();
  intermissionEl.classList.add("hidden");
  goOverlay.classList.add("hidden");
  chosenChar = null;
  dirPicker.classList.add("hidden"); aimPicker.classList.add("hidden");
  clearActionLogs();
  myQueue = []; goldenArmed = false; goldenManaArmed = false; lockedIn = false;
  document.getElementById("golden-btn")?.classList.remove("armed");
  document.getElementById("golden-mana-btn")?.classList.remove("armed");
  closePickers(); renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  castingNow = { p1:false, p2:false };
  facingOverride = { p1: { sx: 0, until: 0 }, p2: { sx: 0, until: 0 } };
  clearActors();
  lockBtn.classList.remove("locked"); lockBtn.disabled = false; lockBtn.textContent = "LOCK IN";
  if (hudTurn) hudTurn.textContent = "";
});

/* ---------- RAF: actors + FX ---------- */
function raf() {
  const now = performance.now();
  const map = { p1: actorP1, p2: actorP2 };

  tickTurnTimer(now); // odpočet času na ťah (auto-lock pri vypršaní)

  // po vypršaní facing override (streľba do strany) otoč postavu späť k súperovi —
  // positionActors sa inak volá len pri timeline frame-och, takže posledná akcia kola by ostala "visieť"
  for (const slot of ["p1", "p2"]) {
    const ov = facingOverride[slot];
    if (ov.sx && now >= ov.until) {
      ov.sx = 0;
      if (state?.p1 && state?.p2) positionActors(state);
    }
  }

  ["p1","p2"].forEach(slot => {
    const cvs = map[slot];
    const st  = state?.[slot];
    const ctx = cvs.getContext("2d");

    if (!st || !st.char) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.style.display = "none";
      return;
    }
    cvs.style.display = "block";

    const dir  = CHAR_META[st.char].dir;
    // victory = slučka special efektu daného mága (nie melee švih) priamo na actor canvase
    const anim = animState[slot].key === "victory"
      ? { file: SPECIAL_ANIMS[st.char].file, fps: SPECIAL_FPS, loop: true }
      : currentAnim(slot);
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, ACTOR_W, ACTOR_H))
      .catch(() => ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(metaIdle => drawSprite(ctx, metaIdle, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(()=>{}));
  });

  // ghost vlastnej pozície po naplánovaných movoch (len počas plánovania)
  {
    const ctx = actorGhost.getContext("2d");
    const mine = state?.[me];
    const gp = ghostPos();
    const show = mine && mine.char && !mine.locked && !playing && gp &&
                 myQueue.some(a => a.type === "move" || a.type === "dash") &&
                 (gp.x !== mine.x || gp.y !== mine.y);
    if (!show) {
      ctx.clearRect(0, 0, actorGhost.width, actorGhost.height);
      actorGhost.style.display = "none";
    } else {
      actorGhost.style.display = "block";
      const { left, top } = cellToPx(gp.x, gp.y);
      actorGhost.style.left = (left - (ACTOR_W - TILE_W) / 2) + "px";
      actorGhost.style.top  = (top - (ACTOR_H - TILE_H)) + "px";
      // rovnaký flip ako hráčov sprite — postava je vo frame mimo stredu, bez flipu vyzerá posunutá
      actorGhost.style.transform = `scaleX(${computeFacing(state.p1, state.p2)[me]})`;
      const dir = CHAR_META[mine.char].dir;
      ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(meta => drawSprite(ctx, meta, ANIM_DEF.idle, now, ACTOR_W, ACTOR_H))
        .catch(() => {});
    }
  }

  // HUD náhľady vybraných postáv + degradácia portrétu podľa HP (Doom-style)
  [["p1", hudCharP1], ["p2", hudCharP2]].forEach(([slot, cvs]) => {
    const st  = state?.[slot];
    const ctx = cvs.getContext("2d");
    if (!st || !st.char) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.classList.remove("wounded", "critical", "dead");
      return;
    }
    const hp = st.hp ?? 10;
    cvs.classList.toggle("wounded",  hp > 3 && hp <= 6);
    cvs.classList.toggle("critical", hp > 0 && hp <= 3);
    cvs.classList.toggle("dead",     hp <= 0);

    // mŕtvy: prehraj Dead raz od momentu úmrtia a zamrzni na poslednom frame
    const dir = CHAR_META[st.char].dir;
    let anim = ANIM_DEF.idle, t = now;
    if (hp <= 0) {
      if (!hudDeadSince[slot]) hudDeadSince[slot] = now;
      anim = ANIM_DEF.dead;
      t = now - hudDeadSince[slot];
    } else {
      hudDeadSince[slot] = 0;
    }
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, t, cvs.width, cvs.height))
      .catch(() => {});
  });

  // projectiles
  document.querySelectorAll("canvas.charge-canvas").forEach(cvs => {
    const ctx = cvs.getContext("2d");
    const dir = cvs.dataset.dir;
    ensureSpriteMeta(dir, CHARGE_ANIM.file)
      .then(meta => drawSprite(ctx, meta, CHARGE_ANIM, now, cvs.width, cvs.height))
      .catch(() => {});
  });

  // specials v strede
  document.querySelectorAll("canvas.special-center").forEach(cvs => {
    const ctx  = cvs.getContext("2d");
    const dir  = cvs.dataset.dir;
    const file = cvs.dataset.file;
    const anim = { file, fps: Number(cvs.dataset.fps) || SPECIAL_FPS, loop: true };
    ensureSpriteMeta(dir, file)
      .then(meta => drawSprite(ctx, meta, anim, performance.now(), cvs.width, cvs.height))
      .catch(()=>{});
  });

  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/* ---------- Initial ---------- */
// hydratácia pixel ikon — [data-emoji] dostanú pixelizovaný emoji canvas,
// [data-pix] ručne kreslené SVG z PIX knižnice (HP/mana v HUD)
hydratePix();
document.querySelectorAll(".pix-ico[data-pix]").forEach(el => { el.innerHTML = pixSvg(el.dataset.pix); });

gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE_H}px)`;
renderGrid({}, []);
renderHUD();
renderQueue();
clearActionLogs(); // skeleton placeholderov v zázname kola od začiatku

// hover preview pre special
const specialBtn = document.getElementById("special-btn");
if (specialBtn){
  // preview z ghost pozície — special by sa vykonal po už naplánovaných akciách
  specialBtn.addEventListener("mouseenter", ()=>{
    const mine = state?.[me];
    const p = ghostPos();
    if (!mine?.char || !p) return;
    showPreviewCells(cellsForSpecialPreview({ x: p.x, y: p.y, char: mine.char }));
  });
  specialBtn.addEventListener("mouseleave", clearPreviewCells);
}

// hover preview zásahovej bunky melee — vlastná bunka z ghost pozície po naplánovaných akciách
const meleeBtn = document.querySelector('.controls button[data-act="melee"]');
if (meleeBtn) {
  meleeBtn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (p) showPreviewCells([[p.x, p.y]]);
  });
  meleeBtn.addEventListener("mouseleave", clearPreviewCells);
}

// hover preview dráhy strely na šípkach aim pickeru — z ghost pozície po naplánovaných akciách
aimPicker.querySelectorAll("button[data-act]").forEach(btn => {
  const dir = btn.dataset.act.split(":")[1];
  btn.addEventListener("mouseenter", () => {
    const p = ghostPos();
    if (!p) return;
    showPreviewCells(cellsForAimPreview(p, dir));
  });
  btn.addEventListener("mouseleave", clearPreviewCells);
});

/* ---------- Admin reset button (zobraz len s ?admin=1) ---------- */
(function mountAdminReset(){
  const qp = new URLSearchParams(location.search);
  if (!qp.has("admin")) return; // zobraz len pre admin režim

  const key = qp.get("key") || "";
  const btn = document.createElement("button");
  btn.id = "admin-reset";
  btn.textContent = "Reset session";
  btn.title = "Disconnects all players and restarts the game";
  btn.style.position = "fixed";
  btn.style.right = "14px";
  btn.style.bottom = "14px";
  btn.style.zIndex = "50";
  btn.style.padding = "10px 14px";
  btn.style.borderRadius = "10px";
  btn.style.border = "1px solid #5a1a1a";
  btn.style.background = "#8e0000";
  btn.style.color = "#fff";
  btn.style.fontWeight = "800";
  btn.style.cursor = "pointer";
  btn.style.boxShadow = "0 6px 18px rgba(0,0,0,.35)";

  btn.addEventListener("click", () => {
    if (!confirm("Really reset the game and disconnect all players?")) return;
    socket.emit("admin_reset_all", key);
    fetch(`/admin/reset-all${key ? `?key=${encodeURIComponent(key)}` : ""}`).catch(()=>{});
  });

  document.body.appendChild(btn);
})();
