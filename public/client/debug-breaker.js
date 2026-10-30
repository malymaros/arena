// public/client/debug-breaker.js - DEBUG náhľad (?breakerdebug=1): Shield/Mirror Breaker v SKUTOČNEJ hre bez
// servera. Stránka hry dostane vymyslený stav cez vlastné socket handlery (HUD, doska, postavy, žiara obrany sú
// teda presne ako v hre), panel scenárov prehrá efekt z breaker-fx.js a tlačidlá štítu / mirroru / golden polovíc
// otvoria návrh výberu obrana / breaker. Bez vplyvu na hru - len query parametrom.
import { socket } from "/client/net.js";
import { setAnim } from "/client/anim.js";
import { spawnDamageFloat, spawnFloat } from "/client/board-fx.js";
import { spawnShieldBlock, spawnMirrorReflect } from "/client/defense-fx.js";
import { spawnBreakerBeam } from "/client/breaker-fx.js";
import { crackIco, hydratePix } from "/client/pix.js";
import { costHtml } from "/client/hud.js";
import { planning } from "/client/planning.js";
import { renderQueue } from "/client/queue.js";
import { syncGoldenHalves } from "/client/controls.js";
import { ACTION_ANIMS } from "/chars/index.js";

(function breakerDebug() {
  const params = new URLSearchParams(location.search);
  if (!params.has("breakerdebug")) return;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // podstrčí udalosť priamo handlerom socketu (ako keby prišla zo servera) - server sa vôbec nekontaktuje
  const fire = (ev, data) => socket.listeners(ev).forEach(fn => fn(data));
  document.getElementById("login")?.classList.add("hidden");

  // návrh balansu (po schválení pôjde do shared/balance.js): dmg breakera = 2 proti štítu, 4 proti mirroru
  const BRK_DMG = { shield: 2, mirror: 4 };
  const chars = { p1: params.get("p1") || "fire", p2: params.get("p2") || "lightning" };
  const actor = (slot, x, extra) => ({
    slot, x, y: 1, hp: 10, mana: 6, char: chars[slot], stone: 0, pride: 0, moon: 0, worldUsed: false,
    labyrinth: false, labReveal: false, thread: [], threadMark: null, clone: null, trap: null,
    shield: false, shieldGold: false, mirror: false, mirrorGold: false, manaRefills: 0,
    lastStandBuff: false, lastHopeBuff: false, down: false, locked: false, ...extra,
  });
  // starter p2 → ja (p1) som nestartér, takže vidím aj golden predťah (golden štít / mirror a ich breakery)
  const snap = (p1, p2) => ({
    phase: "playing", config: { format: "single", tilesPerRound: 1, tileWeights: { dmg: 50, heal: 10, mana: 10, ik: 10, power: 10, block: 10 },
      timer: "off", tilePreview: true, colorPref: "white" },
    series: { gameIndex: 1, needed: 1, format: "single", winsP1: 0, winsP2: 0 },
    names: { p1: "ATTACKER", p2: "DEFENDER" }, awaitingOpponent: false, timestop: null,
    board: { w: 4, h: 3 }, p1, p2, arena: "bridge", turn: 1, starter: "p2", timerMs: null, goldLocked: false,
    tiles: [], iks: [], pending: null,
  });
  fire("you_are", { slot: "p1", isHost: true });
  fire("state", snap(actor("p1", 0), actor("p2", 3)));

  /* ---------------- scenáre animácie ---------------- */
  const SC = [
    { t: "Shield Breaker vs štít",                 def: { shield: true },                   cost: 2, dmg: 2, kind: "shield", label: "SHIELD BROKEN!" },
    { t: "Mirror Breaker vs mirror",               def: { mirror: true },                   cost: 4, dmg: 4, kind: "mirror", label: "MIRROR SHATTERED!" },
    { t: "Golden Shield Breaker vs golden štít",   def: { shield: true, shieldGold: true }, cost: 3, dmg: 2, kind: "shield", gold: true, label: "SHIELD BROKEN!" },
    { t: "Golden Mirror Breaker vs golden mirror", def: { mirror: true, mirrorGold: true }, cost: 5, dmg: 4, kind: "mirror", gold: true, label: "MIRROR SHATTERED!" },
    { t: "Mirror Breaker s Last Stand (×2)",       def: { mirror: true }, atk: { lastStandBuff: true }, cost: 4, dmg: 8, kind: "mirror", label: "MIRROR SHATTERED!" },
    { t: "Shield Breaker vs mirror → odraz",       def: { mirror: true },                   cost: 2, dmg: 2, react: "reflect" },
    { t: "Mirror Breaker vs štít → blok",          def: { shield: true },                   cost: 4, dmg: 4, react: "block" },
    { t: "Breaker naprázdno (súper bez obrany)",   def: {},                                 cost: 2, dmg: 0, whiff: true },
  ];
  let slow = 1, busy = false;

  async function run(sc) {
    if (busy) return; busy = true;
    const atk = (extra) => actor("p1", 0, { ...sc.atk, ...extra });
    fire("state", snap(atk(), actor("p2", 3, sc.def))); // nabitá obrana = žiara okolo postavy
    await sleep(900);
    fire("state", snap(atk({ mana: 6 - sc.cost }), actor("p2", 3, sc.def)));
    // útočník drží svoju range attack pózu celý čas lúča
    const beamMs = (sc.whiff ? 720 : (sc.react ? 420 : 1150) + 140) * slow;
    setAnim("p1", ACTION_ANIMS[chars.p1]?.shot || "attack", beamMs + 150);
    await spawnBreakerBeam("p1", "p2", { kind: sc.kind, gold: !!sc.gold, whiff: !!sc.whiff, react: !!sc.react, slow });
    if (sc.whiff) {
      spawnFloat("p2", "NO GUARD", "breaker-float whiff");
    } else if (sc.react === "block") {
      // Mirror Breaker do štítu: štít ho zablokuje ako bežný útok (spotrebuje sa, 0 dmg)
      spawnShieldBlock("p2", false);
      spawnFloat("p2", "🛡️ BLOCKED", "block-float");
      fire("state", snap(atk({ mana: 6 - sc.cost }), actor("p2", 3)));
    } else if (sc.react === "reflect") {
      // Shield Breaker do mirroru: mirror odrazí jeho dmg späť na útočníka
      spawnMirrorReflect("p2", sc.dmg, "special", false);
      spawnFloat("p2", "🪞 REFLECTED!", "mirror-reflect-text");
      await sleep(450 * slow);
      fire("state", snap(atk({ mana: 6 - sc.cost, hp: 10 - sc.dmg }), actor("p2", 3)));
      setAnim("p1", "hurt", 450);
      spawnDamageFloat("p1", sc.dmg);
    } else {
      // obrana rozbitá a spotrebovaná → zásah (skutočný hurt + -N HP float hry)
      fire("state", snap(atk({ mana: 6 - sc.cost }), actor("p2", 3, { hp: 10 - sc.dmg })));
      spawnFloat("p2", sc.label, "breaker-float");
      await sleep(160);
      setAnim("p2", "hurt", 450);
      spawnDamageFloat("p2", sc.dmg);
    }
    await sleep(1600); busy = false;
  }

  /* ---------------- návrh tlačidiel: klik na obranu → výber obrana / breaker ---------------- */
  const shieldBtn = document.querySelector('.controls .btn.act.shield[data-act="shield"]');
  const mirrorBtn = document.getElementById("mirror-btn");
  const goldenBtn = document.getElementById("golden-btn");
  // štít nemá vlastný .move-wrap (nemal picker) - obal ho, nech sa výber ukotví nad ním
  if (shieldBtn && !shieldBtn.parentElement.classList.contains("move-wrap")) {
    const w = document.createElement("div"); w.className = "move-wrap";
    shieldBtn.replaceWith(w); w.appendChild(shieldBtn);
  }
  if (goldenBtn) goldenBtn.style.position = "relative";
  const opt = (cls, pick, icon, label) =>
    `<button type="button" class="btn act ${cls}" data-pick="${pick}">${icon}<span class="cost${label.word ? " word" : ""}">${label.html}</span></button>`;
  const word = (w) => ({ word: true, html: w });
  const dmg = (n) => ({ html: costHtml(`${n}{☠️}`) });
  const PICKERS = {
    shield:  { anchor: shieldBtn, html: opt("shield", "shield", '<span class="pix-ico" data-emoji="🛡️"></span>', word("BLOCK"))
                                       + opt("shield", "shield_breaker", crackIco("🛡️"), dmg(BRK_DMG.shield)) },
    mirror:  { anchor: mirrorBtn, html: opt("mirror", "mirror", '<span class="pix-ico" data-emoji="🪞"></span>', word("REFLECT"))
                                       + opt("mirror", "mirror_breaker", crackIco("🪞"), dmg(BRK_DMG.mirror)) },
    gshield: { anchor: goldenBtn, html: opt("golden-opt", "golden_shield", '<span class="pix-ico" data-emoji="🛡️"></span>', word("BLOCK"))
                                       + opt("golden-opt", "golden_shield_breaker", crackIco("🛡️"), dmg(BRK_DMG.shield)) },
    gmirror: { anchor: goldenBtn, html: opt("golden-opt", "golden_mirror", '<span class="pix-ico" data-emoji="🪞"></span>', word("REFLECT"))
                                       + opt("golden-opt", "golden_mirror_breaker", crackIco("🪞"), dmg(BRK_DMG.mirror)) },
  };
  for (const [key, p] of Object.entries(PICKERS)) {
    if (!p.anchor) continue;
    p.el = document.createElement("div");
    p.el.className = "def-picker hidden"; p.el.dataset.for = key; p.el.innerHTML = p.html;
    (key === "shield" ? p.anchor.parentElement : key === "mirror" ? p.anchor.parentElement : p.anchor).appendChild(p.el);
    hydratePix(p.el);
  }
  const closeAll = () => Object.values(PICKERS).forEach(p => p.el?.classList.add("hidden"));
  // pôvodný obsah tlačidiel (ikona) - zvolený breaker ju na tlačidle nahradí preškrtnutou
  const orig = new Map([shieldBtn, mirrorBtn, ...document.querySelectorAll(".golden-half")].filter(Boolean).map(b => [b, b.innerHTML]));
  const setIcon = (btn, html) => { const ico = btn.querySelector(".pix-ico, .brk-ico"); if (ico) { ico.outerHTML = html; hydratePix(btn); } };

  function choose(pick) {
    closeAll();
    const brk = pick.endsWith("_breaker");
    if (pick.startsWith("golden")) {
      const mirror = pick.includes("mirror");
      planning.goldenArmed = !mirror; planning.goldenMirrorArmed = mirror; planning.goldenBreaker = brk;
      syncGoldenHalves();
      const half = document.querySelector(`.golden-half.${mirror ? "mirror" : "shield"}-half`);
      if (brk && half) setIcon(half, crackIco(mirror ? "🪞" : "🛡️", "g-ico"));
    } else {
      if (planning.myQueue.length >= 3) return;
      planning.myQueue.push({ type: pick });
      const btn = pick.startsWith("shield") ? shieldBtn : mirrorBtn;
      if (brk) setIcon(btn, crackIco(pick.startsWith("shield") ? "🛡️" : "🪞"));
    }
    renderQueue();
    // breaker zaberá slot svojej obrany - tlačidlo je „použité" rovnako ako po zvolení obrany
    if (pick === "shield_breaker") shieldBtn.disabled = true;
    if (pick === "mirror_breaker") mirrorBtn.disabled = true;
  }
  function resetPicks() {
    closeAll();
    planning.myQueue = []; planning.goldenArmed = false; planning.goldenMirrorArmed = false; planning.goldenBreaker = false;
    for (const [b, html] of orig) { b.innerHTML = html; delete b.dataset.done; hydratePix(b); b.disabled = false; }
    syncGoldenHalves(); renderQueue();
  }
  // capture: klik na štít / mirror / golden polovicu otvorí návrh výberu namiesto pôvodnej akcie hry
  document.addEventListener("click", (e) => {
    const o = e.target.closest(".def-picker [data-pick]");
    if (o) { e.stopImmediatePropagation(); e.preventDefault(); choose(o.dataset.pick); return; }
    const half = e.target.closest(".golden-half");
    const key = e.target.closest('.btn.act.shield[data-act="shield"]') ? "shield"
      : e.target.closest("#mirror-btn") ? "mirror"
      : half ? (half.dataset.gold === "mirror" ? "gmirror" : "gshield") : null;
    if (!key) { if (!e.target.closest(".def-picker")) closeAll(); return; }
    e.stopImmediatePropagation(); e.preventDefault();
    const btn = key === "shield" ? shieldBtn : key === "mirror" ? mirrorBtn : half;
    if (btn.disabled || (key.startsWith("g") && (planning.goldenArmed || planning.goldenMirrorArmed))) return;
    const el = PICKERS[key].el, wasOpen = !el.classList.contains("hidden");
    closeAll();
    if (!wasOpen) el.classList.remove("hidden");
  }, true);

  /* ---------------- panel (mimo zmenšovanej obrazovky hry, aby neprekrýval HUD) ---------------- */
  const panel = document.createElement("div");
  Object.assign(panel.style, { position: "fixed", top: "8px", left: "50%", transform: "translateX(-50%)", zIndex: "2000000",
    display: "flex", flexWrap: "wrap", gap: "6px", maxWidth: "1000px", justifyContent: "center", padding: "8px",
    background: "rgba(10,10,14,.88)", border: "1px solid #444", borderRadius: "6px", font: "12px system-ui, sans-serif" });
  const btn = (txt, on) => {
    const b = document.createElement("button"); b.textContent = txt;
    Object.assign(b.style, { background: "#262a33", color: "#eee", border: "1px solid #555", borderRadius: "4px", padding: "5px 9px", cursor: "pointer" });
    b.onclick = on; panel.appendChild(b); return b;
  };
  for (const sc of SC) btn(sc.t, () => run(sc));
  const sp = btn("rýchlosť 1×", () => { slow = slow === 1 ? 2 : slow === 2 ? 4 : 1; sp.textContent = `rýchlosť ${slow === 1 ? "1" : "1/" + slow}×`; });
  btn("vyčistiť výber tlačidiel", resetPicks);
  const hint = document.createElement("div");
  hint.textContent = "Tlačidlá: klik na štít / mirror / golden polovicu dole = výber obrana alebo breaker";
  Object.assign(hint.style, { width: "100%", textAlign: "center", color: "#aaa", fontSize: "11px" });
  panel.appendChild(hint);
  document.body.appendChild(panel);
})();
