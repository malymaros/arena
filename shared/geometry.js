// shared/geometry.js - herná geometria zdieľaná serverom (engine) aj prehliadačom (client.js) - Etapa 2
// refaktoru (docs/REFACTOR_PLAN.md). Čisté funkcie bez stavu: doska sa podáva explicitne ako { w, h },
// bunky sú [x, y]. Čo je tu, sa NESMIE duplikovať na klientovi - náhľady (hover, ghost, picker) a
// skutočné vyhodnotenie na serveri tak idú po tých istých bunkách.

export const DIR4 = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
export const DIAG_DIRS = { up_left: [-1, -1], up_right: [1, -1], down_left: [-1, 1], down_right: [1, 1] };
export const DIR8 = { ...DIR4, ...DIAG_DIRS }; // vlkolakov charge + smer basicu (ortogonálny aj diagonálny)
export const DIAG_NAME = { "-1,-1": "up_left", "1,-1": "up_right", "-1,1": "down_left", "1,1": "down_right" };
export const VAMP_SHOT_RANGE = 3; // diagonálna bounce strela (Vampire/Onryō/Jotaro/Luffy): max 3 bunky

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
// Vlkolakov charge, charge Vampire/Onryō, ghost simulácia aj ich náhľady.
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

/* ---------- portály (Portal Realm, docs/PORTAL_PLAN.md) ---------- */
// Portál leží na VONKAJŠEJ hrane okrajového políčka: koniec { x, y, side } (side = smer von z dosky).
// Pár { id, type, ends: [koniec, koniec] }. Figúra/strela, ktorá by ortogonálnym krokom opustila dosku cez hranu
// s portálom, pokračuje na políčku DRUHÉHO konca smerom dovnútra (opak jeho side) - prechod = 1 krok.
// Diagonálne pohyby do portálov nevchádzajú. Bez portálov (null / []) sa všetko správa ako stena.
export const OPP_DIR = { up: "down", down: "up", left: "right", right: "left" };
// všetky vonkajšie hrany dosky v pevnom poradí (žreb spawnu je tak deterministický): horná, pravá, dolná, ľavá
export function boardEdges(board) {
  const out = [];
  for (let x = 0; x < board.w; x++) out.push({ x, y: 0, side: "up" });
  for (let y = 0; y < board.h; y++) out.push({ x: board.w - 1, y, side: "right" });
  for (let x = 0; x < board.w; x++) out.push({ x, y: board.h - 1, side: "down" });
  for (let y = 0; y < board.h; y++) out.push({ x: 0, y, side: "left" });
  return out;
}
// koniec portálu na hrane (x, y, side) → { pair, i } (i = index koncu v páre) | null
export function portalEnd(portals, x, y, side) {
  for (const pair of portals || []) {
    for (let i = 0; i < 2; i++) {
      const e = pair.ends[i];
      if (e.x === x && e.y === y && e.side === side) return { pair, i };
    }
  }
  return null;
}
// jeden ortogonálny krok z (x, y) smerom dir. Na doske → { x, y, dir }; mimo dosky cez portál (pár nie je
// v `closed`) → { x, y, dir: smer dovnútra, portal: { id, type, enter, exit } }; inak null (stena)
export function portalStep(board, portals, x, y, dir, closed = null) {
  const d = DIR4[dir];
  if (!d) return null;
  if (inBounds(board, x + d[0], y + d[1])) return { x: x + d[0], y: y + d[1], dir };
  const hit = portalEnd(portals, x, y, dir);
  if (!hit || closed?.has(hit.pair.id)) return null;
  const a = hit.pair.ends[hit.i], b = hit.pair.ends[1 - hit.i];
  return { x: b.x, y: b.y, dir: OPP_DIR[b.side],
    portal: { id: hit.pair.id, type: hit.pair.type, enter: { x: a.x, y: a.y, side: a.side }, exit: { x: b.x, y: b.y, side: b.side } } };
}
// beh (charge) z (x, y) ortogonálnym smerom dir cez portály po PRVÚ figúru súpera alebo stenu; každý pár
// sa v jednom behu použije najviac raz (po prechode sa zatvára). Bez portálov = runPath.
// Vracia { path, target, passes: [{ at, ...portal }] } - at = index výstupnej bunky v path.
export function runPathPortals(board, x, y, dir, foe = null, portals = null) {
  const path = [], passes = [], closed = new Set();
  let target = null;
  for (let guard = 0; guard < 64; guard++) {
    const st = portalStep(board, portals, x, y, dir, closed);
    if (!st) break;
    x = st.x; y = st.y; dir = st.dir;
    path.push([x, y]);
    if (st.portal) { passes.push({ at: path.length - 1, ...st.portal }); closed.add(st.portal.id); }
    target = figureAt(foe, x, y);
    if (target) break;
  }
  return { path, target, passes };
}
// rovná strela (náhľad mierenia / pre-scan): dolet `range` políčok spolu, cez portály (každý pár raz).
// Vracia [{ x, y, dir, portal? }] - bunky letu; zastavenie o figúry rieši volajúci.
export function shotPathPortals(board, portals, x, y, dir, range) {
  const out = [], closed = new Set();
  while (out.length < range) {
    const st = portalStep(board, portals, x, y, dir, closed);
    if (!st) break;
    x = st.x; y = st.y; dir = st.dir;
    if (st.portal) closed.add(st.portal.id);
    out.push(st);
  }
  return out;
}

/* ---------- zóny specialov ---------- */
// Medúza: vlastné políčko + všetko striktne zvoleným smerom (left/right) v riadkoch y±1;
// bez smeru (stratená v labyrinte - je tma) skamení len na jej vlastnom políčku
export function medusaCells(board, me, dir) {
  const cells = [[me.x, me.y]];
  if (dir !== "left" && dir !== "right") return cells;
  const sgn = dir === "left" ? -1 : 1;
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
// Portal Realm: hod mimo dosky cez hranu s portálom → F = políčko druhého konca (zóna sa okolo neho NEpretáča)
export function escanorAnchor(board, me, dir, portals = null) {
  const sd = dir === "left" ? "left" : "right";
  const fx = me.x + (sd === "left" ? -1 : 1), fy = me.y;
  if (fx >= 0 && fx < board.w) return { x: fx, y: fy, portal: null };
  const st = portalStep(board, portals, me.x, me.y, sd);
  return st ? { x: st.x, y: st.y, portal: st.portal } : null;
}
export function escanorCells(board, me, dir, portals = null) {
  const out = [];
  const add = (x, y) => { if (inBounds(board, x, y) && !has(out, x, y)) out.push([x, y]); };
  const pride = Math.max(0, Math.min(3, me.pride || 0));
  const anchor = escanorAnchor(board, me, dir, portals);
  if (!anchor) return out;
  const fx = anchor.x, fy = anchor.y;
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
// guľa (special pred prvým použitím v hre): kotúľ o 1 bunku ←/→ a výbuch na 3×3 okolo dopadovej bunky
// (vrátane nej). Dopadová bunka mimo plochy (kotúľ z krajného stĺpca von) → null / prázdna zóna = spálený special.
// Portal Realm: kotúľ z krajného stĺpca cez hranu s portálom → dopad na políčko druhého konca (portal v návrate)
export function luffyBallLanding(board, me, dir, portals = null) {
  const dx = dir === "left" ? -1 : dir === "right" ? 1 : 0;
  if (!dx) return null;
  if (inBounds(board, me.x + dx, me.y)) return { x: me.x + dx, y: me.y };
  const st = portalStep(board, portals, me.x, me.y, dir);
  return st ? { x: st.x, y: st.y, portal: st.portal } : null;
}
export function luffyBallCells(board, me, dir, portals = null) {
  const c = luffyBallLanding(board, me, dir, portals);
  if (!c) return [];
  const cells = [];
  for (let y = c.y - 1; y <= c.y + 1; y++) for (let x = c.x - 1; x <= c.x + 1; x++) if (inBounds(board, x, y)) cells.push([x, y]);
  return cells;
}

/* ---------- simulácia vlastnej fronty (ghost) ---------- */
// Pozícia hráča počas naplánovaného kola - klient z nej kreslí ghost a náhľady, server ňou validuje
// ciele (Vojak, Luffy). Mana sa NEsimuluje (pohyb sa ráta, akoby vyšla); súperove akcie tiež nie.
// start = { x, y, char, worldUsed }, foe = VIDITEĽNÝ súper (skrytý v labyrinte → null alebo x null).
// worldUsed = jednorazový special tejto hry už padol (Jotaro THE WORLD, Luffyho guľa).
// Vracia pole stavov dĺžky queue.length + 1: [0] = štart, [i + 1] = po akcii i ({ x, y, char, worldUsed }).
// portals (Portal Realm) = portály na doske: pohyb/dash/charge/guľa nimi prechádza a použitý pár sa pre ďalšie
// akcie fronty zatvorí (súperove prechody sa nesimulujú - akceptovaná neistota ako pri pasciach).
export function simulateQueue(board, start, queue, foe, vampChars, portals = null) {
  let { x, y, char } = start;
  let worldUsed = !!start.worldUsed;
  let open = portals ? [...portals] : null; // dostupné páry (použité vypadávajú)
  const close = (ids) => { if (open && ids.length) open = open.filter(p => !ids.includes(p.id)); };
  const out = [{ x, y, char, worldUsed }];
  for (const a of queue || []) {
    if (a?.type === "swap" && a.to) char = a.to;                                   // turnajový swap mení maga
    const d = DIR4[a?.dir];
    const walk = (n) => {
      const used = [];
      let dir = a.dir;
      for (let s = 0; s < n; s++) {
        const st = portalStep(board, open, x, y, dir);
        if (!st) break;
        ({ x, y, dir } = st);
        if (st.portal) { used.push(st.portal.id); close([st.portal.id]); }
      }
      return used;
    };
    if (a?.type === "move" && d) walk(1);
    if (a?.type === "dash" && d) {
      if (vampChars[char]) {                                                       // charge po prvú figúru/okraj
        const r = runPathPortals(board, x, y, a.dir, foe, open);
        ({ x, y } = endOf(r, x, y)); close(r.passes.map(p => p.id));
      } else walk(2);
    }
    if (a?.type === "special" && char === "werewolf" && DIR8[a.dir]) {
      if (DIR4[a.dir]) { const r = runPathPortals(board, x, y, a.dir, foe, open); ({ x, y } = endOf(r, x, y)); close(r.passes.map(p => p.id)); }
      else ({ x, y } = endOf(runPath(board, x, y, DIR8[a.dir], foe), x, y));       // diagonála do portálov nevchádza
    }
    // Luffy: guľa (pred prvým použitím v hre) ho prekotúľa o bunku ←/→; Special 2 po nej nehýbe
    if (a?.type === "special" && char === "luffy" && !worldUsed) {
      const c = luffyBallLanding(board, { x, y }, a.dir, open);
      if (c) { ({ x, y } = c); if (c.portal) close([c.portal.id]); }
    }
    if (a?.type === "special" && (char === "luffy" || char === "jotaro")) worldUsed = true;
    out.push({ x, y, char, worldUsed });
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
export function simulateClone(board, clone, queue, portals = null) {
  if (!clone) return null;
  let c = { x: clone.x, y: clone.y };
  let open = portals ? [...portals] : null;
  for (const a of queue || []) {
    const d = DIR4[a?.dir];
    if (!d || (a.type !== "move" && a.type !== "dash")) continue;
    if (open?.length) {
      // klon ide vertikálne inverzne aj cez portály
      let dir = d[1] ? OPP_DIR[a.dir] : a.dir;
      for (let s = 0; s < (a.type === "dash" ? 2 : 1); s++) {
        const st = portalStep(board, open, c.x, c.y, dir);
        if (!st) break;
        c = { x: st.x, y: st.y }; dir = st.dir;
        if (st.portal) open = open.filter(p => p.id !== st.portal.id);
      }
      continue;
    }
    const path = cloneSteps(board, c, d, a.type === "dash" ? 2 : 1);
    if (path.length) c = { x: path[path.length - 1][0], y: path[path.length - 1][1] };
  }
  return c;
}
