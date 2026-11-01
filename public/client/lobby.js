// public/client/lobby.js - lobby hosta (docs/RANDOM_ARENA_PLAN.md): aréna (STONE BRIDGE / PORTAL REALM / SHREK SWAMP
// alebo kocka = náhodná aréna), ADVANCED SETTINGS (nastavenia každej arény: dlaždice / portály / itemy, počty za kolo,
// náhľad - okno s pevnou veľkosťou, záložky = karty arén), formát, farba, náhodné postavy, časovač → configure_match.
// Všetko sa hneď ukladá do localStorage (per zariadenie / prehliadač) a pri ďalšom lobby sa obnoví; poškodené alebo
// neznáme hodnoty padnú na default. Server konfiguráciu validuje/sanitizuje sám (súčty percent musia dať 100).
import { socket } from "/client/net.js";
import { isTouch } from "/client/viewport.js";
import { pixSvg, DICE_SVG } from "/client/pix.js";
import { PORTAL_TYPES, PORTAL_ORDER, FLAME2_SVG } from "/client/portal-art.js";
import { ARENA_KEYS, ARENA_NAMES, drawArenaThumb } from "/client/arena-thumbs.js";
import { PORTAL_WEIGHTS, PORTAL_TILE_WEIGHTS, PORTALS_PER_ROUND, PORTAL_MAX_PAIRS, ITEM_WEIGHTS } from "/shared/balance.js";

const STORE_KEY = "arena.lobby.v1"; // zmena tvaru uloženého stavu = nový kľúč (v2), starý sa ignoruje
const TILE_DEF = {
  dmg: { label: "Damage", pix: "flame" }, ik: { label: "Insta-kill", pix: "skull" },
  heal: { label: "Heal", pix: "heart" }, power: { label: "Power", pix: "sword" },
  mana: { label: "Mana", pix: "drop" }, block: { label: "Def-blocker", pix: "shieldx" },
};
const ITEM_DEF = { heal: { label: "Heart", pix: "heart" }, mana: { label: "Mana", pix: "drop" } };

// defaulty: spoločné voľby hlavného lobby + pravidlá arén (ADVANCED SETTINGS)
const DEF_MAIN = { arena: "bridge", format: "bo3", color: "random", randomChars: "off", timer: "off" };
const DEF_ARENA = {
  bridge: { count: 1, preview: "on", tiles: { dmg: 75, ik: 5, heal: 5, power: 5, mana: 5, block: 5 } },
  portal: { count: 1, preview: "on", tiles: { ...PORTAL_TILE_WEIGHTS }, portals: { ...PORTAL_WEIGHTS }, perRound: PORTALS_PER_ROUND },
  swamp:  { count: 1, preview: "on", items: { ...ITEM_WEIGHTS } },
};
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
    for (const grp of ["tiles", "portals", "items"]) {
      if (!dst[grp]) continue;
      for (const k in dst[grp]) if (Number.isFinite(src[grp]?.[k])) dst[grp][k] = clampPct(src[grp][k]);
    }
  }
  return st;
}
let settings = null; // načíta sa pri prvom zobrazení lobby (showLobby)
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
const arenasInPlay = () => settings.main.arena === "random" ? ARENA_KEYS : [settings.main.arena];

/* ---------- config pre server ---------- */
// pravidlá jednej arény v tvare configu (bez kľúča arena) - rovnaké polia ako predtým pri ručnom výbere arény
function arenaRules(a) {
  const c = settings.arenas[a], preview = c.preview === "on";
  const rules = { tilesPerRound: c.count, tileWeights: { dmg: 0, heal: 0, mana: 0, ik: 0, power: 0, block: 0, ...(c.tiles || {}) }, tilePreview: preview };
  if (a === "portal") return { ...rules, portalWeights: { ...c.portals }, portalsPerRound: c.perRound };
  if (a === "swamp") return { ...rules, itemsPerRound: c.count, itemWeights: { ...c.items }, shrekPreview: preview };
  return rules;
}
// stone bridge = bez kľúča arena; kocka = "random" + pravidlá všetkých troch arén (server jednu vylosuje)
function matchConfig() {
  const m = settings.main;
  const common = { format: m.format, timer: m.timer, colorPref: m.color, randomChars: m.randomChars === "on" };
  if (m.arena === "random") return { ...common, arena: "random", arenas: Object.fromEntries(ARENA_KEYS.map(a => [a, arenaRules(a)])) };
  return { ...common, ...(m.arena === "bridge" ? {} : { arena: m.arena }), ...arenaRules(m.arena) };
}

/* ---------- hlavné lobby ---------- */
function renderMain() {
  const m = settings.main, rnd = m.arena === "random";
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
  // ľavý stĺpec vždy rovnako: počet za kolo + náhľad (+ dlaždice v portal realm); pravý = percentá (portal realm: portály)
  let left = section(`${swamp ? "ITEMS" : "SPECIAL TILES"} PER ROUND`, optRow("count", [1, 2, 3], c.count))
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
  tab = settings.main.arena === "random" ? "bridge" : settings.main.arena;
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
    const t = e.target.closest("#lobby-adv-tabs [data-tab]");
    const o = e.target.closest(".opt[data-k]");
    const s = e.target.closest(".w-step");
    if (t) { tab = t.dataset.tab; renderAdv(); return; }
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

/* ---------- Lobby (host nastavuje zápas) ---------- */
export function showLobby() {
  $("lobby").classList.remove("hidden");
  if (!built) { settings = loadSettings(); build(); }
  renderMain();
}
// lobby zmizlo (zápas sa začal / iná fáza) - okno ADVANCED nesmie ostať visieť
export function hideLobbyAdvanced() { $("lobby-adv")?.classList.add("hidden"); }
