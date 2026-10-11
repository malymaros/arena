// public/client/mage-head.js - animovaná hlava maga (výrez z Idle sprite) pre HUD hlavy a swap badge.
import { charDirFor, ANIM_DEF, ensureSpriteMeta } from "/client/sprites.js";
import { HEAD_CROP, CHAR_META, CHARS_BY_KEY } from "/chars/index.js";

/* ---------- Mage head ikona (HUD hlavy + swap badge) - ANIMOVANÝ výrez hlavy z Idle sprite ---------- */
// výrez hlavy = headCrop postavy v registri (public/chars/<key>.js, ladí sa cez /head-cropper.html)
export const mageHeadHtml = (char, cls = "", slot = "") => `<canvas class="mage-head ${cls}" data-char="${char}"${slot ? ` data-slot="${slot}"` : ""} width="52" height="52"></canvas>`;
// vykresli AKTUÁLNY idle frame maga orezaný na hlavu (volané z raf → hlava sa animuje)
export function drawMageHeadAnim(cvs, char, now) {
  const dir = charDirFor(char, cvs.dataset.slot || null); // p2 hlava Medúzy = natívna tmavá paleta
  const c = HEAD_CROP[char];
  if (!dir || !c) return;
  // natívny p2 sheet môže mať figúru posunutú inde - použi jeho vlastný stred výrezu
  const isP2Sheet = dir === CHAR_META[char]?.dirP2;
  const cx = (isP2Sheet && c.cxP2 != null) ? c.cxP2 : c.cx;
  const cy = (isP2Sheet && c.cyP2 != null) ? c.cyP2 : c.cy;
  const idleFile = CHARS_BY_KEY[char]?.headIdleFile || ANIM_DEF.idle.file; // register (Escanor: hlava zo slabej formy)
  ensureSpriteMeta(dir, idleFile).then(meta => {
    const ctx = cvs.getContext("2d");
    const fps = ANIM_DEF.idle.fps || 6;
    const idx = Math.floor((now / (1000 / fps)) % meta.frames); // aktuálny idle frame
    const fw = meta.fw, fh = meta.fh, side = fh * c.size;
    let sx = idx * fw + fw * cx - side / 2;
    let sy = fh * cy - side / 2;
    sx = Math.max(idx * fw, Math.min(idx * fw + fw - side, sx)); // udrž výrez v rámci TOHTO framu
    sy = Math.max(0, Math.min(fh - side, sy));
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(meta.img, sx, sy, side, side, 0, 0, cvs.width, cvs.height);
  }).catch(() => {});
}
