// public/client/action-log.js - záznam akcií kola pod HUD widgetom oboch hráčov.
import { me, state } from "/client/session.js";
import { logP1, logP2 } from "/client/dom.js";
import { LS_BADGE_IMG } from "/client/pix.js";
import { isPhone } from "/client/viewport.js";

/* ---------- záznam akcií kola pod widgetom ---------- */
// Narutov vertikálny pohyb je verejne zrkadlený klonom (klon ide opačne) → smer up/down by SÚPEROVI prezradil,
// ktorá z dvoch figúr je pravý Naruto. V zázname/lište ho preto súperovi anonymizujeme na neutrálne „↕"
// (vlastný hráč vidí svoj skutočný smer). Horizontálny smer je bezpečný - klon ho kopíruje 1:1 (figúry sa nerozídu).
export const ARROW_DIR = { up: "↑", down: "↓", left: "←", right: "→", vert: "↕", up_left: "↖", up_right: "↗", down_left: "↙", down_right: "↘", center: "◎" };
export function displayDir(action, ownerSlot) {
  const dir = action?.dir;
  // Narutov klon zrkadlí vertikálu pri pohybe (move/dash) AJ pri basic útoku → smer up/down by súperovi prezradil,
  // ktorá figúra je pravá. Súperovi ho anonymizujeme na „↕" (vlastný hráč vidí skutočný smer).
  const vertMirrored = action?.type === "move" || action?.type === "dash" || action?.type === "attack";
  // anonymizuj len keď Naruto SKUTOČNE má klona - bez klona sa vertikála nerozdvojuje a smer nič neprezrádza
  // (klona má len Naruto - nastavuje ho jedine jeho special, swap ho maže)
  if (vertMirrored && (dir === "up" || dir === "down") &&
      ownerSlot && ownerSlot !== me && state?.[ownerSlot]?.clone) {
    return "vert";
  }
  return dir;
}
function actionIcon(action, ownerSlot) {
  // telefón: zápis kola v karte hráča len s piktogramami, bez smerových šípok (rovnako ako lišta kola)
  const arr = (a) => (isPhone ? "" : ARROW_DIR[displayDir(a, ownerSlot)] || "");
  switch (action?.type) {
    case "move":     return `🚶${arr(action)}`;
    case "dash":     return `🏃${arr(action)}`;
    case "recharge": return "🙏";
    case "attack":   return `🏹${arr(action)}`;
    case "melee":    return "🗡️";
    case "shield":   return "🛡️";
    case "mirror":   return "🪞";
    case "golden_shield": return "🛡️";
    case "golden_mirror": return "🪞";
    case "golden_mana": return "🙏";
    case "last_stand": return "💀";
    case "special":  return `✨${isPhone ? "" : ARROW_DIR[action.dir] || ""}`; // smer: Medúza/Escanor/Jotaro(S2); Vojakov cieľ (cell) sa neukazuje - len čistý badge
    // Special 1 (Jotaro, Luffy) sa v zápise kola tvári ako obyčajný mirror (🪞, bez smeru/cieľa) -
    // analógia k Vampire/Onryō, ktorých charge v dash slote sa ukazuje ako obyčajný dash (nemaskuje smer útoku)
    case "special1": return "🪞";
    case "stoned":   return "🗿";
    case "pass":     return "💭"; // vypršaný čas - nevyplnený slot
    case "swap":     return "🌀";
    case "unknown":  return "❓"; // labyrint - akcia súpera je pre prekliateho redigovaná
    default:         return "?";
  }
}
// skeleton záznamu kola - rovnaká fixná štruktúra ako fronta: [🛡️] | [1][2][3] | [🙏]
function buildActionLogSkeleton(log) {
  log.innerHTML = "";
  const mkSlot = (cls, inner) => {
    const el = document.createElement("span");
    el.className = `a-badge a-slot ${cls}`;
    el.innerHTML = inner;
    log.appendChild(el);
  };
  const mkDivider = () => {
    const d = document.createElement("span");
    d.className = "log-divider";
    log.appendChild(d);
  };
  mkSlot("slot-pre", '<span class="g-ico dim">🛡️</span>');
  mkDivider();
  for (let i = 0; i < 3; i++) mkSlot("slot-act", String(i + 1));
  mkDivider();
  mkSlot("slot-post", '<span class="g-ico dim">🙏</span>');
}

// akcie postupne vypĺňajú placeholder sloty (golden pre/post, bežné zľava doprava); vráti vyplnený slot
export function appendActionLog(slot, action) {
  const log = slot === "p1" ? logP1 : logP2;
  if (!log) return null;
  if (!log.children.length) buildActionLogSkeleton(log);

  const maskedBeat = action?.type === "unknown" ? (action.beat || "act") : null; // labyrint - redigovaná akcia
  if (action?.type === "golden_shield" || action?.type === "golden_mirror" || maskedBeat === "gpre") {
    const el = log.querySelector(".a-slot.slot-pre");
    if (el) {
      const mirror = action.type === "golden_mirror";
      el.className = "a-badge " + (maskedBeat ? "unknown" : action.type);
      el.innerHTML = maskedBeat ? '<span class="g-ico">❓</span>' : mirror ? '<span class="g-ico mirror">🪞</span>' : '<span class="g-ico">🛡️</span>';
    }
    return el;
  }
  if (action?.type === "golden_mana" || action?.type === "last_stand" || maskedBeat === "gmana") {
    const el = log.querySelector(".a-slot.slot-post");
    if (el) {
      el.className = "a-badge " + (maskedBeat ? "unknown" : action.type);
      el.innerHTML = maskedBeat ? '<span class="g-ico">❓</span>' : action.type === "last_stand" ? LS_BADGE_IMG : '<span class="g-ico">🙏</span>';
    }
    return el;
  }
  const el = log.querySelector(".a-slot.slot-act");
  if (el) {
    el.className = `a-badge ${action?.type || ""}`;
    el.textContent = actionIcon(action, slot);
  }
  return el;
}
export function clearActionLogs() {
  if (logP1) buildActionLogSkeleton(logP1);
  if (logP2) buildActionLogSkeleton(logP2);
}
