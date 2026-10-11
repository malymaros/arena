// public/client.js - vstupný bod klienta. Logika žije v moduloch public/client/* (popis v CLAUDE.md a
// docs/REFACTOR_PLAN.md, etapa 7); tu sa len zostaví scope C pre choreografiu postáv, pripoja vrstvy, ktorých
// poradie v DOM musí ísť až po figúrach z registra fx, a vykreslí sa úvodný stav.
// Moduly s vedľajšími efektmi pri načítaní (listenery, socket handlery, slučka kreslenia) sa importujú nižšie;
// ich telá bežia pred týmto súborom, ale udalosti a prvý frame prídu až po jeho dobehnutí.
import * as G from "/shared/geometry.js";
import "/client/net.js";              // socket + prihlásenie + room browser
import "/client/socket-handlers.js";  // herné udalosti zo servera
import "/client/char-select.js";      // výber postavy, draft, Hidden stránka
import "/client/controls.js";         // akčné tlačidlá a pickery
import "/client/preview-hovers.js";   // hover náhľady zón pri plánovaní
import "/client/retry.js";
import "/client/raf.js";              // hlavná slučka kreslenia
import "/client/admin.js";            // ?admin=1 → tlačidlo reset roomky
import "/client/debug-hope.js";       // ?hopedebug=1 → náhľad hope sprite
import { actors } from "/client/actors.js";
import { initCharFx, fxAll } from "/client/fx-registry.js";
import { gridEl, actorsEl, TILE_W, TILE_H, GAP, cellToPx } from "/client/dom.js";
import {
  ACTOR_W, ACTOR_H, spriteFrameIndex, SPECIAL_SCALE, charDirFor, usesAltColor, ANIM_DEF, ensureSpriteMeta,
  drawSprite,
} from "/client/sprites.js";
import { me, board, state } from "/client/session.js";
import { pixSvg, hydratePix } from "/client/pix.js";
import { spawnExplosionAt } from "/client/explosion.js";
import { cellsForSpecialPreview, WOLF_DIRS_CLIENT } from "/client/zones.js";
import { clearActionLogs } from "/client/action-log.js";
import { youMarker } from "/client/actor-layers.js";
import { abilityHoverChar } from "/client/char-select.js";
import { MOVE_MS, POSE_TAIL_MS, INVALID_MSG, setAnim } from "/client/anim.js";
import { computeFacing, pairShift, currentFacing } from "/client/placement.js";
import { spawnFloat } from "/client/board-fx.js";
import { renderGrid } from "/client/grid.js";
import { renderHUD } from "/client/hud.js";
import { renderQueue } from "/client/queue.js";
import { deathCenter, deathBehind, deathFog, hopeCenter, hopeFog } from "/client/overlays.js";
import { tsOverlay, worldCenter } from "/client/the-world.js";

// klientský scope pre choreografiu postáv (public/chars/fx/*): lenivé gettery (moduly ich čítajú až pri
// prehrávaní) - stav hry, rozmery, DOM vrstvy, pomocníci
const C = {
  get state() { return state; },
  get actorsEl() { return actorsEl; },
  get TILE_W() { return TILE_W; }, get TILE_H() { return TILE_H; },
  get ACTOR_W() { return ACTOR_W; }, get ACTOR_H() { return ACTOR_H; },
  get POSE_TAIL_MS() { return POSE_TAIL_MS; },
  get facingOverride() { return actors.facingOverride; },
  get lastAttackEndAt() { return actors.lastAttackEndAt; },
  get cellToPx() { return cellToPx; },
  get pairShift() { return pairShift; },
  get spawnExplosionAt() { return spawnExplosionAt; },
  get ensureSpriteMeta() { return ensureSpriteMeta; },
  get drawSprite() { return drawSprite; },
  get setAnim() { return setAnim; },
  get ANIM_DEF() { return ANIM_DEF; },
  get board() { return board; }, get GAP() { return GAP; },
  get MOVE_MS() { return MOVE_MS; }, get SPECIAL_SCALE() { return SPECIAL_SCALE; },
  get WOLF_DIRS_CLIENT() { return WOLF_DIRS_CLIENT; },
  get charDirFor() { return charDirFor; }, get usesAltColor() { return usesAltColor; },
  get computeFacing() { return computeFacing; },
  get hydratePix() { return hydratePix; }, get G() { return G; },
  get animState() { return actors.animState; }, get currentFacing() { return currentFacing; },
  get spriteFrameIndex() { return spriteFrameIndex; },
  get worldCenterShown() { return worldCenter.style.display !== "none"; },
  get gridEl() { return gridEl; }, get spawnFloat() { return spawnFloat; }, get INVALID_MSG() { return INVALID_MSG; },
  get cellsForSpecialPreview() { return cellsForSpecialPreview; },
  get escPrideDisplay() { return actors.escPrideDisplay; }, get escPrideDisplayChar() { return actors.escPrideDisplayChar; },
  get me() { return me; }, get abilityHoverChar() { return abilityHoverChar; },
};
// inštancie choreografie postáv dostanú scope C (public/client/fx-registry.js)
initCharFx(C);

/* ---------- Vrstvy, ktoré musia ísť v DOM až za figúry z registra fx ---------- */
fxAll("init"); // figúry postáv z registra fx (Jotarov stand Star Platinum - druhý canvas vedľa Jotara)

// overlaye Last Stand / Last Hope (public/client/overlays.js)
document.body.appendChild(deathCenter);
actorsEl.appendChild(deathBehind);
document.body.appendChild(deathFog);
document.body.appendChild(hopeCenter);
document.body.appendChild(hopeFog);
// THE WORLD overlaye (public/client/the-world.js) - v body za overlayami Last Stand
document.body.appendChild(tsOverlay);
document.body.appendChild(worldCenter);
// „YOU" značka - poskakujúca zlatá šípka nad vlastnou postavou (public/client/actor-layers.js)
actorsEl.appendChild(youMarker);

/* ---------- Úvodné vykreslenie ---------- */
// hydratácia pixel ikon - [data-emoji] dostanú pixelizovaný emoji canvas,
// [data-pix] ručne kreslené SVG z PIX knižnice (HP/mana v HUD)
hydratePix();
document.querySelectorAll(".pix-ico[data-pix]").forEach(el => { el.innerHTML = pixSvg(el.dataset.pix); });

gridEl.style.gridTemplateColumns = `repeat(${board.w}, ${TILE_W}px)`;
gridEl.style.gridTemplateRows = `repeat(${board.h}, ${TILE_H}px)`;
renderGrid({}, []);
renderHUD();
renderQueue();
clearActionLogs(); // skeleton placeholderov v zázname kola od začiatku
