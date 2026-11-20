// Statistics, calibration and optimisation utilities (M-RES-01..07). Pure functions, no DOM.

export function mean(a) { return a.reduce((s, x) => s + x, 0) / a.length; }

/** Error metrics between measured y and predicted p. */
export function errorMetrics(y, p) {
  const n = Math.min(y.length, p.length);
  if (n === 0) return null;
  let sa = 0, ss = 0, sp = 0, np = 0;
  const ym = mean(y.slice(0, n));
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const e = p[i] - y[i];
    sa += Math.abs(e); ss += e * e; sst += (y[i] - ym) ** 2;
    if (y[i] !== 0) { sp += Math.abs(e / y[i]); np++; }
  }
  return { n, MAE: sa / n, RMSE: Math.sqrt(ss / n), MAPE: np ? (100 * sp) / np : NaN, R2: sst > 0 ? 1 - ss / sst : NaN, bias: (p.slice(0, n).reduce((s, x) => s + x, 0) - y.slice(0, n).reduce((s, x) => s + x, 0)) / n };
}

/** Solve A x = b (Gaussian elimination with partial pivoting). A is array of rows. */
export function solve(A, b) {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) throw new Error('Singular matrix (insufficient or collinear data)');
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Ordinary least squares: X rows of regressors (include 1 for intercept yourself). */
export function ols(X, y) {
  const p = X[0].length;
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const beta = solve(XtX, Xty);
  const yhat = X.map((r) => r.reduce((s, x, k) => s + x * beta[k], 0));
  const m = errorMetrics(y, yhat);
  const dof = X.length - p;
  const sse = y.reduce((s, yi, i) => s + (yi - yhat[i]) ** 2, 0);
  let se = null;
  if (dof > 0) {
    const s2 = sse / dof;
    try {
      const inv = XtX.map((_, i) => solve(XtX, XtX.map((__, j) => (i === j ? 1 : 0))));
      se = inv.map((col, i) => Math.sqrt(Math.max(0, s2 * col[i])));
    } catch { se = null; }
  }
  return { beta, yhat, R2: m.R2, RMSE: m.RMSE, dof, se };
}

/** Linear regression y = a + b x */
export function linreg(x, y) {
  const r = ols(x.map((v) => [1, v]), y);
  return { a: r.beta[0], b: r.beta[1], R2: r.R2, se: r.se };
}

/**
 * Kienzle calibration from dynamometer data: kc = Fc/(b·h) ; ln kc = ln kc1.1 − mc·ln h.
 * rows: {h (mm), b (mm), Fc (N)}
 */
export function fitKienzle(rows) {
  const ok = rows.filter((r) => r.h > 0 && r.b > 0 && r.Fc > 0);
  if (ok.length < 2) throw new Error('Need ≥ 2 valid rows with h, b, Fc > 0');
  const r = linreg(ok.map((d) => Math.log(d.h)), ok.map((d) => Math.log(d.Fc / (d.b * d.h))));
  return { kc11: Math.exp(r.a), mc: -r.b, R2: r.R2, n: ok.length, seLnKc11: r.se?.[0], seMc: r.se?.[1] };
}

/** Plain Taylor fit from (V, T): ln V = ln C − n ln T. */
export function fitTaylor(rows) {
  const ok = rows.filter((r) => r.V > 0 && r.T > 0);
  if (ok.length < 2) throw new Error('Need ≥ 2 rows with V, T > 0');
  const r = linreg(ok.map((d) => Math.log(d.T)), ok.map((d) => Math.log(d.V)));
  return { C: Math.exp(r.a), n: -r.b, R2: r.R2, n_obs: ok.length };
}

/** Extended Taylor fit: ln T = (ln C − ln V − m ln(f/f0) − p ln(ap/ap0))/n via OLS on ln T = a0 + a1 lnV + a2 ln f' + a3 ln ap'. */
export function fitExtendedTaylor(rows, f0 = 0.25, ap0 = 2) {
  const ok = rows.filter((r) => r.V > 0 && r.T > 0 && r.f > 0 && r.ap > 0);
  if (ok.length < 4) throw new Error('Need ≥ 4 rows with V, T, f, ap > 0');
  const X = ok.map((d) => [1, Math.log(d.V), Math.log(d.f / f0), Math.log(d.ap / ap0)]);
  const r = ols(X, ok.map((d) => Math.log(d.T)));
  const n = -1 / r.beta[1];
  return { n, C: Math.exp(r.beta[0] * n), m: -r.beta[2] * n, p: -r.beta[3] * n, f0, ap0, R2: r.R2 };
}

/** Least-squares scale calibration of a single multiplicative factor k: minimise Σ(y − k·p)². */
export function fitScale(y, p) {
  let num = 0, den = 0;
  for (let i = 0; i < y.length; i++) { num += y[i] * p[i]; den += p[i] * p[i]; }
  return den > 0 ? num / den : NaN;
}

// ---------------- Design of experiments ----------------

/** Full factorial design. factors: [{name, levels:[...]}] → array of runs {name: value}. */
export function fullFactorial(factors) {
  let runs = [{}];
  for (const f of factors) {
    const next = [];
    for (const r of runs) for (const lv of f.levels) next.push({ ...r, [f.name]: lv });
    runs = next;
  }
  return runs;
}

/** Taguchi orthogonal arrays (standard tables). Level indices 0-based. */
export const TAGUCHI = {
  L4: [[0, 0, 0], [0, 1, 1], [1, 0, 1], [1, 1, 0]],
  L9: [[0, 0, 0, 0], [0, 1, 1, 1], [0, 2, 2, 2], [1, 0, 1, 2], [1, 1, 2, 0], [1, 2, 0, 1], [2, 0, 2, 1], [2, 1, 0, 2], [2, 2, 1, 0]],
};
export function taguchiDesign(factors, array) {
  const A = TAGUCHI[array];
  if (!A) throw new Error('Unknown array');
  if (factors.length > A[0].length) throw new Error(`${array} supports at most ${A[0].length} factors`);
  const lv = array === 'L4' ? 2 : 3;
  for (const f of factors) if (f.levels.length !== lv) throw new Error(`${array} requires ${lv} levels per factor`);
  return A.map((row) => Object.fromEntries(factors.map((f, i) => [f.name, f.levels[row[i]]])));
}

/** Signal-to-noise ratios (Taguchi). */
export function snRatio(values, type) {
  const n = values.length;
  if (type === 'larger') return -10 * Math.log10(values.reduce((s, y) => s + 1 / (y * y), 0) / n);
  if (type === 'nominal') { const m = mean(values); const s2 = values.reduce((s, y) => s + (y - m) ** 2, 0) / Math.max(1, n - 1); return 10 * Math.log10((m * m) / s2); }
  return -10 * Math.log10(values.reduce((s, y) => s + y * y, 0) / n); // smaller-the-better
}

/**
 * Main-effects ANOVA for a balanced design (one response per run, no replication).
 * Residual = total − Σ factor SS. Returns SS, dof, MS, F, % contribution.
 */
export function anovaMainEffects(runs, factors, response) {
  const y = runs.map((r) => r[response]);
  const gm = mean(y);
  const sst = y.reduce((s, v) => s + (v - gm) ** 2, 0);
  const rows = [];
  let ssUsed = 0, dofUsed = 0;
  for (const f of factors) {
    const groups = new Map();
    runs.forEach((r) => { const k = r[f]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r[response]); });
    let ss = 0;
    for (const g of groups.values()) ss += g.length * (mean(g) - gm) ** 2;
    const dof = groups.size - 1;
    rows.push({ factor: f, SS: ss, dof, MS: ss / dof, levels: [...groups.entries()].map(([k, g]) => ({ level: k, mean: mean(g) })) });
    ssUsed += ss; dofUsed += dof;
  }
  const dofE = y.length - 1 - dofUsed;
  const sse = Math.max(0, sst - ssUsed);
  const mse = dofE > 0 ? sse / dofE : NaN;
  rows.forEach((r) => { r.F = dofE > 0 && mse > 0 ? r.MS / mse : NaN; r.contribution = sst > 0 ? (100 * r.SS) / sst : 0; });
  return { rows, error: { SS: sse, dof: dofE, MS: mse, contribution: sst > 0 ? (100 * sse) / sst : 0 }, SST: sst };
}

/** Second-order response-surface fit in k factors (coded or natural units). */
export function fitRSM(X, y) {
  const k = X[0].length;
  const terms = (x) => {
    const t = [1, ...x];
    for (let i = 0; i < k; i++) t.push(x[i] * x[i]);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) t.push(x[i] * x[j]);
    return t;
  };
  const r = ols(X.map(terms), y);
  const names = ['1', ...Array.from({ length: k }, (_, i) => `x${i + 1}`), ...Array.from({ length: k }, (_, i) => `x${i + 1}²`)];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) names.push(`x${i + 1}·x${j + 1}`);
  return { ...r, names, predict: (x) => terms(x).reduce((s, v, i) => s + v * r.beta[i], 0) };
}

/** Pearson correlation. */
export function correlation(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

/** Non-dominated set for minimisation of every objective in `keys`. */
export function paretoFront(points, keys) {
  return points.filter((p, i) => !points.some((q, j) => j !== i && keys.every((k) => q[k] <= p[k]) && keys.some((k) => q[k] < p[k])));
}

/** Seeded PRNG (mulberry32) for reproducible optimisation runs. */
export function rng(seed = 12345) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * Real-coded genetic algorithm (tournament selection, BLX-α crossover, Gaussian mutation, elitism).
 * bounds: [[lo,hi],...]; f(x) → objective to MINIMISE (return Infinity for infeasible).
 */
export function geneticAlgorithm(f, bounds, { pop = 40, gens = 60, seed = 1, pc = 0.9, pm = 0.15, alpha = 0.3 } = {}) {
  const R = rng(seed);
  const d = bounds.length;
  const rand = () => bounds.map(([lo, hi]) => lo + R() * (hi - lo));
  const clip = (x) => x.map((v, i) => Math.min(bounds[i][1], Math.max(bounds[i][0], v)));
  let P = Array.from({ length: pop }, rand).map((x) => ({ x, f: f(x) }));
  const hist = [];
  for (let g = 0; g < gens; g++) {
    P.sort((a, b) => a.f - b.f);
    hist.push(P[0].f);
    const next = P.slice(0, 2);
    const tour = () => { const a = P[Math.floor(R() * pop)], b = P[Math.floor(R() * pop)]; return a.f < b.f ? a : b; };
    while (next.length < pop) {
      const p1 = tour().x, p2 = tour().x;
      let c = p1.slice();
      if (R() < pc) c = p1.map((v, i) => { const lo = Math.min(v, p2[i]), hi = Math.max(v, p2[i]), I = hi - lo; return lo - alpha * I + R() * (I * (1 + 2 * alpha)); });
      c = c.map((v, i) => (R() < pm ? v + (bounds[i][1] - bounds[i][0]) * 0.1 * gauss(R) : v));
      c = clip(c);
      next.push({ x: c, f: f(c) });
    }
    P = next;
  }
  P.sort((a, b) => a.f - b.f);
  return { best: P[0], history: hist };
}
function gauss(R) { let u = 0, v = 0; while (u === 0) u = R(); while (v === 0) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---------------- CSV ----------------

/** RFC-4180-ish CSV parser (handles quotes, commas/semicolons/tabs). Returns {headers, rows(objects)}. */
export function parseCSV(text) {
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const out = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  const lines = out.filter((r) => r.some((c) => c.trim() !== ''));
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows = lines.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => { const v = (r[i] ?? '').trim(); const n = Number(v.replace(',', '.')); return [h, v !== '' && Number.isFinite(n) ? n : v]; })));
  return { headers, rows };
}

export function toCSV(headers, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [headers.map(esc).join(','), ...rows.map((r) => headers.map((h) => esc(Array.isArray(r) ? r[headers.indexOf(h)] : r[h])).join(','))].join('\n');
}

/** Linear interpolation of (xs, ys) at x (xs ascending). */
export function interp(xs, ys, x) {
  if (!xs.length) return NaN;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = xs.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

/**
 * Linear edge-force (mechanistic) calibration (Altintas): F/b = Kc·h + Ke from orthogonal or turning tests.
 * rows: {h, b, F}. Returns cutting coefficient Kc [N/mm²] and edge coefficient Ke [N/mm].
 */
export function fitLinearEdge(rows) {
  const ok = rows.filter((r) => r.h > 0 && r.b > 0 && Number.isFinite(r.F));
  if (ok.length < 2) throw new Error('Need ≥ 2 rows with h, b, F');
  const r = linreg(ok.map((d) => d.h), ok.map((d) => d.F / d.b));
  return { Kc: r.b, Ke: r.a, R2: r.R2, n: ok.length };
}

/** Empirical flank-wear progression VB = VB0 + A·t^B (fit on VB − VB0 > 0), e.g. from microscope series. */
export function fitWearPower(rows, VB0 = 0) {
  const ok = rows.filter((r) => r.t > 0 && r.VB - VB0 > 0);
  if (ok.length < 2) throw new Error('Need ≥ 2 rows with t > 0 and VB > VB0');
  const r = linreg(ok.map((d) => Math.log(d.t)), ok.map((d) => Math.log(d.VB - VB0)));
  return { A: Math.exp(r.a), B: r.b, VB0, R2: r.R2, n: ok.length };
}
