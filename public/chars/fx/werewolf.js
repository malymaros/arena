// public/chars/fx/werewolf.js - klientská choreografia Vlkolaka: special = charge v 8 smeroch.
// Cast aj beh sú otočené v horizontálnom smere behu (diagonály vrátane), beh = Run+Attack (wolfrun),
// seknutie na bunke terča = Attack_2 (wolfstrike); dmg/block/odraz padne až po frame seknutia.
// Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie (popis: public/chars/fx/index.js).
export default function werewolfFx(C) {
  return {
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
