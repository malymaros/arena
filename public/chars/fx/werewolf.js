// public/chars/fx/werewolf.js - klientská choreografia Vlkolaka: special = charge v 8 smeroch.
// Cast aj beh sú otočené v horizontálnom smere behu (diagonály vrátane), beh = Run+Attack (wolfrun),
// seknutie na bunke terča = Attack_2 (wolfstrike); dmg/block/odraz padne až po frame seknutia.
// Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie (popis: public/chars/fx/index.js).
import { WOLF_MOON_DMG } from "../werewolf.js";

export default function werewolfFx(C) {
  const skull = (dmg) => `${dmg}<span class="pix-ico mini" data-emoji="☠️"></span>`;
  // HUD: fáza mesiaca (ikona BEZ čísla - level 0–3 je interný, hráč vidí len mesiac) vľavo,
  // dmg specialu pri aktuálnej fáze vpravo v HUD widgete. Pri inej postave sa oba prvky skryjú.
  const moonBadge = { p1: document.getElementById("moon-p1"), p2: document.getElementById("moon-p2") };
  const moonDmg   = { p1: document.getElementById("mdmg-p1"), p2: document.getElementById("mdmg-p2") };
  function hud(slot, p) {
    const badge = moonBadge[slot], dmgEl = moonDmg[slot];
    if (!badge || !dmgEl) return;
    if (!p || p.char !== "werewolf") { badge.classList.add("hidden"); dmgEl.classList.add("hidden"); return; }
    const lvl = Math.max(0, Math.min(3, p.moon || 0));
    const img = badge.querySelector("img");
    if (img && !img.getAttribute("src").endsWith("_" + lvl + ".png")) img.src = "/assets/moon_" + lvl + ".png";
    badge.classList.toggle("moon-max", lvl >= 3); // spln pulzuje (max dmg)
    badge.classList.remove("hidden");
    if (dmgEl.dataset.lvl !== String(lvl)) { // prekresli len pri zmene (renderHUD beží per frame)
      dmgEl.dataset.lvl = String(lvl);
      dmgEl.innerHTML = skull(WOLF_MOON_DMG[lvl]);
      C.hydratePix(dmgEl);
    }
    dmgEl.classList.remove("hidden");
  }
  // výber postáv: fáza mesiaca + dmg pod mini-doskou (moon_{0..3}.png; spln pulzuje ako max), cyklí 0→3
  // (tempo ako pride náhľad); dráha charge od fázy nezávisí - zónu kreslí generický náhľad, cyklí len badge
  const caEl = () => document.getElementById("ca-moon");
  function syncCa(lvl) {
    const el = caEl(); if (!el) return;
    const img = el.querySelector("img");
    if (img && !img.getAttribute("src").endsWith("_" + lvl + ".png")) img.src = "/assets/moon_" + lvl + ".png";
    el.classList.toggle("pride-max", lvl >= 3); // rovnaký pulz ako pride 3
    const dmgEl = el.querySelector(".ca-moon-dmg");
    if (dmgEl) { dmgEl.innerHTML = skull(WOLF_MOON_DMG[lvl]); C.hydratePix(dmgEl); }
  }
  function preview() {
    const s = { lvl: 0, last: 0 };
    caEl()?.classList.remove("hidden");
    syncCa(0);
    return {
      frame(now) {
        if (!s.last) s.last = now;
        if (now - s.last >= 1500) { s.last = now; s.lvl = (s.lvl + 1) % 4; syncCa(s.lvl); }
      },
      close: () => caEl()?.classList.add("hidden"),
    };
  }

  return {
    hud,
    preview,
    // po kole sa zmenila fáza mesiaca → float s NOVOU fázou nad ním (bez farieb/šípok - hráč vidí
    // len mesiac, čísla 0–3 sú čisto interné; aj pri preskoku o viac levelov sa ukáže len výsledná fáza)
    levelFloat(slot, level) {
      const p = C.state?.[slot]; if (!p || p.x == null) return;
      const { left, top } = C.cellToPx(p.x, p.y);
      const el = document.createElement("div");
      el.className = "moon-float";
      el.innerHTML = `<img src="/assets/moon_${Math.max(0, Math.min(3, level))}.png" alt="" />`;
      el.style.left = (left + C.TILE_W / 2) + "px";
      el.style.top = (top - 24) + "px";
      C.actorsEl.appendChild(el);
      setTimeout(() => el.remove(), 1700);
    },
    effect(e, frameHold) {
      if (e.from !== "p1" && e.from !== "p2") return;
      // rozbehový cast aj beh charge - otočený v horizontálnom smere behu
      if ((e.kind === "special" || e.kind === "wolf_charge") && typeof e.dir === "string") {
        const sx = e.dir.includes("left") ? -1 : e.dir.includes("right") ? 1 : 0;
        if (sx) C.facingOverride[e.from] = { sx, until: performance.now() + frameHold + C.POSE_TAIL_MS };
      }
      // beh po doske - Run+Attack namiesto bežného Run (auto-run z posunu pozície beží pred efektmi, tu ho prepíšeme)
      if (e.kind === "wolf_charge") {
        C.setAnim(e.from, "wolfrun", frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
      // seknutie na bunke terča - dmg/block/odraz padne až po tomto frame
      if (e.kind === "wolf_strike") {
        C.setAnim(e.from, "wolfstrike", frameHold);
        C.lastAttackEndAt[e.from] = performance.now() + frameHold;
      }
    },
  };
}
