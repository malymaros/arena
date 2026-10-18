// shared/geometry.js - herná geometria zdieľaná serverom (engine) aj prehliadačom (client.js) - Etapa 2
// refaktoru (docs/REFACTOR_PLAN.md). Čisté funkcie bez stavu: doska sa podáva explicitne ako { w, h },
// bunky sú [x, y]. Čo je tu, sa NESMIE duplikovať na klientovi - náhľady (hover, ghost, picker) a
// skutočné vyhodnotenie na serveri tak idú po tých istých bunkách.

export const DIR4 = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const DIAG_DIRS = { up_left: [-1, -1], up_right: [1, -1], down_left: [-1, 1], down_right: [1, 1] };
export const DIR8 = { ...DIR4, ...DIAG_DIRS }; // vlkolakov charge + smer basicu (ortogonálny aj diagonálny)
export const DIAG_NAME = { "-1,-1": "up_left", "1,-1": "up_right", "-1,1": "down_left", "1,1": "down_right" };
export const VAMP_SHOT_RANGE = 3; // diagonálna bounce strela (Vampire/Onryō/Jotaro/Luffy base): max 3 bunky

export function inBounds(board, x, y) {
  return x >= 0 && y >= 0 && x < board.w && y < board.h;
}
const has = (cells, x, y) => cells.some(([cx, cy]) => cx === x && cy === y);

// ktorá súperova figúra stojí na bunke: null | "player" | "clone" (klon-návnada) | "stacked" (klon na majiteľovi).
// Skrytý súper (labyrint - server mu rediguje x na null) sa nepočíta - ako keby tam nebol nikto.
export function figureAt(foe, x, y) {
  if (!foe || foe.x == null) return null;
  const playerHere = foe.x === x && foe.y === y;
  const cloneHere = !!(foe.clone && foe.clone.x === x && foe.clone.y === y);
  if (playerHere && cloneHere) return "stacked";
  if (cloneHere) return "clone";
  return playerHere ? "player" : null;
}

// beh/strela z (x,y) smerom delta po okraj; ak je daný súper, zastaví sa na PRVEJ jeho figúre.
// Vracia { path: [[x,y]…] (bez štartovej bunky), target: figureAt na poslednej bunke | null }.
// Vlkolakov charge, charge Vampire/Onryō, Luffyho gear3 ruka, ghost simulácia aj ich náhľady.
export function runPath(board, x, y, delta, foe = null) {
  const path = [];
  let target = null;
  while (inBounds(board, x + delta[0], y + delta[1])) {
    x += delta[0]; y += delta[1];
    path.push([x, y]);
    target = figureAt(foe, x, y);
    if (target) break;
  }
  return { path, target };
}

/* ---------- zóny specialov ---------- */
// Medúza: vlastné políčko + všetko striktne zvoleným smerom (left/right) v riadkoch y±1
export function medusaCells(board, me, dir) {
  const sgn = dir === "left" ? -1 : 1;
  const cells = [[me.x, me.y]];
  for (let y = me.y - 1; y <= me.y + 1; y++) {
    if (y < 0 || y >= board.h) continue;
    for (let x = me.x + sgn; x >= 0 && x < board.w; x += sgn) cells.push([x, y]);
  }
  return cells;
}
// Fire: celý riadok; ak stojí na Damage dlaždici (onDmg), riadky ±1 (zo stredného = celá doska)
export function fireCells(board, me, onDmg) {
  const y0 = onDmg ? Math.max(0, me.y - 1) : me.y;
  const y1 = onDmg ? Math.min(board.h - 1, me.y + 1) : me.y;
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = 0; x < board.w; x++) cells.push([x, y]);
  return cells;
}
// Lightning: všetky políčka opačnej „šachovej" farby, než na ktorej stojí
export function lightningCells(board, me) {
  const par = (me.x + me.y) % 2;
  const cells = [];
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) if ((x + y) % 2 !== par) cells.push([x, y]);
  return cells;
}
// diagonálne susedné bunky (wanderer special, Medúzin melee)
export function diagNeighbors(board, me) {
  const cells = [];
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (inBounds(board, me.x + dx, me.y + dy)) cells.push([me.x + dx, me.y + dy]);
  }
  return cells;
}
// celá doska (Minotaurov labyrint, Countess cast, THE WORLD); except = bunka, ktorá sa vynechá (démon útok)
export function allCells(board, except = null) {
  const cells = [];
  for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++)
    if (!(except && except.x === x && except.y === y)) cells.push([x, y]);
  return cells;
}
// zóna „zónových" specialov fire/lightning/wanderer - zásah = súper (alebo jeho klon) stojí v zóne
export function zoneCells(board, me, onDmg = false) {
  switch (me.char) {
    case "fire": return fireCells(board, me, onDmg);
    case "lightning": return lightningCells(board, me);
    case "wanderer": return diagNeighbors(board, me);
    default: return [];
  }
}
export function zoneHas(board, me, x, y, onDmg = false) {
  return has(zoneCells(board, me, onDmg), x, y);
}
// Escanor: zóna ukotvená na bunke F o krok zvoleným smerom; rozsah podľa pride 0-3
// (0 = F, 1 = F + 4 diagonály, 2 = 3×3 okolo F, 3 = celá doska). F mimo dosky = prázdna zóna aj pri pride 3.
export function escanorCells(board, me, dir) {
  const out = [];
  const add = (x, y) => { if (inBounds(board, x, y) && !has(out, x, y)) out.push([x, y]); };
  const pride = Math.max(0, Math.min(3, me.pride || 0));
  const fx = me.x + (dir === "left" ? -1 : 1), fy = me.y;
  if (fx < 0 || fx >= board.w) return out;
  if (pride >= 3) { for (let y = 0; y < board.h; y++) for (let x = 0; x < board.w; x++) add(x, y); return out; }
  add(fx, fy);
  if (pride === 1) { add(fx - 1, fy - 1); add(fx + 1, fy - 1); add(fx - 1, fy + 1); add(fx + 1, fy + 1); }
  if (pride === 2) for (let yy = fy - 1; yy <= fy + 1; yy++) for (let xx = fx - 1; xx <= fx + 1; xx++) add(xx, yy);
  return out;
}
// Jotaro Special 1 (mirror slot): obe diagonálne bunky zvolenej strany (x±1, y±1); priama bunka NIE
export function jotaroS1Cells(board, me, dir) {
  const dx = dir === "left" ? -1 : 1;
  const out = [];
  for (const dy of [-1, 1]) if (inBounds(board, me.x + dx, me.y + dy)) out.push([me.x + dx, me.y + dy]);
  return out;
}
// Jotaro Special 2 (po THE WORLD): jediná susedná bunka zvolenej strany
export function jotaroS2Cells(board, me, dir) {
  const dx = dir === "left" ? -1 : 1;
  return inBounds(board, me.x + dx, me.y) ? [[me.x + dx, me.y]] : [];
}
// dosah melee: vlastné políčko; Medúza navyše diagonálne susedné
export function meleeCells(board, me, char) {
  const cells = [[me.x, me.y]];
  if (char === "medusa") cells.push(...diagNeighbors(board, me));
  return cells;
}

/* ---------- dráhy striel ---------- */
// diagonálna strela s odrazom: RAZ sa odrazí od ktorejkoľvek steny (od bočnej letí späť), roh neodráža
// (koniec letu), druhý kontakt so stenou let ukončí, max VAMP_SHOT_RANGE buniek. Každý krok nesie aktuálny
// smer (po odraze sa hrot strely otáča). Vracia [{ x, y, dir }].
export function vampShotRoute(board, x, y, dir) {
  let [dx, dy] = DIAG_DIRS[dir] || [];
  if (dx === undefined) return [];
  const route = [];
  let bounced = false;
  while (route.length < VAMP_SHOT_RANGE) {
    let nx = x + dx, ny = y + dy;
    if (!inBounds(board, nx, ny)) {
      if (bounced) break;
      const outX = nx < 0 || nx >= board.w;
      const outY = ny < 0 || ny >= board.h;
      if (outX && outY) break;
      bounced = true;
      if (outX) dx = -dx; else dy = -dy;
      nx = x + dx; ny = y + dy;
      if (!inBounds(board, nx, ny)) break;
    }
    x = nx; y = ny;
    route.push({ x, y, dir: DIAG_NAME[dx + "," + dy] });
  }
  return route;
}

/* ---------- Luffy ---------- */
// dosiahne special cieľovú bunku? base = dáma (riadok/stĺpec/diagonála), gear3 = veža; vlastná bunka platí
export function luffySpecialReaches(board, fx, fy, tx, ty, form) {
  if (!inBounds(board, tx, ty)) return false;
  const dx = tx - fx, dy = ty - fy;
  if (dx === 0 && dy === 0) return true;
  const rook = dx === 0 || dy === 0;
  const diag = Math.abs(dx) === Math.abs(dy);
  return form === "gear3" ? rook : (rook || diag);
}
// bunky po priamke z (fx,fy) do (tx,ty) bez štartovej (cieľ je na línii - overené luffySpecialReaches)
export function luffyLinePath(fx, fy, tx, ty) {
  const dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
  const path = []; let x = fx, y = fy;
  while ((x !== tx || y !== ty) && path.length < 8) { x += dx; y += dy; path.push([x, y]); }
  return path;
}

/* ---------- simulácia vlastnej fronty (ghost) ---------- */
// Pozícia hráča počas naplánovaného kola - klient z nej kreslí ghost a náhľady, server ňou validuje
// ciele (Vojak, Luffy). Mana sa NEsimuluje (pohyb sa ráta, akoby vyšla); súperove akcie tiež nie.
// start = { x, y, char, form }, foe = VIDITEĽNÝ súper (skrytý v labyrinte → null alebo x null).
// Vracia pole stavov dĺžky queue.length + 1: [0] = štart, [i + 1] = po akcii i ({ x, y, char, form }).
export function simulateQueue(board, start, queue, foe, vampChars) {
  let { x, y, char, form } = start;
  const out = [{ x, y, char, form }];
  for (const a of queue || []) {
    if (a?.type === "swap" && a.to) char = a.to;                                   // turnajový swap mení maga
    if (a?.type === "recharge" && char === "luffy") form = form === "gear3" ? "base" : "gear3"; // Luffy: recharge prepína mód
    const d = DIR4[a?.dir];
    if (a?.type === "move" && d && inBounds(board, x + d[0], y + d[1])) { x += d[0]; y += d[1]; }
    if (a?.type === "dash" && d) {
      if (vampChars[char]) ({ x, y } = endOf(runPath(board, x, y, d, foe), x, y)); // charge po prvú figúru/okraj
      else for (let s = 0; s < 2; s++) if (inBounds(board, x + d[0], y + d[1])) { x += d[0]; y += d[1]; }
    }
    if (a?.type === "special" && char === "werewolf" && DIR8[a.dir]) ({ x, y } = endOf(runPath(board, x, y, DIR8[a.dir], foe), x, y));
    // Luffy: special ho presunie na cieľovú bunku (ak je na platnej línii)
    if (a?.type === "special" && char === "luffy" && a.cell && luffySpecialReaches(board, x, y, a.cell.x, a.cell.y, form)) { x = a.cell.x; y = a.cell.y; }
    out.push({ x, y, char, form });
  }
  return out;
}
function endOf({ path }, x, y) {
  return path.length ? { x: path[path.length - 1][0], y: path[path.length - 1][1] } : { x, y };
}

// pozícia vlastného tieňového klona po fronte: kopíruje move/dash majiteľa s inverznou vertikálou
// a VLASTNÝM clampom - hýbe sa aj vtedy, keď majiteľ narazí do steny (zrkadlí doMove/doDash + moveCloneSteps)
export function cloneSteps(board, clone, delta, maxSteps) {
  const d = [delta[0], -delta[1]];
  const path = [];
  let { x, y } = clone;
  for (let s = 0; s < maxSteps; s++) if (inBounds(board, x + d[0], y + d[1])) { x += d[0]; y += d[1]; path.push([x, y]); }
  return path;
}
export function simulateClone(board, clone, queue) {
  if (!clone) return null;
  let c = { x: clone.x, y: clone.y };
  for (const a of queue || []) {
    const d = DIR4[a?.dir];
    if (!d || (a.type !== "move" && a.type !== "dash")) continue;
    const path = cloneSteps(board, c, d, a.type === "dash" ? 2 : 1);
    if (path.length) c = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
  }
  return c;
}
