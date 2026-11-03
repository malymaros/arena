// public/client/room-tiles.js - pevné dlaždice roomiek v room browseri (net.js) - čistá funkcia bez socketu, aby ju
// mohla použiť aj dev stránka so všetkými stavmi (public/dev/rooms.html).
// Dlaždica (pixel-art, vo všetkých stavoch rovnako veľká): badge arény (náhodná = rovnako široký s kockou; kým host
// nastavuje „SETTING UP…"), tabuľka MANUAL | RANDOM - COLOR (farba, ktorú dostaneš, keď sa pripojíš), CHARACTER (výber /
// losovanie postáv), TIMER (hodiny + hodnota) - a tlačidlo: prázdna → CREATE (oranžový rám), čaká na súpera → JOIN
// (zelený), plná → SPECTATE (sivý). Tlačidlo nesie triedy room-btn create|join|spectate (tools/*-smoke, screens,
// perf-probe na ne klikajú).
import { DICE_SVG } from "/client/pix.js";
import { drawArenaThumb, ARENA_NAMES } from "/client/arena-thumbs.js";

// pixelové ikonky: riadky znakov → SVG (crispEdges), ako pix.js
const PAL = { "#": "#000", g: "#3ddc84", G: "#1f8f52", w: "#f4f1e8", W: "#b9b5a8", b: "#2b2e36", B: "#5c606b", h: "#8a8f9a",
  y: "#ffcf66", Y: "#b58a2a", x: "#4a4e57" };
const pix = (rows, cls) => {
  let r = "";
  rows.forEach((row, y) => [...row].forEach((c, x) => { if (PAL[c]) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PAL[c]}"/>`; }));
  return `<svg class="rt-ico ${cls}" viewBox="0 0 ${rows[0].length} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
};
const YES = pix(["......###", ".....#gG#", "#...#gG#.", "#g.#gG#..", "#Gg#gG#..", ".#GggG#..", "..#GG#...", "...##...."], "yes");
const NO = pix(["#x#..#x#", ".#x##x#.", "..#xx#..", "..#xx#..", ".#x##x#.", "#x#..#x#"], "no");
const token = (c, C, hl) => pix(["..####..", `.#${c}${c}${c}${c}#.`, `#${c}${hl}${c}${c}${c}${C}#`, `#${c}${c}${c}${c}${c}${C}#`,
  `#${c}${c}${c}${c}${C}${C}#`, `#${c}${c}${c}${C}${C}${C}#`, `.#${C}${C}${C}${C}#.`, "..####.."], "tok");
const WHITE = token("w", "W", "w"), BLACK = token("b", "B", "h");
const CLOCK = pix(["..####..", ".#yyyy#.", "#yy#yyY#", "#yy#yyY#", "#yy##yY#", "#yyyyYY#", ".#YYYY#.", "..####.."], "clock");
const DASH = `<i class="rt-dash"></i>`;

const timerText = (t) => (t === "off" ? "OFF" : t === "quickdraw" ? "60s AFTER LOCK" : `${Number(t) || 0}s`);

// aréna so zmenenými ADVANCED SETTINGS (info.custom - hocičo, aj zákazy postáv): oranžový štvorček v rohu badge
// (rovnaký ako na záložke arény v okne ADVANCED SETTINGS); bez ďalších podrobností
function badge(info, setting) {
  if (setting) return `<span class="rt-badge none setting"><span class="rt-bname">SETTING UP…</span></span>`;
  if (!info) return `<span class="rt-badge none"><span class="rt-bname">• • •</span></span>`;
  const dot = info.custom ? `<i class="rt-custom" title="Custom settings"></i>` : "";
  if (info.arena === "random") return `<span class="rt-badge random"><span class="rt-dice">${DICE_SVG}</span>${dot}</span>`;
  return `<span class="rt-badge" data-arena="${info.arena}"><canvas width="160" height="20"></canvas><span class="rt-bname">${ARENA_NAMES[info.arena] || ""}</span>${dot}</span>`;
}

// info = payload „rooms" ({ rooms: [{ id, slot, players, canJoin, phase, info }], slots }); pick(kind, slot, room)
export function buildRoomGrid(info, pick) {
  const list = Array.isArray(info?.rooms) ? info.rooms : [];
  const slots = Math.max(1, info?.slots || 2);
  const bySlot = new Map();
  list.forEach((r, i) => bySlot.set(r.slot ?? i + 1, r));
  const grid = document.createElement("div");
  grid.className = "room-grid";
  for (let n = 1; n <= slots; n++) {
    const r = bySlot.get(n);
    const kind = !r ? "create" : r.canJoin ? "join" : "spectate";
    const ri = r?.info || null;          // nastavenia zápasu (null = host ešte nastavuje)
    const setting = !!r && !ri;
    const cell = (html) => `<span class="rt-c">${html}</span>`;
    // pri JOIN žetón farby, ktorú dostaneš; divák (SPECTATE) vidí len, či bola farba zvolená alebo losovaná
    const color = !ri ? [DASH, DASH]
      : ri.color === "random" ? [NO, YES]
      : kind === "join" ? [ri.color === "white" ? WHITE : BLACK, NO] : [YES, NO];
    const chars = !ri ? [DASH, DASH] : ri.chars === "random" ? [NO, YES] : [YES, NO];
    const timer = !ri ? `<span class="rt-tv">${DASH}</span>`
      : `<span class="rt-tv${ri.timer === "quickdraw" ? " long" : ""}">${CLOCK}${timerText(ri.timer)}</span>`;
    const cta = kind === "create" ? "CREATE" : kind === "join" ? "JOIN" : "SPECTATE";
    const b = document.createElement("button");
    b.className = `room-tile room-btn ${kind}`;
    b.dataset.slot = String(n);
    b.innerHTML = `${badge(ri, setting)}
      <span class="rt-tbl${ri ? "" : " dim"}"><span></span><span class="rt-h">MANUAL</span><span class="rt-h">RANDOM</span>
        <span class="rt-k">COLOR</span>${cell(color[0])}${cell(color[1])}
        <span class="rt-k">CHARACTER</span>${cell(chars[0])}${cell(chars[1])}
        <span class="rt-k">TIMER</span>${timer}</span>
      <span class="rt-cta">${cta}</span>`;
    b.querySelectorAll(".rt-badge[data-arena] canvas").forEach(c => drawArenaThumb(c, c.parentElement.dataset.arena));
    b.addEventListener("click", () => {
      b.disabled = true;
      pick?.(kind, n, r);
    });
    grid.appendChild(b);
  }
  return grid;
}
