// public/client/match-list.js - zoznam odohraných zápasov MATCHES (docs/MATCH_REVIEW_PLAN.md), otvára sa z room browsera.
// Jeden riadok = zápas / séria: dátum a čas, aréna (kocka = losovaná), formát, bot, biely vs čierny (hlavy postáv;
// turnaj = tím 3, mŕtvi zošednutí; BO3 = postavy v poradí hrania; bot = hlava bota + meno postavy), skóre, kolá, ikona konca každej
// hry, štítok DEMON. Klik na riadok rozbalí hry - každá má ANALYZE (review.js). Server pošle posledných MATCHES_SHOWN
// (shared/match-record.js), jeden zoznam s posuvníkom. Bez mien hráčov - len biely / čierny. Hlavy sú STATICKÉ (nakreslia
// sa raz, idle frame 0) - raf ich neprekresľuje, aby 100 riadkov nezaťažovalo prehliadač.
import { socket } from "/client/net.js";
import { drawMageHeadAnim } from "/client/mage-head.js";
import { usesAltColor } from "/client/sprites.js";
import { drawBotFigure } from "/client/bot-face.js";
import { drawArenaThumb, ARENA_NAMES } from "/client/arena-thumbs.js";
import { pixSvg, tileSvg, DICE_SVG, LS_BADGE_IMG } from "/client/pix.js";
import { CHAR_META } from "/chars/index.js";
import { openReview, PIX_X } from "/client/review.js";
import { SIDE_LABEL } from "/client/side-tag.js";

const CAUSE = {
  arena:   { ico: () => tileSvg("dmg"),    t: "KILLED BY THE ARENA" },
  attack:  { ico: () => pixSvg("sword"),   t: "KILLED BY AN ATTACK" },
  mirror:  { ico: () => pixSvg("mirror"),  t: "KILLED BY A MIRROR" },
  breaker: { ico: () => pixSvg("shieldx"), t: "KILLED BY A BREAKER" },
};
const LEVEL = { baby: "BABY", normal: "AI", cheater: "CHEATER" };
const FORMAT = { single: "SINGLE", bo3: "BO3", tournament: "TOURNAMENT" };
// mená postáv vo veľkých písmenách: skrátené dlhé (inak by sa v stĺpci zalamovali / skracovali), bez diakritiky mimo písma
const SHORT = { wanderer: "WANDERER", lightning: "LIGHTNING", onre: "ONRYO" }; // ONRYO: pixelové písmo nemá „Ō"
const nm = (c) => SHORT[c] || (CHAR_META[c]?.name || c || "?").toUpperCase();
const side = (s) => (s === "p1" ? "WHITE" : "BLACK");
const pad = (n) => String(n).padStart(2, "0");

let win = null, rowsEl = null, rows = [], loading = false;

function build() {
  win = document.createElement("div");
  win.id = "matches";
  win.className = "matches hidden";
  win.innerHTML = `<div class="ml-card"><div class="ml-head"><h1 class="ml-title">MATCHES</h1><button type="button" class="ml-close" title="Close">${PIX_X}</button></div>
    <div class="ml-rows"></div></div>`;
  document.body.appendChild(win);
  rowsEl = win.querySelector(".ml-rows");
  win.querySelector(".ml-close").addEventListener("click", closeMatches);
  win.addEventListener("click", (e) => { if (e.target === win) closeMatches(); });
  rowsEl.addEventListener("click", onRowClick);
}

export function openMatches() {
  if (!win) build();
  win.classList.remove("hidden");
  rows = []; rowsEl.innerHTML = "";
  load();
}
export function closeMatches() { win?.classList.add("hidden"); }
const isOpen = () => !!win && !win.classList.contains("hidden");

function load() {
  if (loading) return;
  loading = true;
  socket.emit("matches_list", {}, (res) => {
    loading = false;
    rows = res?.rows || [];
    rowsEl.innerHTML = rows.length ? rows.map(rowHtml).join("")
      : `<div class="ml-empty">${res?.off ? "MATCH RECORDS ARE OFF ON THIS SERVER" : "NO MATCHES YET"}</div>`;
    for (const c of rowsEl.querySelectorAll("canvas[data-arena]")) drawArenaThumb(c, c.dataset.arena);
    drawHeads(rowsEl);
  });
}
// statické hlavy (postavy idle frame 0, bot v pokojnej nálade) - kreslia sa raz po vložení riadkov
function drawHeads(root) {
  for (const c of root.querySelectorAll("canvas.ml-mh:not([data-drawn])")) { c.dataset.drawn = "1"; drawMageHeadAnim(c, c.dataset.char, 0); }
  for (const c of root.querySelectorAll("canvas.ml-bot:not([data-drawn])")) { c.dataset.drawn = "1"; drawBotFigure(c, "neutral", 0, { level: c.dataset.level }); }
}

/* ---------- riadok ---------- */
const head = (c, slot, extra = "") => `<canvas class="ml-mh ${usesAltColor(c, slot) ? "ml-alt " : ""}${extra}" data-char="${c}" data-slot="${slot}" width="52" height="52"></canvas>`;
const botHead = (level, cls = "") => `<canvas class="ml-bot ${cls}" data-level="${level}" width="64" height="64"></canvas>`;
const isBot = (r, s) => r.ai?.side === s;
const sideHead = (r, s, c) => (isBot(r, s) ? botHead(r.ai.level) : head(c, s));
const sideName = (r, s, c) => (isBot(r, s) ? `${LEVEL[r.ai.level] || "AI"} · ` : "") + nm(c);
const causeIco = (g) => g.cause ? CAUSE[g.cause]?.ico() || "" : '<span class="ml-q">?</span>';
const causeText = (g) => g.cause ? `${side(g.winner === "p1" ? "p2" : "p1")} ${CAUSE[g.cause]?.t || ""}` : "UNFINISHED";

// postavy strany v poradí, v akom ich v sérii hrala (BO3 - postava sa môže medzi hrami meniť), bez opakovania
const playedChars = (r, s) => r.games.map(g => g.chars[s]).filter((c, i, a) => c && a.indexOf(c) === i);
// strana riadku = dva stĺpce mriežky: hlavy postáv + štítok (⚪ WHITE / ⚫ BLACK a pod ním postava / úroveň bota)
function sideCols(r, s) {
  const tag = `<div class="ml-lbl ${s}">${SIDE_LABEL[s]}</div>`;
  // bot v sérii (BO3 / turnaj): len jeden štvorček s jeho hlavou; v turnaji zošedne, ak prehral
  if (isBot(r, s) && r.format !== "single") {
    const lost = r.format === "tournament" && r.finished && r.score[s] < r.score[s === "p1" ? "p2" : "p1"];
    return { heads: botHead(r.ai.level, lost ? "ml-dead" : ""), label: tag + `<div class="ml-lbl">${LEVEL[r.ai.level] || "AI"}</div>`, small: false };
  }
  const chars = playedChars(r, s);
  const many = !r.team && chars.length > 1; // BO3 s viacerými postavami: malé hlavy ako tím v turnaji
  if (r.team) return { heads: (r.team[s] || []).map(c => head(c, s, r.dead?.[s]?.includes(c) ? "ml-dead" : "")).join(""), label: tag, small: true };
  if (many) return { heads: chars.map(c => head(c, s)).join(""), label: tag, small: true };
  return { heads: sideHead(r, s, chars[0]), label: tag + `<div class="ml-lbl">${sideName(r, s, chars[0])}</div>`, small: false };
}
// jeden riadok = 10 stĺpcov pevnej šírky (styles.css .ml-row): dátum | aréna | typ | hlavy bieleho | WHITE | skóre |
// BLACK | hlavy čierneho | kolá | ako skončili hry (až 5 ikon v jednom riadku)
function rowHtml(r) {
  const d = new Date(r.ts);
  const rounds = r.games.reduce((a, g) => a + g.rounds, 0);
  const demon = r.games.some(g => g.demon?.length);
  const lose = (s) => (r.score[s] < r.score[s === "p1" ? "p2" : "p1"] ? "lose" : "");
  const w = sideCols(r, "p1"), b = sideCols(r, "p2");
  return `<div class="ml-row" data-id="${r.id}">
    <div class="ml-when">${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}<small>${pad(d.getHours())}:${pad(d.getMinutes())}</small></div>
    <div class="ml-arena"><canvas width="120" height="42" data-arena="${r.arena}"></canvas>${r.randomArena ? `<span class="ml-dice">${DICE_SVG}</span>` : ""}<span>${ARENA_NAMES[r.arena] || r.arena}</span></div>
    <div class="ml-fmt"><span class="ml-chip">${FORMAT[r.format] || r.format}</span>${r.ai ? `<span class="ml-ai ${r.ai.level}"><span class="ml-ai-full">VS AI · ${(r.ai.level || "normal").toUpperCase()}</span><span class="ml-ai-short">${LEVEL[r.ai.level] || "AI"}</span></span>` : ""}</div>
    <div class="ml-heads w${w.small ? " small" : ""}">${w.heads}</div>
    <div class="ml-side w">${w.label}</div>
    <div class="ml-score"><span class="${lose("p1")}">${r.score.p1}</span>:<span class="${lose("p2")}">${r.score.p2}</span></div>
    <div class="ml-side b">${b.label}</div>
    <div class="ml-heads b${b.small ? " small" : ""}">${b.heads}</div>
    <div class="ml-meta">${rounds} ROUNDS<small>${r.games.length} ${r.games.length > 1 ? "GAMES" : "GAME"}${r.finished ? "" : ' · <span class="ml-unfin">UNFINISHED</span>'}</small>${demon ? `<span class="ml-demon">${LS_BADGE_IMG}DEMON</span>` : ""}</div>
    <div class="ml-causes">${r.games.map(g => `<span class="ml-cause ${g.winner === "p1" ? "w" : g.winner === "p2" ? "b" : ""}" title="${g.g}: ${causeText(g)}">${causeIco(g)}</span>`).join("")}</div>
  </div>`;
}
function gamesHtml(r) {
  return `<div class="ml-games">${r.games.map((g, i) => `<div class="ml-game">
    <span class="ml-g">${g.g}</span>
    <div class="ml-pair"><span class="ml-lbl p1 ml-nm">${sideName(r, "p1", g.chars.p1)}</span>${sideHead(r, "p1", g.chars.p1)}<span class="ml-lbl ml-vs">VS</span>${sideHead(r, "p2", g.chars.p2)}<span class="ml-lbl p2 ml-nm">${sideName(r, "p2", g.chars.p2)}</span></div>
    <div class="ml-ctext"><span class="ml-cause ${g.winner === "p1" ? "w" : g.winner === "p2" ? "b" : ""}">${causeIco(g)}</span>${causeText(g)}</div>
    <div class="ml-meta">${g.rounds} ROUNDS${g.demon?.length ? `<span class="ml-demon">${LS_BADGE_IMG}DEMON R${g.demon.join(", R")}</span>` : ""}</div>
    <button type="button" class="ml-analyze" data-game="${i}">ANALYZE</button>
  </div>`).join("")}</div>`;
}
function onRowClick(e) {
  const btn = e.target.closest(".ml-analyze");
  if (btn) { const id = btn.closest(".ml-games")?.previousElementSibling?.dataset.id; if (id) openReview(id, { game: +btn.dataset.game }); return; }
  const row = e.target.closest(".ml-row");
  if (!row) return;
  const nx = row.nextElementSibling;
  if (nx?.classList.contains("ml-games")) { nx.remove(); row.classList.remove("open"); return; }
  row.classList.add("open");
  row.insertAdjacentHTML("afterend", gamesHtml(rows.find(r => r.id === row.dataset.id)));
  drawHeads(row.nextElementSibling);
}

document.getElementById("matches-open")?.addEventListener("click", openMatches);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen() && !document.body.classList.contains("review-mode")) closeMatches(); });
