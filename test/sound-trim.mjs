// test/sound-trim.mjs - orezanie zvuku na hlavnú časť (public/sounds/trim.js) + validácia trim v balíku
import { envelope, detectTrim, trimOf, loopXfade, PAD_START_MS, PAD_END_MS, LOOP_XFADE_MS } from "../public/sounds/trim.js";
import { validatePack, PACK_FORMAT } from "../public/sounds/pack.js";
import { SOUNDS, SOUND_API_VERSION } from "../public/sounds/manifest.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const SR = 1000; // 1 vzorka = 1 ms (jednoduché čísla)
// ticho 1000 ms, slabý šum 200 ms (2 %), hlavná časť 1500 ms, ticho 800 ms
const samples = new Float32Array(3500);
for (let i = 1000; i < 1200; i++) samples[i] = 0.02 * Math.sin(i);
for (let i = 1200; i < 2700; i++) samples[i] = Math.sin(i / 3);
const env = envelope(samples, SR);
check(env.length === 175, "obálka: počet okien", String(env.length));
const t = detectTrim(env, 3500);
check(t && t.startMs === 1200 - PAD_START_MS && t.endMs === 2700 + PAD_END_MS, "hlavná časť bez ticha a slabého šumu", JSON.stringify(t));
check(detectTrim(envelope(new Float32Array(500), SR), 500) === null, "úplné ticho → null");
{
  const full = new Float32Array(1000).map((_, i) => Math.sin(i));
  const ft = detectTrim(envelope(full, SR), 1000);
  check(ft.startMs === 0 && ft.endMs === 1000, "zvuk bez ticha: celý (rezerva neprekročí hranice)", JSON.stringify(ft));
}
check(trimOf({ trim: { "a.ogg": [100, 900] } }, "a.ogg")?.join() === "100,900" && trimOf({ trim: { "a.ogg": [900, 100] } }, "a.ogg") === null && trimOf({}, "a.ogg") === null, "trimOf");
check(loopXfade(60000) === LOOP_XFADE_MS && loopXfade(900) === 300, "prelínanie slučky: max 1,5 s, pri krátkej tretina");

// validácia trim v pack.json
const ctx = { keys: new Set(Object.keys(SOUNDS)), chars: ["naruto"], api: SOUND_API_VERSION };
const pack = (trim) => ({ format: PACK_FORMAT, id: "t", name: "T", version: 1, soundApi: SOUND_API_VERSION, entries: { death: { files: ["sounds/a.mp3"], vol: 1, trim } } });
const sizes = { "sounds/a.mp3": 10 };
check(validatePack(pack({ "sounds/a.mp3": [1120, 6900] }), sizes, ctx).errors.length === 0, "trim: platný");
check(validatePack(pack({ "sounds/a.mp3": [500, 100] }), sizes, ctx).errors.length > 0, "trim: koniec pred začiatkom → chyba");
check(validatePack(pack({ "sounds/b.mp3": [0, 100] }), sizes, ctx).errors.length > 0, "trim: súbor, ktorý položka nemá → chyba");
check(validatePack(pack({ "sounds/a.mp3": [-5, 100] }), sizes, ctx).errors.length > 0, "trim: záporný začiatok → chyba");

console.log(failures ? `\n${failures} ZLYHANÍ` : "\nsound-trim: VŠETKO PREŠLO");
if (failures) process.exit(1);
