// public/sounds/trim.js - ČISTÉ: orezanie zvuku na hlavnú časť (bez tichého/slabého úvodu a konca).
// Položka registra/balíka môže mať trim: { "<cesta súboru>": [startMs, endMs] } - hra prehrá len tento úsek
// (efekt začne rovno hlavnou časťou; hudba sa opakuje len v ňom a koniec sa prelínia so začiatkom).
// Detekcia beží v Sound Labe z dekódovaného zvuku; tu je len výpočet (testovateľný v Node).
export const WIN_MS = 20;          // dĺžka okna obálky
export const THRESHOLD = 0.05;     // hlavná časť = hlasitosť nad 5 % maxima (~ -26 dB)
export const PAD_START_MS = 20;    // rezerva pred nástupom (nech sa neodsekne útok zvuku)
export const PAD_END_MS = 80;      // rezerva za doznením

// obálka hlasitosti (RMS po oknách) z PCM vzoriek (Float32Array, -1…1)
export function envelope(samples, sampleRate, winMs = WIN_MS) {
  const win = Math.max(1, Math.round(sampleRate * winMs / 1000));
  const env = [];
  for (let i = 0; i < samples.length; i += win) {
    let s = 0;
    const end = Math.min(samples.length, i + win);
    for (let j = i; j < end; j++) s += samples[j] * samples[j];
    env.push(Math.sqrt(s / (end - i)));
  }
  return env;
}

// obálka → { startMs, endMs } hlavnej časti; null = ticho / nedá sa určiť
export function detectTrim(env, durationMs, { winMs = WIN_MS, threshold = THRESHOLD } = {}) {
  const max = Math.max(0, ...env);
  if (!(max > 0)) return null;
  const limit = max * threshold;
  const first = env.findIndex(v => v >= limit);
  let last = env.length - 1;
  while (last > first && env[last] < limit) last--;
  const startMs = Math.max(0, first * winMs - PAD_START_MS);
  const endMs = Math.min(durationMs, (last + 1) * winMs + PAD_END_MS);
  return endMs > startMs ? { startMs: Math.round(startMs), endMs: Math.round(endMs) } : null;
}

// orezanie súboru v položke → [startMs, endMs] alebo null (celý súbor)
export function trimOf(entry, file) {
  const t = entry?.trim?.[file];
  return Array.isArray(t) && t.length === 2 && t[1] > t[0] ? t : null;
}

// prelínanie konca hudby so začiatkom: max 1,5 s, pri krátkom úseku najviac tretina
export const LOOP_XFADE_MS = 1500;
export function loopXfade(loopMs) { return Math.max(0, Math.min(LOOP_XFADE_MS, loopMs / 3)); }
