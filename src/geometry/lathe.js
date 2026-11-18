// Axisymmetric workpiece for lathe operations: outer radius R(z) and bore radius Ri(z) sampled on
// columns z_i = i·dz (z = 0 at the chuck face, z = L at the free end).
//
// Material removal is exact for the axial section of a rotating workpiece: stamping the tool outline
// once per spindle revolution reproduces the kinematic feed marks (the surface at θ = 0). The removed
// section area per revolution IS the uncut chip area A; Pappus' theorem gives the removed volume.
// Threads are handled by the same stamping (one stamp per revolution at pitch spacing); the renderer
// maps the θ = 0 section helically inside the thread zone.

import { envAt } from './toolshape.js';

export class LatheWorkpiece {
  constructor({ L, D, bore = 0, dz = 0.01 }) {
    this.L = L; this.D0 = D; this.dz = dz;
    this.n = Math.round(L / dz) + 1;
    this.R = new Float64Array(this.n).fill(D / 2);
    this.Ri = new Float64Array(this.n).fill(bore / 2);
    this.version = 0;
    this.partedAt = null;
    this.threads = []; // {z1, z2, pitch}
  }
  clone() {
    const w = new LatheWorkpiece({ L: this.L, D: this.D0, dz: this.dz });
    w.R.set(this.R); w.Ri.set(this.Ri); w.partedAt = this.partedAt; w.threads = this.threads.map((t) => ({ ...t }));
    return w;
  }
  zOf(i) { return i * this.dz; }
  idx(z) { return Math.round(z / this.dz); }
  sample(arr, z) {
    const x = z / this.dz;
    if (x < 0 || x > this.n - 1) return null;
    const k = Math.floor(x), t = x - k;
    return k >= this.n - 1 ? arr[this.n - 1] : arr[k] + t * (arr[k + 1] - arr[k]);
  }
  outerAt(z) { return this.sample(this.R, z); }
  innerAt(z) { return this.sample(this.Ri, z); }
  /** Material volume, mm³ */
  volume() {
    let v = 0;
    for (let i = 0; i < this.n; i++) { const w = i === 0 || i === this.n - 1 ? 0.5 : 1; v += w * Math.PI * Math.max(0, this.R[i] ** 2 - this.Ri[i] ** 2); }
    return v * this.dz;
  }
  /** z of the free end (last column with material) */
  endZ() {
    for (let i = this.n - 1; i >= 0; i--) if (this.R[i] > this.Ri[i] + 1e-9) return this.zOf(i);
    return 0;
  }

  /**
   * Engagement of an outline at reference position (Pz, Pr) moving along unit direction d, against the
   * CURRENT (pre-stamp) material. Leading boundary segments (n·d > 0) lying inside material are engaged.
   * Returns engaged edge length l and the length-weighted mean outward normal.
   */
  engagement(outline, Pz, Pr, d) {
    let l = 0, sz = 0, sr = 0;
    for (const s of outline.segs) {
      if (s.nz * d[0] + s.nr * d[1] <= 1e-6) continue;
      const z = Pz + s.mz, r = Pr + s.mr;
      const Ro = this.outerAt(z);
      if (Ro == null) continue;
      const Rin = this.innerAt(z);
      if (r < Ro - 1e-9 && r > Rin + 1e-9) { l += s.L; sz += s.nz * s.L; sr += s.nr * s.L; }
    }
    const m = Math.hypot(sz, sr);
    return { l, nz: m > 0 ? -sz / m : 0, nr: m > 0 ? -sr / m : 0 }; // (nz, nr): unit thrust direction ON the tool
  }

  /**
   * Stamp an EXTERNAL outline at (Pz, Pr): R(z) = min(R(z), Pr + lo(z − Pz)) (not below the bore).
   * Returns removed section area [mm²], its centroid radius and the affected column range.
   */
  stampExternal(outline, Pz, Pr) {
    const { env } = outline;
    const i0 = Math.max(0, Math.ceil((Pz + outline.zmin) / this.dz)), i1 = Math.min(this.n - 1, Math.floor((Pz + outline.zmax) / this.dz));
    let area = 0, mom = 0;
    for (let i = i0; i <= i1; i++) {
      const lo = envAt(env, env.lo, this.zOf(i) - Pz);
      if (lo == null) continue;
      const rt = Pr + lo;
      const old = this.R[i];
      if (rt < old) {
        const nw = Math.max(rt, this.Ri[i]);
        if (nw < old) {
          area += (old - nw) * this.dz; mom += (old - nw) * ((old + nw) / 2) * this.dz;
          this.R[i] = nw;
        }
      }
    }
    if (area > 0) { this.version++; this._checkPartOff(i0, i1); }
    return { area, rMean: area > 0 ? mom / area : 0, i0, i1 };
  }

  /** Stamp an INTERNAL outline (boring): Ri(z) = max(Ri(z), Pr + hi(z − Pz)) (not beyond the outer radius). */
  stampInternal(outline, Pz, Pr) {
    const { env } = outline;
    const i0 = Math.max(0, Math.ceil((Pz + outline.zmin) / this.dz)), i1 = Math.min(this.n - 1, Math.floor((Pz + outline.zmax) / this.dz));
    let area = 0, mom = 0;
    for (let i = i0; i <= i1; i++) {
      const hi = envAt(env, env.hi, this.zOf(i) - Pz);
      if (hi == null) continue;
      const rt = Pr + hi;
      const old = this.Ri[i];
      if (rt > old && this.R[i] > old) {
        const nw = Math.min(rt, this.R[i]);
        area += (nw - old) * this.dz; mom += (nw - old) * ((old + nw) / 2) * this.dz;
        this.Ri[i] = nw;
      }
    }
    if (area > 0) { this.version++; this._checkPartOff(i0, i1); }
    return { area, rMean: area > 0 ? mom / area : 0, i0, i1 };
  }

  /**
   * Stamp a twist drill with its tip on the axis at z = zt, pointing toward −z (entering from the free end).
   * Drill occupies r ≤ min(Rd, (z − zt)·tan(σ/2)).
   */
  stampDrill(Rd, pointAngle, zt, length = 200) {
    const ts = Math.tan((pointAngle / 2) * Math.PI / 180);
    const i0 = Math.max(0, Math.ceil(zt / this.dz)), i1 = Math.min(this.n - 1, Math.floor((zt + length) / this.dz));
    let area = 0, mom = 0;
    for (let i = i0; i <= i1; i++) {
      const rt = Math.min(Rd, (this.zOf(i) - zt) * ts);
      const old = this.Ri[i];
      if (rt > old && this.R[i] > old) {
        const nw = Math.min(rt, this.R[i]);
        area += (nw - old) * this.dz; mom += (nw - old) * ((old + nw) / 2) * this.dz;
        this.Ri[i] = nw;
      }
    }
    if (area > 0) { this.version++; this._checkPartOff(i0, i1); }
    return { area, rMean: area > 0 ? mom / area : 0, i0, i1 };
  }

  /** If a column has been cut through, everything beyond it (toward the free end) separates. */
  _checkPartOff(i0, i1) {
    for (let i = Math.max(1, i0); i <= i1; i++) {
      if (this.R[i] <= this.Ri[i] + 1e-6 && this.R[i - 1] > this.Ri[i - 1] + 1e-6) {
        // is there material beyond this column?
        let beyond = false;
        for (let k = i + 1; k < this.n; k++) if (this.R[k] > this.Ri[k] + 1e-6) { beyond = true; break; }
        if (beyond) {
          for (let k = i; k < this.n; k++) { this.R[k] = 0; this.Ri[k] = 0; }
          this.partedAt = this.zOf(i);
          return true;
        }
      }
    }
    return false;
  }

  /** Arithmetic mean roughness Ra [µm] and Rt of the outer profile over [z1, z2] (least-squares mean line). */
  roughness(z1, z2) {
    const i0 = Math.max(0, this.idx(Math.min(z1, z2))), i1 = Math.min(this.n - 1, this.idx(Math.max(z1, z2)));
    const n = i1 - i0 + 1;
    if (n < 5) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = i0; i <= i1; i++) { const x = this.zOf(i), y = this.R[i]; sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const b = (n * sxy - sx * sy) / (n * sxx - sx * sx), a = (sy - b * sx) / n;
    let sa = 0, mx = -Infinity, mn = Infinity;
    for (let i = i0; i <= i1; i++) { const e = this.R[i] - (a + b * this.zOf(i)); sa += Math.abs(e); mx = Math.max(mx, e); mn = Math.min(mn, e); }
    return { Ra: (sa / n) * 1000, Rt: (mx - mn) * 1000, meanDiameter: 2 * (a + b * (this.zOf(i0) + this.zOf(i1)) / 2) };
  }

  /** Diameter statistics over [z1, z2] (max of peaks — what a micrometer would read). */
  diameterOver(z1, z2) {
    const i0 = Math.max(0, this.idx(Math.min(z1, z2))), i1 = Math.min(this.n - 1, this.idx(Math.max(z1, z2)));
    let mx = -Infinity, mn = Infinity;
    for (let i = i0; i <= i1; i++) { mx = Math.max(mx, this.R[i]); mn = Math.min(mn, this.R[i]); }
    return { Dmax: 2 * mx, Dmin: 2 * mn };
  }

  /** Simplified outline (z, R) for rendering: drops collinear points within tol (mm). */
  renderProfile(arr = this.R, tol = 0.002) {
    const out = [[0, arr[0]]];
    let last = 0;
    for (let i = 1; i < this.n - 1; i++) {
      // keep i if the chord last→i+1 deviates from any point between by > tol (check only i)
      const z0 = this.zOf(last), r0 = arr[last], z2 = this.zOf(i + 1), r2 = arr[i + 1];
      const t = (this.zOf(i) - z0) / (z2 - z0);
      const rp = r0 + t * (r2 - r0);
      if (Math.abs(arr[i] - rp) > tol || i - last > 400) { out.push([this.zOf(i), arr[i]]); last = i; }
    }
    out.push([this.zOf(this.n - 1), arr[this.n - 1]]);
    return out;
  }

  toJSON() {
    return { L: this.L, D: this.D0, dz: this.dz, R: Array.from(this.R, (v) => +v.toFixed(5)), Ri: Array.from(this.Ri, (v) => +v.toFixed(5)), partedAt: this.partedAt, threads: this.threads };
  }
  static fromJSON(o) {
    const w = new LatheWorkpiece({ L: o.L, D: o.D, dz: o.dz });
    w.R.set(o.R); w.Ri.set(o.Ri); w.partedAt = o.partedAt; w.threads = o.threads || [];
    return w;
  }
}
