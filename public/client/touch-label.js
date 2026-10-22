// public/client/touch-label.js - telefón: štítok akcie (cena + účinok) namiesto popisu. Tlačidlá na telefóne
// nesú len piktogram; po prvom ťuknutí sa nad tlačidlom ukáže štítok z poľa `label` (balance-ui.js BUTTON_TEXT,
// prebité v public/chars/<key>.js buttons.<slot>.label), prípadne žltá linka varovania (ghost.js planWarnings
// pre akciu na ďalšom mieste fronty). Málo many = červený štítok (zaradiť sa dá, server ju preškrtne).
// Čisté výpočty - vykresľovanie a umiestnenie robí touch.js.
import { moveBtn, attackBtn, dashBtn, meleeBtn, specialBtn, mirrorBtn, rechargeBtn, demonBtn, lastHopeBtn } from "/client/dom.js";
import { state, me } from "/client/session.js";
import { planning, buttonUi } from "/client/planning.js";
import { ghostCharAt, candidateWarning, shortWarning, NO_MANA_RE, foeMirrorImmune } from "/client/ghost.js";
import { BUTTON_TEXT } from "/client/balance-ui.js";
import { CHAR_BUTTONS, CHARS_BY_KEY } from "/chars/index.js";
import { GOLDEN_COST, GOLDEN_MIRROR_COST, MAX_MANA } from "/shared/balance.js";

const shieldBtn = document.querySelector('.btn.act.shield[data-act="shield"]');
// sloty, ktoré môže postava prebiť (buttons.<slot> v registri)
const CHAR_SLOTS = new Set(["attack", "dash", "melee", "special", "mirror", "recharge"]);

// tlačidlo → kľúč štítku (null = bez štítku: move, undo, LOCK IN…)
export function slotOf(el) {
  if (!el) return null;
  if (el === attackBtn) return "attack";
  if (el === dashBtn) return "dash";
  if (el === meleeBtn) return "melee";
  if (el === specialBtn) return "special";
  if (el === mirrorBtn) return "mirror";
  if (el === shieldBtn) return "shield";
  if (el === rechargeBtn) return "recharge";
  if (el === demonBtn) return "demon";
  if (el === lastHopeBtn) return "lastHope";
  if (el.classList.contains("shield-half")) return "goldenShield";
  if (el.classList.contains("mirror-half")) return "goldenMirror";
  if (el.classList.contains("gm-half")) return "goldenMana";
  if (el.classList.contains("ls-half")) return "lastStand";
  return null;
}
// tlačidlá, ktorým sa na telefóne počíta „málo many" (sivé, červený štítok)
export const MANA_BUTTONS = () => [attackBtn, dashBtn, meleeBtn, specialBtn, mirrorBtn, shieldBtn, demonBtn,
  ...document.querySelectorAll(".golden-half.shield-half, .golden-half.mirror-half")].filter(Boolean);

// text štítku ({emoji} tokeny) - postava prebíja spoločný
export function labelText(slot) {
  if (!slot) return null;
  const ui = buttonUi();
  const val = (d) => (typeof d === "function" ? d(ui) : d);
  let l;
  if (CHAR_SLOTS.has(slot)) l = val(CHAR_BUTTONS[ghostCharAt()]?.[slot])?.label;
  if (l == null) l = BUTTON_TEXT[slot]?.label;
  return val(l) ?? null;
}

// akcia, ktorá by sa ťuknutím zaradila (pre simuláciu many a varovaní); null = nejde do fronty
function candidateFor(slot, el) {
  const act = el?.dataset?.act;
  if (act && el.classList.contains("arrow")) { const [type, dir] = act.split(":"); return { type, dir }; }
  if (el?.classList.contains("mini-target")) return { type: "special" };
  switch (slot) {
    case "attack": case "dash": case "melee": case "special": case "shield": case "recharge": return { type: slot };
    case "mirror": return { type: CHARS_BY_KEY[ghostCharAt()]?.mirrorSlot === "special1" ? "special1" : "mirror" };
    case "demon": return planning.myQueue.some(a => a.type === "demon") ? null : { type: "demon" };
    default: return null;
  }
}

// { text, warn, noMana } pre tlačidlo / šípku / políčko; `dir` = prvok nesie smer (varovania závislé od smeru)
export function labelInfo(slot, el = null) {
  const out = { text: labelText(slot), warn: null, noMana: false };
  const mine = state?.[me];
  if (!mine) return out;
  // zlatý predťah: platí sa z many na začiatku kola (po Last Hope plnej); zapnutý → ťuk ho vypína, bez kontroly
  if (slot === "goldenShield" || slot === "goldenMirror") {
    const on = slot === "goldenShield" ? planning.goldenArmed : planning.goldenMirrorArmed;
    if (on) return out;
    const mana = planning.lastHopeArmed ? MAX_MANA : (mine.mana ?? 0);
    out.noMana = mana < (slot === "goldenShield" ? GOLDEN_COST : GOLDEN_MIRROR_COST);
    if (slot === "goldenMirror" && foeMirrorImmune()) out.warn = "ONLY BLOCKS";
    return out;
  }
  const cand = candidateFor(slot, el);
  if (!cand) return out;
  const w = candidateWarning(cand);
  out.noMana = !!w && NO_MANA_RE.test(w);
  out.warn = shortWarning(w);
  // bez smeru (tlačidlo, ktoré len otvára výber) sa „mimo plochy" ešte nedá posúdiť
  if (!cand.dir && out.warn === "OFF BOARD") out.warn = null;
  return out;
}
// tlačidlo, ktoré otvorilo práve otvorený výber smeru / políčka
export function openerOf(pickerEl) {
  const id = pickerEl?.id;
  if (id === "dir-picker") return moveBtn;
  if (id === "dash-picker") return dashBtn;
  if (id === "aim-picker" || id === "aim-picker-diag") return attackBtn;
  if (id === "s1-picker") return mirrorBtn;
  if (id === "special-picker" || id === "wolf-picker" || id === "cell-picker") return specialBtn;
  return null;
}
