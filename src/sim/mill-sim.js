// Milling simulation: revolution-by-revolution Z-map material removal with geometry-coupled
// tooth engagement (each tooth/edge element is engaged only where material exists before the cut).

import { verticalToolBottom, horizontalToolBottom } from '../geometry/zmap.js';
import { millingForcesAt, cutterElements } from '../physics/milling.js';
import { defaultWearLand } from '../physics/cutting.js';
import { EdgeWear } from '../physics/wear.js';

export const MILL_OPS = {
  face: { name: 'Face milling', vertical: true },
  end: { name: 'End milling (shoulder)', vertical: true },
  slot: { name: 'Slot milling', vertical: true },
  side: { name: 'Side milling (horizontal, side & face cutter)', vertical: false },
  peripheral: { name: 'Peripheral (slab) milling', vertical: false },
  angular: { name: 'Angular milling (edge chamfer)', vertical: false },
  profile: { name: 'Profile milling (rectangular outline)', vertical: true },
  contour: { name: 'Contour milling (circular boss)', vertical: true },
  ball: { name: 'Ball-nose milling (raster)', vertical: true },
  pocket: { name: 'Pocket milling', vertical: true },
};
export const MILL_MACHINE = { Pmax: 5.5, Nmax: 3000 };

export class MillSim {
  constructor({ zmap, mat, tool, toolMat, wear, land, nPhi = 48, runout = null, machine = MILL_MACHINE }) {
    Object.assign(this, { zmap, mat, tool, toolMat, nPhi, machine });
    this.land = land || defaultWearLand(mat);
    this.wear = wear || Array.from({ length: tool.z }, () => new EdgeWear({ taylor: null }));
    this.runout = runout;
    this.moves = []; this.mi = 0; this.time = 0;
    this.pos = { x: -tool.D, y: 0, z: zmap.H0 + 20 };
    this.hist = { t: [], Fx: [], Fy: [], Fz: [], F: [], T: [], P: [], mrr: [], VBmax: [], op: [] };
    this.events = []; this.removed = 0; this.lastCycle = null;
    this.Delta = Math.max(zmap.g * 1.5, 0.3);
  }
  load(moves, opName) { this.moves = moves.map((m) => ({ ...m, op: opName })); this.mi = 0; }
  get done() { return this.mi >= this.moves.length; }

  step() {
    if (this.done) return null;
    const m = this.moves[this.mi];
    const d = Math.hypot(m.x - this.pos.x, m.y - this.pos.y, m.z - this.pos.z);
    if (d < 1e-9) { this.mi++; return { kind: 'skip' }; }
    if (m.kind === 'rapid') { this.time += (d / 4000) * 60; this.pos = { x: m.x, y: m.y, z: m.z }; this.mi++; return { kind: 'rapid' }; }
    const tool = this.tool, Z = tool.z;
    const fRev = m.fz * Z; // feed per revolution
    const ds = Math.min(fRev, d), frac = ds / fRev;
    const u3 = [(m.x - this.pos.x) / d, (m.y - this.pos.y) / d, (m.z - this.pos.z) / d];
    const np = { x: this.pos.x + u3[0] * ds, y: this.pos.y + u3[1] * ds, z: this.pos.z + u3[2] * ds };
    const dt = (frac * 60) / m.N;
    const cyc = this._forces(np, u3, m);
    // remove material swept during this revolution (stamp at the new position)
    const vol = this._stamp(np);
    this.removed += vol;
    this.pos = np; this.time += dt; if (d - ds < 1e-9) this.mi++;
    const cutting = vol > 1e-9 || cyc.engagedFrac > 0;
    if (cutting) {
      const V = (Math.PI * tool.D * m.N) / 1000;
      // each tooth accumulates damage only while engaged (fraction of revolution in cut)
      for (let j = 0; j < Z; j++) if (cyc.toothEngaged[j] > 0) this.wear[j].advance(dt * cyc.toothEngaged[j], { V, f: m.fz, ap: m.ap ?? 1 });
    }
    const VB = this.wear.map((w) => w.VB);
    const s = { cutting, t: this.time, x: np.x, y: np.y, z: np.z, ...cyc.mean, F: cyc.Fpeak, Fmean: Math.hypot(cyc.mean.Fx, cyc.mean.Fy, cyc.mean.Fz), T: cyc.mean.T, P: (cyc.mean.T * 2 * Math.PI * m.N) / 60000, mrr: (vol / Math.max(dt, 1e-12)) * 60, VB, VBmax: Math.max(...VB), op: m.op, N: m.N, fz: m.fz, cycle: cyc };
    const H = this.hist;
    H.t.push(s.t); H.Fx.push(s.Fx); H.Fy.push(s.Fy); H.Fz.push(s.Fz); H.F.push(s.F); H.T.push(s.T); H.P.push(s.P); H.mrr.push(s.mrr); H.VBmax.push(s.VBmax); H.op.push(s.op);
    if (H.t.length > 40000) for (const k of Object.keys(H)) H[k] = H[k].filter((_, i) => i % 2 === 0);
    if (cutting) { this.lastCycle = cyc; this.lastCut = s; }
    if (this.machine && s.P > this.machine.Pmax) this.events.push({ t: this.time, level: 'warning', msg: `Power ${s.P.toFixed(2)} kW exceeds ${this.machine.Pmax} kW` });
    this.last = s;
    return s;
  }

  /** Frame: u = horizontal feed direction; v = in-plane normal (vertical: rot +90°; horizontal: −z). */
  _frame(u3) {
    const tool = this.tool;
    if (tool.horizontal) {
      const ux = Math.sign(u3[0]) || 1;
      const climb = this.climb ? -1 : 1;
      return { u: [ux, 0, 0], v: [0, 0, -1 * climb * ux], horizontal: true };
    }
    let ux = u3[0], uy = u3[1];
    const l = Math.hypot(ux, uy);
    if (l < 1e-9) { ux = 1; uy = 0; } else { ux /= l; uy /= l; }
    // clockwise (top view) rotation with φ from +v toward +u: v = u rotated +90°
    return { u: [ux, uy, 0], v: [-uy, ux, 0], horizontal: false };
  }

  _forces(np, u3, m) {
    const tool = this.tool, zm = this.zmap, Z = tool.z;
    const fr = this._frame(u3);
    const ap = tool.horizontal ? tool.width : Math.max(0.05, Math.min(tool.flute ?? 30, zm.H0 - np.z + 0.01));
    const els = this._els && this._elsAp === ap ? this._els : (this._els = cutterElements(tool.horizontal ? { ...tool, subtype: 'end' } : tool, ap, 16), this._elsAp = ap, this._els);
    const Delta = this.Delta;
    const engagedTest = (phi, el) => {
      const s = Math.sin(phi), c = Math.cos(phi), rr = el.r + Delta;
      if (fr.horizontal) {
        const qx = np.x + rr * (s * fr.u[0]);
        const qz = np.z + rr * (c * fr.v[2]);
        const y = (m.y0 ?? np.y) + el.z;
        return zm.heightNear(qx, y) > qz + 1e-6 ? 1 : 0;
      }
      const qx = np.x + rr * (s * fr.u[0] + c * fr.v[0]);
      const qy = np.y + rr * (s * fr.u[1] + c * fr.v[1]);
      const zq = np.z + el.z;
      return zm.heightNear(qx, qy) > zq + 1e-6 && zq >= 0 ? 1 : 0;
    };
    const o = { mat: this.mat, tool: tool.horizontal ? { ...tool, subtype: 'end' } : tool, fz: m.fz, ap, immersion: { st: 0, ex: Math.PI }, engaged: engagedTest, VB: this.wear.map((w) => w.VB), land: this.land, runout: this.runout };
    const n = this.nPhi;
    let sx = 0, sy = 0, sz = 0, sT = 0, peak = 0, eng = 0;
    const toothEngaged = new Array(Z).fill(0);
    const series = { phi: [], Fx: [], Fy: [], Fz: [], T: [], perTooth: [], hTooth: [] };
    for (let k = 0; k < n; k++) {
      const phi = (2 * Math.PI * k) / n;
      const r = millingForcesAt(phi, o, els);
      // to machine axes
      let Fx, Fy, Fz;
      if (fr.horizontal) { Fx = r.Fx * fr.u[0]; Fz = r.Fy * fr.v[2]; Fy = r.Fz; }
      else { Fx = r.Fx * fr.u[0] + r.Fy * fr.v[0]; Fy = r.Fx * fr.u[1] + r.Fy * fr.v[1]; Fz = r.Fz; }
      sx += Fx; sy += Fy; sz += Fz; sT += r.T; peak = Math.max(peak, Math.hypot(Fx, Fy, Fz));
      if (r.T > 0) eng++;
      r.perTooth.forEach((v, j) => { if (v > 0) toothEngaged[j] += 1 / n; });
      series.phi.push((phi * 180) / Math.PI); series.Fx.push(Fx); series.Fy.push(Fy); series.Fz.push(Fz); series.T.push(r.T); series.perTooth.push(r.perTooth); series.hTooth.push(r.hTooth);
    }
    return { mean: { Fx: sx / n, Fy: sy / n, Fz: sz / n, T: sT / n }, Fpeak: peak, engagedFrac: eng / n, toothEngaged, series, frame: fr };
  }

  _stamp(np) {
    const tool = this.tool, zm = this.zmap;
    const R = tool.D / 2;
    if (tool.horizontal) {
      const y0 = this.moves[Math.min(this.mi, this.moves.length - 1)]?.y0 ?? np.y;
      return zm.stamp(horizontalToolBottom(tool, np.x, np.z, y0), np.x - R, np.x + R, y0, y0 + tool.width);
    }
    const ext = tool.subtype === 'face' && (tool.kr ?? 90) < 89.9 ? 15 / Math.tan((tool.kr * Math.PI) / 180) : 0;
    return zm.stamp(verticalToolBottom(tool, np.x, np.y, np.z), np.x - R - ext, np.x + R + ext, np.y - R - ext, np.y + R + ext);
  }
  runAll(max = 5e6) { let n = 0; while (!this.done && n < max) { this.step(); n++; } return n; }
}

/**
 * Toolpath planner. Block occupies x ∈ [0, W], y ∈ [0, Dp], z ∈ [0, H]. Tool position = tip centre.
 * Vertical cutters: (x, y, z) of tip. Horizontal cutters: (x, z) of axis, y0 = left face of the cutter.
 */
export function planMillOp(op, p, zm, tool) {
  const W = zm.W, Dp = zm.Dp, H = zm.H0;
  const R = tool.D / 2;
  const mv = [];
  const rapid = (x, y, z, extra = {}) => mv.push({ kind: 'rapid', x, y, z, ...extra });
  const feed = (x, y, z, extra = {}) => mv.push({ kind: 'feed', x, y, z, fz: p.fz, N: p.N, ap: p.ap, ...extra });
  const safe = H + 10;
  const levels = (total, step) => { const n = Math.max(1, Math.ceil(total / step - 1e-9)); return Array.from({ length: n }, (_, k) => (total * (k + 1)) / n); };
  const warnings = [];
  switch (op) {
    case 'face': {
      const so = Math.min(p.stepover ?? 0.7 * tool.D, 0.8 * tool.D);
      const nPass = Math.max(1, Math.ceil((Dp + 0.2 * tool.D - 0) / so));
      for (const dep of levels(p.depth, p.ap)) {
        const z = H - dep;
        for (let k = 0; k < nPass; k++) {
          const y = Math.min(Dp + R * 0.2, -R * 0.2 + R + k * so);
          rapid(-R - 5, y, safe); rapid(-R - 5, y, z); feed(W + R + 5, y, z); rapid(W + R + 5, y, safe);
        }
      }
      return { moves: mv, warnings };
    }
    case 'end': case 'slot': {
      const y = op === 'slot' ? p.y : Dp - p.ae + R; // shoulder along the far edge (y = Dp)
      if (op === 'slot' && (p.y - R < 0 || p.y + R > Dp)) warnings.push('Slot extends beyond the block edge.');
      const L1 = p.x1 ?? -R - 5, L2 = p.x2 ?? W + R + 5;
      for (const dep of levels(p.depth, p.ap)) {
        const z = H - dep;
        rapid(L1, y, safe); rapid(L1, y, z); feed(L2, y, z); rapid(L2, y, safe);
      }
      return { moves: mv, warnings };
    }
    case 'profile': {
      // climb-mill around the outside of a rectangle offset inward by `ae` from the block edges
      const off = R - p.ae;
      for (const dep of levels(p.depth, p.ap)) {
        const z = H - dep;
        const pts = [[-off, -off - R - 3], [-off, Dp + off], [W + off, Dp + off], [W + off, -off], [-off, -off]];
        rapid(pts[0][0], pts[0][1], safe); rapid(pts[0][0], pts[0][1], z);
        for (let k = 1; k < pts.length; k++) feed(pts[k][0], pts[k][1], z);
        rapid(-off, -off, safe);
      }
      return { moves: mv, warnings };
    }
    case 'contour': {
      // circular boss of diameter Db at the block centre: tool travels on circle radius Db/2 + R (climb)
      const cx = W / 2, cy = Dp / 2, rc = p.Db / 2 + R;
      const n = 180;
      for (const dep of levels(p.depth, p.ap)) {
        const z = H - dep;
        rapid(cx + rc + R + 3, cy, safe); rapid(cx + rc + R + 3, cy, z); feed(cx + rc, cy, z);
        for (let k = 1; k <= n; k++) { const a = (-2 * Math.PI * k) / n; feed(cx + rc * Math.cos(a), cy + rc * Math.sin(a), z); }
        rapid(cx + rc, cy, safe);
      }
      // the boss is surrounded by stock: clear the outside first is the user's choice (profile op)
      return { moves: mv, warnings };
    }
    case 'ball': {
      const so = p.stepover ?? 0.5;
      const z = H - p.depth;
      let dir = 1;
      for (let y = p.y1 ?? 10; y <= (p.y2 ?? Dp - 10) + 1e-9; y += so) {
        const xa = dir > 0 ? p.x1 ?? 10 : p.x2 ?? W - 10, xb = dir > 0 ? p.x2 ?? W - 10 : p.x1 ?? 10;
        if (!mv.length) { rapid(xa, y, safe); rapid(xa, y, z + 1); feed(xa, y, z); }
        else feed(xa, y, z);
        feed(xb, y, z); dir = -dir;
      }
      rapid(mv[mv.length - 1].x, mv[mv.length - 1].y, safe);
      return { moves: mv, warnings };
    }
    case 'pocket': {
      const x1 = p.cx - p.Lx / 2 + R, x2 = p.cx + p.Lx / 2 - R, y1 = p.cy - p.Ly / 2 + R, y2 = p.cy + p.Ly / 2 - R;
      if (x2 < x1 || y2 < y1) { warnings.push('Pocket smaller than cutter.'); return { moves: mv, warnings }; }
      const so = Math.min(p.stepover ?? 0.6 * tool.D, 0.9 * tool.D);
      for (const dep of levels(p.depth, p.ap)) {
        const z = H - dep;
        rapid(x1, y1, safe); rapid(x1, y1, z + 0.5);
        feed(x1, y1, z, { ramp: true }); // plunge (end-cutting edge); flagged
        let dir = 1;
        for (let y = y1; y <= y2 + 1e-9; y += so) { feed(dir > 0 ? x2 : x1, y, z); const yn = Math.min(y + so, y2); if (y < y2 - 1e-9) feed(dir > 0 ? x2 : x1, yn, z); dir = -dir; }
        // finishing contour
        feed(x1, y2, z); feed(x1, y1, z); feed(x2, y1, z); feed(x2, y2, z); feed(x1, y2, z);
        rapid(x1, y2, safe);
      }
      warnings.push('Pocket entry is a straight plunge: centre-cutting end mill assumed; plunge forces use the side-edge model only (limitation).');
      return { moves: mv, warnings };
    }
    case 'peripheral': case 'side': case 'angular': {
      if (!tool.horizontal) { warnings.push('Select a horizontal-arbor cutter for this operation.'); return { moves: mv, warnings }; }
      const y0 = op === 'peripheral' ? p.y0 ?? (Dp - tool.width) / 2 : op === 'angular' ? Dp - tool.width : p.y0 ?? Dp - tool.width;
      const zAxis = (dep) => H - dep + R; // axis height so the lowest point is at H − dep
      for (const dep of levels(p.depth, p.ap)) {
        rapid(-R - 5, 0, zAxis(dep) + 20, { y0 }); rapid(-R - 5, 0, zAxis(dep), { y0 });
        feed(W + R + 5, 0, zAxis(dep), { y0 });
        rapid(W + R + 5, 0, zAxis(dep) + 20, { y0 });
      }
      return { moves: mv, warnings };
    }
    default: throw new Error(`Unknown milling op ${op}`);
  }
}
