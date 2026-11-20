// Lathe V2 dynamics & surface (M-DYN-06, M-SURF-01..02).
//
// Time-domain regenerative turning model (radial structural mode(s), Tlusty-type):
//   m ÿ + c ẏ + k y = F_r(t),   y = tool displacement normal to the machined surface, away from the axis
//   (positive y leaves the surface larger)
//   dynamic chip thickness  h = h0 − n_r·(y(t) − y(t−τ))
//   radial force            F_r = K_th · b · h · n_r     (zero when h ≤ 0: tool leaves the cut — nonlinearity)
// with n_r the radial component of the engaged-edge normal (from the geometric engagement), K_th the thrust
// specific force and τ = 60/N. Linear threshold = Tlusty lobes with Ks = K_th·n_r² (verified in tests).
// Integration: RK4 with the delay held on a uniform grid (dt = τ/n, ≥ 40 steps per natural period).

export function turningTimeDomain({ modes, Kth, nr = 1, b, h0, N, nrev = 40, stepsPerPeriod = 40, mcExp = 0 }) {
  const tau = 60 / N;
  const fmax = Math.max(...modes.map((m) => m.fn));
  const n = Math.max(32, Math.ceil(tau * fmax * stepsPerPeriod));
  const dt = tau / n;
  const total = n * nrev;
  const M = modes.map((m) => ({ w: 2 * Math.PI * m.fn, z: m.zeta, k: m.k / 1000 })); // k in N/mm → displacement in mm
  const ySum = new Float64Array(total + 1); // total displacement history (sum of modes)
  const st = M.map(() => ({ q: 0, v: 0 }));
  const t = [], y = [], F = [], h = [];
  const force = (yNow, yDel) => {
    const hh = h0 - nr * (yNow - yDel);
    if (hh <= 0) return { F: 0, h: hh };
    const hEff = mcExp ? h0 * Math.pow(hh / h0, 1 - mcExp) : hh; // optional Kienzle nonlinearity about h0
    return { F: Kth * b * hEff * nr, h: hh };
  };
  // each mode (q = tool displacement away from the axis): q̈ + 2ζω q̇ + ω² q = ω² F / k
  const deriv = (s, Fv) => s.map((x, i) => ({ dq: x.v, dv: -2 * M[i].z * M[i].w * x.v - M[i].w ** 2 * x.q + (M[i].w ** 2 * Fv) / M[i].k }));
  for (let k = 0; k < total; k++) {
    const yDel = k - n >= 0 ? ySum[k - n] : 0;
    const yDelNext = k + 1 - n >= 0 ? ySum[k + 1 - n] : 0;
    const yDelMid = 0.5 * (yDel + yDelNext);
    const sumq = (s) => s.reduce((a, x) => a + x.q, 0);
    const f1 = force(sumq(st), yDel).F;
    const k1 = deriv(st, f1);
    const s2 = st.map((x, i) => ({ q: x.q + (dt / 2) * k1[i].dq, v: x.v + (dt / 2) * k1[i].dv }));
    const k2 = deriv(s2, force(sumq(s2), yDelMid).F);
    const s3 = st.map((x, i) => ({ q: x.q + (dt / 2) * k2[i].dq, v: x.v + (dt / 2) * k2[i].dv }));
    const k3 = deriv(s3, force(sumq(s3), yDelMid).F);
    const s4 = st.map((x, i) => ({ q: x.q + dt * k3[i].dq, v: x.v + dt * k3[i].dv }));
    const k4 = deriv(s4, force(sumq(s4), yDelNext).F);
    st.forEach((x, i) => { x.q += (dt / 6) * (k1[i].dq + 2 * k2[i].dq + 2 * k3[i].dq + k4[i].dq); x.v += (dt / 6) * (k1[i].dv + 2 * k2[i].dv + 2 * k3[i].dv + k4[i].dv); });
    ySum[k + 1] = sumq(st);
    const fr = force(ySum[k + 1], yDelNext);
    t.push((k + 1) * dt); y.push(ySum[k + 1]); F.push(fr.F); h.push(fr.h); // y positive = away from the axis
  }
  // stability: compare displacement fluctuation (about its mean) in early vs late windows
  const win = (a, b2) => { const s = y.slice(a, b2); const m = s.reduce((p, c) => p + c, 0) / s.length; return Math.sqrt(s.reduce((p, c) => p + (c - m) ** 2, 0) / s.length); };
  const early = win(n * 3, n * 8), late = win(total - n * 5, total);
  const contactLoss = h.slice(total - n * 5).some((x) => x <= 0);
  const growth = late / Math.max(early, 1e-15);
  const stable = !contactLoss && growth < 1;
  // per-revolution samples at θ = 0 (used to imprint the axial surface profile)
  const yRev = Array.from({ length: nrev }, (_, r) => y[Math.min(total - 1, (r + 1) * n - 1)]);
  return { t, y, F, h, dt, n, tau, stable, growth, contactLoss, yRev, ppLate: Math.max(...y.slice(total - n)) - Math.min(...y.slice(total - n)) };
}

/** ISO 4287-style parameters of a profile z(x) (mm): least-squares mean line; Rz = mean of 5 sampling-length (max−min). */
export function roughnessParams(x, z, nSampling = 5) {
  const n = x.length;
  let sx = 0, sz = 0, sxx = 0, sxz = 0;
  for (let i = 0; i < n; i++) { sx += x[i]; sz += z[i]; sxx += x[i] * x[i]; sxz += x[i] * z[i]; }
  const bb = (n * sxz - sx * sz) / (n * sxx - sx * sx || 1), a = (sz - bb * sx) / n;
  const e = z.map((v, i) => v - (a + bb * x[i]));
  const Ra = e.reduce((p, c) => p + Math.abs(c), 0) / n;
  const Rq = Math.sqrt(e.reduce((p, c) => p + c * c, 0) / n);
  const Rt = Math.max(...e) - Math.min(...e);
  const L = Math.floor(n / nSampling);
  let rz = 0; for (let k = 0; k < nSampling; k++) { const seg = e.slice(k * L, (k + 1) * L); rz += Math.max(...seg) - Math.min(...seg); }
  return { Ra: Ra * 1000, Rq: Rq * 1000, Rz: (rz / nSampling) * 1000, Rt: Rt * 1000, residual: e };
}

/**
 * Axial surface profile at θ = 0 from successive tool stamps (nose radius rn, edge angles) offset radially by the
 * per-revolution displacement yRev (mm; positive = larger radius). Feed f per revolution.
 */
export function vibratedProfile({ f, rn, kr = 95, krMinor = 5, yRev, pointsPerFeed = 80 }) {
  const DEGR = Math.PI / 180;
  const g = (x) => { // lower envelope of the tool around its tip (x = axial distance from tip, either side)
    const kap = x >= 0 ? Math.min(Math.max(krMinor, 0.01), 90) : Math.min(kr, 90);
    const ax = Math.abs(x), k = kap * DEGR;
    if (rn > 0 && ax <= rn * Math.sin(k)) return rn - Math.sqrt(Math.max(rn * rn - ax * ax, 0));
    if (kap >= 90) return 1e9;
    return rn * (1 - Math.cos(k)) + (ax - rn * Math.sin(k)) * Math.tan(k);
  };
  const nrev = yRev.length;
  const X = [], Z = [];
  const x0 = f * 2, x1 = f * (nrev - 2);
  const np = Math.round(((x1 - x0) / f) * pointsPerFeed);
  for (let i = 0; i <= np; i++) {
    const x = x0 + ((x1 - x0) * i) / np;
    let zmin = Infinity;
    const kc = Math.round(x / f);
    for (let k = Math.max(0, kc - 6); k <= Math.min(nrev - 1, kc + 6); k++) zmin = Math.min(zmin, g(x - k * f) + yRev[k]);
    X.push(x); Z.push(zmin);
  }
  return { x: X, z: Z, ...roughnessParams(X, Z) };
}
