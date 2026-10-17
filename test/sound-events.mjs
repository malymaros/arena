// test/sound-events.mjs - čisté mapovanie timeline → zvukové udalosti (public/sounds/events.js) na syntetických
// frame-och: raz za beh, move vs dash, skrytý súper, prah ťažkého zásahu, char zasiahnutého, okná.
import { eventsForFrame, newTracker, resetTracker, HIT_HEAVY_DMG } from "../public/sounds/events.js";

let failures = 0;
function check(cond, label, detail = "") {
  if (cond) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? " - " + detail : ""}`); }
}
const P1 = { x: 0, y: 1, char: "fire" }, P2 = { x: 3, y: 1, char: "naruto" };
const fr = (effects, delayMs = 100, p1 = P1, p2 = P2) => ({ p1, p2, effects, delayMs });
// prehrá celú timeline ako klient (before = predošlý frame) a vráti udalosti po frame-och;
// hlasy (voice.*) sú samostatná vrstva - bez { voice: true } ich vynechá (testy efektov ich neriešia)
const noVoice = (evs) => evs.filter(e => !e.key.startsWith("voice."));
function play(timeline, { voice = false } = {}) {
  const tr = newTracker();
  const out = [];
  for (let i = 1; i < timeline.length; i++) out.push(eventsForFrame(timeline, i, { p1: timeline[i - 1].p1, p2: timeline[i - 1].p2 }, tr));
  return voice ? out : out.map(noVoice);
}
const keys = (evs) => evs.map(e => e.key);

/* let strely: charge vo 3 frame-och za sebou → JEDEN výstrel, okno = celý let */
{
  const tl = [fr([]), fr([{ kind: "charge", from: "p1", dir: "right", cell: [1, 1] }], 432),
    fr([{ kind: "charge", from: "p1", dir: "right", cell: [2, 1] }], 432),
    fr([{ kind: "charge", from: "p1", dir: "right", cell: [3, 1] }], 432), fr([{ kind: "hit", target: "p2", dmg: 1 }], 1080)];
  const ev = play(tl);
  check(ev[0].length === 1 && ev[0][0].key === "attack", "charge: výstrel na prvom frame-e");
  check(ev[1].length === 0 && ev[2].length === 0, "charge: ďalšie kroky letu ticho");
  check(ev[0][0].windowMs === 1296, "charge: okno = súčet behu", String(ev[0][0].windowMs));
  check(ev[0][0].char === "fire", "charge: char strelca");
  check(ev[3][0].key === "hit" && ev[3][0].char === "naruto", "hit: char ZASIAHNUTÉHO");
}

/* dva behy oddelené iným frame-om = dva zvuky; klonova strela je samostatný beh */
{
  const c = (clone) => ({ kind: "charge", from: "p2", dir: "left", cell: [2, 1], clone });
  const ev = play([fr([]), fr([c(false), c(true)]), fr([]), fr([c(false)])]);
  check(ev[0].length === 2, "klon: vlastný beh strely");
  check(ev[2].length === 1, "nový beh po prerušení zaznie znova");
}

/* hlas: raz na začiatku akcie, efekt úderu melee pri každom zo 3 švihov; klon hlas nemá */
{
  const m = { kind: "melee", from: "p1", cells: [[0, 1]] };
  const ev = play([fr([]), fr([m], 1620), fr([m], 1620), fr([m], 1620)], { voice: true });
  check(keys(ev[0]).join() === "voice.melee,melee", "hlas melee + prvý švih", keys(ev[0]).join());
  check(keys(ev[1]).join() === "melee" && keys(ev[2]).join() === "melee", "ďalšie švihy: len efekt, bez hlasu");
  check(ev[0][0].windowMs === 4860 && ev[0][0].char === "fire", "hlas: okno = celá akcia, char postavy", String(ev[0][0].windowMs));
  const s = { kind: "special", from: "p1" };
  const sp = play([fr([]), fr([s], 900), fr([s], 900), fr([s], 900)], { voice: true });
  check(keys(sp[0]).join() === "voice.special,special" && sp[1].length === 0 && sp[2].length === 0, "special: hlas aj efekt raz", keys(sp[0]).join());
  const c = (clone) => ({ kind: "charge", from: "p2", dir: "left", cell: [2, 1], clone });
  check(keys(play([fr([]), fr([c(false), c(true)])], { voice: true })[0]).filter(k => k === "voice.attack").length === 1, "klonova strela nemá vlastný hlas");
  check(keys(play([fr([]), fr([{ kind: "attack_swing", from: "p1", dir: "left", offboard: true }])], { voice: true })[0]).join() === "voice.attack,attack_whiff", "strela mimo plochy: hlas strely");
}

/* resetTracker: nová timeline začína bez behu z minulej */
{
  const tr = newTracker();
  const tl = [fr([]), fr([{ kind: "special", from: "p1" }])];
  eventsForFrame(tl, 1, {}, tr);
  resetTracker(tr);
  check(noVoice(eventsForFrame(tl, 1, {}, tr)).length === 1, "resetTracker: special zaznie v novej timeline");
}

/* pohyb: move vs dash podľa ohlásenej akcie; skrytý súper (x null) ticho; vlastný presun bez kroku */
{
  const moved = { ...P1, x: 1 }, dashed = { ...P1, x: 3 };
  const ev = play([fr([]), fr([{ kind: "action", from: "p1", action: { type: "move" } }]), fr([], 1440, moved),
    fr([{ kind: "action", from: "p1", action: { type: "dash" } }], 250, moved), fr([], 1440, dashed)]);
  check(keys(ev[1]).join() === "move" && ev[1][0].windowMs === 1440, "move po ohlásení move");
  check(keys(ev[3]).join() === "dash", "dash po ohlásení dash");
  const hidden = play([fr([], 100, P1, { ...P2, x: null, y: null }), fr([], 100, P1, { ...P2, x: null, y: null })]);
  check(hidden[0].length === 0, "skrytý súper v labyrinte: žiadny krok");
  const wolf = play([fr([]), fr([{ kind: "wolf_charge", from: "p1", dir: "right" }], 500, { ...P1, x: 2 })]);
  check(keys(wolf[0]).join() === "wolf_charge", "wolf_charge: vlastný zvuk, nie krok");
}

/* zásah: prah ťažkého, nulový dmg ticho; tile; odmietnutá golden mana; neznámy efekt ticho */
{
  const ev = play([fr([]), fr([{ kind: "hit", target: "p1", dmg: HIT_HEAVY_DMG }]), fr([{ kind: "hit", target: "p1", dmg: HIT_HEAVY_DMG - 1 }]),
    fr([{ kind: "hit", target: "p1", dmg: 0 }]), fr([{ kind: "tile_proc", tile: "ik", cell: [0, 1] }]),
    fr([{ kind: "golden_mana", from: "p1", gained: 0 }]), fr([{ kind: "nieco_nove", from: "p1" }])]);
  check(ev[0][0].key === "hit_heavy" && ev[1][0].key === "hit", "prah hit_heavy");
  check(ev[2].length === 0, "dmg 0 = ticho");
  check(ev[3][0].key === "tile.ik" && ev[3][0].pan < 0, "tile.ik + panoráma vľavo");
  check(ev[4].length === 0, "odmietnutá golden mana = ticho");
  check(ev[5].length === 0, "neznámy efekt = ticho");
}

/* panoráma: ľavý a pravý stĺpec opačné znamienko; board z kontextu */
{
  const tr = newTracker();
  const tl = [fr([]), fr([{ kind: "block", target: "p1" }, { kind: "block", target: "p2" }])];
  const ev = eventsForFrame(tl, 1, {}, tr, { board: { w: 4 } });
  check(ev[0].pan < 0 && ev[1].pan > 0, "panoráma podľa stĺpca");
}

console.log(failures ? `\n${failures} ZLYHANÍ` : "\nsound-events: VŠETKO PREŠLO");
if (failures) process.exit(1);
