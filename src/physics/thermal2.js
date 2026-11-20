// Lathe V2 thermal model (M-THERM-04): transient tool conduction on a graded 2-D finite-volume grid
// (Peaceman–Rachford ADI, unconditionally stable) with HEAT-FLUX boundary conditions on the tool–chip contact
// (rake) and on the flank-wear land, and a heat-partition condition that equates the mean interface
// temperature seen from the tool (numerical) and from the moving chip / workpiece (analytical band source).
//
// Chip / workpiece side (moving body under a uniform band flux q over length l, high Péclet number):
//   surface rise at distance x from the leading edge  θ(x) = (2q/k)·√(α x / (π V))      (1-D transient analogue)
//   mean over the band                                   θ̄   = (4q / 3k)·√(α l / (π V)) = q·κ
// Partition: chip receives R·q_f, tool (1−R)·q_f; solved so that T_shear + R·q_f·κ_c = T̄_tool,contact.
// Same for the flank land against the machined surface (workpiece at ambient, sliding speed V).
// Fields are linear in (R, Rw) for a given step, so each update needs exactly three ADI solves.
//
// Assumptions (stated in the UI): constant properties; 2-D section per unit width (heat spreading across the
// width neglected); far faces of the 12 mm section held at ambient (holder as heat sink); chip enters the
// contact at the Boothroyd shear-plane temperature; secondary-zone heat generated at the interface.

export function bandSourceKappa(k, alpha, l_m, V_ms) {
  return (4 / (3 * k)) * Math.sqrt((alpha * l_m) / (Math.PI * Math.max(V_ms, 1e-9)));
}

function gradedFaces(L, d0, g) {
  const f = [0];
  let d = d0;
  while (f[f.length - 1] + d < L) { f.push(f[f.length - 1] + d); d *= g; }
  f.push(L);
  return f;
}

function thomas(a, b, c, d, n, out) {
  // a sub, b diag, c super (length n), solves in place into out
  const cp = new Float64Array(n), dp = new Float64Array(n);
  cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i++) { const m = b[i] - a[i] * cp[i - 1]; cp[i] = c[i] / m; dp[i] = (d[i] - a[i] * dp[i - 1]) / m; }
  out[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i--) out[i] = dp[i] - cp[i] * out[i + 1];
}

export class ToolThermal {
  /**
   * @param o {k, rho, cp (tool), L (mm, section size), d0 (mm, first cell), growth, hConv (W/m²K), T0, far:'ambient'|'adiabatic'}
   */
  constructor(o = {}) {
    Object.assign(this, { k: 50, rho: 14500, cp: 220, L: 12, d0: 0.01, growth: 1.15, hConv: 20, T0: 20, far: 'ambient' }, o);
    this.xf = gradedFaces(this.L / 1000, this.d0 / 1000, this.growth); // metres
    this.yf = this.xf.slice();
    this.nx = this.xf.length - 1; this.ny = this.yf.length - 1;
    this.dx = Float64Array.from({ length: this.nx }, (_, i) => this.xf[i + 1] - this.xf[i]);
    this.dy = Float64Array.from({ length: this.ny }, (_, j) => this.yf[j + 1] - this.yf[j]);
    this.xc = Float64Array.from({ length: this.nx }, (_, i) => (this.xf[i] + this.xf[i + 1]) / 2);
    this.yc = Float64Array.from({ length: this.ny }, (_, j) => (this.yf[j] + this.yf[j + 1]) / 2);
    this.T = new Float64Array(this.nx * this.ny).fill(this.T0);
    this.time = 0; this.R = 0; this.Rw = 0; this.last = null;
    this.energyIn = 0;
  }
  reset() { this.T.fill(this.T0); this.time = 0; this.energyIn = 0; this.last = null; }
  idx(i, j) { return j * this.nx + i; }

  /** Overlap length [m] of [0, len] with the face interval of cell i (faces array f). */
  static overlap(f, i, len) { return Math.max(0, Math.min(f[i + 1], len) - f[i]); }

  /**
   * One ADI step of length dt with prescribed fluxes: qRake [W/m²] over x ∈ [0, lc], qFlank [W/m²] over y ∈ [0, lw].
   * Returns the new field (does not overwrite this.T unless commit).
   */
  _adi(T0f, dt, qRake, lc, qFlank, lw) {
    const { nx, ny, dx, dy, xc, yc, xf, yf, k, rho, cp, hConv, T0 } = this;
    const C = (i, j) => rho * cp * dx[i] * dy[j];
    const farCond = (d) => (this.far === 'ambient' ? (k) / (d / 2) : 0); // conductance per unit area to the far face
    // source terms (W per unit depth) from fluxes and convection constants on free faces
    const src = new Float64Array(nx * ny);
    for (let i = 0; i < nx; i++) { const a = ToolThermal.overlap(xf, i, lc); if (a > 0) src[this.idx(i, 0)] += qRake * a; }
    for (let j = 0; j < ny; j++) { const a = ToolThermal.overlap(yf, j, lw); if (a > 0) src[this.idx(0, j)] += qFlank * a; }
    const hx0 = (j) => hConv * (dy[j] - ToolThermal.overlap(yf, j, lw)); // convective conductance on flank face x=0
    const hy0 = (i) => hConv * (dx[i] - ToolThermal.overlap(xf, i, lc)); // on rake face y=0
    const h2 = dt / 2;
    const Ty = (T, i, j) => { // explicit y-operator value at (i,j)
      let r = 0;
      if (j > 0) r += (k * dx[i] / (yc[j] - yc[j - 1])) * (T[this.idx(i, j - 1)] - T[this.idx(i, j)]); else r += hy0(i) * (T0 - T[this.idx(i, j)]);
      if (j < ny - 1) r += (k * dx[i] / (yc[j + 1] - yc[j])) * (T[this.idx(i, j + 1)] - T[this.idx(i, j)]); else r += farCond(dy[j]) * dx[i] * (T0 - T[this.idx(i, j)]);
      return r;
    };
    const Tx = (T, i, j) => {
      let r = 0;
      if (i > 0) r += (k * dy[j] / (xc[i] - xc[i - 1])) * (T[this.idx(i - 1, j)] - T[this.idx(i, j)]); else r += hx0(j) * (T0 - T[this.idx(i, j)]);
      if (i < nx - 1) r += (k * dy[j] / (xc[i + 1] - xc[i])) * (T[this.idx(i + 1, j)] - T[this.idx(i, j)]); else r += farCond(dx[i]) * dy[j] * (T0 - T[this.idx(i, j)]);
      return r;
    };
    const Ts = new Float64Array(nx * ny), Tn = new Float64Array(nx * ny);
    // half step 1: implicit in x
    let a = new Float64Array(nx), b = new Float64Array(nx), c = new Float64Array(nx), d = new Float64Array(nx), o = new Float64Array(nx);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const Cc = C(i, j) / h2;
        const gW = i > 0 ? k * dy[j] / (xc[i] - xc[i - 1]) : hx0(j);
        const gE = i < nx - 1 ? k * dy[j] / (xc[i + 1] - xc[i]) : farCond(dx[i]) * dy[j];
        a[i] = i > 0 ? -gW : 0; c[i] = i < nx - 1 ? -gE : 0; b[i] = Cc + gW + gE;
        d[i] = Cc * T0f[this.idx(i, j)] + Ty(T0f, i, j) + src[this.idx(i, j)] + (i === 0 ? gW * T0 : 0) + (i === nx - 1 ? gE * T0 : 0);
      }
      thomas(a, b, c, d, nx, o);
      for (let i = 0; i < nx; i++) Ts[this.idx(i, j)] = o[i];
    }
    // half step 2: implicit in y
    a = new Float64Array(ny); b = new Float64Array(ny); c = new Float64Array(ny); d = new Float64Array(ny); o = new Float64Array(ny);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const Cc = C(i, j) / h2;
        const gS = j > 0 ? k * dx[i] / (yc[j] - yc[j - 1]) : hy0(i);
        const gN = j < ny - 1 ? k * dx[i] / (yc[j + 1] - yc[j]) : farCond(dy[j]) * dx[i];
        a[j] = j > 0 ? -gS : 0; c[j] = j < ny - 1 ? -gN : 0; b[j] = Cc + gS + gN;
        d[j] = Cc * Ts[this.idx(i, j)] + Tx(Ts, i, j) + src[this.idx(i, j)] + (j === 0 ? gS * T0 : 0) + (j === ny - 1 ? gN * T0 : 0);
      }
      thomas(a, b, c, d, ny, o);
      for (let j = 0; j < ny; j++) Tn[this.idx(i, j)] = o[j];
    }
    return Tn;
  }

  /** Mean surface temperature over the rake contact [0, lc] and the flank land [0, lw] (cell value + half-cell flux correction). */
  contactMeans(T, qRake, lc, qFlank, lw) {
    let s = 0, w = 0;
    for (let i = 0; i < this.nx; i++) { const a = ToolThermal.overlap(this.xf, i, lc); if (a > 0) { s += a * (T[this.idx(i, 0)] + (qRake * this.dy[0]) / (2 * this.k)); w += a; } }
    let s2 = 0, w2 = 0;
    for (let j = 0; j < this.ny; j++) { const a = ToolThermal.overlap(this.yf, j, lw); if (a > 0) { s2 += a * (T[this.idx(0, j)] + (qFlank * this.dx[0]) / (2 * this.k)); w2 += a; } }
    return { rake: w > 0 ? s / w : null, flank: w2 > 0 ? s2 / w2 : null };
  }

  /** Step with fixed fluxes (W/m²); used for verification. */
  stepFlux(dt, qRake, lc_mm, qFlank = 0, lw_mm = 0) {
    this.T = this._adi(this.T, dt, qRake, lc_mm / 1000, qFlank, lw_mm / 1000);
    this.time += dt; this.energyIn += (qRake * lc_mm / 1000 + qFlank * lw_mm / 1000) * dt;
    return this.T;
  }

  /**
   * Coupled cutting step.
   * @param c {Pf W (rake friction power), lc mm, b mm, Vch m/min, Tshear °C, chip: {k, alpha}, Pw W (flank-land power), VB mm, V m/min, work: {k, alpha}}
   * active=false → idle (cooling only).
   */
  stepCutting(dt, c, active = true) {
    if (!active || !c || !(c.Pf > 0)) { this.T = this._adi(this.T, dt, 0, 0, 0, 0); this.time += dt; this.last = null; return null; }
    // a flank land narrower than 0.02 mm carries negligible heat and cannot be resolved: treated as absent
    const lc = c.lc / 1000, b = c.b / 1000, lw = c.Pw > 0 && c.VB >= 0.02 ? c.VB / 1000 : 0;
    const qf = c.Pf / (lc * b);
    const qw = lw > 0 ? c.Pw / (lw * b) : 0;
    const kc_ = bandSourceKappa(c.chip.k, c.chip.alpha, lc, c.Vch / 60);
    const kw_ = lw > 0 ? bandSourceKappa(c.work.k, c.work.alpha, lw, c.V / 60) : 0;
    // three linear solves: (R, Rw) = (0,0), (1,0), (0,1)
    const F00 = this._adi(this.T, dt, qf, lc, qw, lw);
    const F10 = this._adi(this.T, dt, 0, lc, qw, lw);
    const F01 = lw > 0 ? this._adi(this.T, dt, qf, lc, 0, lw) : F00;
    const m00 = this.contactMeans(F00, qf, lc, qw, lw), m10 = this.contactMeans(F10, 0, lc, qw, lw), m01 = lw > 0 ? this.contactMeans(F01, qf, lc, 0, lw) : m00;
    // tool-side means are affine in (R, Rw): Tt = A + R·(m10 − m00) + Rw·(m01 − m00)
    // chip side: Tshear + R·qf·κc ; work side: T0 + Rw·qw·κw
    const a11 = (m10.rake - m00.rake) - qf * kc_, a12 = lw > 0 ? m01.rake - m00.rake : 0, r1 = c.Tshear - m00.rake;
    let R, Rw;
    if (lw > 0) {
      const a21 = m10.flank - m00.flank, a22 = (m01.flank - m00.flank) - qw * kw_, r2 = this.T0 - m00.flank;
      const det = a11 * a22 - a12 * a21;
      R = (r1 * a22 - a12 * r2) / det; Rw = (a11 * r2 - a21 * r1) / det;
    } else { R = r1 / a11; Rw = 0; }
    // R > 1 (or Rw > 1) is physical: the tool is hotter than the moving body and loses heat to it through the contact.
    R = Math.min(10, Math.max(-10, R)); Rw = Math.min(10, Math.max(-10, Rw));
    const T = new Float64Array(this.T.length);
    for (let n = 0; n < T.length; n++) T[n] = F00[n] + R * (F10[n] - F00[n]) + (lw > 0 ? Rw * (F01[n] - F00[n]) : 0);
    this.T = T; this.time += dt; this.R = R; this.Rw = Rw;
    const m = this.contactMeans(T, (1 - R) * qf, lc, (1 - Rw) * qw, lw);
    this.energyIn += ((1 - R) * qf * lc + (1 - Rw) * qw * lw) * dt; // J per metre of edge width (2-D section)
    this.last = { R, Rw, Trake: m.rake, Tflank: m.flank, TchipSide: c.Tshear + R * qf * kc_, TworkSide: lw > 0 ? this.T0 + Rw * qw * kw_ : null, qf, qw };
    return this.last;
  }
  max() { let m = -Infinity; for (const v of this.T) m = Math.max(m, v); return m; }
  /** Temperature at (x, y) mm by nearest cell. */
  at(xmm, ymm) {
    const x = xmm / 1000, y = ymm / 1000;
    let i = 0; while (i < this.nx - 1 && this.xf[i + 1] < x) i++;
    let j = 0; while (j < this.ny - 1 && this.yf[j + 1] < y) j++;
    return this.T[this.idx(i, j)];
  }
  /** Resample to a uniform grid (for plotting) over [0, W]×[0, H] mm. */
  resample(Wmm, Hmm, n = 60) {
    const out = new Float64Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = this.at(((i + 0.5) / n) * Wmm, ((j + 0.5) / n) * Hmm);
    return out;
  }
  /** Stored heat relative to T0 per unit depth (J/m). */
  storedEnergy() { let e = 0; for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) e += this.rho * this.cp * this.dx[i] * this.dy[j] * (this.T[this.idx(i, j)] - this.T0); return e; }
}
