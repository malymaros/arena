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
const hudHp    = document.getElementById("hud-hp");
const hudMana  = document.getElementById("hud-mana");

const goOverlay= document.getElementById("gameover");
const goText   = document.getElementById("go-text");
const retryBtn = document.getElementById("retry");

const cs = getComputedStyle(document.documentElement);
const TILE = parseInt(cs.getPropertyValue("--tile")) || 224;
const GAP  = parseInt(getComputedStyle(gridEl).gap || "10") || 10;

const MOVE_MS = 1000;          // musí ladiť so serverom (MOVE_FRAME_MS)
const ATTACK_SWING_MS = 800;
const HURT_MS = 800;

const CHAR_META = {
  fire:      { name: "Fire Wizard",      dir: "fire" },
  lightning: { name: "Lightning Mage",   dir: "lightning" },
  wanderer:  { name: "Wanderer Magician",dir: "wanderer" }
};
const ANIM_DEF = {
  idle:    { file: "Idle.png",     fps: 6,  loop: true  },
  run:     { file: "Run.png",      fps: 12, loop: true  },
  attack:  { file: "Attack_1.png", fps: 10, loop: false },
  attack2: { file: "Attack_2.png", fps: 10, loop: true  },
  hurt:    { file: "Hurt.png",     fps: 10, loop: false },
  dead:    { file: "Dead.png",     fps: 7,  loop: false }
};

let me = null;
let board = { w: 5, h: 3 };
let state = { p1:null, p2:null, arena:null, turn:1, starter:"p1" };
let myQueue = [];
let chosenChar = null;

let animState = { p1: { key:"idle", until:0 }, p2: { key:"idle", until:0 } };
const SPRITES = {};
let actorsInitialized = false;

// --- char-select preview helpers ---
let charPreviewRaf = 0;
const CHAR_KEYS = Object.keys(CHAR_META);

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
function drawSprite(ctx, meta, anim, t, dstW=TILE, dstH=TILE) {
  const idx = anim.loop ? Math.floor((t / (1000 / anim.fps)) % meta.frames)
                        : Math.min(meta.frames - 1, Math.floor(t / (1000 / anim.fps)));
  const sx = idx * meta.fw;
  const scale = Math.min(dstW / meta.fw, dstH / meta.fh) * 0.95;
  const dw = meta.fw * scale, dh = meta.fh * scale;
  const dx = (dstW - dw) / 2, dy = (dstH - dh) / 2;
  ctx.clearRect(0, 0, dstW, dstH);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(meta.img, sx, 0, meta.fw, meta.fh, dx, dy, dw, dh);
}

/* ---------- animation state ---------- */
function setAnim(slot, key, durationMs = 0) {
  const def = ANIM_DEF[key] ?? ANIM_DEF.idle;
  animState[slot].key = key;

  // aj pre loop animácie vieme nastaviť "časovač" (napr. run)
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
    if (st.key !== "dead" && st.key !== "attack2") {
      animState[slot].key = "idle";
      animState[slot].until = 0;
      return ANIM_DEF.idle;
    }
  }
  return def;
}

/* ---------- arena ---------- */
function renderArenaLayers(arenaKey, layerFiles) {
  arenaEl.innerHTML = "";
  if (!arenaKey || !Array.isArray(layerFiles) || !layerFiles.length) return;
  layerFiles.forEach((file, i) => {
    const img = document.createElement("img");
    img.className = "layer";
    img.style.zIndex = String(i);
    img.src = `/arenas/${arenaKey}/${file}`;
    arenaEl.appendChild(img);
  });
}

/* ---------- HUD ---------- */
function renderHUD() {
  hudTurn.textContent = `Kolo ${state.turn} — Začína ${state.starter?.toUpperCase?.() || "-"}`;
  if (!me || !state[me]) { hudHp.textContent = ""; hudMana.textContent = ""; return; }
  hudHp.textContent = `HP: ${state[me].hp}`;
  hudMana.textContent = `Mana: ${state[me].mana}`;
}

/* ---------- Grid (efekty) ---------- */
function renderGrid(s, effects = []) {
  gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE}px)`;
  gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE}px)`;
  gridEl.innerHTML = "";

  const blue = new Set();
  const proj = new Map();
  let hitTarget = null;

  for (const e of effects) {
    if (e?.kind === "recharge") for (const [x,y] of e.cells || []) blue.add(`${x},${y}`);
    if (e?.kind === "projectile") proj.set(`${e.cell[0]},${e.cell[1]}`, e.from);
    if (e?.kind === "hit") hitTarget = e.target;
  }

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      const key = `${x},${y}`;
      if (blue.has(key)) cell.classList.add("hl-recharge");
      if (proj.has(key)) cell.classList.add("hl-projectile");

      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");

      gridEl.appendChild(cell);
    }
  }
}

/* ---------- Actors (plynulý pohyb) ---------- */
function cellToPx(x, y) {
  return { left: x * (TILE + GAP), top: y * (TILE + GAP) };
}
function computeFacing(p1, p2) {
  if (!p1 || !p2) return { p1: 1, p2: -1 };
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
function positionActors(s, immediate = false) {
  const p1 = s.p1, p2 = s.p2;
  const same = p1 && p2 && p1.x === p2.x && p1.y === p2.y;
  const facing = computeFacing(p1, p2);

  [["p1", actorP1, p1], ["p2", actorP2, p2]].forEach(([slot, el, data]) => {
    if (!data || !data.char) { el.style.display = "none"; return; }

    el.style.display = "block";
    const { left, top } = cellToPx(data.x, data.y);

    if (immediate || !actorsInitialized) {
      el.style.transition = "none";
      el.style.left = left + "px";
      el.style.top  = top + "px";
      void el.offsetHeight;
      el.style.transition = ""; // späť na CSS
    } else {
      el.style.left = left + "px";
      el.style.top  = top + "px";
    }

    const shift = same ? (slot === "p1" ? -22 : 22) : 0;
    const scale = facing[slot];
    el.style.transform = `translateX(${shift}px) scaleX(${scale})`;

    el.dataset.slot = slot;
    if (same) el.dataset.pair = "1"; else el.removeAttribute("data-pair");
  });

  actorsInitialized = true;
}

/* ---------- Queue UI ---------- */
function renderQueue() {
  queueEl.innerHTML = "";
  myQueue.forEach(a => {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = a.type === "move" ? `move:${a.dir}` : a.type;
    queueEl.appendChild(div);
  });
}

/* ---------- Winner fallback ---------- */
function computeWinnerFromState(s) {
  const dead1 = !s?.p1 || s.p1.hp <= 0;
  const dead2 = !s?.p2 || s.p2.hp <= 0;
  if (dead1 && dead2) return "draw";
  if (dead1) return "p2";
  if (dead2) return "p1";
  return null;
}

/* ---------- Timeline prehrávanie ---------- */
function schedulePlayTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return;

  // prvý frame bez prechodu
  const first = timeline[0];
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn;
  renderHUD();
  renderGrid(state, first.effects || []);
  positionActors(state, true);

  let i = 1;
  let prev = first;

  const step = () => {
    if (i >= timeline.length) {
      const winner = computeWinnerFromState(state);
      if (winner) {
        if (goOverlay.classList.contains("hidden")) {
          const loser = winner === "p1" ? "p2" : "p1";
          if (winner !== "draw") { setAnim(winner, "attack2", 0); setAnim(loser, "dead", 1200); }
          goText.textContent = winner === "draw" ? "GAME OVER — Remíza" : `GAME OVER — ${winner.toUpperCase()} vyhral`;
          goOverlay.classList.remove("hidden");
        }
        return; // nenechávame odomknuté UI
      }

      renderGrid(state, []);
      renderHUD();
      myQueue = []; renderQueue();
      lockBtn.disabled = false;
      return;
    }

    const frame = timeline[i++];

    const beforeP1 = prev?.p1 || state.p1;
    const beforeP2 = prev?.p2 || state.p2;

    state.p1 = frame.p1; state.p2 = frame.p2; state.turn = frame.turn;
    renderHUD();

    // pohyb => bež Run celých MOVE_MS
    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y)) setAnim("p1", "run", MOVE_MS);
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y)) setAnim("p2", "run", MOVE_MS);

    // útoky / zásahy
    const shooters = new Set();
    for (const e of frame.effects || []) {
      if ((e.kind === "projectile" || e.kind === "attack_swing") && e.from) shooters.add(e.from);
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) setAnim(e.target, "hurt", HURT_MS);
    }
    if (shooters.has("p1")) setAnim("p1", "attack", ATTACK_SWING_MS);
    if (shooters.has("p2")) setAnim("p2", "attack", ATTACK_SWING_MS);

    renderGrid(state, frame.effects || []);
    positionActors(state); // plynulý presun cez CSS transition

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
    el.style.left = "0px";
    el.style.top  = "0px";
    el.style.transform = "translateX(0) scaleX(1)";
  });
  actorsInitialized = false;
}

/* ---------- Char select (preview) ---------- */
function drawCharSelectFrame(now) {
  const canvases = selEl.querySelectorAll("canvas.char-canvas");
  canvases.forEach((cvs) => {
    const key = cvs.dataset.char;
    const dir = CHAR_META[key].dir;
    const ctx = cvs.getContext("2d");
    const anim = ANIM_DEF.idle;
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height))
      .catch(() => {
        ctx.clearRect(0, 0, cvs.width, cvs.height);
      });
  });
  if (!selEl.classList.contains("hidden")) {
    charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
  } else {
    charPreviewRaf = 0;
  }
}
function startCharSelectPreview() {
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = requestAnimationFrame(drawCharSelectFrame);
}
function stopCharSelectPreview() {
  if (charPreviewRaf) cancelAnimationFrame(charPreviewRaf);
  charPreviewRaf = 0;
}

// klik na kartu – NESKRÝVAME overlay, počkáme na potvrdenie od servera (state s char)
selEl.addEventListener("click", (e) => {
  const card = e.target.closest(".char-card");
  if (!card) return;
  const key = card.dataset.char;
  chosenChar = key;
  socket.emit("choose_character", key);
});

/* ---------- Controls ---------- */
document.querySelectorAll(".controls button[data-act]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (myQueue.length >= 3) return;
    const [type, arg] = btn.dataset.act.split(":");
    if (type === "move") myQueue.push({ type: "move", dir: arg });
    if (type === "recharge") myQueue.push({ type: "recharge" });
    if (type === "attack") myQueue.push({ type: "attack" });
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => { myQueue.pop(); renderQueue(); });
document.getElementById("lock").addEventListener("click", () => {
  if (myQueue.length !== 3) return;
  socket.emit("lock_in", myQueue);
  lockBtn.disabled = true;
});

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => {
  socket.emit("retry");
});

/* ---------- Sockets ---------- */
socket.on("you_are", (slot) => { me = slot; });

socket.on("reset", () => {
  goOverlay.classList.add("hidden");
  chosenChar = null;
  myQueue = []; renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  clearActors();
  selEl.classList.remove("hidden");
  startCharSelectPreview();
  renderGrid({}, []);
  renderHUD();
});

socket.on("state", (s) => {
  state = s; board = s.board || board;

  // aréna
  if (s.arena && s.arena !== arenaEl.dataset.key) {
    arenaEl.dataset.key = s.arena;
    const ARENAS_CLIENT = { bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"] };
    renderArenaLayers(s.arena, ARENAS_CLIENT[s.arena] || []);
  }

  // výber postavy (zobraziť/ skryť overlay podľa potvrdenia zo servera)
  if (!s[me]?.char) {
    selEl.classList.remove("hidden");
    startCharSelectPreview();
  } else {
    if (!selEl.classList.contains("hidden")) {
      selEl.classList.add("hidden");
      stopCharSelectPreview();
    }
  }

  renderGrid(s);
  renderHUD();

  if (s.timeline) {
    schedulePlayTimeline(s.timeline);
  } else {
    positionActors(s, true);       // dôležité pre prvé vykreslenie po výbere/po retry
    lockBtn.disabled = s[me]?.locked ?? false;
  }
});

socket.on("game_over", ({ winner }) => {
  const loser = winner === "p1" ? "p2" : "p1";
  if (winner !== "draw") { setAnim(winner, "attack2", 0); setAnim(loser, "dead", 1200); }
  goText.textContent = winner === "draw" ? "GAME OVER — Remíza" : `GAME OVER — ${winner.toUpperCase()} vyhral`;
  goOverlay.classList.remove("hidden");
});

/* ---------- RAF: kreslenie postáv ---------- */
function raf() {
  const now = performance.now();
  const map = { p1: actorP1, p2: actorP2 };

  ["p1","p2"].forEach(slot => {
    const cvs = map[slot];
    const st = state?.[slot];
    const ctx = cvs.getContext("2d");

    if (!st || !st.char) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.style.display = "none";
      return;
    }
    cvs.style.display = "block";

    const dir = CHAR_META[st.char].dir;
    const anim = currentAnim(slot);

    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, TILE, TILE))
      .catch(() => {
        const idle = ANIM_DEF.idle;
        return ensureSpriteMeta(dir, idle.file)
          .then(metaIdle => drawSprite(ctx, metaIdle, idle, now, TILE, TILE))
          .catch(() => {});
      });
  });

  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/* ---------- Initial ---------- */
gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE}px)`;
gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE}px)`;
renderGrid({}, []);
renderHUD();
renderQueue();
