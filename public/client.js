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

// === Timing (2× pomalšie) ===
const MOVE_MS = 2000;               // bolo 1000
const ATTACK_SWING_MS = 1600;       // bolo 800
const HURT_MS = 1600;               // bolo 800

// Projektil (vizuálny FPS môžete ponechať; let spomaľuje server)
const CHARGE_SCALE = 1.0;
const CHARGE_ANIM  = { file: "Charge.png", fps: 8, loop: true }; // mierne pomalšie

// Special anim (pomalší FPS)
const SPECIAL_SCALE = 2.4;
const SPECIAL_FPS   = 6;
const SPECIAL_ANIMS = {
  fire:      { file: "Flame_jet.png",    fps: SPECIAL_FPS, loop: true },
  lightning: { file: "Light_charge.png", fps: SPECIAL_FPS, loop: true },
  wanderer:  { file: "Magic_sphere.png", fps: SPECIAL_FPS, loop: true },
};

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

// počas special castu skryjeme bežný actor sprite
let castingNow = { p1:false, p2:false };

let animState = { p1: { key:"idle", until:0 }, p2: { key:"idle", until:0 } };
const SPRITES = {};
let actorsInitialized = false;

// preview loop
let charPreviewRaf = 0;

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

/* ---------- Grid (efekty + anim. objekty) ---------- */
function renderGrid(s, effects = []) {
  gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE}px)`;
  gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE}px)`;
  gridEl.innerHTML = "";

  // reset info o caste
  castingNow.p1 = false;
  castingNow.p2 = false;

  const recharge = new Set();
  const charges  = [];      // {cell:[x,y], dir, from}
  const specials = [];      // {from}
  let hitTarget = null;

  // pre blikajúci rozsah pri speciale
  const previewSet = new Set(); // "x,y"

  for (const e of effects) {
    if (e?.kind === "recharge") for (const [x,y] of e.cells || []) recharge.add(`${x},${y}`);
    if (e?.kind === "charge")   charges.push(e);
    if (e?.kind === "special")  specials.push(e);
    if (e?.kind === "hit")      hitTarget = e.target;
  }

  // priprav rozsahy pre všetky špeciály v tomto frame
  for (const sp of specials) {
    const caster = s?.[sp.from];
    if (!caster || !caster.char) continue;
    castingNow[sp.from] = true; // ⬅ skryjeme jeho actor sprite v RAF
    const cells = cellsForSpecialPreview(caster); // rovnaká logika ako hover
    cells.forEach(([x,y]) => previewSet.add(`${x},${y}`));
  }

  // ktorý cell je políčko kúzelníka so special anim?
  const specialCasterCell = new Map(); // from -> {x,y,file,dir}
  for (const sp of specials) {
    const caster = s?.[sp.from];
    if (!caster || !caster.char) continue;
    const charKey = caster.char;                       // "fire"|"lightning"|"wanderer"
    const dirKey  = CHAR_META[charKey].dir;
    const file    = SPECIAL_ANIMS[charKey].file;
    specialCasterCell.set(sp.from, { x: caster.x, y: caster.y, file, dir: dirKey });
  }

  for (let y = 0; y < board.h; y++) {
    for (let x = 0; x < board.w; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const key = `${x},${y}`;
      if (recharge.has(key)) cell.classList.add("hl-recharge");
      if (previewSet.has(key)) cell.classList.add("preview-red");

      // CHARGE projektil v tejto bunke
      const chargeHere = charges.find(c => c.cell?.[0] === x && c.cell?.[1] === y);
      if (chargeHere) {
        const charKey = s?.[chargeHere.from]?.char;
        const dirKey  = charKey ? CHAR_META[charKey].dir : null;
        if (dirKey) {
          const cvs = document.createElement("canvas");
          const px  = Math.round(TILE * CHARGE_SCALE);
          cvs.width = px; cvs.height = px;
          cvs.className = "charge-canvas";
          cvs.dataset.dir = dirKey;
          cvs.style.width  = px + "px";
          cvs.style.height = px + "px";
          cvs.style.transform = (chargeHere.dir === "left")
            ? "translate(-50%, -50%) scaleX(-1)"
            : "translate(-50%, -50%)";
          cell.appendChild(cvs);
        }
      }

      // SPECIAL animácia len na políčku kúzelníka
      for (const [from, info] of specialCasterCell.entries()) {
        if (info.x === x && info.y === y) {
          const cvs = document.createElement("canvas");
          const px  = Math.round(TILE * SPECIAL_SCALE);
          cvs.width = px; cvs.height = px;
          cvs.className = "special-canvas";
          cvs.dataset.dir  = info.dir;
          cvs.dataset.file = info.file;
          cvs.style.width  = px + "px";
          cvs.style.height = px + "px";
          cvs.style.transform = "translate(-50%, -50%)";
          cell.appendChild(cvs);
        }
      }

      // zásahový blik
      const isP1 = s?.p1 && s.p1.x === x && s.p1.y === y;
      const isP2 = s?.p2 && s.p2.x === x && s.p2.y === y;
      if (hitTarget === "p1" && isP1) cell.classList.add("hit-blink");
      if (hitTarget === "p2" && isP2) cell.classList.add("hit-blink");

      gridEl.appendChild(cell);
    }
  }
}

/* ---------- Special preview (hover) ---------- */
function cellsForSpecialPreview(meState){
  if (!meState || !meState.char) return [];
  const { x, y, char } = meState;
  const cells = [];
  if (char === "fire"){
    for (let cx=0; cx<board.w; cx++) cells.push([cx, y]);
  } else if (char === "lightning"){
    for (let cy=0; cy<board.h; cy++) for (let cx=0; cx<board.w; cx++){
      if (!(cx===x && cy===y)) cells.push([cx, cy]);
    }
  } else if (char === "wanderer"){
    [[-1,-1],[1,-1],[-1,1],[1,1]].forEach(([dx,dy])=>{
      const cx=x+dx, cy=y+dy;
      if (cx>=0 && cy>=0 && cx<board.w && cy<board.h) cells.push([cx,cy]);
    });
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

/* ---------- Actors (plynulý pohyb) ---------- */
function cellToPx(x, y) { return { left: x * (TILE + GAP), top: y * (TILE + GAP) }; }
function computeFacing(p1, p2) {
  if (!p1 || !p2) return { p1: 1, p2: -1 };
  if (p1.x === p2.x && p1.y === p2.y) return { p1: 1, p2: -1 };
  if (p1.x <= p2.x) return { p1: 1, p2: -1 };
  return { p1: -1, p2: 1 };
}
function positionActors(s, immediate = false) {
  const p1 = s.p1, p2 = s.p2;
  const same = p1 && p2 && p1.x === p2.x && p2.y === p2.y;
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
      el.style.transition = "";
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

/* ---------- Queue + Lock ---------- */
function renderQueue() {
  queueEl.innerHTML = "";
  const arrow = { up: "↑", down: "↓", left: "←", right: "→" };

  myQueue.forEach(a => {
    const div = document.createElement("div");
    div.className = "q-badge";
    if (a.type === "move") {
      div.classList.add("move");  div.textContent = arrow[a.dir] || "?";
    } else if (a.type === "recharge") {
      div.classList.add("mana");  div.textContent = "+2 mana";
    } else if (a.type === "attack") {
      div.classList.add("attack"); div.textContent = "Basic";
    } else if (a.type === "special") {
      div.classList.add("mana");   div.textContent = "Special";
    } else {
      div.textContent = a.type;
    }
    queueEl.appendChild(div);
  });
  updateLockButton();
}
function updateLockButton() {
  const locked = !!state?.[me]?.locked;
  if (locked) {
    lockBtn.classList.add("locked"); lockBtn.textContent = "LOCKED"; lockBtn.disabled = true;
  } else {
    lockBtn.classList.remove("locked"); lockBtn.textContent = "LOCK IN"; lockBtn.disabled = false;
  }
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

  const first = timeline[0];
  state.p1 = first.p1; state.p2 = first.p2; state.turn = first.turn; state.starter = first.starter;
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
        return;
      }

      if (state.p1) state.p1.locked = false;
      if (state.p2) state.p2.locked = false;

      // čistý frame bez efektov obnoví castingNow na false
      renderGrid(state, []);
      renderHUD();
      myQueue = []; renderQueue();
      updateLockButton();
      return;
    }

    const frame = timeline[i++];

    const beforeP1 = prev?.p1 || state.p1;
    const beforeP2 = prev?.p2 || state.p2;

    state.p1 = frame.p1; state.p2 = frame.p2; state.turn = frame.turn;
    renderHUD();

    if (beforeP1 && (beforeP1.x !== frame.p1.x || beforeP1.y !== frame.p1.y)) setAnim("p1", "run", MOVE_MS);
    if (beforeP2 && (beforeP2.x !== frame.p2.x || beforeP2.y !== frame.p2.y)) setAnim("p2", "run", MOVE_MS);

    const shooters = new Set();
    for (const e of frame.effects || []) {
      if ((e.kind === "charge" || e.kind === "attack_swing" || e.kind === "special") && e.from) shooters.add(e.from);
      if (e.kind === "hit" && (e.target === "p1" || e.target === "p2")) setAnim(e.target, "hurt", HURT_MS);
      if (e.kind === "invalid" && (e.target === "p1" || e.target === "p2")) setAnim(e.target, "hurt", HURT_MS);
    }
    if (shooters.has("p1")) setAnim("p1", "attack", ATTACK_SWING_MS);
    if (shooters.has("p2")) setAnim("p2", "attack", ATTACK_SWING_MS);

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
    const anim = ANIM_DEF.idle;
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height))
      .catch(() => { ctx.clearRect(0, 0, cvs.width, cvs.height); });
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
    if (state?.[me]?.locked) return;
    if (myQueue.length >= 3) return;

    const [type, arg] = btn.dataset.act.split(":");
    if (type === "move")      myQueue.push({ type: "move", dir: arg });
    if (type === "recharge")  myQueue.push({ type: "recharge" });
    if (type === "attack")    myQueue.push({ type: "attack" });
    if (type === "special")   myQueue.push({ type: "special" });
    renderQueue();
  });
});
undoBtn.addEventListener("click", () => {
  if (state?.[me]?.locked) return;
  myQueue.pop();
  renderQueue();
});
lockBtn.addEventListener("click", () => {
  if (state?.[me]?.locked) return;
  if (myQueue.length !== 3) {
    lockBtn.classList.add("shake");
    setTimeout(() => lockBtn.classList.remove("shake"), 400);
    return;
  }
  socket.emit("lock_in", myQueue);
  lockBtn.classList.add("locked");
  lockBtn.textContent = "LOCKED";
  lockBtn.disabled = true;
});

/* ---------- Retry ---------- */
retryBtn.addEventListener("click", () => { socket.emit("retry"); });

/* ---------- Sockets ---------- */
socket.on("you_are", (slot) => { me = slot; });

socket.on("reset", () => {
  goOverlay.classList.add("hidden");
  chosenChar = null;
  myQueue = []; renderQueue();
  animState = { p1:{key:"idle", until:0}, p2:{key:"idle", until:0} };
  castingNow = { p1:false, p2:false };
  clearActors();
  lockBtn.classList.remove("locked");
  lockBtn.disabled = false;
  lockBtn.textContent = "LOCK IN";
  selEl.classList.remove("hidden");
  startCharSelectPreview();
  renderGrid({}, []);
  renderHUD();
});

socket.on("state", (s) => {
  state = s; board = s.board || board;

  // arena
  if (s.arena && s.arena !== arenaEl.dataset.key) {
    arenaEl.dataset.key = s.arena;
    const ARENAS_CLIENT = { bridge: ["sky-bridge.png","clouds.png","clouds-2.png","tower.png","bridge.png"] };
    renderArenaLayers(s.arena, ARENAS_CLIENT[s.arena] || []);
  }

  // char select overlay
  if (!s[me]?.char) {
    selEl.classList.remove("hidden");
    startCharSelectPreview();
  } else if (!selEl.classList.contains("hidden")) {
    selEl.classList.add("hidden");
    stopCharSelectPreview();
  }

  renderGrid(s);
  renderHUD();

  if (s.timeline) {
    schedulePlayTimeline(s.timeline);
  } else {
    positionActors(s, true);
    updateLockButton();
  }

  // label special podľa mága
  const mine = s[me];
  const dmg = mine?.char ? { fire:4, lightning:2, wanderer:8 }[mine.char] : null;
  const specialBtn = document.getElementById("special-btn");
  if (dmg != null && specialBtn) {
    specialBtn.textContent = `Special (−5, ${dmg} dmg)`;
    specialBtn.title = specialBtn.textContent;
  }
});

socket.on("game_over", ({ winner }) => {
  const loser = winner === "p1" ? "p2" : "p1";
  if (winner !== "draw") { setAnim(winner, "attack2", 0); setAnim(loser, "dead", 1200); }
  goText.textContent = winner === "draw" ? "GAME OVER — Remíza" : `GAME OVER — ${winner.toUpperCase()} vyhral`;
  goOverlay.classList.remove("hidden");
});

/* ---------- RAF: actors + FX ---------- */
function raf() {
  const now = performance.now();
  const map = { p1: actorP1, p2: actorP2 };

  // actors – skryť, ak práve castia special (pretože special sprite už obsahuje postavu)
  ["p1","p2"].forEach(slot => {
    const cvs = map[slot];
    const st  = state?.[slot];
    const ctx = cvs.getContext("2d");

    // ak caster -> skryť actor sprite
    if (castingNow[slot]) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.style.display = "none";
      return;
    }

    if (!st || !st.char) {
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      cvs.style.display = "none";
      return;
    }
    cvs.style.display = "block";

    const dir  = CHAR_META[st.char].dir;
    const anim = currentAnim(slot);
    ensureSpriteMeta(dir, anim.file)
      .then(meta => drawSprite(ctx, meta, anim, now, TILE, TILE))
      .catch(() => ensureSpriteMeta(dir, ANIM_DEF.idle.file)
        .then(metaIdle => drawSprite(ctx, metaIdle, ANIM_DEF.idle, now, TILE, TILE))
        .catch(()=>{}));
  });

  // projectiles
  document.querySelectorAll("canvas.charge-canvas").forEach(cvs => {
    const ctx = cvs.getContext("2d");
    const dir = cvs.dataset.dir;
    ensureSpriteMeta(dir, CHARGE_ANIM.file)
      .then(meta => drawSprite(ctx, meta, CHARGE_ANIM, now, cvs.width, cvs.height))
      .catch(() => {});
  });

  // specials (na políčku kúzelníka)
  document.querySelectorAll("canvas.special-canvas").forEach(cvs=>{
    const ctx = cvs.getContext("2d");
    const dir = cvs.dataset.dir;
    const file = cvs.dataset.file;
    const anim = { file, fps: SPECIAL_FPS, loop: true };
    ensureSpriteMeta(dir, file)
      .then(meta => drawSprite(ctx, meta, anim, now, cvs.width, cvs.height))
      .catch(()=>{});
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

// hover preview pre special
const specialBtn = document.getElementById("special-btn");
if (specialBtn){
  specialBtn.addEventListener("mouseenter", ()=>{
    const mine = state?.[me];
    if (!mine) return;
    showPreviewCells(cellsForSpecialPreview(mine));
  });
  specialBtn.addEventListener("mouseleave", clearPreviewCells);
}
