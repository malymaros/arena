// tools/arena-bg/thumbs.mjs - hotový náhľad arény pre lobby (karta STONE BRIDGE): vrstvy pozadia zložené do jedného PNG.
// Lobby predtým skladalo vrstvy za behu a kreslilo každú hneď po stiahnutí - keď nebo prišlo neskôr než most,
// prekreslilo ho (neúplný náhľad). Jeden súbor nemá poradie, ktoré by sa dalo pokaziť.
// Vrstvy sú už 320×180 (tools/arena-bg/build.mjs), takže stačí zložiť ich 1:1 (source-over) v poradí kreslenia.
//
//   node tools/arena-bg/thumbs.mjs      (po zmene vrstiev v public/arenas/bridge/)
import fs from "node:fs";
import { PNG } from "pngjs";

const THUMBS = {
  "public/arenas/bridge/thumb.png": ["sky-bridge.png", "clouds.png", "clouds-2.png", "tower.png", "bridge.png"].map(f => `public/arenas/bridge/${f}`),
};

for (const [out, layers] of Object.entries(THUMBS)) {
  const imgs = layers.map(f => PNG.sync.read(fs.readFileSync(f)));
  const { width: w, height: h } = imgs[0];
  if (imgs.some(i => i.width !== w || i.height !== h)) throw new Error(`${out}: vrstvy nemajú rovnaký rozmer`);
  const dst = new PNG({ width: w, height: h });
  for (const img of imgs) {
    for (let i = 0; i < w * h * 4; i += 4) {
      const sa = img.data[i + 3] / 255, da = dst.data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst.data[i + c] = oa ? Math.round((img.data[i + c] * sa + dst.data[i + c] * da * (1 - sa)) / oa) : 0;
      }
      dst.data[i + 3] = Math.round(oa * 255);
    }
  }
  fs.writeFileSync(out, PNG.sync.write(dst));
  console.log(`${out}: ${w}×${h}, ${fs.statSync(out).size} B`);
}
