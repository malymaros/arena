// Last Stand démon + Last Hope postava - atlas namiesto dlhého pásu (docs/PERF_PLAN.md, etapa 6), reprodukovateľné.
// Originálne pásy (src/death_strip.png 5024×314 = 16 framov, src/hope_strip.png 9216×512 = 12 framov) sú širšie
// než 4096 px - limit textúry mnohých mobilných GPU (najmä iOS): prehliadač by obrázok delil alebo opakovane
// nahrával. Atlas = rovnaké framy poskladané do mriežky COLS stĺpcov (riadok po riadku, frame i → stĺpec i % COLS,
// riadok floor(i / COLS)), pixelovo identické. Klient ich kreslí cez anim.cols (public/client/demon-sprites.js).
// Kompresia: deflateStrategy 1 (Z_FILTERED) - pngjs predvolene používa Z_RLE, s ním by atlas vyšiel ~40 % väčší.
// Spustenie: node tools/sprites-overlays/build.cjs
const fs = require("fs"), path = require("path"), { PNG } = require("pngjs");

const SRC = path.join(__dirname, "src");
const ASSETS = path.join(__dirname, "../../public/assets");
const JOBS = [
  { src: "death_strip.png", frames: 16, cols: 4, out: "death/atlas.png" }, // 314×314 framy → 1256×1256
  { src: "hope_strip.png",  frames: 12, cols: 4, out: "hope/atlas.png" },  // 768×512 framy → 3072×1536
];

for (const j of JOBS) {
  const strip = PNG.sync.read(fs.readFileSync(path.join(SRC, j.src)));
  const fw = strip.width / j.frames, fh = strip.height;
  if (!Number.isInteger(fw)) throw new Error(`${j.src}: šírka ${strip.width} nie je deliteľná ${j.frames}`);
  const rows = Math.ceil(j.frames / j.cols);
  const out = new PNG({ width: fw * j.cols, height: fh * rows });
  for (let i = 0; i < j.frames; i++) {
    PNG.bitblt(strip, out, i * fw, 0, fw, fh, (i % j.cols) * fw, Math.floor(i / j.cols) * fh);
  }
  // overenie: každý frame atlasu = frame pásu (pixel po pixeli)
  for (let i = 0; i < j.frames; i++) {
    const ax = (i % j.cols) * fw, ay = Math.floor(i / j.cols) * fh;
    for (let y = 0; y < fh; y++) {
      const a = strip.data.subarray(((y * strip.width) + i * fw) * 4, ((y * strip.width) + i * fw + fw) * 4);
      const b = out.data.subarray((((ay + y) * out.width) + ax) * 4, (((ay + y) * out.width) + ax + fw) * 4);
      if (Buffer.compare(a, b) !== 0) throw new Error(`${j.out}: frame ${i} riadok ${y} nesedí`);
    }
  }
  const dst = path.join(ASSETS, j.out);
  fs.writeFileSync(dst, PNG.sync.write(out, { deflateLevel: 9, deflateStrategy: 1, filterType: -1 }));
  console.log(`${j.out}: ${j.frames} framov ${fw}×${fh} → ${out.width}×${out.height}, ${(fs.statSync(dst).size / 1024).toFixed(0)} kB (pás ${(fs.statSync(path.join(SRC, j.src)).size / 1024).toFixed(0)} kB)`);
}
