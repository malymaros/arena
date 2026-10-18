// public/client/defense-fx.js - efekty obrany: rozbitie štítu (blok) a odraz zrkadla (lúč späť do útočníka,
// úlomky, otras dosky). originCell umožní zobraziť obranu na klonovej figúre bez prezradenia pravého Naruta.
import { state } from "/client/session.js";
import { pairShift, computeFacing } from "/client/placement.js";
import { ACTOR_W } from "/client/sprites.js";
import { HEAD_CX } from "/chars/index.js";
import { cellToPx, TILE_W, TILE_H, actorsEl, gridEl } from "/client/dom.js";
import { pixelizeEmoji } from "/client/pix.js";

// efektný náraz do štítu pri úspešnom bloku - hexagonálna bariéra flashne, rázové prstence + iskry
// originCell (voliteľné): štít sa rozbije na inej bunke než na Narutovi - napr. zásah na KLONOVI cez zdieľaný
// štít, aby sa block ukázal aj na klonovej figúre (nielen na pravom Narutovi)
export function spawnShieldBlock(slot, gold, originCell = null) {
  const p = state?.[slot];
  if (!p || p.x == null) return;
  const shift = Array.isArray(originCell) ? 0 : pairShift(slot);
  const facing = computeFacing(state?.p1, state?.p2);
  const headDx = (facing[slot] || 1) * ACTOR_W * ((HEAD_CX[p.char] ?? 0.5) - 0.5);
  const cell = Array.isArray(originCell) ? originCell : [p.x, p.y];
  const { left, top } = cellToPx(cell[0], cell[1]);
  const cx = left + TILE_W / 2 + shift + headDx;
  const cy = top + TILE_H * 0.5;

  const add = (cls, style) => {
    const el = document.createElement("div");
    el.className = "shield-fx " + cls + (gold ? " gold" : "");
    el.style.left = cx + "px"; el.style.top = cy + "px";
    Object.assign(el.style, style || {});
    actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
    return el;
  };

  add("sb-barrier", { width: Math.round(TILE_W * 0.7) + "px", height: Math.round(TILE_H * 0.95) + "px" });
  add("sb-flash", {});
  add("sb-ring", {});
  // štít sa roztriešti - veľa veľkých úlomkov letí ďaleko na všetky strany so spinom
  const N = 24;
  for (let i = 0; i < N; i++) {
    const ang = (Math.PI * 2 * i / N) + i * 0.17;
    const dist = 95 + (i % 4) * 40 + Math.random() * 30;
    const sh = add("sb-shard", {
      width: (16 + Math.random() * 16).toFixed(0) + "px",
      height: (18 + Math.random() * 16).toFixed(0) + "px",
      animationDelay: ".08s", // najprv bariéra zaregistruje náraz, potom sa roztriešti
    });
    sh.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    sh.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    sh.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2 + 60) + "deg");
  }
}

// stred bunky hráča v súradniciach actorsEl
function centerOf(slot) {
  const p = state?.[slot];
  if (!p || p.x == null) return null;
  const { left, top } = cellToPx(p.x, p.y);
  return { x: left + TILE_W / 2, y: top + TILE_H / 2 };
}

// efektná animácia odrazu: zrkadlová tabuľa flashne a praskne pri obrancovi,
// rázová vlna + sklenené úlomky, lúč vystrelí späť do útočníka, board sa otrasie
// originCell (voliteľné): odraz vychádza z inej bunky než z obrancu - napr. zásah na KLONOVI cez zdieľaný
// mirror, aby lúč nešiel z pravého Naruta (to by prezradilo, ktorý je skutočný)
export function spawnMirrorReflect(defenderSlot, dmg = 1, atkKind = "basic", gold = false, originCell = null, destCell = null) {
  const d = Array.isArray(originCell)
    ? (() => { const { left, top } = cellToPx(originCell[0], originCell[1]); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; })()
    : centerOf(defenderSlot);
  if (!d) return;
  // destCell: útok vystrelil útočníkov klon → beam letí do klonovej bunky, nie do pravého útočníka (slot center)
  const a = Array.isArray(destCell)
    ? (() => { const { left, top } = cellToPx(destCell[0], destCell[1]); return { x: left + TILE_W / 2, y: top + TILE_H / 2 }; })()
    : centerOf(defenderSlot === "p1" ? "p2" : "p1");

  const add = (cls, style) => {
    const el = document.createElement("div");
    el.className = "mirror-fx " + cls + (gold ? " gold" : "");
    Object.assign(el.style, style);
    actorsEl.appendChild(el);
    setTimeout(() => el.remove(), 900);
    return el;
  };

  // 1) zrkadlová tabuľa (glassy flash) za emoji
  add("mirror-pane", {
    left: d.x + "px", top: d.y + "px",
    width: Math.round(TILE_W * 0.6) + "px",
    height: Math.round(TILE_H * 0.92) + "px",
  });

  // 1b) samotné 🪞 emoji ako zdroj lúča - pixelizované ako zvyšok UI
  const emoSize = Math.round(TILE_H * 0.6);
  const emo = add("mirror-emoji pix-ico", {
    left: d.x + "px", top: d.y + "px",
    width: emoSize + "px", height: emoSize + "px",
  });
  emo.dataset.emoji = "🪞";
  pixelizeEmoji(emo, 24);

  // 2) rázová vlna
  const ring = Math.round(TILE_H * 1.1);
  add("mirror-ring", { left: d.x + "px", top: d.y + "px", width: ring + "px", height: ring + "px" });

  // 3) sklenené úlomky letiace do strán
  for (let i = 0; i < 12; i++) {
    const ang  = (Math.PI * 2 * i / 12) + (i * 0.37);          // pseudo-náhodný rozptyl bez Math.random()
    const dist = 46 + (i % 4) * 22;
    const el = add("mirror-shard", { left: d.x + "px", top: d.y + "px" });
    el.style.setProperty("--dx", Math.round(Math.cos(ang) * dist) + "px");
    el.style.setProperty("--dy", Math.round(Math.sin(ang) * dist) + "px");
    el.style.setProperty("--rot", Math.round(ang * 180 / Math.PI * 2) + "deg");
  }

  // 4) odraz: melee - alebo special na rovnakom políčku - = hrubý drsný burst (beam nemá kam letieť);
  //    inak smerový lúč k útočníkovi
  const foeSlot = defenderSlot === "p1" ? "p2" : "p1";
  const dp = state?.[defenderSlot], ap = state?.[foeSlot];
  const sameCell = !!(dp && ap && dp.x === ap.x && dp.y === ap.y);
  const useBurst = atkKind === "melee" || (atkKind === "special" && sameCell);
  if (useBurst) {
    // burst cez skoro celé políčko; pri speciáli vo fialovom prevedení
    add("mirror-melee" + (atkKind === "special" ? " special" : ""), {
      left: d.x + "px", top: d.y + "px",
      width: Math.round(TILE_W * 0.9) + "px",
      height: Math.round(TILE_H * 0.95) + "px",
    });
  } else if (a) {
    const dist = Math.hypot(a.x - d.x, a.y - d.y);
    const ang  = Math.atan2(a.y - d.y, a.x - d.x) * 180 / Math.PI;
    // hrúbka: basic podľa dmg (1/2/3) s výraznými rozostupmi, special ako najhrubší basic, fialovo ladený
    const thick = atkKind === "special" ? 48 : ({ 1: 12, 2: 28, 3: 48 }[dmg] || 12);
    const wrap = add("mirror-beam-wrap", {
      left: d.x + "px", top: (d.y - thick / 2) + "px",
      width: dist + "px", height: thick + "px",
      transform: `rotate(${ang}deg)`,
    });
    const beam = document.createElement("div");
    beam.className = "mirror-beam" + (atkKind === "special" ? " special" : "") + (gold ? " gold" : "");
    wrap.appendChild(beam);
  }

  // 5) otras boardu - pri burste (melee/special-na-políčku) silnejší (drsnejší dojem)
  const boardEl = gridEl.parentElement;
  if (boardEl) {
    boardEl.classList.remove("fx-shake");
    void boardEl.offsetWidth;
    boardEl.classList.add("fx-shake");
    setTimeout(() => boardEl.classList.remove("fx-shake"), useBurst ? 650 : 450);
  }
}
