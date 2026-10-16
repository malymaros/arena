// public/client/sound-map.js - KEDY čo zaznie: mapovanie timeline frame-ov (efekty zo servera + pohyb figúr)
// a stavu hry (fáza → hudba) na kľúče z public/sounds/manifest.js. Samotné prehrávanie je v sound.js.
// Redakcia labyrintu/pasce platí aj pre zvuk automaticky: čo server klientovi zamaskoval, nezaznie.
import { sfx, setMusic } from "/client/sound.js";
import { state, board } from "/client/session.js";

// panoráma podľa stĺpca bunky: ľavý okraj -0.6 … pravý +0.6 (jemne - aby to nebolo do jedného ucha)
const panX = (x) => (typeof x === "number" && board.w > 1 ? (x / (board.w - 1) * 2 - 1) * 0.6 : 0);
const panOf = (e, frame) => {
  if (Array.isArray(e.cell)) return panX(e.cell[0]);
  const s = e.from || e.target;
  return panX(frame?.[s]?.x ?? state?.[s]?.x);
};
const charOf = (slot, frame) => frame?.[slot]?.char || state?.[slot]?.char || null;

// efekty, ktoré sa opakujú v po sebe idúcich frame-och (let strely po bunkách, beaty castu) → zaznejú
// len na prvom frame-e; ostatné zaznejú pri každom výskyte
const ONCE_PER_RUN = new Set(["charge", "special", "wolf_charge", "vamp_charge", "luffy_roll"]);
let prevRun = new Set();
let lastAction = { p1: null, p2: null }; // posledná ohlásená akcia slotu (move vs dash pri zmene pozície)

// priame mapovanie druh efektu → kľúč (s kľúčom postavy z e.from/e.target)
const DIRECT = {
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
  luffy_pull: "luffy_pull", luffy_gp: "luffy_gp", luffy_roll: "luffy_roll",
  luffy_explode: "luffy_explode", luffy_chomp: "luffy_chomp",
  stoned: "stoned", labyrinth_reveal: "labyrinth_reveal", thread_mark: "thread_mark",
  clone_born: "clone_born", clone_hit: "clone_hit", teleport_in: "teleport_in", trap_tp_in: "teleport_in",
  demon_attack: "demon_attack", last_stand_kill: "last_stand_kill", last_stand_revive: "last_stand_revive",
  last_stand_banish: "last_stand_banish", last_stand_banish_kill: "last_stand_kill",
  vamp_heal_cast: "vamp_heal_cast", luffy_ball_form: "luffy_ball_form", wanderer_no_regen: "wanderer_no_regen",
  charge: "attack", special: "special",
};

// začiatok novej timeline (nové kolo / pokračovanie po THE WORLD)
export function soundTimelineStart() { prevRun = new Set(); }

// jeden frame timeline: `before` = stav slotov pred frame-om (pohyb sa odvodí z rozdielu pozícií)
export function soundForFrame(frame, before) {
  const run = new Set();
  for (const e of frame.effects || []) {
    const slot = e.from || (typeof e.target === "string" ? e.target : null);
    if (e.kind === "action" && (e.from === "p1" || e.from === "p2")) lastAction[e.from] = e.action?.type || null;
    if (e.kind === "hit") {
      // char = ZASIAHNUTÁ postava (hit.<char> / hit_heavy.<char> = jej hlas)
      if (e.dmg > 0) sfx(e.dmg >= 8 ? "hit_heavy" : "hit", { char: charOf(e.target, frame), pan: panOf(e, frame) });
      continue;
    }
    if (e.kind === "tile_proc") {
      sfx(`tile.${e.tile}`, { pan: panOf(e, frame) });
      continue;
    }
    if (e.kind === "golden_mana" && !e.gained) continue; // odmietnutá výmena
    const key = DIRECT[e.kind];
    if (!key) continue;
    if (ONCE_PER_RUN.has(e.kind)) {
      const id = `${e.kind}:${slot}:${e.clone ? 1 : 0}`;
      run.add(id);
      if (prevRun.has(id)) continue;
    }
    sfx(key, { char: charOf(slot, frame), pan: panOf(e, frame) });
  }
  prevRun = run;

  // pohyb: zmena pozície bez vlastného zvuku akcie (charge/teleport si ho nesú) → krok alebo dash
  const ownLoco = (frame.effects || []).some(e => ["wolf_charge", "vamp_charge", "luffy_pull", "luffy_roll", "trap_tp_in", "trap_tp_out", "teleport_in"].includes(e.kind));
  if (!ownLoco) {
    for (const s of ["p1", "p2"]) {
      const b = before?.[s], f = frame[s];
      if (!b || !f || f.x == null || b.x == null) continue; // skrytý v labyrinte → nič
      if (b.x !== f.x || b.y !== f.y) sfx(lastAction[s] === "dash" ? "dash" : "move", { char: charOf(s, frame), pan: panX(f.x) });
    }
  }
}

// hudba podľa fázy hry: lobby / výber / draft → menu, hra → battle (FINAL ROUND → final, ak má súbor)
export function syncMusic(s, finalRound = false) {
  const phase = s?.phase;
  if (!phase) return;
  if (phase === "match_over") return; // hudbu stíši až game-over sekvencia (po dohraní poslednej timeline)
  const inGame = phase === "playing" && s.p1?.char && s.p2?.char;
  if (!inGame) setMusic("music.menu");
  else if (finalRound) setMusic("music.final", "music.battle");
  else setMusic("music.battle");
}
