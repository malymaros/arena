// public/client/codex-pages.js - stránky postáv v CODEXe (codex.js): klik na postavu na obsahu otvorí jej dvojstranu.
// Prenesené zo schváleného návrhu public/dev/codex.html (vlastník 2026-11-06/07): vzor základných postáv = Fire Wizard
// (portrét so špendlíkom + menovka, čierny skin „evil twin", PASSIVE ABILITIES, vpravo ✨ SPECIAL ACTION s animovaným
// náhľadom ako vo výbere postavy), vzor skrytých = Vampire (temné strany, MUTATED ACTIONS, prečiarknuté tlačidlo → ???).
// Texty sú vlastníkove / z hry (náhľady pri výbere postavy, popisy tlačidiel); čísla zo shared/balance.js, zóny zo
// shared/geometry.js. Nevymýšľať texty ani sekcie - meniť len podľa vlastníka (najprv na dev stránke).
import { CHAR_LIST, HEAD_CROP } from "/chars/index.js";
import * as B from "/shared/balance.js";
import * as G from "/shared/geometry.js";
import { hydratePix, pixSvg, tileSvg } from "/client/pix.js";

let root = null; // .codex-book (nastaví renderEntry)
const imgs = {};
const load = (src) => imgs[src] ||= new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });
// hlava ako HUD (výrez headCrop; Escanor zo slabej formy); dir = iný priečinok (čierny skin = meta.dirP2)
async function drawHead(cv, c, bust = false, reveal = true, dir = c.meta.dir) {
  if (!cv) return;
  const im = await load(`/assets/${dir}/${c.headIdleFile || "Idle.png"}`); if (!im) return;
  const h = im.height, cr = HEAD_CROP[c.key] || { cx: .5, cy: .5, size: .3 }, ctx = cv.getContext("2d");
  const s = cr.size * h * (bust ? 1.6 : 1), cx = cr.cx * h, cy = cr.cy * h + (bust ? cr.size * h * .28 : 0);
  ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(im, cx - s / 2, cy - s / 2, s, s, 0, 0, cv.width, cv.height);
}

const SPECIAL_FPS = 6; // = public/chars/common.js SPECIAL_FPS
// dlaždica ako v hre: bunka s podfarbením a rámikom typu + pixel ikona (tileSvg) v rohu
const tileIco = (type) => `<span class="tile-ico ${type}"><span>${tileSvg(type)}</span></span>`;
const PAGES = {
  fire: {
    passive: [`Consumes ${tileIco("dmg")} <b>damage tiles</b> with his special action - it gives him <b>±1 row</b> range.`],
    special: { caster: { x: 0, y: 1 }, cells: G.fireCells({ w: 4, h: 3 }, { x: 0, y: 1 }, false), dmg: B.SPECIAL_ZONE_DMG.fire, mana: B.SPECIAL_COST,
      text: "Range: his <b>whole row</b>." },
  },
  // texty z náhľadu pri výbere postavy (abilityPreview.desc v public/chars/lightning.js)
  lightning: {
    passive: [`${tileIco("heal")} <b>Heal tiles</b> heal her to <b>full HP</b>.`],
    special: { caster: { x: 1, y: 1 }, cells: G.lightningCells({ w: 4, h: 3 }, { x: 1, y: 1 }), dmg: B.SPECIAL_ZONE_DMG.lightning, mana: B.SPECIAL_COST,
      text: "Range: every cell of the <b>opposite colour</b>." },
  },
  // melee z tlačidla v hre (Tail sweep), špeciál z náhľadu pri výbere postavy (public/chars/medusa.js)
  medusa: {
    melee: { caster: { x: 1, y: 1 }, cells: G.meleeCells({ w: 4, h: 3 }, { x: 1, y: 1 }, "medusa"), dmg: B.MEDUSA_MELEE_DMG, mana: B.MELEE_COST,
      anim: { file: "Attack_1.png" }, fps: 10, text: "Range: her cell + all <b>4 diagonal neighbours</b>." },
    special: { caster: { x: 1, y: 1 }, cells: G.medusaCells({ w: 4, h: 3 }, { x: 1, y: 1 }, "right"), dmg: null, mana: B.SPECIAL_COST, effect: { emoji: "🗿", num: `${B.STONE_ACTIONS}×` },
      text: `Range: her cell + everything <b>one way</b> (row ±1). <b>No damage</b> - petrifies: the target skips <b class="nw">${B.STONE_ACTIONS} actions</b>.` },
  },
  // pasívka podľa vlastníka; niť a špeciál z náhľadu pri výbere postavy (public/chars/minotaur.js)
  minotaur: {
    passive: [`In the labyrinth he created he deals <b>${B.MAZE_DEAL_MUL}× dmg</b>.`],
    thread: { path: [[0, 2], [1, 2], [2, 2], [2, 1]], meet: [1, 2], foe: [2, 1],
      text: "<b>Ariadne's thread</b>: the foe's steps weave it. Where the Minotaur steps on it, the foe sees<br><span class='nw'>his <b>silhouette</b>.</span>" },
    special: { caster: { x: 1, y: 1 }, cells: G.allCells({ w: 4, h: 3 }), dmg: null, mana: B.SPECIAL_COST, effect: { emoji: "🌀", num: "" },
      text: "Range: <b>whole board</b>. <b>No damage</b> - banishes the foe into the labyrinth until <b>any hit</b> lands." },
  },
  // špeciál + ako funguje klon (z náhľadu pri výbere postavy, public/chars/naruto.js)
  naruto: {
    special: { caster: { x: 1, y: 1 }, cells: [[1, 1]], dmg: null, mana: B.SPECIAL_COST, effect: { emoji: "👥", num: "" },
      text: "Range: <b>his own cell</b> - he must stand <b>alone</b>. <b>No damage</b> - summons a <b>shadow clone</b>." },
    ability: { title: "SPECIAL ABILITY", name: "Shadow Clone Jutsu", note: "The clone is <b>indistinguishable from Naruto</b> for the foe.", summon: true },
    clone: { from: [1, 1], me: [1, 0], clone: [1, 2],
      text: "The clone <b>copies his moves</b> - <b>up/down inverted</b>. Same dmg as Naruto, <b>double</b> when stacked on his cell. <b>Vanishes</b> on any hit." },
  },
  // Escanor: pride (pasívka) + špeciál, ktorého zóna cyklí pride 0→3 (ako náhľad vo výbere postáv)
  escanor: {
    passive: ["<b>Pride</b> rises each round he doesn't use <b>shield/mirror</b>, and falls when he uses them or <b>takes a hit</b>."],
    special: { caster: { x: 1, y: 1 }, cells: [], dmg: B.SPECIAL_ZONE_DMG.escanor, mana: B.SPECIAL_COST,
      cycle: { levels: 4, ms: 1500, cells: (lvl) => G.escanorCells({ w: 4, h: 3 }, { x: 1, y: 1, pride: lvl }, "right"),
        label: (lvl) => `<img src="/assets/pride_lion_${lvl}.png" alt=""><span>PRIDE ${lvl}</span>` },
      text: "Range: <b>one way</b> (left/right) - the zone grows with his <b>Pride</b>." },
  },
  // Soldier: špeciál = zvolená bunka; obmedzenia výberu vľavo (vlastná bunka, súperova bunka = ✕ na doske)
  soldier: {
    rules: { icon: "✨", title: "SPECIAL RESTRICTIONS", items: ["He <b>can't pick his own cell</b>.", "He <b>can't pick the foe's current cell</b> - the foe is hit only if they <b>move onto</b> the picked cell."] },
    special: { caster: { x: 0, y: 1 }, cells: [[2, 0]], dmg: B.SOLDIER_SPECIAL_DMG, mana: B.SPECIAL_COST,
      text: "Range: <b>any cell</b> he picks - a sniper beam hits whoever stands there when it fires." },
  },
  // Werewolf: charge (texty z náhľadu pri výbere postavy) - dráha je stála, cyklí fáza mesiaca + dmg ako vo výbere postáv;
  werewolf: {
    passive: [`<b>Moon phase</b> changes at the start of each round: it grows as his <b>HP drops</b>, and wanes when he <b>heals</b>.`],
    moons: [["10", 0], ["9-7", 1], ["6-4", 2], ["3-1", 3]],
    special: { caster: { x: 0, y: 1 }, cells: G.runPath({ w: 4, h: 3 }, 0, 1, G.DIR8.right).path, dmg: null, mana: B.SPECIAL_COST, picker: "wolf", pickerNote: "<span class='warn'>WARNING:</span><br>the werewolf can hit you from <b>many sides</b>.",
      cycle: { levels: 4, ms: 1500, cells: () => G.runPath({ w: 4, h: 3 }, 0, 1, G.DIR8.right).path,
        label: (lvl) => `<img src="/assets/moon_${lvl}.png" alt=""><span class="pix-ico mini" data-emoji="☠️"></span><span>${B.WOLF_MOON_DMG[lvl]}</span>` },
      inline: true, text: `Range: <b>charge</b> in <b>8 directions</b> to the first foe (or the edge). Lower HP = <b>fuller moon</b> = more dmg.` },
  },
  countess: {
    mutated: [
      { icon: "🏹", name: "RANGE ATTACK", mana: B.BASIC_COST, dmg: [1, 2, 3].map(d => Math.max(1, B.BASIC_DMG_MAX - d)).join("/"),
        text: "Shoots <b>diagonally</b> and bounces once off a wall.",
        board: { me: [0, 1], hit: G.vampShotRoute({ w: 4, h: 3 }, 0, 1, "up_right").map(c => [c.x, c.y]) } },
      { icon: "🏃", name: "CHARGE", slot: "DASH", swapVisual: true, mana: B.DASH_COST, dmg: B.VAMP_CHARGE_DMG, heal: B.VAMP_CHARGE_BONUS,
        text: "Rushes <b>up, down, left or<br>right</b> to the first foe<br>(or the edge) and strikes;<br>a hit <b>heals</b> her.",
        board: { me: [0, 1], path: [[1, 1], [2, 1]], hit: [[3, 1]] } },
    ],
    passiveRight: ["Mirrors are mere <b>shields</b> against her - they never reflect her damage."],
    special: { caster: { x: 0, y: 1 }, cells: [[2, 0]], dmg: B.VAMP_TRAP_DMG, heal: B.VAMP_TRAP_BONUS, mana: B.SPECIAL_COST,
      text: "<span style='letter-spacing:0;font-size:10px'>Range: a hidden trap on <b>any cell</b>.<br>When the foe <b>enters or crosses</b><br>it, she teleports there and<br>strikes; a hit <b>heals</b> her.</span>" },
  },
  onre: {
    mutated: [
      { icon: "🏹", name: "RANGE ATTACK", mana: B.BASIC_COST, dmg: [1, 2, 3].map(d => Math.max(1, B.BASIC_DMG_MAX - d)).join("/"),
        text: "Shoots <b>diagonally</b> and bounces once off a wall.",
        board: { me: [0, 1], hit: G.vampShotRoute({ w: 4, h: 3 }, 0, 1, "up_right").map(c => [c.x, c.y]) } },
      { icon: "🏃", name: "CHARGE", slot: "DASH", swapVisual: true, mana: B.DASH_COST, dmg: B.VAMP_CHARGE_DMG, drain: B.VAMP_CHARGE_BONUS,
        text: "Rushes <b>up, down, left or<br>right</b> to the first foe<br>(or the edge) and strikes;<br>a hit <b>drains</b> their mana.",
        board: { me: [0, 1], path: [[1, 1], [2, 1]], hit: [[3, 1]] } },
    ],
    passiveRight: ["Mirrors are mere <b>shields</b> against her - they never reflect her damage."],
    special: { caster: { x: 0, y: 1 }, cells: [[2, 0]], dmg: B.VAMP_TRAP_DMG, drain: B.VAMP_TRAP_BONUS, mana: B.SPECIAL_COST,
      text: "<span style='letter-spacing:0;font-size:10px'>Range: a hidden trap on <b>any cell</b>.<br>When the foe <b>enters or crosses</b><br>it, she teleports there and<br>strikes; a hit <b>drains</b> their mana.</span>" },
  },
  jotaro: {
    swap: { from: "🪞", fromLabel: "MIRROR", toLabel: "PUNCH", skin: "jotaro-s1" }, // Special 1 = PUNCH (vlastník: aj pre Luffyho)
    mutated: [
      { icon: "🏹", name: "RANGE ATTACK", mana: B.BASIC_COST, dmg: [1, 2, 3].map(d => Math.max(1, B.BASIC_DMG_MAX - d)).join("/"),
        text: "Shoots <b>diagonally</b> and bounces once off a wall.",
        board: { me: [0, 1], hit: G.vampShotRoute({ w: 4, h: 3 }, 0, 1, "up_right").map(c => [c.x, c.y]) } },
      { icon: "🪞", name: "PUNCH", slot: "MIRROR", mana: B.JOTARO_S1_COST, dmg: B.JOTARO_S1_DMG,
        text: "Hits <b>both diagonal cells</b><br>on the left or right side.",
        board: { me: [1, 1], hit: G.jotaroS1Cells({ w: 4, h: 3 }, { x: 1, y: 1 }, "right") } },
      { icon: "🗡️", name: "MELEE", mana: B.MELEE_COST, dmg: B.JOTARO_MELEE_DMG, line: true },
    ],
    special: { caster: { x: 1, y: 1 }, cells: G.allCells({ w: 4, h: 3 }), idle: true, castArt: true, dmg: null, mana: B.SPECIAL_COST, effect: { emoji: "⏱", num: "" },
      text: "<span style='letter-spacing:0;font-size:9px'><b>THE WORLD</b> (once per game): time stops,<br>he takes <b>3 extra actions</b> - all effects<br>resolve when time restarts.</span><br><span style='letter-spacing:0;font-size:10px'>Range: <b>whole board</b>.</span>" },
    after: { icon: "✨", name: "SPECIAL after THE WORLD", mana: B.JOTARO_S2_COST, dmg: B.JOTARO_S2_DMG,
      text: "After THE WORLD: the<br><b>adjacent cell</b> left or right.",
      board: { me: [1, 1], hit: [[2, 1]] } },
    warn: "after THE WORLD is used, he is <b>weak against Shinigami</b>.",
  },
  luffy: {
    swap: { from: "🪞", fromLabel: "MIRROR", toLabel: "PUNCH", skin: "luffy-s1" },
    mutated: [
      { icon: "🏹", name: "RANGE ATTACK", mana: B.BASIC_COST, dmg: [1, 2, 3].map(d => Math.max(1, B.BASIC_DMG_MAX - d)).join("/"),
        text: "Shoots <b>diagonally</b> and bounces once off a wall.",
        board: { me: [0, 1], hit: G.vampShotRoute({ w: 4, h: 3 }, 0, 1, "up_right").map(c => [c.x, c.y]) } },
      { icon: "🪞", name: "PUNCH", slot: "MIRROR", mana: B.LUFFY_S1_COST, dmg: B.LUFFY_S1_DMG,
        text: "Stretches an arm to<br><b>any cell</b> except his own.",
        board: { me: [0, 1], hit: [[2, 0]] } },
      { icon: "🗡️", name: "MELEE", mana: B.MELEE_COST, dmg: B.LUFFY_MELEE_DMG, line: true },
    ],
    special: { caster: { x: 1, y: 1 }, cells: G.luffyBallCells({ w: 4, h: 3 }, { x: 1, y: 1 }, "right"), idle: true, hoverPlay: { to: [2, 1] }, dmg: B.LUFFY_BALL_DMG, mana: B.SPECIAL_COST,
      text: "<span style='letter-spacing:0;font-size:9px'><b>BALLOON</b> (once per game): inflates,<br>rolls one cell left or right and<br>bursts on <b>everything around</b>.</span><br><span style='letter-spacing:0;font-size:10px'>Range: <b>3×3</b> around the landing.</span>" },
    after: { icon: "✨", name: "SPECIAL after BALLOON", mana: B.LUFFY_S2_COST, dmg: B.LUFFY_S2_DMG,
      text: "After BALLOON: the<br><b>adjacent cell</b> left or right.",
      board: { me: [1, 1], hit: [[2, 1]] } },
    warn: "after BALLOON is used, he is <b>weak against Shinigami</b>.",
  },
  // texty z náhľadu pri výbere postavy (abilityPreview.desc v public/chars/wanderer.js)
  wanderer: {
    passive: [`<b>+${B.WANDERER_MANA_REGEN}</b> <span class="drop-ico">${pixSvg("drop")}</span> <b>mana</b> each round he doesn't use <b>mirror</b>.`],
    special: { caster: { x: 1, y: 1 }, cells: G.diagNeighbors({ w: 4, h: 3 }, { x: 1, y: 1 }), dmg: B.SPECIAL_ZONE_DMG.wanderer, mana: B.SPECIAL_COST,
      text: "Range: <b>diagonal neighbours</b>." },
  },
};
// animovaný mág v bunke castera: efektový sprite špeciálu (ako drawAbilityCaster vo výbere postáv: fill 1.1, stred)
function animateCaster(cv, c, anim = c.specialAnim, fps = SPECIAL_FPS) {
  if (!cv || !anim) return;
  const offX = anim === c.specialAnim ? (c.fxOffsetX || 0) * cv.width : 0;
  load(`/assets/${c.meta.dir}/${anim.file}`).then(im => {
    if (!im) return;
    const fh = im.height, fw = fh, total = Math.max(1, Math.round(im.width / fw)), x = cv.getContext("2d");
    const tick = (t) => {
      if (!cv.isConnected) return;
      const idx = Math.floor(t / (1000 / fps)) % total, sc = Math.min(cv.width / fw, cv.height / fh) * 1.1;
      x.clearRect(0, 0, cv.width, cv.height); x.imageSmoothingEnabled = false;
      x.drawImage(im, idx * fw, 0, fw, fh, (cv.width - fw * sc) / 2 + offX, (cv.height - fh * sc) / 2, fw * sc, fh * sc);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const ARROW8 = { "-1,-1": "↖", "0,-1": "↑", "1,-1": "↗", "-1,0": "←", "1,0": "→", "-1,1": "↙", "0,1": "↓", "1,1": "↘" }; // smery vlkolakovho chargu
function actionBlock(sp, { icon = "✨", title = "SPECIAL ACTION", compact = false, key = "sp" } = {}) {
  const hit = new Set(sp.cells.map(([x, y]) => `${x},${y}`));
  let cells = "";
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const me = sp.caster.x === x && sp.caster.y === y;
    const no = (sp.blocked || []).some(([bx, by]) => bx === x && by === y);
    const fz = sp.frozen && !me ? " frozen" : "";
    const ar = sp.arrows && !me && Math.abs(x - sp.caster.x) <= 1 && Math.abs(y - sp.caster.y) <= 1 ? ARROW8[`${x - sp.caster.x},${y - sp.caster.y}`] : "";
    cells += `<i class="${me ? "caster" : hit.has(`${x},${y}`) ? "hit" : no ? "no" : ""}${fz}">${me ? `<canvas data-act="${key}" width="48" height="34"></canvas>` : no ? "<span class=\"nox\">✕</span>" : ar ? `<span class="ar8">${ar}</span>` : ""}</i>`;
  }
  const cyc = sp.cycle ? `<div class="sp-cycle" data-cyc="${key}"></div>` : "";
  const stats = `<div class="sp-stats"><span><span class="pix-ico mini" data-emoji="💧"></span>${sp.mana}</span>${sp.dmg != null ? `<span><span class="pix-ico mini" data-emoji="☠️"></span>${sp.dmg}</span>` : ""}${sp.heal ? `<span><span class="pix-ico mini" data-emoji="❤️"></span>${sp.heal}</span>` : ""}${sp.drain ? `<span><span class="pix-ico mini" data-emoji="💧"></span>${sp.drain}</span>` : ""}${sp.effect ? `<span><span class="pix-ico mini" data-emoji="${sp.effect.emoji}"></span>${sp.effect.num}</span>` : ""}${sp.inline ? cyc : ""}</div>`;
  const text = (sp.inline ? "" : cyc) + (sp.text ? `<p class="sp-text">${sp.text}</p>` : "");
  const picker = sp.picker === "wolf" ? `<div class="dir-picker wolf-picker cx-picker">${[["ul", "↖"], ["up", "↑"], ["ur", "↗"], ["left", "←"]].map(([c, a]) => `<span class="btn arrow ${c}">${a}</span>`).join("")}<span class="wolf-center"></span>${[["right", "→"], ["dl", "↙"], ["down", "↓"], ["dr", "↘"]].map(([c, a]) => `<span class="btn arrow ${c}">${a}</span>`).join("")}</div>` : "";
  if (sp.hoverPlay && !compact) return `<div class="sp-head"><span class="pix-ico sp-ico" data-emoji="${icon}"></span><span>${title}</span></div><div class="board-wrap play"><div class="sp-board">${cells}</div><canvas class="play-fx"></canvas></div>${stats}${text}`;
  if (sp.castArt && !compact) return `<div class="sp-head"><span class="pix-ico sp-ico" data-emoji="${icon}"></span><span>${title}</span></div><div class="board-wrap"><div class="sp-board">${cells}</div><canvas class="cast-art" width="220" height="220"></canvas></div>${stats}${text}`;
  if (picker && !compact) return `<div class="sp-head"><span class="pix-ico sp-ico" data-emoji="${icon}"></span><span>${title}</span></div><div class="sp-board">${cells}</div>${stats}${text}<div class="pk-bottom">${picker}${sp.pickerNote ? `<p class="pk-note">${sp.pickerNote}</p>` : ""}</div>`;
  return `<div class="sp-head"><span class="pix-ico sp-ico" data-emoji="${icon}"></span><span>${title}</span></div>`
    + (compact ? `<div class="sp-row"><div class="sp-board sm">${cells}</div><div class="sp-side">${stats}${text}</div></div>` : `<div class="sp-board">${cells}</div>${stats}${text}`);
}
const TB = { cw: 34, ch: 25, gap: 3, pad: 5 };
function threadBoard(t) {
  const on = new Set(t.path.map(([x, y]) => `${x},${y}`));
  let cells = "";
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const k = `${x},${y}`, foe = t.foe[0] === x && t.foe[1] === y, meet = t.meet[0] === x && t.meet[1] === y;
    cells += `<i class="${foe ? "torch" : on.has(k) ? "thread" : ""}">${foe ? '<canvas data-th="foe" width="24" height="24"></canvas>' : meet ? '<canvas data-th="meet" width="24" height="24"></canvas>' : ""}</i>`;
  }
  const pt = ([x, y]) => [TB.pad + x * (TB.cw + TB.gap) + TB.cw / 2, TB.pad + y * (TB.ch + TB.gap) + TB.ch / 2];
  const pts = t.path.map(pt), W = TB.pad * 2 + 4 * TB.cw + 3 * TB.gap, H = TB.pad * 2 + 3 * TB.ch + 2 * TB.gap;
  const svg = `<svg class="th-svg" width="${W}" height="${H}"><polyline points="${pts.map(q => q.join(",")).join(" ")}" fill="none" stroke="#e8b23c" stroke-width="3" stroke-dasharray="8 6" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/><circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="5" fill="#e8b23c"/></svg>`;
  return `<div class="sp-row th-row"><div class="sp-board sm th">${cells}${svg}</div><div class="sp-side"><p class="sp-text">${t.text}</p></div></div>`;
}
function cloneBoard(t) {
  let cells = "";
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const at = (q) => q[0] === x && q[1] === y;
    cells += `<i class="${at(t.from) ? "from" : ""}">${at(t.me) ? '<canvas data-cl="me" width="24" height="24"></canvas><span class="ar">↑</span>' : at(t.clone) ? '<canvas data-cl="clone" width="24" height="24"></canvas><span class="ar">↓</span>' : at(t.from) ? '<span class="ar dim">↕</span>' : ""}</i>`;
  }
  return `<div class="sp-row th-row"><div class="sp-board sm th cl">${cells}</div><div class="sp-side"><p class="sp-text">${t.text}</p></div></div>`;
}
function animateSummon(cv, c) {
  if (!cv) return;
  load(`/assets/${c.meta.dir}/Special_2.png`).then(im => {
    if (!im) return;
    const fh = im.height, fw = fh, total = Math.max(1, Math.round(im.width / fw)), x = cv.getContext("2d"), crop = Math.round(fw * 0.24);
    const sc = 172 / fh, dw = (fw - 2 * crop) * sc, dh = fh * sc, off = 34;
    const tick = (t) => {
      if (!cv.isConnected) return;
      const idx = Math.floor(t / (1000 / 6)) % total, top = cv.height - dh - 2; // celá postava aj s nohami
      x.clearRect(0, 0, cv.width, cv.height); x.imageSmoothingEnabled = false;
      x.save(); x.translate(cv.width / 2 + off, 0); x.scale(-1, 1); // klon vyzerá rovnako ako Naruto // klon: zrkadlo, hľadí na Naruta
      x.drawImage(im, idx * fw + crop, 0, fw - 2 * crop, fh, -dw / 2, top, dw, dh); x.restore();
      x.drawImage(im, idx * fw + crop, 0, fw - 2 * crop, fh, cv.width / 2 - off - dw / 2, top, dw, dh); // Naruto
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function runCycle(sp, key) {
  const board = root.querySelector(`canvas[data-act="${key}"]`)?.closest(".sp-board"), lab = root.querySelector(`[data-cyc="${key}"]`);
  if (!board || !sp.cycle) return;
  const cells = [...board.querySelectorAll("i")];
  let lvl = -1, last = 0;
  const tick = (t) => {
    if (!board.isConnected) return;
    if (lvl < 0 || t - last >= sp.cycle.ms) {
      lvl = (lvl + 1) % sp.cycle.levels; last = t;
      const hit = new Set(sp.cycle.cells(lvl).map(([x, y]) => `${x},${y}`));
      // pulz ide synchrónne ďalej: delay sa nastaví LEN pri pridaní bunky (fáza podľa globálnych hodín), bežiaca bunka sa nereštartuje
      cells.forEach((el, i) => {
        if (el.classList.contains("caster")) return;
        const on = hit.has(`${i % 4},${Math.floor(i / 4)}`);
        if (on && !el.classList.contains("hit")) { el.style.animationDelay = -(performance.now() % 1000) + "ms"; el.classList.add("hit"); }
        else if (!on) el.classList.remove("hit");
      });
      if (lab) { lab.innerHTML = sp.cycle.label(lvl); hydratePix(lab); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
// póza z karty výberu postavy (previewCast: framy prehrá raz, potom drží loopFrom; po pauze znova)
function animateCast(cv, c) {
  const pc = c.previewCast; if (!cv || !pc) return;
  load(`/assets/${c.meta.dir}/${pc.file}`).then(im => {
    if (!im) return;
    const total = pc.frames, fw = Math.round(im.width / total), fh = im.height, x = cv.getContext("2d");
    let t0 = performance.now();
    cv.parentElement.addEventListener("mouseenter", () => { t0 = performance.now(); });
    const tick = (t) => {
      if (!cv.isConnected) return;
      const fi = Math.floor(Math.max(0, t - t0) / 1000 * pc.fps), idx = fi < total ? fi : pc.loopFrom + ((fi - total) % (total - pc.loopFrom));
      const sc = Math.min(cv.width / fw, cv.height / fh) * 1.05;
      x.clearRect(0, 0, cv.width, cv.height); x.imageSmoothingEnabled = false;
      x.drawImage(im, idx * fw, 0, fw, fh, (cv.width - fw * sc) / 2, cv.height - fh * sc, fw * sc, fh * sc);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
// Luffyho guľa na doske ako v hre (anims v public/chars/luffy.js): Special_1 premena (8 fps, potom f7-8),
// kotúľ o bunku (f7-8, 12 fps), Special_2 výbuch raz na dopadovej bunke; spustí sa pri nadídení myšou na dosku
function animateHoverPlay(wrap, c, hp, sp) {
  const cv = wrap?.querySelector("canvas.play-fx"), board = wrap?.querySelector(".sp-board"); if (!cv || !board) return;
  const casterCv = board.querySelector(".caster canvas");
  const cellAt = (x, y) => board.children[y * 4 + x];
  const ctr = (x, y) => { const el = cellAt(x, y); return { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2, h: el.offsetHeight }; };
  Promise.all([load(`/assets/${c.meta.dir}/Special_1.png`), load(`/assets/${c.meta.dir}/Special_2.png`)]).then(([s1, s2]) => {
    if (!s1 || !s2) return;
    cv.width = board.offsetWidth; cv.height = board.offsetHeight;
    const x = cv.getContext("2d"), n1 = Math.round(s1.width / s1.height), n2 = Math.round(s2.width / s2.height);
    const FORM = n1 / 8 * 1000, ROLL = 600, BURST = n2 / 8 * 1000;
    let t0 = -1;
    wrap.addEventListener("mouseenter", () => { t0 = performance.now(); });
    wrap.addEventListener("mouseleave", () => { t0 = -1; });
    const draw = (im, n, idx, at) => {
      const f = im.height, sc = at.h * 1.5 / f, dw = f * sc;
      x.drawImage(im, idx * f, 0, f, f, at.x - dw / 2, at.y + at.h / 2 - dw * .9, dw, dw);
    };
    const tick = (t) => {
      if (!cv.isConnected) return;
      x.clearRect(0, 0, cv.width, cv.height); x.imageSmoothingEnabled = false;
      if (t0 >= 0 && t - t0 > FORM + ROLL + BURST + 900) t0 = t; // kým je myš nad doskou, útok sa opakuje
      const e = t0 < 0 ? -1 : t - t0, a = ctr(sp.caster.x, sp.caster.y), b = ctr(hp.to[0], hp.to[1]);
      if (casterCv) casterCv.style.visibility = e < 0 || e > FORM + ROLL + BURST ? "" : "hidden";
      if (e >= 0 && e < FORM) { const f = Math.floor(e / 125); draw(s1, n1, f < n1 ? f : 7 + ((f - n1) % 2), a); }
      else if (e >= FORM && e < FORM + ROLL) { const k = (e - FORM) / ROLL; draw(s1, n1, 7 + Math.floor((e - FORM) / 83) % 2, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h }); }
      else if (e >= FORM + ROLL && e < FORM + ROLL + BURST) draw(s2, n2, Math.min(n2 - 1, Math.floor((e - FORM - ROLL) / 125)), b);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
function swapVisual(v) {
  const slot = v.slot || "mirror";
  return `<div class="swap-vis"><span class="btn act ${slot} x-out"><span class="pix-ico" data-emoji="${v.from}"></span></span><span class="lbl dash">${v.fromLabel}</span><span class="down">↓</span><span class="btn act ${slot} ${v.skin}"><span class="pix-ico charge-mark">???</span></span><span class="lbl">${v.toLabel}</span></div>`;
}
function tinyBoard(b) {
  const at = (arr, x, y) => (arr || []).some(([a, c]) => a === x && c === y);
  let cells = "";
  for (let y = 0; y < 3; y++) for (let x = 0; x < 4; x++) {
    const me = b.me[0] === x && b.me[1] === y;
    cells += `<i class="${me ? "caster" : at(b.hit, x, y) ? "hit" : at(b.path, x, y) ? "path" : ""}">${me ? '<canvas class="tb-hd" width="24" height="24"></canvas>' : ""}</i>`;
  }
  return `<div class="sp-board tiny">${cells}</div>`;
}
function mutatedBlock(m) {
  const chip = (e, v) => `<span class="mchip"><span class="pix-ico mini" data-emoji="${e}"></span>${v}</span>`;
  const head = m.replaces
    ? `<span class="repl"><span class="pix-ico" data-emoji="${m.replaces}"></span></span><span class="ra">→</span><span class="vq"><span class="pix-ico" data-emoji="${m.icon}"></span></span>`
    : `<span class="pix-ico" data-emoji="${m.icon}"></span>`;
  if (m.line) return `<div class="mut line"><div class="mut-h">${head}<span class="mn">${m.name}</span><span class="mchips">${chip("💧", m.mana)}${chip("☠️", m.dmg)}</span><span class="weak">- weaker</span></div></div>`;
  return `<div class="mut"><div class="mut-h">${head}<span class="mn">${m.name}</span>${m.slot ? `<span class="ms">(${m.slot} SLOT)</span>` : ""}<span class="mchips">${chip("💧", m.mana)}${m.dmg != null ? chip("☠️", m.dmg) : ""}${m.heal ? chip("❤️", m.heal) : ""}${m.drain ? chip("💧", m.drain) : ""}</span></div>
    <div class="mut-row">${tinyBoard(m.board)}<div><p>${m.text}</p></div></div></div>`;
}
async function drawSilhouette(cv, c) { await drawHead(cv, c, false, true); const x = cv.getContext("2d"); x.globalCompositeOperation = "source-atop"; x.fillStyle = "#000"; x.fillRect(0, 0, cv.width, cv.height); x.globalCompositeOperation = "source-over"; }
// menovka na stránke postavy = celé meno (na obsahu skrátené); Onryō bez dĺžňa (pixel font)
const fullName = (c) => c.key === "onre" ? "ONRYO" : c.meta.name.toUpperCase();
const INK = "#6a0e18";
function twinNote() {
  return `<div class="tw tw-e"><span>evil twin</span><svg width="30" height="26" viewBox="0 0 30 26"><path d="M6 2 C 4 10, 10 16, 20 20" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/><path d="M12 22 L21 21 L18 12" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
}
const BLACK_SKIN = new Set(["fire", "lightning", "wanderer", "medusa", "minotaur", "naruto", "escanor", "soldier", "werewolf"]); // čierny skin vedľa portrétu - všetky základné postavy (schválené na Fire Wizardovi)
export function renderEntry(bookEl, c) {
  root = bookEl;
  root.classList.toggle("dark-page", !!c.side);
  const pg = PAGES[c.key], side = c.side === "p1" ? " w" : c.side === "p2" ? " b" : "";
  root.querySelector(".cx-pg.l").innerHTML = `<div class="portrait pin${side}"><div class="photo"><canvas width="64" height="64"></canvas></div>
    <span class="d1"></span><span class="d2"></span><span class="d3"></span><span class="d4"></span><span class="pn${fullName(c).length > 13 ? " long" : ""}">${fullName(c)}</span></div>
    ${pg?.passive ? `<div class="pv${pg.moons ? " pv-moon" : ""}"><h3>PASSIVE ABILITIES</h3>${pg.passive.map(t => `<p>${t}</p>`).join("")}${pg.moons ? `<div class="moon-tab">${pg.moons.map(([hp, l]) => `<div><img src="/assets/moon_${l}.png" alt=""><span class="hp"><span class="drop-ico">${pixSvg("heart")}</span>${hp}</span><span class="dm"><span class="pix-ico mini" data-emoji="☠️"></span>${B.WOLF_MOON_DMG[l]}</span></div>`).join("")}</div>` : ""}</div>` : ""}
    ${!c.side && c.meta.dirP2 && BLACK_SKIN.has(c.key) ? `<div class="skin-b"><span class="cx-pin"></span><canvas width="48" height="48"></canvas></div>${twinNote()}` : ""}
    ${pg?.swap || pg?.mutated?.some(m => m.swapVisual) ? swapVisual(pg.swap || { from: "🏃", fromLabel: "DASH", toLabel: "CHARGE", skin: "vamp-charge", slot: "dash" }) : ""}
    ${pg?.mutated ? `<div class="pv mu${pg.mutated.length > 2 ? " three" : ""}"><h3>MUTATED ACTIONS</h3>${pg.mutated.map(mutatedBlock).join("")}</div>` : ""}
    ${pg?.rules ? `<div class="pv"><h3 class="ih">${pg.rules.icon ? `<span class="pix-ico" data-emoji="${pg.rules.icon}"></span>` : ""}${pg.rules.title}</h3>${pg.rules.items.map(t => `<p class="rule-li">${t}</p>`).join("")}</div>` : ""}
    ${pg?.ability ? `<div class="pv ab"><h3>${pg.ability.title}</h3><div class="ab-name">${pg.ability.name}</div><div class="ab-row"><canvas class="summon" width="136" height="118"></canvas><div>${pg.ability.note ? `<p class="ab-note">${pg.ability.note}</p>` : ""}</div></div></div>` : ""}
    ${pg?.melee ? `<div class="pv act">${actionBlock(pg.melee, { icon: "🗡️", title: "MELEE", compact: true, key: "melee" })}</div>` : ""}`;
  // Ariadnina niť (Minotaur) na pravej strane pod špeciálom - blok špeciálu je vtedy tesnejší
  root.querySelector(".cx-pg.r").innerHTML = pg?.special ? `<div class="spp${pg.thread || pg.clone || pg.passiveRight || pg.after ? " tight" : ""}${pg.warn ? " dense" : ""}${pg.special.picker ? " fill" : ""}">${actionBlock(pg.special)}${pg.thread ? threadBoard(pg.thread) : ""}${pg.clone ? cloneBoard(pg.clone) : ""}${pg.after ? `<div class="pv-r after">${mutatedBlock(pg.after)}</div>` : ""}${pg.warn ? `<div class="pk-bottom warn-row"><span class="btn act demon ls-btn"><img class="ls-ico" src="/assets/last_stand.png" alt="Shinigami"></span><p class="pk-note"><span class="warn">WARNING:</span><br>${pg.warn}</p></div>` : ""}${pg.passiveRight ? `<div class="pv-r"><h3>PASSIVE ABILITIES</h3>${pg.passiveRight.map(t => `<p>${t}</p>`).join("")}</div>` : ""}</div>` : "";
  hydratePix(root);
  animateCaster(root.querySelector('canvas[data-act="sp"]'), c, pg?.special?.idle ? { file: "Idle.png" } : c.specialAnim, pg?.special?.idle ? 8 : SPECIAL_FPS);
  if (pg?.special?.cycle) runCycle(pg.special, "sp");
  const skb = root.querySelector(".skin-b canvas"); if (skb) drawHead(skb, c, false, true, c.meta.dirP2);
  if (pg?.special?.hoverPlay) animateHoverPlay(root.querySelector(".board-wrap.play"), c, pg.special.hoverPlay, pg.special);
  if (pg?.special?.castArt) animateCast(root.querySelector("canvas.cast-art"), c);
  if (pg?.thread) { drawHead(root.querySelector('canvas[data-th="foe"]'), CHAR_LIST[0], false, true); drawSilhouette(root.querySelector('canvas[data-th="meet"]'), c); }
  if (pg?.ability?.summon) animateSummon(root.querySelector("canvas.summon"), c);
  if (pg?.mutated || pg?.after) root.querySelectorAll("canvas.tb-hd").forEach(cv => drawHead(cv, c, false, true));
  if (pg?.clone) root.querySelectorAll("canvas[data-cl]").forEach(cv => drawHead(cv, c, false, true));
  if (pg?.melee) animateCaster(root.querySelector('canvas[data-act="melee"]'), c, pg.melee.anim, pg.melee.fps);
  drawHead(root.querySelector(".portrait canvas"), c, false, true); // ten istý výrez ako na obsahu, len väčší; skrytá postava bez siluety
}
