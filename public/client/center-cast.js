// public/client/center-cast.js - veľký sprite specialu/melee v strede dosky (stredový overlay castu).
import { actorsEl, TILE_H } from "/client/dom.js";
import { computeFacing, currentFacing } from "/client/placement.js";
import { state } from "/client/session.js";
import { CHAR_FX } from "/client/fx-registry.js";
import { charDirFor, SPECIAL_SCALE, usesAltColor } from "/client/sprites.js";
import { SPECIAL_ANIMS } from "/chars/index.js";

/* ---------- specials/melee v strede boardu ---------- */
// veľký centrálny overlay - pre special efektový sprite mága, pre melee zväčšená postava so sekaním
export function updateSpecialCenter(casts) {
  actorsEl.querySelectorAll(".special-center").forEach(n => n.remove());
  if (!Array.isArray(casts) || casts.length === 0) return;

  // veľký sprite musí byť otočený rovnako ako malá postava na ploche (poloha voči súperovi + override streľby)
  const facing = computeFacing(state?.p1, state?.p2);

  for (const sp of casts) {
    const caster = state?.[sp.from];
    if (!caster || !caster.char) continue;

    // vlastný stredový overlay z registra fx (Jotaro: PÁR telo + stand Star Platinum)
    if (CHAR_FX[caster.char]?.spawnCenter?.(sp, facing)) continue;
    const dirKey = charDirFor(caster.char, sp.from);
    const file   = sp.file || SPECIAL_ANIMS[caster.char].file;

    const cvs = document.createElement("canvas");
    // veľkosť z registra fx (Escanorovo melee: stredová postava škáluje s Pridom)
    const fx = CHAR_FX[caster.char]?.centerScale?.(sp.from) ?? 1;
    const px  = Math.round(TILE_H * SPECIAL_SCALE * fx);
    cvs.width = px; cvs.height = px;
    cvs.className = "special-center";
    if (usesAltColor(caster.char, sp.from)) cvs.classList.add("alt-color");
    cvs.dataset.dir  = dirKey;
    cvs.dataset.file = file;
    if (sp.fps) cvs.dataset.fps = sp.fps;
    // choreografia postavy (register fx): vlastný vznik/kreslenie stredového spritu (Vojak: mierenie + výšľah)
    const cfx = CHAR_FX[caster.char];
    cfx?.centerCanvas?.(cvs, sp);
    if (cfx?.drawCenter) cvs.dataset.fxChar = caster.char;
    // one-shot stredový sprite (Countess A-sheety): hrá RAZ od vzniku canvasu (= od začiatku svojho
    // frame-u) a drží posledný frame - absolútny loop by naratívnu sekvenciu začal v strede.
    // Platí pre melee/heal casty (sp.once); jej trap cast (A5) nastaví to isté register fx (centerCanvas)
    if (sp.once) {
      cvs.dataset.once = "1";
      cvs.dataset.born = String(performance.now());
    }

    const flip = currentFacing(sp.from, facing);
    if (!cfx?.centerPlace?.(cvs, flip)) { // register fx (Escanor: rastie s Pridom → nohy fixné, rast nahor)
      cvs.style.left = "50%";
      cvs.style.top  = "50%";
      cvs.style.transform = `translate(-50%, -50%) scaleX(${flip})`;
    }

    actorsEl.appendChild(cvs);
  }
}
