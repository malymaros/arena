// public/chars/fx/countess.js - klientská choreografia Vampire (Countess): A-sheety (A1–A5) sú naratívne
// sekvencie so zapečenými Blood_Charge efektmi - hrajú RAZ od frame 0 a držia posledný frame (absolútny loop
// by ich začal v strede). Úder A1 aj liečivé beaty A2–A4 sa zrkadlia do veľkého stredového spritu.
// Továreň dostane C = klientský scope (client.js) a vráti háčiky choreografie (popis: public/chars/fx/index.js).
export default function countessFx(C) {
  return {
    // úder (A1) aj liečivé beaty (A2/A3/A4) → one-shot stredový sprite od začiatku svojho beatu
    centerCast(e) {
      if (e.kind !== "vamp_strike" && e.kind !== "vamp_heal_cast") return null;
      const def = C.ANIM_DEF[e.anim] ?? C.ANIM_DEF.va1;
      return { from: e.from, file: def.file, fps: def.fps, once: true };
    },
    // cast pasce (special bez sp.file → A5): stredový sprite hrá RAZ od vzniku canvasu
    centerCanvas(cvs, sp) {
      if (sp.file) return;
      cvs.dataset.once = "1";
      cvs.dataset.born = String(performance.now());
    },
    // malá figúra pri caste pasce: A5 RAZ od frame 0 (relatívny čas), nie absolútny loop
    boardAnim({ aSt, stoned, anim }) {
      if (aSt.key !== "casting") return anim;
      return { ...anim, loop: stoned ? anim.loop : false, fromStart: true };
    },
  };
}
