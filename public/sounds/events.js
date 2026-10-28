// public/sounds/events.js - ČISTÉ mapovanie timeline → zvukové udalosti: ktorý kľúč z registra (manifest.js)
// zaznie v danom frame-e, pre ktorú postavu, kam v panoráme a aké má OKNO (ms, kým hra pokračuje ďalej).
// Bez DOM/Web Audio - importuje ho klient (public/client/sound-map.js), meranie okien z enginu
// (tools/sound-windows.mjs) aj testy (test/sound-events.mjs), takže okná v labe sú zmerané presne tou logikou,
// ktorá v hre zvuk spúšťa.
// Redakcia labyrintu/pasce platí automaticky: čo server klientovi zamaskoval, v timeline nie je → nezaznie.

// druh efektu zo servera → kľúč registra (char = postava z e.from / e.target)
export const DIRECT = {
  attack_swing: "attack_whiff", wall_bump: "wall_bump", melee: "melee",
  block: "block", mirror: "mirror", shield: "shield", mirror_on: "mirror_on",
  golden_shield: "golden_shield", golden_mirror: "golden_mirror", golden_mana: "golden_mana",
  recharge: "recharge", pass: "pass", invalid: "invalid", heal: "heal", mana_drain: "mana_drain",
  petrify: "petrify", unpetrify: "unpetrify", tile_consume: "tile_consume",
  labyrinth: "labyrinth", labyrinth_end: "labyrinth_end",
  clone_summon: "clone_summon", clone_die: "clone_die",
  trap_set: "trap_set", trap_trigger: "trap_trigger", trap_break: "trap_break",
  trap_tp_out: "teleport", teleport_out: "teleport",
  timestop_start: "timestop_start", timestop_end: "timestop_end",
  demon_summon: "demon_summon", last_stand_summon: "last_stand", last_hope_summon: "last_hope",
  soldier_beam: "soldier_beam", wolf_charge: "wolf_charge", wolf_strike: "wolf_strike",
  vamp_charge: "vamp_charge", vamp_strike: "vamp_strike", special1: "special1",
  luffy_punch: "luffy_punch", luffy_roll: "luffy_roll", luffy_explode: "luffy_explode",
  stoned: "stoned", labyrinth_reveal: "labyrinth_reveal", thread_mark: "thread_mark",
  clone_born: "clone_born", clone_hit: "clone_hit", teleport_in: "teleport_in", trap_tp_in: "teleport_in",
  demon_attack: "demon_attack", last_stand_kill: "last_stand_kill", last_stand_revive: "last_stand_revive",
  last_stand_banish: "last_stand_banish", last_stand_banish_kill: "last_stand_banish_kill",
  vamp_heal_cast: "vamp_heal_cast", luffy_ball_form: "luffy_ball_form", wanderer_no_regen: "wanderer_no_regen",
  charge: "attack", special: "special",
  // Portal Realm: prechod tela (move/dash/charge/guľa), nový pár na konci kola, zatvorenie páru po prechode
  portal_walk: "portal.use", portal_spawn: "portal.open", portal_close: "portal.close",
};
// efekty opakované v po sebe idúcich frame-och (let strely po bunkách, beaty castu) → zaznejú raz za beh;
// okno = celý beh. Melee sem nepatrí - zvuk úderu znie pri každom z 3 švihov.
export const ONCE_PER_RUN = new Set(["charge", "special", "wolf_charge", "vamp_charge", "luffy_roll"]);
// HLAS postavy - samostatná vrstva popri zvuku efektu: zaznie RAZ na začiatku akcie (prvý frame behu),
// aj keď efekt sa opakuje (3 švihy melee); okno = celý beh. Len skutočná postava, nie Narutov klon.
// THE WORLD (Jotaro) nie je efekt `special`, ale `timestop_start` → hlas špeciálu. vamp_strike = úder Vampire/Onryō
// (melee na vlastnej bunke, úder po charge v slote dashu, úder pasce) → hlas melee.
export const VOICE = {
  charge: "voice.attack", attack_swing: "voice.attack", melee: "voice.melee", special: "voice.special",
  timestop_start: "voice.special", vamp_strike: "voice.melee",
  luffy_ball_form: "voice.special", // Luffyho guľa (jednorazový special) nie je efekt `special`
};
// postava, pre ktorú efekt znamená iný hlas: Jotarov `special` je vždy Special 2 (THE WORLD má timestop_start),
// jeho Special 1 (útok v slote mirroru) hrá tiež hlas Special 2. Luffy rovnako: `special` = Special 2 (guľa má
// luffy_ball_form); ruka v slote mirroru (luffy_punch) má vlastný hlas Special 1
export const VOICE_BY_CHAR = {
  jotaro: { special: "voice.special2", special1: "voice.special2" },
  luffy: { special: "voice.special2", luffy_punch: "voice.special1" },
};
// postava, ktorej hlas zaznie pri KAŽDOM frame behu (nie len raz): Onryō pri melee povie hlášku pri každom
// z 3 švihov (krátka hláška sa zmestí do beatu) - ako vlkolak, ktorého nahrávka melee má tri opakovania
export const VOICE_EACH_BEAT = { onre: new Set(["melee"]) };
// FÁZA ako jedna stopa: okno udalosti siaha od jej frame-u až po frame s efektom `until` (`inclusive` = vrátane neho).
// Pakt Last Stand má dve stopy: `last_stand` = vyvolanie (démon sa vynorí + odčerpá HP/manu, až po smrť) a
// `last_stand_kill` = smrť + oživenie (démon za postavou, zlaté dvíhanie, hráč vstane - vrátane settle).
// Útok démona (`demon_summon`) = vynorenie → 3 bliknutia → zásah → odchod; vyhnanie (`last_stand_banish`) = duch opustí
// postavu → v strede → odčerpanie → smrť.
export const PHASE_SPAN = {
  last_stand_summon: { until: "last_stand_kill", inclusive: false },
  last_stand_kill:   { until: "last_stand_settle", inclusive: true },
  demon_summon:      { until: "demon_center_out", inclusive: true },
  last_stand_banish: { until: "last_stand_banish_kill", inclusive: true },
  last_hope_summon:  { until: "last_hope_settle", inclusive: true }, // Last Hope: vynorenie → HP 1 / mana 10 → zmizne
  luffy_punch:       { until: "luffy_punch_back", inclusive: true }, // Luffyho ruka: natiahnutie → úder → stiahnutie
};
function phaseWindow(timeline, i, { until, inclusive }) {
  let ms = 0;
  for (let j = i; j < timeline.length; j++) {
    const hit = j > i && (timeline[j].effects || []).some(e => e.kind === until);
    if (hit && !inclusive) break;
    ms += timeline[j].delayMs || 0;
    if (hit) break;
  }
  return ms;
}
// frame s týmto efektom nesie vlastný zvuk presunu - zmena pozície v ňom nie je krok/dash
export const OWN_LOCO = new Set(["wolf_charge", "vamp_charge", "luffy_roll", "trap_tp_in", "trap_tp_out", "teleport_in"]);
export const HIT_HEAVY_DMG = 8;
export const TILE_KINDS = ["dmg", "heal", "mana", "ik"];
// všetky kľúče, ktoré táto mapa môže vydať (test/sounds.mjs overí, že sú v registri)
export const PLAYED_KEYS = [...new Set([...Object.values(DIRECT), ...Object.values(VOICE),
  ...Object.values(VOICE_BY_CHAR).flatMap(Object.values), "hit", "hit_heavy", "voice.hurt", "move", "dash", ...TILE_KINDS.map(t => `tile.${t}`)])];

// stav medzi frame-ami jednej timeline (nová timeline → newTracker / resetTracker)
export function newTracker() { return { prevRun: new Set(), lastAction: { p1: null, p2: null } }; }
export function resetTracker(tr) { tr.prevRun = new Set(); }

const runId = (e, slot) => `${e.kind}:${slot}:${e.clone ? 1 : 0}`;
const slotOf = (e) => e.from || (typeof e.target === "string" ? e.target : null);

// okno behu: súčet delayMs od frame-u i, kým nasledujúce frame-y nesú ten istý efekt
function runWindow(timeline, i, id) {
  let ms = timeline[i].delayMs || 0;
  for (let j = i + 1; j < timeline.length; j++) {
    if (!(timeline[j].effects || []).some(e => runId(e, slotOf(e)) === id)) break;
    ms += timeline[j].delayMs || 0;
  }
  return ms;
}

// zvukové udalosti frame-u timeline[i]; `before` = sloty pred frame-om ({p1, p2}), `tr` = tracker,
// `board` = {w,h} (panoráma), `fallback` = stav, z ktorého sa doplní postava/pozícia, ak ich frame nemá
// → [{ key, char, pan, windowMs }]
export function eventsForFrame(timeline, i, before, tr, { board = { w: 4 }, fallback = null } = {}) {
  const frame = timeline[i];
  const out = [];
  const panX = (x) => (typeof x === "number" && board.w > 1 ? (x / (board.w - 1) * 2 - 1) * 0.6 : 0);
  const charOf = (slot) => frame?.[slot]?.char || fallback?.[slot]?.char || null;
  const panOf = (e) => {
    if (Array.isArray(e.cell)) return panX(e.cell[0]);
    const s = slotOf(e);
    return panX(frame?.[s]?.x ?? fallback?.[s]?.x);
  };
  const win = frame.delayMs || 0;
  const run = new Set();
  for (const e of frame.effects || []) {
    const slot = slotOf(e);
    if (e.kind === "action" && (e.from === "p1" || e.from === "p2")) tr.lastAction[e.from] = e.action?.type || null;
    if (e.kind === "hit") {
      // char = ZASIAHNUTÁ postava (hit.<char> = jej hlas)
      if (e.dmg > 0) {
        out.push({ key: e.dmg >= HIT_HEAVY_DMG ? "hit_heavy" : "hit", char: charOf(e.target), pan: panOf(e), windowMs: win });
        // hlas zasiahnutej postavy (vzdych) - samostatná vrstva popri zvuku nárazu, ako ostatné hlasy
        out.push({ key: "voice.hurt", char: charOf(e.target), pan: panOf(e), windowMs: win });
      }
      continue;
    }
    if (e.kind === "tile_proc") {
      if (TILE_KINDS.includes(e.tile)) out.push({ key: `tile.${e.tile}`, char: null, pan: panOf(e), windowMs: win });
      continue;
    }
    if (e.kind === "golden_mana" && !e.gained) continue; // odmietnutá výmena
    // Portal Realm: strela/slnko preletí trhlinou (charge/special nesie portal) → zvuk prechodu popri zvuku útoku
    if (e.portal && e.kind !== "portal_walk") out.push({ key: "portal.use", char: null, pan: panOf(e), windowMs: win });
    // Narutov pár prejde tým istým portálom naraz - jeden zvuk prechodu, nie dva
    if (e.kind === "portal_walk" && e.clone && (frame.effects || []).some(o => o.kind === "portal_walk" && o.from === e.from && !o.clone)) continue;
    const key = DIRECT[e.kind];
    if (!key) continue;
    let windowMs = PHASE_SPAN[e.kind] ? phaseWindow(timeline, i, PHASE_SPAN[e.kind]) : win;
    const id = runId(e, slot);
    const firstOfRun = !tr.prevRun.has(id);
    run.add(id);
    const char = charOf(slot);
    const voiceKey = VOICE_BY_CHAR[char]?.[e.kind] || VOICE[e.kind];
    const eachBeat = VOICE_EACH_BEAT[char]?.has(e.kind);
    if (voiceKey && (firstOfRun || eachBeat) && !e.clone) {
      out.push({ key: voiceKey, char, pan: panOf(e), windowMs: eachBeat ? win : PHASE_SPAN[e.kind] ? windowMs : runWindow(timeline, i, id) });
    }
    if (ONCE_PER_RUN.has(e.kind)) {
      if (!firstOfRun) continue;
      windowMs = runWindow(timeline, i, id);
    }
    out.push({ key, char: charOf(slot), pan: panOf(e), windowMs });
  }
  tr.prevRun = run;

  // pohyb: zmena pozície bez vlastného zvuku presunu → krok alebo dash (podľa ohlásenej akcie)
  if (!(frame.effects || []).some(e => OWN_LOCO.has(e.kind))) {
    for (const s of ["p1", "p2"]) {
      const b = before?.[s], f = frame[s];
      if (!b || !f || f.x == null || b.x == null) continue; // skrytý v labyrinte → nič
      if (b.x !== f.x || b.y !== f.y) out.push({ key: tr.lastAction[s] === "dash" ? "dash" : "move", char: charOf(s), pan: panX(f.x), windowMs: win });
    }
  }
  return out;
}
