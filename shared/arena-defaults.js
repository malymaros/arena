// shared/arena-defaults.js - predvolené ADVANCED SETTINGS každej arény (lobby hosta, public/client/lobby.js) a ich
// prevod na config pre server. Zdieľané klientom aj serverom: server podľa nich pozná, či má aréna zmenené nastavenia
// (dlaždica roomky v room browseri ukáže oranžový štvorček CUSTOM - je jedno, čo je zmenené, vrátane zákazov postáv).
import { PORTAL_WEIGHTS, PORTAL_TILE_WEIGHTS, PORTALS_PER_ROUND, ITEM_WEIGHTS } from "./balance.js";

// tvar uložený v lobby (localStorage): počet za kolo, náhľad, percentá, zákazy postáv per farba (BANNED CHARACTERS)
export const DEF_ARENA = {
  bridge: { count: 1, preview: "on", tiles: { dmg: 75, ik: 5, heal: 5, power: 5, mana: 5, block: 5 }, bans: { p1: [], p2: [] } },
  portal: { count: 1, preview: "on", tiles: { ...PORTAL_TILE_WEIGHTS }, portals: { ...PORTAL_WEIGHTS }, perRound: PORTALS_PER_ROUND, bans: { p1: [], p2: [] } },
  swamp:  { count: 1, preview: "on", items: { ...ITEM_WEIGHTS }, bans: { p1: [], p2: [] } },
};

// pravidlá jednej arény v tvare configu pre server (bez kľúča arena). Zákazy (bans) len keď nejaké sú - config
// bez nich ostáva rovnaký ako predtým (goldeny, telemetria).
export function arenaRules(a, c) {
  const preview = c.preview === "on";
  const rules = { tilesPerRound: c.count, tileWeights: { dmg: 0, heal: 0, mana: 0, ik: 0, power: 0, block: 0, ...(c.tiles || {}) }, tilePreview: preview };
  const bans = c.bans && (c.bans.p1?.length || c.bans.p2?.length) ? { bans: { p1: [...(c.bans.p1 || [])], p2: [...(c.bans.p2 || [])] } } : {};
  if (a === "portal") return { ...rules, portalWeights: { ...c.portals }, portalsPerRound: c.perRound, ...bans };
  if (a === "swamp") return { ...rules, itemsPerRound: c.count, itemWeights: { ...c.items }, shrekPreview: preview, ...bans };
  return { ...rules, ...bans };
}

// polia configu, ktoré nastavuje ADVANCED SETTINGS danej arény (ostatné sú hlavné lobby: formát, farba, časovač…)
const FIELDS = {
  bridge: ["tilesPerRound", "tileWeights", "tilePreview", "bans"],
  portal: ["tilesPerRound", "tileWeights", "tilePreview", "portalWeights", "portalsPerRound", "bans"],
  swamp: ["itemsPerRound", "itemWeights", "shrekPreview", "bans"],
};
// stabilný zápis (poradie kľúčov nehrá rolu; zákazy ako zoradené množiny)
const norm = (v) => {
  if (Array.isArray(v)) return [...v].map(String).sort();
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])]));
  return v;
};
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const emptyBans = (b) => !b || (!(b.p1?.length) && !(b.p2?.length));

// má config jednej arény (už očistený serverom) iné ADVANCED SETTINGS než predvolené?
export function arenaConfigCustom(cfg) {
  if (!cfg) return false;
  const a = cfg.arena === "portal" || cfg.arena === "swamp" ? cfg.arena : "bridge";
  const def = arenaRules(a, DEF_ARENA[a]);
  return FIELDS[a].some(k => (k === "bans" ? !(emptyBans(cfg.bans) && emptyBans(def.bans)) && !same(cfg.bans, def.bans) : !same(cfg[k], def[k])));
}
// celý config zápasu: kocka = CUSTOM, keď je upravená niektorá z arén v losovaní
export function matchConfigCustom(cfg) {
  if (!cfg) return false;
  if (cfg.arena === "random") return Object.values(cfg.arenas || {}).some(arenaConfigCustom);
  return arenaConfigCustom(cfg);
}
