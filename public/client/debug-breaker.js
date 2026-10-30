// public/client/debug-breaker.js - DEBUG náhľad (?breakerdebug=1): Shield/Mirror Breaker v SKUTOČNEJ hre bez
// servera. Stránka hry dostane vymyslený stav cez vlastné socket handlery (HUD, doska, postavy, žiara obrany sú
// teda presne ako v hre) a panel scenárov prehrá efekt z breaker-fx.js. Bez vplyvu na hru - len query parametrom.
import { socket } from "/client/net.js";
import { setAnim } from "/client/anim.js";
import { spawnDamageFloat, spawnFloat } from "/client/board-fx.js";
import { spawnBreakerBeam } from "/client/breaker-fx.js";
import { ACTION_ANIMS } from "/chars/index.js";

(function breakerDebug() {
  const params = new URLSearchParams(location.search);
  if (!params.has("breakerdebug")) return;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // podstrčí udalosť priamo handlerom socketu (ako keby prišla zo servera) - server sa vôbec nekontaktuje
  const fire = (ev, data) => socket.listeners(ev).forEach(fn => fn(data));
  document.getElementById("login")?.classList.add("hidden");

  const chars = { p1: params.get("p1") || "fire", p2: params.get("p2") || "lightning" };
  const actor = (slot, x, extra) => ({
    slot, x, y: 1, hp: 10, mana: 6, char: chars[slot], stone: 0, pride: 0, moon: 0, worldUsed: false,
    labyrinth: false, labReveal: false, thread: [], threadMark: null, clone: null, trap: null,
    shield: false, shieldGold: false, mirror: false, mirrorGold: false, manaRefills: 0,
    lastStandBuff: false, lastHopeBuff: false, down: false, locked: false, ...extra,
  });
  const snap = (p1, p2) => ({
    phase: "playing", config: { format: "single", tilesPerRound: 1, tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 },
      timer: "off", tilePreview: true, colorPref: "white" },
    series: { gameIndex: 1, needed: 1, format: "single", winsP1: 0, winsP2: 0 },
    names: { p1: "ATTACKER", p2: "DEFENDER" }, awaitingOpponent: false, timestop: null,
    board: { w: 4, h: 3 }, p1, p2, arena: "bridge", turn: 1, starter: "p1", timerMs: null, goldLocked: false,
    tiles: [], iks: [], pending: null,
  });
  fire("you_are", { slot: "p1", isHost: true });
  fire("state", snap(actor("p1", 0), actor("p2", 3)));

  const SC = [
    { k: "sb",  t: "Shield Breaker vs štít",                 def: { shield: true },                     cost: 2, dmg: 2, kind: "shield", label: "SHIELD BROKEN!" },
    { k: "mb",  t: "Mirror Breaker vs mirror",               def: { mirror: true },                     cost: 4, dmg: 4, kind: "mirror", label: "MIRROR SHATTERED!" },
    { k: "gsb", t: "Golden Shield Breaker vs golden štít",   def: { shield: true, shieldGold: true },   cost: 3, dmg: 2, kind: "shield", gold: true, label: "SHIELD BROKEN!" },
    { k: "gmb", t: "Golden Mirror Breaker vs golden mirror", def: { mirror: true, mirrorGold: true },   cost: 5, dmg: 4, kind: "mirror", gold: true, label: "MIRROR SHATTERED!" },
    { k: "ls",  t: "Mirror Breaker s Last Stand (×2)",       def: { mirror: true }, atk: { lastStandBuff: true }, cost: 4, dmg: 8, kind: "mirror", label: "MIRROR SHATTERED!" },
    { k: "wh",  t: "Breaker naprázdno (súper bez obrany)",   def: {},                                   cost: 2, dmg: 0, whiff: true },
    { k: "wr",  t: "Shield Breaker vs mirror (zlá obrana)",  def: { mirror: true },                     cost: 2, dmg: 0, whiff: true, wrong: true },
  ];
  let slow = 1, busy = false;

  async function run(sc) {
    if (busy) return; busy = true;
    fire("state", snap(actor("p1", 0, sc.atk), actor("p2", 3, sc.def))); // nabitá obrana = žiara okolo postavy
    await sleep(900);
    fire("state", snap(actor("p1", 0, { ...sc.atk, mana: 6 - sc.cost }), actor("p2", 3, sc.def)));
    // útočník drží svoju range attack pózu celý čas lúča
    const beamMs = ((sc.whiff ? 420 : 1150) + 140) * slow;
    setAnim("p1", ACTION_ANIMS[chars.p1]?.shot || "attack", beamMs + 150);
    await spawnBreakerBeam("p1", "p2", { kind: sc.kind, gold: !!sc.gold, whiff: !!sc.whiff, slow });
    if (sc.whiff) {
      spawnFloat("p2", sc.wrong ? "WRONG GUARD" : "NO GUARD", "breaker-float whiff");
      await sleep(1400); busy = false; return;
    }
    // obrana rozbitá a spotrebovaná → zásah (skutočný hurt + -N HP float hry)
    fire("state", snap(actor("p1", 0, { ...sc.atk, mana: 6 - sc.cost }), actor("p2", 3, { hp: 10 - sc.dmg })));
    spawnFloat("p2", sc.label, "breaker-float");
    await sleep(160);
    setAnim("p2", "hurt", 450);
    spawnDamageFloat("p2", sc.dmg);
    await sleep(1600); busy = false;
  }

  // panel scenárov (mimo zmenšovanej obrazovky hry, aby neprekrýval HUD)
  const panel = document.createElement("div");
  Object.assign(panel.style, { position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "2000000",
    display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "980px", justifyContent: "center", padding: "8px",
    background: "rgba(10,10,14,.88)", border: "1px solid #444", borderRadius: "6px", font: "12px system-ui, sans-serif" });
  const btn = (txt, on) => {
    const b = document.createElement("button"); b.textContent = txt;
    Object.assign(b.style, { background: "#262a33", color: "#eee", border: "1px solid #555", borderRadius: "4px", padding: "5px 9px", cursor: "pointer" });
    b.onclick = on; panel.appendChild(b); return b;
  };
  for (const sc of SC) btn(sc.t, () => run(sc));
  const sp = btn("rýchlosť 1×", () => { slow = slow === 1 ? 2 : slow === 2 ? 4 : 1; sp.textContent = `rýchlosť ${slow === 1 ? "1" : "1/" + slow}×`; });
  document.body.appendChild(panel);
})();
