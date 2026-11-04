// telemetry/match-log.js - úložisko záznamov zápasov pre MATCHES / ANALYZE (docs/MATCH_REVIEW_PLAN.md).
// Jeden súbor na záznam (<dir>/<id>.json.gz) + index.jsonl (riadok zoznamu na záznam, najnovší na konci).
// Bez limitu počtu. Záznamy inej MATCH_RECORD_VERSION sa pri štarte presunú do <dir>/old-v<N>/ a nezobrazia sa.
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { MATCH_RECORD_VERSION } from "../shared/match-record.js";

const ID_RE = /^[a-f0-9]{6,32}$/;

// riadok zoznamu: len to, čo ukazuje MATCHES (bez zápisov kôl)
export function summaryOf(r) {
  return {
    id: r.id, v: r.v, ts: r.ts, arena: r.arena, ...(r.randomArena ? { randomArena: true } : {}), format: r.format,
    ...(r.ai ? { ai: r.ai } : {}), score: r.score, finished: r.finished,
    ...(r.team ? { team: r.team, dead: r.dead || { p1: [], p2: [] } } : {}),
    games: r.games.map(x => ({ g: x.g, chars: x.chars, winner: x.winner, cause: x.cause, rounds: x.rounds.length, ...(x.demon.length ? { demon: x.demon } : {}) })),
  };
}

export function createMatchLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const indexFile = path.join(dir, "index.jsonl");
  let rows = []; // najstarší prvý

  // načítaj index; riadky inej verzie (a ich súbory) presuň do old-v<N>/
  if (fs.existsSync(indexFile)) {
    const keep = [], old = new Map();
    for (const line of fs.readFileSync(indexFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let row; try { row = JSON.parse(line); } catch { continue; }
      if (row.v === MATCH_RECORD_VERSION) keep.push(row);
      else { if (!old.has(row.v)) old.set(row.v, []); old.get(row.v).push(row); }
    }
    for (const [v, list] of old) {
      const od = path.join(dir, `old-v${v}`);
      fs.mkdirSync(od, { recursive: true });
      fs.appendFileSync(path.join(od, "index.jsonl"), list.map(r => JSON.stringify(r)).join("\n") + "\n");
      for (const r of list) {
        const f = path.join(dir, `${r.id}.json.gz`);
        try { if (fs.existsSync(f)) fs.renameSync(f, path.join(od, `${r.id}.json.gz`)); } catch { /* nič */ }
      }
    }
    if (old.size) fs.writeFileSync(indexFile, keep.map(r => JSON.stringify(r)).join("\n") + (keep.length ? "\n" : ""));
    rows = keep;
  }
  const ids = new Set(rows.map(r => r.id)); // rýchle overenie id (index je bez limitu)

  function save(record) {
    if (!ID_RE.test(record.id)) return;
    fs.writeFileSync(path.join(dir, `${record.id}.json.gz`), zlib.gzipSync(JSON.stringify(record)));
    const row = summaryOf(record);
    fs.appendFileSync(indexFile, JSON.stringify(row) + "\n");
    rows.push(row);
    ids.add(row.id);
  }

  // stránka zoznamu: najnovšie prvé; before = id posledného riadku predošlej stránky
  function list({ before = null, limit = 50 } = {}) {
    let end = rows.length;
    if (before) { const i = rows.findIndex(r => r.id === before); if (i >= 0) end = i; }
    const start = Math.max(0, end - limit);
    return { rows: rows.slice(start, end).reverse(), more: start > 0 };
  }

  // zabalený súbor záznamu tak, ako leží na disku (server ho pošle klientovi bez rozbaľovania - rozbalí prehliadač);
  // asynchrónne - čítanie neblokuje herný server
  const known = (id) => typeof id === "string" && ID_RE.test(id) && ids.has(id);
  async function getRaw(id) {
    if (!known(id)) return null;
    try { return await fs.promises.readFile(path.join(dir, `${id}.json.gz`)); } catch { return null; }
  }

  function get(id) {
    if (!known(id)) return null;
    try { return JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, `${id}.json.gz`))).toString("utf8")); }
    catch { return null; }
  }

  return { save, list, get, getRaw, get size() { return rows.length; } };
}
