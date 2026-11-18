// Height-field (Z-map / dexel) workpiece for prismatic parts: material occupies 0 ≤ z ≤ H(x, y).
// Exact for 3-axis vertical tools (drills, end mills, face mills, ball nose) and for horizontal-axis
// cutters whose envelope is a single-valued function of (x, y). Undercuts cannot be represented (stated limitation).

export class ZMap {
  constructor({ W, Dp, H, g = 0.25 }) {
    this.W = W; this.Dp = Dp; this.H0 = H; this.g = g;
    this.nx = Math.round(W / g) + 1; this.ny = Math.round(Dp / g) + 1;
    this.h = new Float32Array(this.nx * this.ny).fill(H);
    this.version = 0;
    this.dirty = null; // {i0,i1,j0,j1}
    this.holesChanged = false;
  }
  x(i) { return i * this.g; }
  y(j) { return j * this.g; }
  get(i, j) { return this.h[j * this.nx + i]; }
  /** Bilinear height at (x, y); −Infinity outside the block. */
  heightAt(x, y) {
    const fx = x / this.g, fy = y / this.g;
    if (fx < 0 || fy < 0 || fx > this.nx - 1 || fy > this.ny - 1) return -Infinity;
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const a = this.get(i, j), b = this.get(i + 1, j), c = this.get(i, j + 1), d = this.get(i + 1, j + 1);
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }
  /** Nearest-cell height (no smoothing across walls) — used for engagement tests. */
  heightNear(x, y) {
    const i = Math.round(x / this.g), j = Math.round(y / this.g);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -Infinity;
    return this.get(i, j);
  }
  /**
   * Lower the surface to a tool envelope: for every cell in the bbox, zt = bottom(x, y) (Infinity where the
   * tool does not cover the cell). Returns removed volume [mm³].
   */
  stamp(bottom, x0, x1, y0, y1) {
    const g = this.g;
    const i0 = Math.max(0, Math.floor(x0 / g)), i1 = Math.min(this.nx - 1, Math.ceil(x1 / g));
    const j0 = Math.max(0, Math.floor(y0 / g)), j1 = Math.min(this.ny - 1, Math.ceil(y1 / g));
    let vol = 0;
    const A = g * g;
    for (let j = j0; j <= j1; j++) {
      const y = j * g;
      for (let i = i0; i <= i1; i++) {
        const zt = bottom(i * g, y);
        if (!(zt < Infinity)) continue;
        const id = j * this.nx + i;
        const old = this.h[id];
        if (zt < old) {
          const nw = Math.max(zt, 0);
          if (nw < old) {
            vol += (old - nw) * A;
            this.h[id] = nw;
            if (nw <= 1e-6) this.holesChanged = true;
          }
        }
      }
    }
    if (vol > 0) {
      this.version++;
      const d = this.dirty;
      this.dirty = d ? { i0: Math.min(d.i0, i0), i1: Math.max(d.i1, i1), j0: Math.min(d.j0, j0), j1: Math.max(d.j1, j1) } : { i0, i1, j0, j1 };
    }
    return vol;
  }
  volume() {
    let v = 0;
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const w = (i === 0 || i === this.nx - 1 ? 0.5 : 1) * (j === 0 || j === this.ny - 1 ? 0.5 : 1);
      v += w * this.h[j * this.nx + i];
    }
    return v * this.g * this.g;
  }
  toJSON() { return { W: this.W, Dp: this.Dp, H: this.H0, g: this.g, h: Array.from(this.h, (v) => +v.toFixed(4)) }; }
  static fromJSON(o) { const z = new ZMap({ W: o.W, Dp: o.Dp, H: o.H, g: o.g }); z.h.set(o.h); return z; }
}

/** Envelope (bottom surface height) of common vertical tools with tip centre at (cx, cy, cz). */
export function verticalToolBottom(tool, cx, cy, cz) {
  const R = tool.D / 2;
  const R2 = R * R;
  if (tool.kind === 'drill') {
    const pa = tool.pointAngle ?? 118;
    const cot = pa >= 179.9 ? 0 : 1 / Math.tan((pa / 2) * Math.PI / 180);
    return (x, y) => { const r2 = (x - cx) ** 2 + (y - cy) ** 2; return r2 <= R2 ? cz + Math.sqrt(r2) * cot : Infinity; };
  }
  if (tool.subtype === 'ball') {
    return (x, y) => { const r2 = (x - cx) ** 2 + (y - cy) ** 2; return r2 <= R2 ? cz + R - Math.sqrt(R2 - r2) : Infinity; };
  }
  if (tool.subtype === 'face' && (tool.kr ?? 90) < 89.9) {
    // lead-angle inserts: floor at radius R, conical flank outside it up to R + ap·cot κr (body above)
    const ck = 1 / Math.tan((tool.kr * Math.PI) / 180);
    const Rmax = R + 15 * ck;
    return (x, y) => { const r = Math.hypot(x - cx, y - cy); if (r <= R) return cz; if (r <= Rmax) return cz + (r - R) / ck; return Infinity; };
  }
  const rc = tool.cornerR || 0;
  return (x, y) => {
    const r2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (r2 > R2) return Infinity;
    if (rc > 0) { const r = Math.sqrt(r2); if (r > R - rc) { const dx = r - (R - rc); return cz + rc - Math.sqrt(Math.max(rc * rc - dx * dx, 0)); } }
    return cz;
  };
}

/** Horizontal-axis cutter (axis ∥ y, centre (cx, ·, cz)), width b from y0: slab / side / angle cutters. */
export function horizontalToolBottom(tool, cx, cz, y0) {
  const R = tool.D / 2;
  const b = tool.width ?? 20;
  if (tool.subtype === 'angle') {
    // single-angle cutter: radius decreases linearly across the width (included angle θ from the face)
    const ta = Math.tan(((tool.angle ?? 45) * Math.PI) / 180);
    return (x, y) => {
      const t = y - y0;
      if (t < 0 || t > b) return Infinity;
      const Rl = R - t * ta;
      if (Rl <= 0) return Infinity;
      const dx = x - cx;
      return Math.abs(dx) <= Rl ? cz - Math.sqrt(Rl * Rl - dx * dx) : Infinity;
    };
  }
  return (x, y) => {
    if (y < y0 || y > y0 + b) return Infinity;
    const dx = x - cx;
    return Math.abs(dx) <= R ? cz - Math.sqrt(R * R - dx * dx) : Infinity;
  };
}
