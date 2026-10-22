// public/client/sprites.js - sprite sheety postáv: priečinky per slot (alt-color / dirP2), definície animácií
// (ANIM_DEF + anims z registra postáv), načítanie metadát sheetu (ensureSpriteMeta, cache SPRITES) a kreslenie
// framu do canvasu (drawSprite). Rozmery figúry na doske (ACTOR_W/H) a škály projektilu / stredového castu.
import { CHAR_META, SIDE_CHARS, CHAR_ANIMS, SPRITE_FILE_ALIAS, PORTRAIT_SCALE } from "/chars/index.js";
import { TILE_W, TILE_H } from "/client/dom.js";

// canvasy postáv - väčšie než bunka (1.5×), v positionActors centrované na bunku
const ACTOR_SCALE = 1.875;
export const ACTOR_W = Math.round(TILE_W * ACTOR_SCALE);
export const ACTOR_H = Math.round(TILE_H * ACTOR_SCALE);
// index práve zobrazeného framu - zrkadlí logiku drawSprite (loop/loopFrom/clamp), aby feet lookup sedel (Jotarov stand)
export function spriteFrameIndex(anim, t, total) {
  if (anim.frameIndex != null) return Math.max(0, Math.min(total - 1, anim.frameIndex));
  const elapsedF = Math.floor(t / (1000 / anim.fps));
  if (anim.loopFrom != null) return elapsedF < total ? elapsedF : anim.loopFrom + ((elapsedF - anim.loopFrom) % (total - anim.loopFrom));
  if (anim.loop) return ((elapsedF % total) + total) % total;
  return Math.min(total - 1, Math.max(0, elapsedF));
}

export const CHARGE_SCALE = 1.0;
export const CHARGE_ANIM  = { file: "Charge.png", fps: 8, loop: true };

// Special anim
export const SPECIAL_SCALE = 4.8;

// veľkosť postavy v karte výberu / HUD portréte (portraitScale z registra; na BOARDE bez násobiča)
export const portraitFill = (char, base) => base * (PORTRAIT_SCALE[char] ?? 1);

// je `key` side-postava viazaná na `slot`? (SIDE_CHARS z registra; p2 má viac: onre, jotaro). V turnaji sa
// dajú draftnúť, ale swap DO/Z nich je zakázaný - v HUD hlavách to reprezentuje glitch (viď renderMageHeads).
export function sideCharBoundTo(key, slot) { return SIDE_CHARS[key] === slot; }

// sprite priečinok postavy pre daný slot - postava s natívnou p2 paletou (dirP2) nepoužíva alt-color filter
export function charDirFor(char, slot) {
  const m = CHAR_META[char];
  return (slot === "p2" && m?.dirP2) ? m.dirP2 : m?.dir;
}
export function usesAltColor(char, slot) { return slot === "p2" && !CHAR_META[char]?.dirP2; }
export const ANIM_DEF = {
  idle: { file: "Idle.png",     fps: 6,  loop: true  },
  run: { file: "Run.png",      fps: 12, loop: true  },
  attack: { file: "Attack_1.png", fps: 10, loop: false },
  attack2: { file: "Attack_2.png", fps: 10, loop: false },
  // looping variant pre melee - malá postava sa seká súbežne s veľkým sprite-om (inak by zamrzla na poslednom frame).
  // special nemá vlastný key: malá postava kreslí svoj efektový sprite (SPECIAL_ANIMS) cez key "casting" priamo v raf.
  attack2_loop: { file: "Attack_2.png", fps: 10, loop: true },
  attack1_loop: { file: "Attack_1.png", fps: 10, loop: true }, // melee Medúzy - šľah celým telom (Attack_1)
  hurt: { file: "Hurt.png",     fps: 10, loop: false },
  // flinch = to isté PNG ako hurt, ale klon ho ZRKADLÍ (hurt/dead klon potláča na idle, aby zásah naň nič neprezradil).
  // Používa sa pri neplatnej akcii (žiadny dmg) → aj Naruto aj klon trhnú rovnako a nedá sa rozoznať pravý.
  flinch: { file: "Hurt.png",     fps: 10, loop: false },
  dead: { file: "Dead.png",     fps: 7,  loop: false },
  victory: { file: "Idle.png", fps: 6, loop: true }, // placeholder - raf pre victory kreslí special sprite mága (SPECIAL_ANIMS)
  // animácie konkrétnych postáv (Escanor, Luffy, vlkolak, Vampire/Onryō…) - public/chars/<key>.js, pole anims
  ...CHAR_ANIMS,
};
// neloopové one-shot animácie kreslené relatívnym časom od setAnim (hrajú RAZ od frame 0, potom držia pózu)
export const VAMP_ONESHOT_KEYS = new Set(["wolfstrike", "vampstrike", "vattack1", "va1", "va2", "va3", "va4", "scream"]);

export const SPRITES = {};

// alias súboru per priečinok (spriteAlias postavy, napr. Minotaur nemá Run/Attack_1/Attack_2 - jeho sheet
// má Walk/Attack), nech všetky ANIM_DEF/SPECIAL cesty fungujú bez per-char výnimiek v kóde
function spriteFileFor(charDir, file) {
  for (const pfx in SPRITE_FILE_ALIAS) {
    if (charDir.startsWith(pfx) && SPRITE_FILE_ALIAS[pfx][file]) return SPRITE_FILE_ALIAS[pfx][file];
  }
  return file;
}

export function ensureSpriteMeta(charDir, file) {
  file = spriteFileFor(charDir, file);
  SPRITES[charDir] ||= {};
  if (SPRITES[charDir][file]) return Promise.resolve(SPRITES[charDir][file]);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const frames = Math.max(1, Math.round(img.naturalWidth / img.naturalHeight));
      const fw = Math.round(img.naturalWidth / frames);
      const fh = img.naturalHeight;
      SPRITES[charDir][file] = { img, frames, fw, fh };
      resolve(SPRITES[charDir][file]);
    };
    img.onerror = reject;
    img.src = `/assets/${charDir}/${file}`;
  });
}

/* ---------- preskočenie zbytočného prekreslenia (výkon na mobile, docs/MOBILE.md) ---------- */
// Slučka kreslenia (raf.js) volá drawSprite pre každý canvas 60× za sekundu, no sprity menia frame ~10× za sekundu.
// drawSprite si preto pamätá, čo naposledy nakreslil do canvasu (kľúč = obrázok + frame + geometria), a rovnaký
// obsah znova nekreslí. Pamäť canvasu sa zmaže pri AKOMKOĽVEK inom kreslení doň (priame clearRect/drawImage/… mimo
// drawSprite, napr. Luffyho guma, char-select) aj pri zmene width/height (tá canvas vymaže), takže prípadné
// priame kreslenie nikdy nezostane prekryté starým obsahom. Vrstvenie (clear=false) sa nepamätá nikdy.
const lastDraw = new WeakMap(); // canvas → kľúč posledného vykreslenia
let inDrawSprite = false;
if (typeof CanvasRenderingContext2D !== "undefined") {
  const P = CanvasRenderingContext2D.prototype;
  for (const m of ["clearRect", "fillRect", "strokeRect", "drawImage", "putImageData", "fill", "stroke", "fillText", "strokeText", "reset"]) {
    const orig = P[m];
    if (typeof orig !== "function") continue;
    P[m] = function (...a) { if (!inDrawSprite) lastDraw.delete(this.canvas); return orig.apply(this, a); };
  }
  for (const prop of ["width", "height"]) {
    const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, prop);
    if (d?.set) Object.defineProperty(HTMLCanvasElement.prototype, prop, { ...d, set(v) { lastDraw.delete(this); d.set.call(this, v); } });
  }
}

export function drawSprite(ctx, meta, anim, t, dstW=TILE_W, dstH=TILE_H, fill=0.95, anchorY=0.5, clear=true, offsetX=0, offsetY=0, cropXFrac=0, cropRightFrac=0) {
  // anim.frames prepíše odhad počtu framov (keď framy nie sú štvorcové a inference zlyhá)
  const total = anim.frames || meta.frames;
  // anim.cols: atlas (mriežka cols stĺpcov, frame i → stĺpec i % cols, riadok floor(i / cols)) namiesto pásu -
  // veľké sprity (démon, Last Hope), ktoré by ako pás presiahli 4096 px (limit textúry mobilných GPU)
  const cols = anim.cols || 0;
  const fw = cols ? Math.round(meta.img.naturalWidth / cols) : anim.frames ? Math.round(meta.img.naturalWidth / total) : meta.fw;
  const fh = cols ? Math.round(meta.img.naturalHeight / Math.ceil(total / cols)) : meta.fh;
  // anim.frameIndex: explicitný frame (vlastná časová logika, napr. Escanor IntroStand s loopFrom)
  // anim.loopFrom: prehraj RAZ celé (0..N-1), potom cykli len chvost od loopFrom (napr. Escanorov WinSunBoard -
  // zdvih ruky raz, ďalej len ústa + preblikávajúce slnko). Vyžaduje t relatívny od štartu animácie.
  const elapsedF = Math.floor(t / (1000 / anim.fps));
  // maxFrame: neloopová animácia sa zastaví (drží) na tomto frame; startFrame: začne od tohto framu (napr.
  // Luffy chomp = len druhá polovica Special_7). Oboje kombinovateľné (napr. chomp 7..9).
  const lastIdx = anim.maxFrame != null ? Math.min(total - 1, anim.maxFrame) : total - 1;
  const startF = anim.startFrame || 0;
  const idx = anim.frameIndex != null ? Math.max(0, Math.min(total - 1, anim.frameIndex))
            : anim.loopFrom != null ? (elapsedF < total ? elapsedF : anim.loopFrom + ((elapsedF - anim.loopFrom) % (total - anim.loopFrom)))
            : anim.loop ? startF + (elapsedF % (lastIdx - startF + 1)) // loop RESPEKTUJE startFrame/maxFrame (startFrame 0 → identické s pôvodným elapsedF % total)
                        : Math.min(lastIdx, startF + elapsedF);
  // cropXFrac: odreže prázdny (transparentný) okraj po bokoch framu - kreslí sa len stredový pás postavy
  // cropRightFrac: NAVYŠE odreže časť SPRAVA v sprite-priestore (sprite mieri doprava, flip rieši CSS) -
  //   napr. Luffyho zapečená natiahnutá ruka+päsť: necháme len telo, dosah kreslí procedurálna guma
  const cropPx  = Math.round(fw * Math.max(0, Math.min(0.45, cropXFrac)));
  const cropRPx = Math.round(fw * Math.max(0, Math.min(0.9, cropRightFrac)));
  const sx = (cols ? idx % cols : idx) * fw + cropPx;
  const sy = cols ? Math.floor(idx / cols) * fh : 0;
  const sw = Math.max(1, fw - 2 * cropPx - cropRPx);
  const scale = Math.min(dstW / fw, dstH / fh) * fill; // výška ostáva „normálna" (škáluje sa podľa plnej výšky/šírky framu)
  const dw = sw * scale, dh = fh * scale;
  // anchorY: 0 = hore, 0.5 = stred, 1 = dole; offsetX/offsetY = posun v px (záporné offsetY dvíha hore)
  const dx = (dstW - dw) / 2 + offsetX, dy = (dstH - dh) * anchorY + offsetY;
  const cvs = ctx.canvas;
  if (clear) {
    const key = `${meta.img.src}|${sx}|${sy}|${sw}|${dx}|${dy}|${dw}|${dh}|${dstW}|${dstH}`;
    if (lastDraw.get(cvs) === key) return; // na canvase už je presne tento obraz
    lastDraw.set(cvs, key);
  } else {
    lastDraw.delete(cvs); // vrstvenie mení obsah - ďalší clear=true musí kresliť
  }
  inDrawSprite = true;
  try {
    if (clear) ctx.clearRect(0, 0, dstW, dstH); // clear=false -> vrstvenie (efekt navrch mága)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(meta.img, sx, sy, sw, fh, dx, dy, dw, dh);
  } finally {
    inDrawSprite = false;
  }
}
