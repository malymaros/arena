// public/client/demon-sprites.js - sprity Last Stand démona (atlas 16 framov) a Last Hope postavy + vzhľad
// démona za postavou počas golden stavu.

// === Last Stand „démon" sprite - atlas 4×4 framov po 314×314 (tools/sprites-overlays: pôvodný pás 5024 px bol
// širší než 4096 px - limit textúry mobilných GPU) ===
export const DEATH_DIR   = "death";
export const DEATH_ANIM  = { file: "atlas.png", fps: 10, loop: true, frames: 16, cols: 4 };
export const DEATH_FRAME = 314; // rozmer framu (px) - backing canvasu stredového démona (overlays.js)
export const DEATH_SCALE = 2.0;  // veľkosť stredového démona (násobok výšky bunky)

// === Last Hope „hope" postava - atlas 4×3 framov po 768×512 (pôvodný pás 9216 px, tools/sprites-overlays) ===
export const HOPE_DIR  = "hope";
export const HOPE_ANIM = { file: "atlas.png", fps: 10, loop: true, frames: 12, cols: 4 };
export const HOPE_FRAME = { w: 768, h: 512 };

// vzhľad démona „za postavou" počas golden stavu (časovanie fáz riadi server cez delayMs frame-ov)
export const DEATH_SEQ = {
  behindRatio:   0.72, // veľkosť za postavou
  behindOpacity: 0.25, // priehľadnosť za postavou v ustálenom golden stave
  behindOffsetX: 0,    // doladenie pozície na postave (px)
  behindOffsetY: 80,
};
