// public/client/demon-sprites.js - sprity Last Stand démona (strip 5024×314 = 16 framov) a Last Hope postavy + vzhľad
// démona za postavou počas golden stavu.

// === Last Stand „démon" sprite - strip 5024×314 = 16 štvorcových framov ===
export const DEATH_DIR   = "death";
export const DEATH_ANIM  = { file: "spritesheet_strip.png", fps: 10, loop: true };
export const DEATH_SCALE = 2.0;  // veľkosť stredového démona (násobok výšky bunky)

// === Last Hope „hope" postava - strip (analógia k death sprite) ===
export const HOPE_DIR  = "hope";
// 9216×512 = 12 framov po 768px (framy NIE sú štvorcové → frame inference háda zle, preto explicitné frames)
export const HOPE_ANIM = { file: "sprite_strip.png", fps: 10, loop: true, frames: 12 };

// vzhľad démona „za postavou" počas golden stavu (časovanie fáz riadi server cez delayMs frame-ov)
export const DEATH_SEQ = {
  behindRatio:   0.72, // veľkosť za postavou
  behindOpacity: 0.25, // priehľadnosť za postavou v ustálenom golden stave
  behindOffsetX: 0,    // doladenie pozície na postave (px)
  behindOffsetY: 80,
};
