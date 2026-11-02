// engine/ai/solve.js - rovnováha maticovej hry s nulovým súčtom (docs/AI_PLAN.md 3.4).
// M[i][j] = hodnota pre riadkového hráča (bot), stĺpcový ju minimalizuje. Regret matching+ s váženým
// priemerom stratégií - konverguje k Nashovej rovnováhe, desiatky riadkov/stĺpcov za pár ms.
export function solveMatrix(M, iters = 2000) {
  const n = M.length, m = M[0]?.length || 0;
  if (!n || !m) return { row: [], col: [], value: 0 };
  const rr = new Float64Array(n), rc = new Float64Array(m);      // kumulatívne (kladné) regrety
  const sr = new Float64Array(n), sc = new Float64Array(m);      // vážené súčty stratégií
  const pr = new Float64Array(n), pc = new Float64Array(m);
  const norm = (reg, out) => {
    let s = 0;
    for (let i = 0; i < reg.length; i++) s += reg[i];
    for (let i = 0; i < reg.length; i++) out[i] = s > 0 ? reg[i] / s : 1 / reg.length;
  };
  const ur = new Float64Array(n), uc = new Float64Array(m);
  for (let t = 1; t <= iters; t++) {
    norm(rr, pr); norm(rc, pc);
    // úžitok každého riadku proti stĺpcovej zmesi a každého stĺpca proti riadkovej
    let vr = 0;
    for (let i = 0; i < n; i++) { let u = 0; const row = M[i]; for (let j = 0; j < m; j++) u += row[j] * pc[j]; ur[i] = u; vr += u * pr[i]; }
    for (let j = 0; j < m; j++) { let u = 0; for (let i = 0; i < n; i++) u += M[i][j] * pr[i]; uc[j] = -u; }
    const vc = -vr;
    for (let i = 0; i < n; i++) rr[i] = Math.max(0, rr[i] + ur[i] - vr);
    for (let j = 0; j < m; j++) rc[j] = Math.max(0, rc[j] + uc[j] - vc);
    for (let i = 0; i < n; i++) sr[i] += t * pr[i];
    for (let j = 0; j < m; j++) sc[j] += t * pc[j];
  }
  const row = [...sr], col = [...sc];
  const tr = row.reduce((a, b) => a + b, 0), tc = col.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) row[i] /= tr;
  for (let j = 0; j < m; j++) col[j] /= tc;
  let value = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) value += row[i] * col[j] * M[i][j];
  return { row, col, value };
}

// výber indexu podľa pravdepodobností; drobné váhy (< minP) sa zahodia - šum regret matchingu
export function sampleMix(probs, rng, minP = 0.02) {
  let w = probs.map(p => (p >= minP ? p : 0));
  let s = w.reduce((a, b) => a + b, 0);
  if (s <= 0) { w = probs; s = 1; }
  let r = rng() * s;
  for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0 && w[i] > 0) return i; }
  return w.findIndex(x => x > 0);
}
