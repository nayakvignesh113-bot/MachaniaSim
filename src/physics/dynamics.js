// Structural dynamics & chatter (M-DYN-01..05).
// Modal parameters (k, ζ, fn) MUST come from tap testing for real predictions; shipped defaults are ESTIMATES.
// Units: k N/m, fn Hz, b/a mm, forces N, spindle speed rev/min.

const TWO_PI = 2 * Math.PI;

/** Complex helpers */
const C = (re, im = 0) => ({ re, im });
const add = (a, b) => C(a.re + b.re, a.im + b.im);
const mul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const scl = (a, s) => C(a.re * s, a.im * s);
const div = (a, b) => { const d = b.re * b.re + b.im * b.im; return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d); };
const csqrt = (a) => { const r = Math.hypot(a.re, a.im); const re = Math.sqrt((r + a.re) / 2); const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (r - a.re) / 2)); return C(re, im); };
export const complex = { C, add, mul, scl, div, csqrt };

/** SDOF receptance G(ω) = 1 / (k (1 − r² + 2iζr)), r = ω/ωn  [m/N] */
export function frf(mode, f) {
  const r = f / mode.fn;
  const den = C(mode.k * (1 - r * r), mode.k * 2 * mode.zeta * r);
  return div(C(1), den);
}
/** Sum of modes (same direction). */
export function frfMulti(modes, f) {
  return modes.reduce((acc, m) => add(acc, frf(m, f)), C(0));
}

/**
 * Regenerative chatter stability lobes for turning (Tlusty, oriented SDOF):
 *   b_lim = −1 / (2·Ks·Re[G]) for Re[G] < 0 ;  ε = 2π − 2·atan(Re/Im) ;  n = 60·fc / (j + ε/2π)
 * Ks [N/mm²] specific cutting force in the chip-thickness direction; u directional orientation factor.
 */
export function turningLobes({ modes, Ks, u = 1, fmin, fmax, nf = 2000, lobes = 6 }) {
  const out = [];
  for (let j = 0; j < lobes; j++) out.push({ n: [], b: [] });
  let bmin = Infinity;
  for (let i = 0; i <= nf; i++) {
    const fc = fmin + ((fmax - fmin) * i) / nf;
    const G = scl(frfMulti(modes, fc), u);
    if (G.re >= 0) continue;
    const b = -1 / (2 * Ks * 1e6 * G.re) * 1000; // mm (Ks N/mm² → N/m² ; G m/N)
    bmin = Math.min(bmin, b);
    const eps = TWO_PI - 2 * Math.atan(G.re / G.im);
    for (let j = 0; j < lobes; j++) {
      out[j].n.push((60 * fc) / (j + eps / TWO_PI));
      out[j].b.push(b);
    }
  }
  return { lobes: out, bAsymptote: bmin };
}

/** Average directional factors (Altintas & Budak 1995) between φst and φex [rad] for radial ratio Kr. */
export function directionalFactors(st, ex, Kr) {
  const ev = (f) => f(ex) - f(st);
  return {
    axx: 0.5 * ev((p) => Math.cos(2 * p) - 2 * Kr * p + Kr * Math.sin(2 * p)),
    axy: 0.5 * ev((p) => -Math.sin(2 * p) - 2 * p + Kr * Math.cos(2 * p)),
    ayx: 0.5 * ev((p) => -Math.sin(2 * p) + 2 * p + Kr * Math.cos(2 * p)),
    ayy: 0.5 * ev((p) => -Math.cos(2 * p) - 2 * Kr * p - Kr * Math.sin(2 * p)),
  };
}

/**
 * Milling stability lobes — zero-order (average tooth-passing) solution, 2-DOF (x, y) orthogonal modes.
 * Kt [N/mm²] tangential cutting coefficient, Kr ratio, Z teeth.
 */
export function millingLobes({ modesX, modesY, Kt, Kr, Z, st, ex, fmin, fmax, nf = 2000, lobes = 6 }) {
  const { axx, axy, ayx, ayy } = directionalFactors(st, ex, Kr);
  const out = [];
  for (let j = 0; j < lobes; j++) out.push({ n: [], b: [] });
  let amin = Infinity;
  for (let i = 0; i <= nf; i++) {
    const fc = fmin + ((fmax - fmin) * i) / nf;
    const Gxx = frfMulti(modesX, fc), Gyy = frfMulti(modesY, fc);
    const a0 = scl(mul(Gxx, Gyy), axx * ayy - axy * ayx);
    const a1 = add(scl(Gxx, axx), scl(Gyy, ayy));
    // Λ = −(a1 ± √(a1² − 4a0)) / (2a0)
    const disc = csqrt(add(mul(a1, a1), scl(a0, -4)));
    for (const sgn of [1, -1]) {
      const L = div(scl(add(a1, scl(disc, sgn)), -1), scl(a0, 2));
      if (!Number.isFinite(L.re) || !Number.isFinite(L.im)) continue;
      const kappa = L.im / L.re;
      const alim = (-TWO_PI * L.re * (1 + kappa * kappa)) / (Z * Kt * 1e6) * 1000; // mm
      if (!(alim > 0)) continue;
      amin = Math.min(amin, alim);
      const eps = Math.PI - 2 * Math.atan(kappa);
      for (let j = 0; j < lobes; j++) {
        out[j].n.push((60 * fc) / (Z * (j + eps / TWO_PI)));
        out[j].b.push(alim);
      }
    }
  }
  for (const l of out) { const idx = l.n.map((_, i) => i).sort((p, q) => l.n[p] - l.n[q]); l.n = idx.map((i) => l.n[i]); l.b = idx.map((i) => l.b[i]); }
  return { lobes: out, aAsymptote: amin, factors: { axx, axy, ayx, ayy } };
}

/** Lower envelope of lobe curves sampled on a speed grid. */
export function lobeEnvelope(lobes, nGrid, nmin, nmax) {
  const n = [], b = [];
  for (let i = 0; i <= nGrid; i++) {
    const s = nmin + ((nmax - nmin) * i) / nGrid;
    let best = Infinity;
    for (const l of lobes) {
      for (let k = 1; k < l.n.length; k++) {
        const a = l.n[k - 1], c = l.n[k];
        if ((s - a) * (s - c) <= 0 && a !== c) {
          const t = (s - a) / (c - a);
          best = Math.min(best, l.b[k - 1] + t * (l.b[k] - l.b[k - 1]));
        }
      }
    }
    n.push(s); b.push(Number.isFinite(best) ? best : null);
  }
  return { n, b };
}

/** Workpiece radial deflection [mm] under radial force F at axial position z from chuck (cantilever) or between centres. */
export function workpieceDeflection({ F, D, L, z, E = 200, support = 'chuck' }) {
  const I = (Math.PI * D ** 4) / 64; // mm⁴
  const EI = E * 1000 * I; // N·mm²
  if (support === 'centres') {
    const a = z, b = L - z;
    return (F * a * a * b * b) / (3 * EI * L);
  }
  if (support === 'chuck-centre') {
    // propped cantilever (fixed at chuck, simply supported at tailstock), load at a = z
    const a = z, b = L - z;
    return (F * b * b * a ** 3 * (3 * L + b)) / (12 * EI * L ** 3);
  }
  return (F * z ** 3) / (3 * EI);
}

/**
 * Steady-state response of an SDOF mode to a periodic force sampled over one period T [s]:
 * x(t) = Σ G(kΩ)·F̂k e^{ikΩt}. Returns displacement samples [µm].
 */
export function periodicResponse(force, period, modes) {
  const N = force.length;
  const out = new Array(N).fill(0);
  const H = Math.floor(N / 2);
  for (let k = 0; k <= H; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const a = (-TWO_PI * k * n) / N; re += force[n] * Math.cos(a); im += force[n] * Math.sin(a); }
    re /= N; im /= N;
    const G = k === 0 ? C(modes.reduce((s, m) => s + 1 / m.k, 0)) : frfMulti(modes, k / period);
    const X = mul(G, C(re, im));
    const w = k === 0 || (N % 2 === 0 && k === H) ? 1 : 2;
    for (let n = 0; n < N; n++) { const a = (TWO_PI * k * n) / N; out[n] += w * (X.re * Math.cos(a) - X.im * Math.sin(a)); }
  }
  return out.map((x) => x * 1e6);
}

/** Single-sided amplitude spectrum of a uniformly sampled signal. fs sample rate [Hz]. */
export function amplitudeSpectrum(x, fs) {
  const N = x.length, H = Math.floor(N / 2);
  const f = [], A = [];
  for (let k = 0; k <= H; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) { const a = (-TWO_PI * k * n) / N; re += x[n] * Math.cos(a); im += x[n] * Math.sin(a); }
    f.push((k * fs) / N);
    A.push(((k === 0 ? 1 : 2) * Math.hypot(re, im)) / N);
  }
  return { f, A };
}

export const DEFAULT_MODES = {
  lathe: [{ k: 2.0e7, zeta: 0.04, fn: 650, status: 'estimated' }],
  millX: [{ k: 1.2e7, zeta: 0.03, fn: 900, status: 'estimated' }],
  millY: [{ k: 1.2e7, zeta: 0.03, fn: 950, status: 'estimated' }],
};
