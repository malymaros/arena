// telemetry/store.js - ukladanie záznamov telemetrie: jeden JSONL súbor na deň (UTC) v adresári
// TELEMETRY_DIR (na VM /home/arena/arena-data - mimo repa, deploy ho nezmaže). Záznamy sa držia v pamäti
// a zapisujú v dávkach (flush každé 2 s a pri ukončení procesu); chyba zápisu hru nikdy nezhodí.
import fs from "fs";
import path from "path";
import zlib from "zlib";

const FILE_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export function createJsonlStore(dir, { flushMs = 2000 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  let buf = [];        // [{ file, line }]
  let warned = false;
  const timer = setInterval(flush, flushMs);
  timer.unref?.();

  function append(record) {
    const file = new Date().toISOString().slice(0, 10) + ".jsonl";
    buf.push({ file, line: JSON.stringify(record) + "\n" });
  }

  function flush() {
    if (!buf.length) return;
    const batch = buf;
    buf = [];
    const byFile = new Map();
    for (const { file, line } of batch) byFile.set(file, (byFile.get(file) || "") + line);
    for (const [file, text] of byFile) {
      try { fs.appendFileSync(path.join(dir, file), text); }
      catch (e) { if (!warned) { warned = true; console.warn("telemetry: zápis zlyhal:", e.message); } }
    }
  }

  // denné súbory (voliteľne od dátumu YYYY-MM-DD vrátane), zoradené
  function files(from = null) {
    try { return fs.readdirSync(dir).filter(f => FILE_RE.test(f) && (!from || f.slice(0, 10) >= from)).sort(); }
    catch { return []; }
  }

  // všetky (vybrané) denné súbory spojené za sebou a zbalené gzipom do zapisovateľného streamu (HTTP odpoveď)
  function pipeGzip(out, from = null) {
    flush();
    const gz = zlib.createGzip();
    gz.pipe(out);
    const list = files(from);
    const next = () => {
      const f = list.shift();
      if (!f) { gz.end(); return; }
      const rs = fs.createReadStream(path.join(dir, f));
      rs.on("error", next);
      rs.on("end", next);
      rs.pipe(gz, { end: false });
    };
    next();
  }

  return { append, flush, files, pipeGzip, dir };
}
