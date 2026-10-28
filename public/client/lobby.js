// public/client/lobby.js - lobby hosta: aréna (STONE BRIDGE / PORTAL REALM), formát, tiles (počet + váhy, súčet
// 100 %), v portal realm aj váhy typov portálov, časovač, náhľad tiles, farba → configure_match. Každá aréna je
// samostatný formulár so spoločným základom - pri prepnutí si každá pamätá svoje hodnoty. Server konfiguráciu
// validuje/sanitizuje sám.
import { socket } from "/client/net.js";
import { isTouch } from "/client/viewport.js";
import { pixSvg } from "/client/pix.js";
import { PORTAL_TYPES, PORTAL_ORDER, FLAME2_SVG } from "/client/portal-art.js";
import { PORTAL_WEIGHTS, PORTAL_TILE_WEIGHTS } from "/shared/balance.js";

const lobbyEl = document.getElementById("lobby");

// dlaždice: mriežka 2 stĺpcov plnená po riadkoch → ľavý stĺpec Damage/Heal/Mana, pravý Insta-kill/Power/Def-blocker
// (rovnako v oboch arénach; portal realm má len Damage + Insta-kill)
const TILE_DEF = {
  dmg: { label: "Damage", pix: "flame" }, ik: { label: "Insta-kill", pix: "skull" },
  heal: { label: "Heal", pix: "heart" }, power: { label: "Power", pix: "sword" },
  mana: { label: "Mana", pix: "drop" }, block: { label: "Def-blocker", pix: "shieldx" },
};
const TILE_ORDER = ["dmg", "ik", "heal", "power", "mana", "block"];
// spoločné voľby (opt-row id → kľúč stavu)
const FIELDS = { format: "lobby-format", tiles: "lobby-tiles-count", color: "lobby-color", preview: "lobby-preview", random: "lobby-random", timer: "lobby-timer" };
// pozadie náhľadu arény v tlačidle (rovnaké vrstvy ako hra, socket-handlers ARENAS_CLIENT)
const ARENA_THUMBS = {
  bridge: ["sky-bridge.png", "clouds.png", "clouds-2.png", "tower.png", "bridge.png"].map(f => `/arenas/bridge/${f}`),
  portal: ["/arenas/portal-realm/portal-realm-hd.webp"],
};

let lobbyBuilt = false;
let arena = "bridge";
let wtab = "tiles"; // telefón v portal realm: ktorý zoznam váh je vidieť
const forms = {};   // per aréna: { fields: {…}, tileWeights: {…}, portalWeights?: {…} }

const $ = (id) => document.getElementById(id);
const sum = (o) => Object.values(o || {}).reduce((a, b) => a + (b || 0), 0);

function drawThumb(cvs, layers) {
  const ctx = cvs.getContext("2d");
  layers.forEach(src => {
    const img = new Image();
    img.onload = () => {
      const s = Math.max(cvs.width / img.width, cvs.height / img.height), dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
    };
    img.src = src;
  });
}

// jeden riadok váhy (na dotyku −/+ po 5 % namiesto písania - číselné pole by otvorilo klávesnicu cez pol obrazovky)
function weightRow(kind, key, label, icoHtml, val, { portal = false, alone = false } = {}) {
  const T = PORTAL_TYPES[key];
  const ico = portal ? `<span class="w-ico w-portal" style="--pc:${T.pc};--pc2:${T.pc2}"></span>`
                     : `<span class="w-ico${key === "dmg" && arena === "portal" ? " w-dmg2" : ""}">${icoHtml}</span>`;
  const step = (d, t) => isTouch ? `<button type="button" class="w-step" data-kind="${kind}" data-key="${key}" data-d="${d}">${t}</button>` : "";
  return `<label class="weight">${ico}${label}
    ${step(-5, "−")}<input type="number" min="0" max="100" step="5" data-kind="${kind}" data-key="${key}" value="${val}"${isTouch ? " readonly" : ""}>${step(5, "+")}<span class="pct">%</span></label>${alone ? '<span class="w-fill"></span>' : ""}`;
}

function render() {
  const f = forms[arena];
  lobbyEl.querySelectorAll(".arena-card").forEach(c => c.classList.toggle("active", c.dataset.arena === arena));
  for (const [k, id] of Object.entries(FIELDS)) {
    $(id)?.querySelectorAll(".opt").forEach(o => o.classList.toggle("active", o.dataset.val === f.fields[k]));
  }
  $("lobby-weights").innerHTML = TILE_ORDER.filter(k => arena !== "portal" || k in PORTAL_TILE_WEIGHTS).map(k =>
    weightRow("tile", k, TILE_DEF[k].label, k === "dmg" && arena === "portal" ? FLAME2_SVG : pixSvg(TILE_DEF[k].pix), f.tileWeights[k] || 0)).join("");
  const portal = arena === "portal";
  $("lobby-portal-section").style.display = portal ? "" : "none";
  $("lobby-portal-weights").innerHTML = portal
    ? PORTAL_ORDER.map(k => weightRow("portal", k, PORTAL_TYPES[k].en, "", f.portalWeights[k] || 0, { portal: true, alone: k === "classic" })).join("")
    : "";
  const box = $("lobby-sec-weights");
  box.classList.toggle("is-portal", portal);
  box.classList.toggle("wtab-tiles", wtab === "tiles");
  box.classList.toggle("wtab-portals", wtab === "portals");
  $("lobby-wtabs").querySelectorAll(".opt").forEach(o => o.classList.toggle("active", o.dataset.tab === wtab));
  refreshSums();
}

function refreshSums() {
  const f = forms[arena];
  const s1 = sum(f.tileWeights), s2 = arena === "portal" ? sum(f.portalWeights) : 100;
  $("lobby-weights-sum").textContent = `Total: ${s1}%`;
  $("lobby-weights-sum").classList.toggle("bad", s1 !== 100);
  $("lobby-portal-sum").textContent = `Total: ${s2}%`;
  $("lobby-portal-sum").classList.toggle("bad", s2 !== 100);
  // záložka so zlým súčtom sa zafarbí, aby chyba v skrytom zozname neušla
  $("lobby-wtabs").querySelector('[data-tab="tiles"]').classList.toggle("bad", s1 !== 100);
  $("lobby-wtabs").querySelector('[data-tab="portals"]').classList.toggle("bad", s2 !== 100);
  $("lobby-start").disabled = s1 !== 100 || s2 !== 100;
}

/* ---------- Lobby (host nastavuje zápas) ---------- */
export function showLobby() {
  lobbyEl.classList.remove("hidden");
  if (lobbyBuilt) return;
  lobbyBuilt = true;

  // východzie hodnoty spoločných volieb z HTML (.active), dlaždice podľa arény
  const fields = {};
  for (const [k, id] of Object.entries(FIELDS)) fields[k] = $(id)?.querySelector(".opt.active")?.dataset.val;
  forms.bridge = { fields: { ...fields }, tileWeights: { dmg: 75, heal: 5, mana: 5, ik: 5, power: 5, block: 5 } };
  forms.portal = { fields: { ...fields }, tileWeights: { dmg: 0, heal: 0, mana: 0, ik: 0, power: 0, block: 0, ...PORTAL_TILE_WEIGHTS },
    portalWeights: { ...PORTAL_WEIGHTS } };

  lobbyEl.querySelectorAll(".arena-card").forEach(c => {
    drawThumb(c.querySelector("canvas"), ARENA_THUMBS[c.dataset.arena] || []);
    c.addEventListener("click", () => { arena = c.dataset.arena; render(); });
  });
  // segmentové prepínače spoločných volieb
  for (const [k, id] of Object.entries(FIELDS)) {
    $(id)?.addEventListener("click", (e) => {
      const btn = e.target.closest(".opt");
      if (!btn) return;
      forms[arena].fields[k] = btn.dataset.val;
      render();
    });
  }
  $("lobby-wtabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]");
    if (t) { wtab = t.dataset.tab; render(); }
  });
  const target = (kind) => kind === "tile" ? forms[arena].tileWeights : forms[arena].portalWeights;
  lobbyEl.addEventListener("input", (e) => {
    const i = e.target.closest("input[data-kind]");
    if (!i) return;
    target(i.dataset.kind)[i.dataset.key] = Math.max(0, Math.min(100, parseInt(i.value, 10) || 0));
    refreshSums();
  });
  lobbyEl.addEventListener("click", (e) => {
    const b = e.target.closest(".w-step");
    if (!b) return;
    e.preventDefault();
    const t = target(b.dataset.kind);
    t[b.dataset.key] = Math.max(0, Math.min(100, (t[b.dataset.key] || 0) + Number(b.dataset.d)));
    render();
  });
  render();

  $("lobby-start").addEventListener("click", () => {
    const f = forms[arena];
    if (sum(f.tileWeights) !== 100 || (arena === "portal" && sum(f.portalWeights) !== 100)) return;
    const config = {
      format: f.fields.format || "single",
      tilesPerRound: parseInt(f.fields.tiles || "1", 10),
      tileWeights: { ...f.tileWeights },
      timer: f.fields.timer || "off",
      tilePreview: (f.fields.preview || "on") === "on",
      colorPref: f.fields.color || "random",
      randomChars: f.fields.random === "on",
      ...(arena === "portal" ? { arena: "portal", portalWeights: { ...f.portalWeights } } : {}),
    };
    socket.emit("configure_match", config);
  });
}
