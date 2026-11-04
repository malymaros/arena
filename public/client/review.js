// public/client/review.js - rozbor zápasu ANALYZE (docs/MATCH_REVIEW_PLAN.md): herná obrazovka v režime rozboru.
// Úplne statická - figúry v idle frame 0 (raf.js), žiadne efekty, floaty ani zvuky; mení sa len stav. Spodné
// ovládanie je skryté, na jeho mieste je väčšia lišta kola (tie isté bunky ako v hre) - klik na akciu (← / →) presunie
// zelený trojuholník pod ňu a doska ukáže stav PO tej akcii; trojuholník je vždy aktívny (nové kolo = prvá predakcia úplne
// vľavo), ◀ ▶ po stranách lišty = krok po akciách; dole ◀ ROUND n / N ▶ (↑ / ↓), ⏮ / ⏭ = začiatok / koniec hry
// (Home / End), zelené ▶ PLAY = akcie po jednej s pauzou PLAY_STEP_MS (medzerník). Pohľad (biely / čierny)
// = klik na HUD; vybraný HUD je zlatý (trieda .me, identita sa počas rozboru dočasne nastaví na ten slot).
// THE WORLD: klik na Jotarovu akciu THE WORLD rozbalí priamo v lište jeho 3 frozen akcie + koniec pauzy.
// Kolo, v ktorom hra skončila, ukáže aj zamknuté akcie, na ktoré nedošlo (zašednuté).
// Dáta = záznam zo servera (match_review), kreslí ich aktuálny klient - formát stráži MATCH_RECORD_VERSION.
import { socket } from "/client/net.js";
import { review } from "/client/review-state.js";
import { state, me, isHost, setIdentity, setState } from "/client/session.js";
import { queueEl, hudBoxP1, hudBoxP2, hudTurn } from "/client/dom.js";
import { qCursor } from "/client/actor-layers.js";
import { actionBadgeView, renderQueue } from "/client/queue.js";
import { beatPos, emptyBeatPos, MATCH_RECORD_VERSION } from "/shared/match-record.js";
import { renderHUD } from "/client/hud.js";
import { renderGrid } from "/client/grid.js";
import { positionActors } from "/client/placement.js";
import { updateMatchScore } from "/client/phase-ui.js";
import { clearActors } from "/client/timeline.js";
import { resetPoses, actors } from "/client/actors.js";
import { clearActionLogs, appendActionLog } from "/client/action-log.js";
import { clearProjectiles } from "/client/board-fx.js";
import { playback } from "/client/playback.js";
import { fxAll } from "/client/fx-registry.js";
import { preloadChar } from "/client/sprites.js";
import { syncArenaBg } from "/client/arena-bg.js";
import { hydratePix, LS_BADGE_IMG, LH_BADGE_IMG } from "/client/pix.js";
import { SIDE_LABEL } from "/client/side-tag.js";

const NAMES = SIDE_LABEL; // štítky HUD: ⚪ WHITE / ⚫ BLACK
const PLAY_STEP_MS = 1000; // PLAY: pauza medzi akciami
// pixelová ikona „na začiatok / koniec hry": zvislá čiara + trojuholník (end = vpravo ▶|, inak |◀)
const EDGE_SVG = (end) => {
  let r = "";
  for (let y = 0; y < 7; y++) {
    r += `<rect x="${end ? 6 : 0}" y="${y}" width="1" height="1"/>`;
    const w = 4 - Math.abs(3 - y); // trojuholník 1-4-1
    for (let i = 0; i < w; i++) r += `<rect x="${end ? 1 + i : 5 - i}" y="${y}" width="1" height="1"/>`;
  }
  return `<svg class="pix-edge" viewBox="0 0 7 7" shape-rendering="crispEdges" fill="#fff" aria-hidden="true">${r}</svg>`;
};
// pixelové ikony PLAY (trojuholník) a pauza (dva stĺpce), 7×7
const PLAY_SVG = (() => {
  let r = "";
  for (let y = 0; y < 7; y++) { const w = 1 + 2 * (3 - Math.abs(3 - y)) / 1.5; for (let x = 0; x < Math.round(w); x++) r += `<rect x="${x + 1}" y="${y}" width="1" height="1"/>`; }
  return `<svg class="pix-edge" viewBox="0 0 7 7" shape-rendering="crispEdges" fill="#fff" aria-hidden="true">${r}</svg>`;
})();
const PAUSE_SVG = `<svg class="pix-edge" viewBox="0 0 7 7" shape-rendering="crispEdges" fill="#fff" aria-hidden="true"><rect x="1" y="0" width="2" height="7"/><rect x="4" y="0" width="2" height="7"/></svg>`;
// pixelové X na tlačidle odchodu (7×7, biele s tmavým tieňom) - zdieľa ho aj okno MATCHES
export const PIX_X = (() => {
  let r = "";
  for (let i = 0; i < 7; i++) for (const x of new Set([i, 6 - i])) r += `<rect x="${x + 0.5}" y="${i + 0.5}" width="1" height="1" fill="#4a0b07"/><rect x="${x}" y="${i}" width="1" height="1" fill="#fff"/>`;
  return `<svg class="pix-x" viewBox="0 0 7.5 7.5" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
})();
// herné eventy roomky - ak prídu počas rozboru, stav za ním je neaktuálny → po zatvorení sa stránka obnoví
const DIRTY_EVENTS = new Set(["state", "new_game", "game_result", "game_over", "you_are", "color_roll", "char_roll", "arena_roll", "reset"]);

let R = null;     // { rec, gi, view, round, beat } - beat = index v zázname kola (-1 = začiatok kola)
let saved = null; // čo bolo pred rozborom (identita, stav, verdikt game over)

/* ---------- vstup / výstup ---------- */
export function openReview(id, opts = {}) {
  if (!id) return;
  socket.emit("match_review", { id }, (res) => {
    if (res?.record) enterReview(res.record, opts);
    else console.warn("match_review:", res?.error || "no response");
  });
}

export function enterReview(rec, { view = null, game = null } = {}) {
  if (rec?.v !== MATCH_RECORD_VERSION || !rec.games?.length) { console.warn("match_review: nepodporovaná verzia záznamu", rec?.v); return; }
  if (!review.active) {
    saved = { me, isHost, state, hudTurn: hudTurn?.innerHTML ?? "", gameOverShown: playback.gameOverShown, finalRound: playback.finalRoundActive };
    review.dirty = false;
  }
  review.active = true;
  document.body.classList.add("review-mode");
  playback.playGen++; playback.playing = false; // prípadné bežiace prehrávanie timeline sa zastaví
  playback.gameOverShown = false;
  clearProjectiles(); clearActors(); resetPoses();
  actors.escPrideDisplay = { p1: null, p2: null }; actors.escPrideDisplayChar = { p1: null, p2: null };
  const own = saved?.me === "p1" || saved?.me === "p2" ? saved.me : "p1";
  R = { rec, gi: Math.max(0, Math.min(rec.games.length - 1, game ?? 0)), view: view || own, round: 0, beat: 0 };
  panel = { key: null, cells: [], ts: {}, pos: [], group: [] }; logs = { key: null, upTo: -1 };
  buildChrome();
  show();
}

export function exitReview() {
  if (!review.active) return;
  stopPlay();
  review.active = false;
  document.body.classList.remove("review-mode");
  chrome?.remove(); chrome = null;
  R = null;
  if (review.dirty) { location.reload(); return; } // roomka medzitým pokračovala - čistý stav zo servera
  const s = saved; saved = null;
  setIdentity(s.me, s.isHost);
  setState(s.state);
  playback.gameOverShown = s.gameOverShown; playback.finalRoundActive = s.finalRound;
  clearActors(); resetPoses(); clearActionLogs();
  syncArenaBg(state.arena);
  renderHUD(); updateMatchScore(state);
  if (hudTurn) hudTurn.innerHTML = s.hudTurn;
  if (state?.p1 && state?.p2) { renderGrid(state, []); positionActors(state, true); }
  renderQueue();
}

/* ---------- stav vybraného miesta ---------- */
const gameRec = () => R.rec.games[R.gi];
const roundRec = () => gameRec().rounds[R.round];
const viewRec = () => roundRec().views[R.view];
function frameNow() {
  const v = viewRec();
  return R.beat < 0 ? v.start : v.beats[R.beat].state;
}

function show() {
  review.drawUntil = performance.now() + 1500; // raf dokreslí figúry (aj čerstvo stiahnuté sprity), potom stojí
  const gm = gameRec();
  const f = frameNow();
  const st = { ...gm.base, phase: "playing", names: NAMES, ...f };
  setState(st);
  setIdentity(R.view);
  playback.finalRoundActive = !!viewRec().start.goldLocked;
  syncArenaBg(st.arena);
  for (const slot of ["p1", "p2"]) {
    const c = st[slot]?.char || null;
    fxAll("stateChar", slot, c, st);
    if (c) preloadChar(c, slot);
  }
  renderHUD(); updateMatchScore(st);
  renderGrid(st, []);
  positionActors(st, true);
  renderPanel();
  renderLogs();
  renderChrome();
}

/* ---------- lišta kola ---------- */
// rozloženie ako renderQueue v hre: [Last Hope] | golden shield | 6 akcií | golden mana ×2 / démon
function layoutFor(start) {
  const starter = start.starter || "p1", second = starter === "p1" ? "p2" : "p1";
  const lastRound = !!start.goldLocked;
  const buffSlot = start.p1?.lastStandBuff ? "p1" : start.p2?.lastStandBuff ? "p2" : null;
  const hopeSlot = buffSlot ? (buffSlot === "p1" ? "p2" : "p1") : null;
  const L = [];
  if (lastRound && hopeSlot) L.push({ pos: 9, kind: "lasthope", owner: hopeSlot });
  L.push({ pos: 0, kind: "gshield", owner: second },
    { pos: 1, kind: "act", idx: 0, owner: starter }, { pos: 2, kind: "act", idx: 0, owner: second },
    { pos: 3, kind: "act", idx: 1, owner: starter }, { pos: 4, kind: "act", idx: 1, owner: second },
    { pos: 5, kind: "act", idx: 2, owner: starter }, { pos: 6, kind: "act", idx: 2, owner: second });
  if (lastRound) L.push({ pos: 7, kind: "demon" });
  else L.push({ pos: 7, kind: "gmana", owner: starter }, { pos: 8, kind: "gmana", owner: second });
  return { L, starter, lastRound, hopeSlot };
}
function fillBadge(el, action, from) {
  const v = actionBadgeView(action, from);
  el.classList.remove("q-slot");
  if (v.cls) el.classList.add(v.cls);
  if (v.html) { el.innerHTML = v.html; hydratePix(el); } else el.textContent = v.text;
}
// beaty kola → bunky lišty; frozen akcie (THE WORLD) a koniec pauzy patria pod bunku THE WORLD
function mapBeats(v, starter) {
  const counts = { p1: 0, p2: 0 }, pos = [], group = [];
  let tw = null; // pozícia bunky THE WORLD, kým idú frozen akcie
  v.beats.forEach((b, j) => {
    if (b.frozen || b.tsEnd) { pos[j] = tw; if (tw != null) group[tw] = [...(group[tw] || []), j]; return; }
    const p = b.empty ? emptyBeatPos(b.from, b.empty, starter) : beatPos(b.from, b.action, counts, starter);
    pos[j] = p;
    tw = b.action?.type === "special" && v.beats[j + 1]?.frozen ? p : null;
  });
  return { pos, group };
}
// lišta sa stavia nanovo len pri zmene kola / pohľadu / rozbalenia THE WORLD - inak sa presunie len kurzor (rýchle prepínanie)
let panel = { key: null, cells: [], ts: {}, pos: [], group: [] };
function renderPanel() {
  const v = viewRec();
  const { L, starter, lastRound, hopeSlot } = layoutFor(v.start);
  const map = panel.v === v ? panel : mapBeats(v, starter);
  const { pos, group } = map;
  const curPos = R.beat >= 0 ? pos[R.beat] : null;
  const tw = curPos != null && group[curPos] ? curPos : null;
  const key = `${R.gi}|${R.round}|${R.view}|${tw}`;
  if (key !== panel.key) {
    queueEl.innerHTML = '<button type="button" class="rv-step" data-s="-1" title="Previous action (←)">◀</button>';
    const cells = [];
    for (const b of L) {
      if ((b.pos === 0 && lastRound && hopeSlot) || b.pos === 1 || b.pos === 7) {
        const d = document.createElement("div"); d.className = "q-divider"; queueEl.appendChild(d);
      }
      const el = document.createElement("div");
      el.dataset.pos = String(b.pos);
      if (b.kind === "demon") { el.className = "q-badge demon"; el.innerHTML = LS_BADGE_IMG; }
      else {
        el.className = "q-badge q-slot " + (b.owner === R.view ? "mine" : "opp") + " " + (b.kind === "act" ? "main" : "opt");
        if (b.kind === "gshield") el.innerHTML = '<span class="g-ico dim">🛡️</span>';
        else if (b.kind === "gmana") el.innerHTML = '<span class="g-ico dim">🙏</span>';
        else if (b.kind === "lasthope") el.innerHTML = '<span class="lh-dim">?</span>';
        else el.textContent = String(b.idx + 1);
      }
      queueEl.appendChild(el);
      cells[b.pos] = el;
    }
    // vyplň bunky beatmi kola (všetky akcie oboch strán; v labyrinte súperove „?")
    v.beats.forEach((b, j) => {
      if (b.frozen || b.tsEnd) return;
      const el = cells[pos[j]];
      if (!el) return;
      el.dataset.beat = String(j);
      el.classList.add("rv-beat");
      if (b.action) fillBadge(el, b.action, b.from);
      if (b.action?.type === "last_hope" && el.classList.contains("lasthope")) el.innerHTML = LH_BADGE_IMG;
      if (b.invalid) el.classList.add("act-invalid");
      if (group[pos[j]]) el.classList.add("rv-world");
    });
    // kolo, v ktorom hra skončila: zamknuté akcie, na ktoré už nedošlo - zašednuté (nedajú sa vybrať)
    const planned = roundRec().planned;
    if (planned) for (const b of L) {
      const el = cells[b.pos];
      if (!el || el.dataset.beat || !b.owner) continue;
      const pl = planned[b.owner];
      const a = b.kind === "act" ? pl?.queue?.[b.idx]
        : b.kind === "gmana" ? (pl?.lastStand ? { type: "last_stand" } : pl?.goldenMana ? { type: "golden_mana" } : null) : null;
      if (!a) continue;
      fillBadge(el, a, b.owner);
      el.classList.add("rv-unplayed");
      el.title = "Not played - the game ended";
    }
    // THE WORLD: vybraná bunka THE WORLD (alebo jej frozen akcia) rozbalí za sebou frozen akcie + koniec pauzy
    const ts = tw != null ? expandWorld(cells[tw], v, group[tw]) : {};
    queueEl.insertAdjacentHTML("beforeend", '<button type="button" class="rv-step" data-s="1" title="Next action (→)">▶</button>');
    queueEl.appendChild(qCursor);
    panel = { key, cells, ts, pos, group, v };
  }
  // kurzor: aktuálny beat (frozen / koniec pauzy → jeho bunka v rozbalenej skupine)
  panel.now?.classList.remove("q-now");
  const curEl = panel.ts[R.beat] || (curPos != null ? panel.cells[curPos] : null);
  panel.now = curEl;
  if (curEl) {
    curEl.classList.add("q-now");
    // poloha v súradniciach lišty: offsetParent je lišta (position: relative) aj pre bunky vnorenej skupiny THE WORLD
    qCursor.style.left = (curEl.offsetLeft + curEl.offsetWidth / 2) + "px";
    qCursor.classList.add("show");
  } else qCursor.classList.remove("show");
  // krokové šípky lišty: zošednuté na úplnom začiatku / konci hry
  const lastR = R.round >= gameRec().rounds.length - 1;
  queueEl.querySelector('.rv-step[data-s="-1"]').disabled = R.round === 0 && R.beat <= 0;
  queueEl.querySelector('.rv-step[data-s="1"]').disabled = lastR && R.beat >= v.beats.length - 1;
}
// THE WORLD: frozen akcie + koniec pauzy ako skupina hneď za bunkou THE WORLD (lišta sa rozšíri)
function expandWorld(anchor, v, list) {
  const wrap = document.createElement("div");
  wrap.className = "rv-ts-group";
  const out = {};
  for (const j of list) {
    const b = v.beats[j];
    const el = document.createElement("div");
    el.className = "q-badge main rv-beat " + (b.from === R.view ? "mine" : "opp");
    el.dataset.beat = String(j);
    if (b.tsEnd) { el.classList.add("rv-ts-end"); el.textContent = "▶"; el.title = "Time resumes"; }
    else fillBadge(el, b.action, b.from);
    if (b.invalid) el.classList.add("act-invalid");
    wrap.appendChild(el);
    out[j] = el;
  }
  anchor.after(wrap);
  return out;
}

// záznam akcií pod HUD widgetmi = akcie kola až po vybranú (ako počas prehrávania); krok dopredu len pridá jednu akciu
let logs = { key: null, upTo: -1 };
function addLog(b) {
  if (!b.action || b.frozen) return;
  const el = appendActionLog(b.from, b.action);
  if (b.invalid) el?.classList.add("act-invalid");
}
function renderLogs() {
  const v = viewRec(), key = `${R.gi}|${R.round}|${R.view}`;
  if (logs.key === key && R.beat === logs.upTo) return;
  if (logs.key === key && R.beat === logs.upTo + 1) { addLog(v.beats[R.beat]); logs.upTo = R.beat; return; }
  clearActionLogs();
  for (let j = 0; j <= R.beat && j < v.beats.length; j++) addLog(v.beats[j]);
  logs = { key, upTo: R.beat };
}

/* ---------- ovládanie: ◀ ROUND ▶, záložky hier, zatvoriť ---------- */
let chrome = null;
function buildChrome() {
  if (chrome) return;
  chrome = document.createElement("div");
  chrome.className = "review-chrome";
  // jeden pás dole: [hry série] ◀ ROUND n / N ▶ [zatvoriť] - hore ostáva celá plocha pre dosku
  chrome.innerHTML = `
    <div class="rv-nav"><div class="rv-games"></div>
      <button type="button" class="rv-edge" data-e="start" title="First round (Home)">${EDGE_SVG(false)}</button>
      <button type="button" class="rv-arrow" data-d="-1" title="Previous round (↑)">◀</button>
      <span class="rv-round"></span>
      <button type="button" class="rv-arrow" data-d="1" title="Next round (↓)">▶</button>
      <button type="button" class="rv-edge" data-e="end" title="Last round - end of the game (End)">${EDGE_SVG(true)}</button>
      <button type="button" class="rv-play"></button>
      <button type="button" class="rv-close" title="Close (Esc)">${PIX_X}</button></div>`;
  document.body.appendChild(chrome);
  chrome.querySelector(".rv-close").addEventListener("click", exitReview);
  chrome.querySelectorAll(".rv-arrow").forEach(b => b.addEventListener("click", () => { stopPlay(); stepRound(+b.dataset.d); }));
  chrome.querySelectorAll(".rv-edge").forEach(b => b.addEventListener("click", () => { stopPlay(); gameEdge(b.dataset.e === "end"); }));
  chrome.querySelector(".rv-play").addEventListener("click", togglePlay);
  syncPlayBtn();
  chrome.querySelector(".rv-games").addEventListener("click", (e) => {
    const b = e.target.closest("[data-g]"); if (!b) return;
    stopPlay(); R.gi = +b.dataset.g; R.round = 0; R.beat = 0; show();
  });
}
function renderChrome() {
  if (!chrome) return;
  const gm = gameRec(), N = gm.rounds.length;
  chrome.querySelector(".rv-round").textContent = `ROUND ${roundRec().turn} / ${gm.rounds[N - 1].turn}`;
  chrome.querySelector('[data-d="-1"]').disabled = R.round <= 0;
  chrome.querySelector('[data-d="1"]').disabled = R.round >= N - 1;
  chrome.querySelector('[data-e="start"]').disabled = R.round === 0 && R.beat <= 0;
  chrome.querySelector('[data-e="end"]').disabled = R.round === N - 1 && R.beat >= viewRec().beats.length - 1;
  const games = R.rec.games;
  chrome.querySelector(".rv-games").innerHTML = games.length > 1
    ? games.map((g, i) => `<button type="button" class="rv-game${i === R.gi ? " on" : ""}" data-g="${i}">${g.g}</button>`).join("") : "";
}
// skok na úplný začiatok hry (kolo 1 pred prvou akciou) / úplný koniec (posledné kolo, stav po poslednej akcii)
function gameEdge(end) {
  const N = gameRec().rounds.length;
  const round = end ? N - 1 : 0;
  const beat = end ? gameRec().rounds[round].views[R.view].beats.length - 1 : 0;
  if (round === R.round && beat === R.beat) return;
  R.round = round; R.beat = beat; show();
}
function stepRound(d) {
  const N = gameRec().rounds.length;
  const r = Math.max(0, Math.min(N - 1, R.round + d));
  if (r === R.round) return;
  R.round = r; R.beat = 0; show();
}
// krok po akciách (cez hranicu kola do susedného); false = už nie je kam
function stepBeat(d) {
  const n = viewRec().beats.length;
  if (d > 0) { if (R.beat < n - 1) R.beat++; else if (R.round < gameRec().rounds.length - 1) { R.round++; R.beat = 0; } else return false; }
  else { if (R.beat > 0) R.beat--; else if (R.round > 0) { R.round--; R.beat = viewRec().beats.length - 1; } else return false; }
  show();
  return true;
}
// PLAY: akcie po jednej s pauzou PLAY_STEP_MS (cez kolá až po koniec hry); akékoľvek ručné prepnutie ho zastaví
let playTimer = null;
function stopPlay() { clearInterval(playTimer); playTimer = null; syncPlayBtn(); }
function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  playTimer = setInterval(() => { if (!review.active || !stepBeat(1)) stopPlay(); }, PLAY_STEP_MS);
  syncPlayBtn();
}
function syncPlayBtn() {
  const b = chrome?.querySelector(".rv-play");
  if (!b) return;
  b.classList.toggle("on", !!playTimer);
  b.innerHTML = playTimer ? PAUSE_SVG : PLAY_SVG;
  b.title = playTimer ? "Pause (Space)" : "Play - one action per second (Space)";
}

// klik na bunku lišty / THE WORLD riadku = skok na tú akciu
document.addEventListener("click", (e) => {
  if (!review.active) return;
  const step = e.target.closest(".rv-step");
  if (step && queueEl.contains(step)) { stopPlay(); stepBeat(+step.dataset.s); return; }
  const el = e.target.closest(".rv-beat");
  if (el && queueEl.contains(el)) { stopPlay(); R.beat = +el.dataset.beat; show(); }
});
// klik na HUD = pohľad toho hráča
for (const [box, slot] of [[hudBoxP1, "p1"], [hudBoxP2, "p2"]]) {
  box?.addEventListener("click", () => { if (review.active && R && R.view !== slot) { R.view = slot; show(); } });
}
document.addEventListener("keydown", (e) => {
  if (!review.active || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target?.closest?.("input, textarea")) return;
  // ručné prepnutie zastaví PLAY; medzerník = play / pauza
  const manual = { ArrowRight: () => stepBeat(1), ArrowLeft: () => stepBeat(-1), ArrowDown: () => stepRound(1), ArrowUp: () => stepRound(-1), Home: () => gameEdge(false), End: () => gameEdge(true) }[e.key];
  const k = manual ? () => { stopPlay(); manual(); } : { " ": togglePlay, Escape: exitReview }[e.key];
  if (k) { e.preventDefault(); e.stopImmediatePropagation(); k(); } // Esc nezavrie aj okno MATCHES pod rozborom
});

/* ---------- napojenie: id posledného záznamu (ANALYZE na game over), neaktuálny stav, dev odkaz ---------- */
socket.on("match_record", (m) => { review.lastMatchId = m?.id || null; syncAnalyzeBtn(); });
socket.onAny((ev) => { if (review.active && DIRTY_EVENTS.has(ev)) review.dirty = true; });

const analyzeBtn = document.getElementById("analyze");
function syncAnalyzeBtn() { analyzeBtn?.classList.toggle("hidden", !review.lastMatchId); }
analyzeBtn?.addEventListener("click", () => openReview(review.lastMatchId));
syncAnalyzeBtn();

// dev / prototyp: /?review=<id> otvorí rozbor záznamu hneď po prihlásení
const devId = new URLSearchParams(location.search).get("review");
if (devId) socket.once("session", () => setTimeout(() => openReview(devId), 400));
