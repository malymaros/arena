// tools/pixel-glyphs/build.mjs - pixelový doplnkový font so symbolmi, ktoré Press Start 2P nemá (✕ ✓ ⚙ šípky ◀ ▶ ▲ ● … ⚠ −).
// public/styles.css ho pridá do rodiny "Press Start 2P" cez @font-face + unicode-range, takže každý text v pixel fonte
// nakreslí tieto znaky pixelovo (predtým ich prehliadač bral z iného fontu - hladké a posunuté nižšie/vyššie).
// Bez závislostí: TrueType sa skladá priamo (každý pixel/riadok pixelov = obdĺžnik), mriežka 8×8 ako Press Start 2P
// (1 px = 125 jednotiek, em 1000; riadky 0–6 nad účiaricou, riadok 7 pod ňou).
//   node tools/pixel-glyphs/build.mjs   → public/fonts/arena-pixel.ttf
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("public/fonts/arena-pixel.ttf");
const PX = 125, EM = 1000, ASC = 875, DESC = -125;

// znak → 8 riadkov po 8 (# = pixel). Šírka obsahu 7 (stĺpec 7 = medzera ako v Press Start 2P).
const G = {};
const def = (chars, rows) => { for (const c of chars) G[c] = rows; };
const flipV = (r) => [...r.slice(0, 7)].reverse().concat(r[7]);
const flipH = (r) => r.map(s => [...s.slice(0, 7)].reverse().join("") + s[7]);
const transpose = (r) => r.map((_, y) => r.map((_, x) => (x < 7 && y < 7 ? r[x][y] : ".")).join(""));

const X = [
  "##...##.",
  "###.###.",
  ".#####..",
  "..###...",
  ".#####..",
  "###.###.",
  "##...##.",
  "........"];
def("✕✖×✗✘", X);
def("✓✔", [
  "........",
  "......#.",
  ".....##.",
  "#...##..",
  "##.##...",
  ".###....",
  "..#.....",
  "........"]);
def("⚙", [
  "...#....",
  ".#####..",
  ".##.##..",
  "##...##.",
  ".##.##..",
  ".#####..",
  "...#....",
  "........"]);
const UP = [
  "...#....",
  "..###...",
  ".#####..",
  "#######.",
  "..###...",
  "..###...",
  "..###...",
  "........"];
def("↑", UP); def("↓", flipV(UP)); def("←", transpose(UP)); def("→", flipH(transpose(UP)));
const UL = [
  "#####...",
  "####....",
  "#####...",
  "##.###..",
  "#...###.",
  ".....##.",
  "........",
  "........"];
def("↖", UL); def("↗", flipH(UL)); def("↙", flipV(UL)); def("↘", flipH(flipV(UL)));
const UD = [
  "...#....",
  "..###...",
  ".#####..",
  "...#....",
  ".#####..",
  "..###...",
  "...#....",
  "........"];
def("↕", UD); def("↔", transpose(UD));
def("↩", [
  "..#.....",
  ".##.....",
  "######..",
  ".##...#.",
  "..#...#.",
  "......#.",
  ".#####..",
  "........"]);
const RIGHT_TRI = [
  ".#......",
  ".##.....",
  ".###....",
  ".####...",
  ".###....",
  ".##.....",
  ".#......",
  "........"];
def("▶►", RIGHT_TRI); def("◀◄", flipH(RIGHT_TRI));
const UP_TRI = [
  "........",
  "........",
  "...#....",
  "..###...",
  ".#####..",
  "#######.",
  "........",
  "........"];
def("▲", UP_TRI); def("▼", flipV(UP_TRI));
const DOT = [
  "........",
  "..###...",
  ".#####..",
  ".#####..",
  ".#####..",
  "..###...",
  "........",
  "........"];
def("●⚫⚪", DOT);
def("○", [
  "........",
  "..###...",
  ".#...#..",
  ".#...#..",
  ".#...#..",
  "..###...",
  "........",
  "........"]);
def("•", [
  "........",
  "........",
  "........",
  "..##....",
  "..##....",
  "........",
  "........",
  "........"]);
def("·", [
  "........",
  "........",
  "........",
  "...#....",
  "........",
  "........",
  "........",
  "........"]);
def("…", [
  "........",
  "........",
  "........",
  "........",
  "........",
  "........",
  "#..#..#.",
  "........"]);
def("−", [
  "........",
  "........",
  "........",
  ".#####..",
  "........",
  "........",
  "........",
  "........"]);
def("⚠", [
  "...#....",
  "..###...",
  "..#.#...",
  ".##.##..",
  ".#####..",
  "###.###.",
  "#######.",
  "........"]);
def("★", [
  "...#....",
  "...#....",
  "#######.",
  ".#####..",
  "..###...",
  ".##.##..",
  "#.....#.",
  "........"]);
// variačné selektory (⚠️ = ⚠ + U+FE0F): prázdny znak nulovej šírky, aby celá dvojica zostala v tomto fonte
const ZERO = ["️", "︎"];

// ---------- obrysy: riadky pixelov zlúčené do obdĺžnikov (smer v smere hodín = vonkajší obrys) ----------
function contours(rows) {
  const out = [];
  rows.forEach((s, r) => {
    const y0 = (6 - r) * PX, y1 = y0 + PX;
    for (let x = 0; x < 8; x++) {
      if (s[x] !== "#") continue;
      let e = x; while (e + 1 < 8 && s[e + 1] === "#") e++;
      out.push([[x * PX, y0], [x * PX, y1], [(e + 1) * PX, y1], [(e + 1) * PX, y0]]);
      x = e;
    }
  });
  return out;
}

// ---------- binárne pomôcky ----------
class Buf {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff); }
  bytes(b) { for (const x of b) this.u8(x); return this; }
  get length() { return this.a.length; }
  out() { return Uint8Array.from(this.a); }
}
const checksum = (b) => { let s = 0; for (let i = 0; i < b.length; i += 4) s = (s + ((b[i] << 24) | ((b[i + 1] || 0) << 16) | ((b[i + 2] || 0) << 8) | (b[i + 3] || 0))) >>> 0; return s; };

// ---------- znaky ----------
const chars = Object.keys(G).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const glyphs = [{ name: ".notdef", rows: null, adv: EM }];
for (const c of chars) glyphs.push({ code: c.codePointAt(0), rows: G[c], adv: EM });
for (const z of ZERO) glyphs.push({ code: z.codePointAt(0), rows: null, adv: 0 });
const mapped = glyphs.map((g, i) => ({ ...g, id: i })).filter(g => g.code != null).sort((a, b) => a.code - b.code);

// glyf + loca
const glyf = new Buf(), loca = [];
let maxPts = 0, maxCont = 0, bx0 = EM, by0 = EM, bx1 = 0, by1 = DESC;
const lsb = [];
for (const g of glyphs) {
  loca.push(glyf.length);
  const cs = g.rows ? contours(g.rows) : [];
  if (!cs.length) { lsb.push(0); continue; }
  const pts = cs.flat();
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  bx0 = Math.min(bx0, x0); bx1 = Math.max(bx1, x1); by0 = Math.min(by0, y0); by1 = Math.max(by1, y1);
  lsb.push(x0);
  maxPts = Math.max(maxPts, pts.length); maxCont = Math.max(maxCont, cs.length);
  glyf.i16(cs.length).i16(x0).i16(y0).i16(x1).i16(y1);
  let n = -1; for (const c of cs) { n += c.length; glyf.u16(n); }
  glyf.u16(0); // bez inštrukcií
  for (let i = 0; i < pts.length; i++) glyf.u8(1); // všetky body na krivke, súradnice ako int16 delty
  let px = 0; for (const [x] of pts) { glyf.i16(x - px); px = x; }
  let py = 0; for (const [, y] of pts) { glyf.i16(y - py); py = y; }
  while (glyf.length % 4) glyf.u8(0);
}
loca.push(glyf.length);

const tables = {};
tables.glyf = glyf.out();
{ const b = new Buf(); for (const o of loca) b.u32(o); tables.loca = b.out(); }
{ const b = new Buf(); glyphs.forEach((g, i) => b.u16(g.adv).i16(lsb[i])); tables.hmtx = b.out(); }
tables.head = new Buf().u32(0x00010000).u32(0x00010000).u32(0).u32(0x5F0F3CF5).u16(0x000B).u16(EM)
  .u32(0).u32(0).u32(0).u32(0).i16(bx0).i16(by0).i16(bx1).i16(by1).u16(0).u16(8).i16(2).i16(1).i16(0).out();
tables.hhea = new Buf().u32(0x00010000).i16(ASC).i16(DESC).i16(0).u16(EM).i16(0).i16(0).i16(bx1).i16(1).i16(0).i16(0)
  .i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length).out();
tables.maxp = new Buf().u32(0x00010000).u16(glyphs.length).u16(maxPts).u16(maxCont).u16(0).u16(0).u16(2)
  .u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).out();
{
  const b = new Buf().u16(4).i16(EM).u16(400).u16(5).u16(0)
    .i16(650).i16(600).i16(0).i16(75).i16(650).i16(600).i16(0).i16(350).i16(PX).i16(3 * PX).i16(0)
    .bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).u32(0).u32(0).u32(0).u32(0).bytes([...Buffer.from("ARNA")])
    .u16(0x40).u16(Math.min(mapped[0].code, 0xffff)).u16(Math.min(mapped.at(-1).code, 0xffff))
    .i16(ASC).i16(DESC).i16(0).u16(ASC).u16(-DESC).u32(1).u32(0).i16(5 * PX).i16(7 * PX).u16(0).u16(32).u16(1);
  tables["OS/2"] = b.out();
}
tables.post = new Buf().u32(0x00030000).u32(0).i16(DESC).i16(PX).u32(1).u32(0).u32(0).u32(0).u32(0).out();
{ // cmap 3/1 formát 4 - každý znak vlastný segment + koncový 0xFFFF
  const segs = [...mapped.map(g => [g.code, g.code, (g.id - g.code + 65536) % 65536]), [0xffff, 0xffff, 1]];
  const n = segs.length, sr = 2 ** Math.floor(Math.log2(n)) * 2;
  const s = new Buf().u16(4).u16(16 + n * 8).u16(0).u16(n * 2).u16(sr).u16(Math.log2(sr / 2)).u16(n * 2 - sr);
  for (const g of segs) s.u16(g[1]); s.u16(0);
  for (const g of segs) s.u16(g[0]);
  for (const g of segs) s.u16(g[2]);
  for (let i = 0; i < n; i++) s.u16(0);
  tables.cmap = new Buf().u16(0).u16(1).u16(3).u16(1).u32(12).bytes(s.out()).out();
}
{ // name - UTF-16BE, platforma Windows
  const names = [[1, "Arena Pixel Symbols"], [2, "Regular"], [3, "ArenaPixelSymbols-1"], [4, "Arena Pixel Symbols"], [6, "ArenaPixelSymbols"]];
  const enc = names.map(([id, s]) => [id, Buffer.from(s, "utf16le").swap16()]);
  const b = new Buf().u16(0).u16(enc.length).u16(6 + enc.length * 12);
  let off = 0; for (const [id, s] of enc) { b.u16(3).u16(1).u16(0x409).u16(id).u16(s.length).u16(off); off += s.length; }
  for (const [, s] of enc) b.bytes(s);
  tables.name = b.out();
}

// ---------- sfnt ----------
const tags = Object.keys(tables).sort();
const nT = tags.length, sr = 2 ** Math.floor(Math.log2(nT)) * 16;
const font = new Buf().u32(0x00010000).u16(nT).u16(sr).u16(Math.log2(sr / 16)).u16(nT * 16 - sr);
let offset = 12 + nT * 16;
const placed = tags.map(t => { const d = tables[t]; const o = offset; offset += Math.ceil(d.length / 4) * 4; return [t, d, o]; });
for (const [t, d, o] of placed) font.bytes([...Buffer.from(t.padEnd(4))]).u32(checksum(d)).u32(o).u32(d.length);
for (const [, d] of placed) { font.bytes(d); while (font.length % 4) font.u8(0); }
const bytes = font.out();
const headOff = placed.find(p => p[0] === "head")[2];
const adj = (0xB1B0AFBA - checksum(bytes) + 2 ** 32) % 2 ** 32;
new DataView(bytes.buffer).setUint32(headOff + 8, adj);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, bytes);
const ranges = mapped.map(g => "U+" + g.code.toString(16).toUpperCase().padStart(4, "0")).join(", ");
console.log(`${OUT}: ${glyphs.length} znakov, ${bytes.length} B\nunicode-range: ${ranges}`);
