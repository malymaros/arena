// public/client/lobby.js - lobby hosta (docs/RANDOM_ARENA_PLAN.md): aréna (STONE BRIDGE / PORTAL REALM / SHREK SWAMP
// alebo kocka = náhodná aréna), ADVANCED SETTINGS (nastavenia každej arény: dlaždice / portály / itemy, počty za kolo,
// náhľad, BANNED CHARACTERS - zákazy postáv per farba, obrazovka ban-screen.js - okno s pevnou veľkosťou, záložky =
// karty arén), formát, farba, náhodné postavy, časovač → configure_match.
// Všetko sa hneď ukladá do localStorage (per zariadenie / prehliadač) a pri ďalšom lobby sa obnoví; poškodené alebo
// neznáme hodnoty padnú na default. Server konfiguráciu validuje/sanitizuje sám (súčty percent musia dať 100).
import { socket } from "/client/net.js";
import { isTouch } from "/client/viewport.js";
import { pixSvg, DICE_SVG } from "/client/pix.js";
import { PORTAL_TYPES, PORTAL_ORDER, FLAME2_SVG } from "/client/portal-art.js";
import { ARENA_KEYS, ARENA_NAMES, drawArenaThumb } from "/client/arena-thumbs.js";
import { PORTAL_MAX_PAIRS } from "/shared/balance.js";
import { DEF_ARENA, arenaRules as rulesOf } from "/shared/arena-defaults.js";
import { LAYOUT } from "/client/char-roll.js";
import { openBanScreen } from "/client/ban-screen.js";

const STORE_KEY = "arena.lobby.v1"; // zmena tvaru uloženého stavu = nový kľúč (v2), starý sa ignoruje
const TILE_DEF = {
  dmg: { label: "Damage", pix: "flame" }, ik: { label: "Insta-kill", pix: "skull" },
  heal: { label: "Heal", pix: "heart" }, power: { label: "Power", pix: "sword" },
  mana: { label: "Mana", pix: "drop" }, block: { label: "Def-blocker", pix: "shieldx" },
};
const ITEM_DEF = { heal: { label: "Heart", pix: "heart" }, mana: { label: "Mana", pix: "drop" } };

// defaulty: spoločné voľby hlavného lobby + pravidlá arén (ADVANCED SETTINGS - shared/arena-defaults.js, server podľa
// nich pozná CUSTOM arénu pre dlaždicu roomky)
const DEF_MAIN = { arena: "bridge", format: "bo3", color: "random", randomChars: "off", timer: "off" };
// postavy, ktoré strana môže hrať (mriežka losovania / obrazovky zákazov); turnaj potrebuje TEAM_SIZE voľných
const SIDES = ["p1", "p2"];
const POOL = { p1: LAYOUT.p1.filter(Boolean), p2: LAYOUT.p2.filter(Boolean) };
const TEAM_SIZE = 3;
const MAIN_CHOICES = {
  arena: [...ARENA_KEYS, "random"], format: ["single", "bo3", "tournament"], color: ["random", "white", "black"],
  randomChars: ["on", "off"], timer: ["off", "30", "60", "120", "quickdraw"],
};
const MAIN_ROWS = { format: "lobby-format", color: "lobby-color", randomChars: "lobby-random", timer: "lobby-timer" };

const $ = (id) => document.getElementById(id);
const copy = (o) => JSON.parse(JSON.stringify(o));
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const clampPct = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const clampPairs = (v) => Math.max(1, Math.min(PORTAL_MAX_PAIRS, Math.round(Number(v) || 1)));

/* ---------- uložený stav ---------- */
// načítanie: každá hodnota sa prevezme len ak sedí s defaultom (typ / povolená voľba / rozsah), inak default
function loadSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch {}
  const st = { main: { ...DEF_MAIN }, arenas: copy(DEF_ARENA) };
  for (const k in DEF_MAIN) if (MAIN_CHOICES[k].includes(saved?.main?.[k])) st.main[k] = saved.main[k];
  for (const a of ARENA_KEYS) {
    const src = saved?.arenas?.[a], dst = st.arenas[a];
    if (!src || typeof src !== "object") continue;
    if ([1, 2, 3].includes(src.count)) dst.count = src.count;
    if (["on", "off"].includes(src.preview)) dst.preview = src.preview;
    if (a === "portal" && Number.isFinite(src.perRound)) dst.perRound = clampPairs(src.perRound);
    // zákazy: len známe postavy strany, bez duplicít, aspoň 1 musí ostať (inak bez zákazov)
    for (const sl of SIDES) {
      const list = Array.isArray(src.bans?.[sl]) ? [...new Set(src.bans[sl])].filter(k => POOL[sl].includes(k)) : [];
      dst.bans[sl] = list.length < POOL[sl].length ? list : [];
    }
    for (const grp of ["tiles", "portals", "items"]) {
      if (!dst[grp]) continue;
      for (const k in dst[grp]) if (Number.isFinite(src[grp]?.[k])) dst[grp][k] = clampPct(src[grp][k]);
    }
  }
  return st;
}
let settings = null; // načíta sa pri prvom zobrazení lobby (showLobby)
// hlavné voľby lobby (proti AI botovi platia všetky - arény, kocka aj turnaj, docs/AI_PLAN.md 8d)
const main = () => settings.main;
let savedFlash = 0;
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
  const el = $("lobby-adv-saved");
  if (!el) return;
  el.textContent = "✓ SAVED IN THIS BROWSER";
  clearTimeout(savedFlash);
  savedFlash = setTimeout(() => { el.textContent = ""; }, 1400);
}
const isCustom = (a) => JSON.stringify(settings.arenas[a]) !== JSON.stringify(DEF_ARENA[a]);
const isValid = (a) => {
  const c = settings.arenas[a];
  return a === "swamp" ? sum(c.items) === 100 : sum(c.tiles) === 100 && (a !== "portal" || sum(c.portals) === 100);
};
// arény, ktorých nastavenia sa pri štarte použijú (kocka = všetky tri)
const arenasInPlay = () => main().arena === "random" ? ARENA_KEYS : [main().arena];
// zákazy nechajú niektorej farbe menej ako TEAM_SIZE postáv v niektorej z arén v hre (pri kocke stačí jedna) →
// turnaj sa zamkne (zámok ako v AI roomke) a zvolený turnaj sa prepne na SINGLE
const bansBlockTournament = () => arenasInPlay().some(a => SIDES.some(sl => POOL[sl].length - settings.arenas[a].bans[sl].length < TEAM_SIZE));

/* ---------- config pre server ---------- */
// pravidlá jednej arény v tvare configu (bez kľúča arena; zákazy len keď nejaké sú) - shared/arena-defaults.js
const arenaRules = (a) => rulesOf(a, settings.arenas[a]);
// stone bridge = bez kľúča arena; kocka = "random" + pravidlá všetkých troch arén (server jednu vylosuje)
function matchConfig() {
  const m = main();
  const common = { format: m.format, timer: m.timer, colorPref: m.color, randomChars: m.randomChars === "on" };
  if (m.arena === "random") return { ...common, arena: "random", arenas: Object.fromEntries(ARENA_KEYS.map(a => [a, arenaRules(a)])) };
  return { ...common, ...(m.arena === "bridge" ? {} : { arena: m.arena }), ...arenaRules(m.arena) };
}

/* ---------- hlavné lobby ---------- */
function renderMain() {
  syncTournamentLock();
  const m = main(), rnd = m.arena === "random";
  $("lobby-arena").querySelectorAll("[data-arena]").forEach(c => c.classList.toggle("active", c.dataset.arena === m.arena));
  $("lobby-arena").classList.toggle("pool", rnd); // kocka: všetky tri arény sú „v losovaní"
  for (const [k, id] of Object.entries(MAIN_ROWS)) {
    $(id).querySelectorAll(".opt").forEach(o => o.classList.toggle("active", o.dataset.val === m[k]));
  }
  // štítok pri ADVANCED SETTINGS: DEFAULT, alebo CUSTOM (pri kocke + mená upravených arén)
  const mod = arenasInPlay().filter(isCustom);
  $("lobby-adv-sum").innerHTML = !mod.length ? `<span class="adv-chip">DEFAULT</span>`
    : `<span class="adv-chip custom">CUSTOM${rnd ? ": " + mod.map(a => ARENA_NAMES[a].split(" ").pop()).join(", ") : ""}</span>`;
  $("lobby-start").disabled = !arenasInPlay().every(isValid);
}

/* ---------- ADVANCED SETTINGS ---------- */
let tab = "bridge";
const optRow = (key, vals, cur, labels = vals, cls = "") =>
  `<div class="opt-row${cls}">${vals.map((v, i) => `<button class="opt${String(v) === String(cur) ? " active" : ""}" data-k="${key}" data-val="${v}">${labels[i]}</button>`).join("")}</div>`;
const section = (label, body) => `<div class="lobby-section"><div class="lobby-label">${label}</div>${body}</div>`;
// riadok percenta: −/+ po 5 % (na dotyku aj jediná možnosť - číselné pole by otvorilo klávesnicu cez pol obrazovky)
function weightRow(grp, key, label, ico, val) {
  const step = (d, t) => `<button type="button" class="w-step" data-g="${grp}" data-key="${key}" data-d="${d}">${t}</button>`;
  return `<label class="weight"><span class="w-ico${grp === "tiles" && key === "dmg" && tab === "portal" ? " w-dmg2" : ""}">${ico}</span>${label}
    ${step(-5, "−")}<input type="number" min="0" max="100" step="5" data-g="${grp}" data-key="${key}" value="${val}"${isTouch ? " readonly" : ""}>${step(5, "+")}<span class="pct">%</span></label>`;
}
const weights = (rows, o) => `<div class="weights">${rows}</div><div class="weights-sum${sum(o) !== 100 ? " bad" : ""}">Total: ${sum(o)}%</div>`;

function renderAdv() {
  $("lobby-adv-tabs").querySelectorAll("[data-tab]").forEach(c => {
    const a = c.dataset.tab;
    c.classList.toggle("active", a === tab);
    c.classList.toggle("custom", isCustom(a));
    c.classList.toggle("bad", !isValid(a));
  });
  const c = settings.arenas[tab], swamp = tab === "swamp", portal = tab === "portal";
  // ľavý stĺpec vždy rovnako: zákazy postáv, počet za kolo + náhľad (+ dlaždice v portal realm); pravý = percentá
  // (portal realm: portály). Zákazy: dve tlačidlá WHITE: n / BLACK: n (číslo červené, keď nie je 0) → obrazovka zákazov
  const banBtn = (sl) => { const n = c.bans[sl].length; return `<button class="opt ban-open" data-ban="${sl}">${sl === "p1" ? "WHITE" : "BLACK"}: ${n ? `<b>${n}</b>` : "0"}</button>`; };
  let left = section("BANNED CHARACTERS", `<div class="opt-row">${banBtn("p1")}${banBtn("p2")}</div>`) + section(`${swamp ? "ITEMS" : "SPECIAL TILES"} PER ROUND`, optRow("count", [1, 2, 3], c.count))
    + section(swamp ? "SHREK PREVIEW" : "TILE PREVIEW", optRow("preview", ["on", "off"], c.preview, ["On", "Off"]));
  let right;
  if (swamp) {
    right = section("ITEM CHANCE", weights(Object.keys(c.items).map(k => weightRow("items", k, ITEM_DEF[k].label, pixSvg(ITEM_DEF[k].pix), c.items[k])).join(""), c.items));
  } else {
    const tiles = section("TILE CHANCE", weights(Object.keys(c.tiles).map(k =>
      weightRow("tiles", k, TILE_DEF[k].label, k === "dmg" && portal ? FLAME2_SVG : pixSvg(TILE_DEF[k].pix), c.tiles[k])).join(""), c.tiles));
    if (portal) {
      left += tiles;
      right = section("PORTALS PER ROUND", optRow("perRound", Array.from({ length: PORTAL_MAX_PAIRS }, (_, i) => i + 1), c.perRound, undefined, " tight"))
        + section("PORTAL CHANCE", weights(PORTAL_ORDER.map(k => weightRow("portals", k, PORTAL_TYPES[k].en,
          `<span class="w-ico w-portal" style="--pc:${PORTAL_TYPES[k].pc};--pc2:${PORTAL_TYPES[k].pc2}"></span>`, c.portals[k])).join(""), c.portals));
    } else right = tiles;
  }
  $("lobby-adv-body").innerHTML = `<div class="adv-cols"><div>${left}</div><div>${right}</div></div>`;
  $("lobby-adv-reset").disabled = !isCustom(tab);
  $("lobby-adv-done").disabled = !ARENA_KEYS.every(isValid); // zavrieť sa dá, až keď všetky súčty sedia
}
function openAdv() {
  tab = main().arena === "random" ? "bridge" : main().arena;
  $("lobby-adv").classList.remove("hidden");
  renderAdv();
}
function closeAdv() {
  if (!ARENA_KEYS.every(isValid)) return;
  $("lobby-adv").classList.add("hidden");
  renderMain();
}

/* ---------- zostavenie (raz) ---------- */
let built = false;
function build() {
  built = true;
  const card = (a) => `<button class="arena-card" data-arena="${a}"><canvas width="320" height="180"></canvas><span>${ARENA_NAMES[a]}</span></button>`;
  $("lobby-arena").innerHTML = ARENA_KEYS.map(card).join("") + `<button class="dice-btn" data-arena="random" title="Random arena">${DICE_SVG}</button>`;
  $("lobby-adv-tabs").innerHTML = ARENA_KEYS.map(a =>
    `<button class="arena-card" data-tab="${a}"><canvas width="320" height="180"></canvas><i class="dot"></i><span>${ARENA_NAMES[a]}</span></button>`).join("");
  document.querySelectorAll("#lobby-arena canvas, #lobby-adv-tabs canvas").forEach(cv => {
    const b = cv.parentElement;
    drawArenaThumb(cv, b.dataset.arena || b.dataset.tab);
  });

  $("lobby").addEventListener("click", (e) => {
    if (aiLocked(e.target)) return; // zamknutá voľba (AI roomka)
    const arena = e.target.closest("#lobby-arena [data-arena]");
    const opt = e.target.closest(".opt-row[id] .opt");
    if (arena) { settings.main.arena = arena.dataset.arena; save(); renderMain(); }
    else if (opt) {
      const key = Object.keys(MAIN_ROWS).find(k => MAIN_ROWS[k] === opt.parentElement.id);
      if (key) { settings.main[key] = opt.dataset.val; save(); renderMain(); }
    }
    else if (e.target.closest("#lobby-adv-open")) openAdv();
    else if (e.target.closest("#lobby-start") && arenasInPlay().every(isValid)) socket.emit("configure_match", matchConfig());
  });

  const adv = $("lobby-adv");
  adv.addEventListener("click", (e) => {
    const c = settings.arenas[tab];
    if (aiLocked(e.target)) return; // zamknutá aréna (AI roomka)
    const t = e.target.closest("#lobby-adv-tabs [data-tab]");
    const o = e.target.closest(".opt[data-k]");
    const s = e.target.closest(".w-step");
    if (t) { tab = t.dataset.tab; renderAdv(); return; }
    const b = e.target.closest("[data-ban]");
    if (b) { openBanScreen(b.dataset.ban, c.bans[b.dataset.ban], () => { save(); renderAdv(); }); return; }
    if (o) c[o.dataset.k] = o.dataset.k === "preview" ? o.dataset.val : Number(o.dataset.val);
    else if (s) { e.preventDefault(); const g = c[s.dataset.g]; g[s.dataset.key] = clampPct(g[s.dataset.key] + Number(s.dataset.d)); }
    else if (e.target.closest("#lobby-adv-reset")) settings.arenas[tab] = copy(DEF_ARENA[tab]);
    else if (e.target.closest("#lobby-adv-done") || e.target === adv) { closeAdv(); return; } // aj klik mimo okna
    else return;
    save();
    renderAdv();
  });
  // písanie čísla (počítač): uloží sa po potvrdení poľa
  adv.addEventListener("change", (e) => {
    const i = e.target.closest("input[data-g]");
    if (!i) return;
    settings.arenas[tab][i.dataset.g][i.dataset.key] = clampPct(i.value);
    save();
    renderAdv();
  });
}

/* ---------- zamknutý turnaj: zákazy postáv ---------- */
// turnaj ostáva viditeľný, len zamknutý (🔒, .ai-locked): zákazy (BANNED CHARACTERS) ho zamknú, keď by niektorej
// farbe ostali menej ako 3 postavy - zvolený turnaj sa prepne na SINGLE
const AI_LOCKED = '#lobby-format .opt[data-val="tournament"]';
const LOCK_TITLE = "Not enough characters left (banned characters)";
let banLocked = false;
const aiLocked = (el) => banLocked && !!el?.closest?.(AI_LOCKED);
function syncTournamentLock() {
  banLocked = !!settings && bansBlockTournament();
  if (banLocked && settings.main.format === "tournament") { settings.main.format = "single"; save(); }
  document.querySelectorAll(AI_LOCKED).forEach(el => {
    el.classList.toggle("ai-locked", banLocked);
    if (banLocked) el.title = LOCK_TITLE; else if (el.title === LOCK_TITLE) el.removeAttribute("title");
  });
}

/* ---------- Lobby (host nastavuje zápas) ---------- */
export function showLobby() {
  $("lobby").classList.remove("hidden");
  if (!built) { settings = loadSettings(); build(); }
  renderMain();
}
// lobby zmizlo (zápas sa začal / iná fáza) - okno ADVANCED nesmie ostať visieť
export function hideLobbyAdvanced() { $("lobby-adv")?.classList.add("hidden"); }
