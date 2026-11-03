// test/ai-portal-maps.mjs - mapy zásahov AI bota s portálmi (engine/ai/threat.js, Portal Realm): výber ťahov na
// začiatku kola počíta s portálmi aktuálneho kola - strela / pohyb cez portál pokračuje na druhom konci; akcie, ktoré
// portálom neprechádzajú (melee), sa preberú z mapy bez portálov; mapy bez portálov ostávajú nedotknuté.
import { createEngine } from "../engine/game.js";
import { actionHits, reach } from "../engine/ai/threat.js";

let ok = true;
const check = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) ok = false; };
const e = createEngine({ seed: 5, schedule: () => {} });
e.startMatch(e.sanitizeConfig({ format: "single", tilesPerRound: 1, timer: "off", tilePreview: true, colorPref: "white",
  tileWeights: { dmg: 90, ik: 10 }, arena: "portal" }));
e.chooseCharacter("A", "fire"); e.chooseCharacter("B", "wanderer");
const st = e.exportState();
st.portals = [{ id: "A", type: "classic", ends: [{ x: 3, y: 1, side: "right" }, { x: 0, y: 2, side: "left" }] }];
const idx = (x, y) => y * st.board.w + x;
const from = { x: 3, y: 1 }, shot = { type: "attack", dir: "right" };
const plain = actionHits(st, "p1", from, shot, false), port = actionHits(st, "p1", from, shot, true);
check(!plain || plain[idx(0, 2)] === 0, "bez portálov strela z okraja nikoho nezasiahne");
check(port?.[idx(0, 2)] === 3 && port?.[idx(1, 2)] === 2, "s portálmi strela cez portál: 3 dmg na výstupe, 2 o bunku ďalej");
check(reach(st, from, 0, false, true).some(c => c.x === 0 && c.y === 2), "pohyb cez portál sa dostane na druhý koniec");
check(!reach(st, from, 0, false, false).some(c => c.x === 0 && c.y === 2), "pohyb bez portálov nie");
const melee = { type: "melee" };
check(actionHits(st, "p1", from, melee, true)?.[idx(3, 1)] === actionHits(st, "p1", from, melee, false)?.[idx(3, 1)], "melee s portálmi = bez portálov");
// nové rozloženie portálov → mapy sa prepočítajú (strela z rovnakej bunky teraz vyjde inde)
const st2 = { ...st, portals: [{ id: "B", type: "classic", ends: [{ x: 3, y: 1, side: "right" }, { x: 0, y: 0, side: "left" }] }] };
const port2 = actionHits(st2, "p1", from, shot, true);
check(port2?.[idx(0, 0)] === 3 && port2?.[idx(0, 2)] === 0, "nové rozloženie portálov = nová mapa");
console.log(ok ? "ai-portal-maps: OK" : "ai-portal-maps: ZLYHALO");
process.exit(ok ? 0 : 1);
