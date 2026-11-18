// Radial drilling machine simulation: inverse kinematics of arm/head + revolution-by-revolution
// drilling with Z-map material removal and geometry-coupled lip engagement.

import { ZMap, verticalToolBottom } from '../geometry/zmap.js';
import { drillForces, tappingTorque, drillDeflection } from '../physics/drilling.js';
import { EdgeWear } from '../physics/wear.js';
import { defaultWearLand } from '../physics/cutting.js';

export const DRILL_OPS = {
  centre: { name: 'Centre drilling', sub: [undefined] },
  drilling: { name: 'Drilling', sub: [undefined] },
  step: { name: 'Step drilling (pilot + main)', sub: [undefined] },
  reaming: { name: 'Reaming', sub: ['reamer'] },
  counterbore: { name: 'Counterboring', sub: ['counterbore'] },
  countersink: { name: 'Countersinking', sub: ['countersink'] },
  tapping: { name: 'Tapping', sub: ['tap'] },
};

/** Radial-drill geometry (mm): column axis position relative to the block origin and arm limits. */
export const RADIAL_DRILL = { col: { x: -350, y: 40 }, armMin: 250, armMax: 1050, heightMin: 300, heightMax: 900, Pmax: 3.0, Nmax: 2000 };

/** Inverse kinematics: arm angle θ (rad) and head radius ρ for a spindle above (x, y). */
export function radialIK(x, y, m = RADIAL_DRILL) {
  const dx = x - m.col.x, dy = y - m.col.y;
  const rho = Math.hypot(dx, dy);
  return { theta: Math.atan2(dy, dx), rho, ok: rho >= m.armMin && rho <= m.armMax };
}

export class DrillSim {
  constructor({ zmap, mat, tool, toolMat, wear, land, machine = RADIAL_DRILL }) {
    Object.assign(this, { zmap, mat, tool, toolMat, machine });
    this.land = land || defaultWearLand(mat);
    // independent wear state for each cutting lip; chisel-edge wear is a user-set condition (no predictive model)
    this.lipWear = Array.isArray(wear) ? wear : [wear || new EdgeWear({ taylor: null }), new EdgeWear({ taylor: wear?.taylor ?? null, VB0: wear?.VB ?? 0 })];
    this.VBchisel = 0;
    this.moves = []; this.mi = 0; this.time = 0;
    this.pos = { x: 0, y: 0, z: zmap.H0 + 30 };
    this.hist = { t: [], depth: [], thrust: [], torque: [], P: [], mrr: [], VB: [], op: [], hole: [] };
    this.events = []; this.removed = 0; this.holes = [];
  }
  load(moves, opName) { this.moves = moves.map((m) => ({ ...m, op: opName })); this.mi = 0; }
  get done() { return this.mi >= this.moves.length; }

  step() {
    if (this.done) return null;
    const m = this.moves[this.mi];
    const d = Math.hypot(m.x - this.pos.x, m.y - this.pos.y, m.z - this.pos.z);
    if (d < 1e-9) { this.mi++; return { kind: 'skip' }; }
    if (m.kind === 'rapid') {
      this.time += (d / 3000) * 60;
      this.pos = { x: m.x, y: m.y, z: m.z }; this.mi++;
      return { kind: 'rapid' };
    }
    const f = m.f, N = m.N;
    const ds = Math.min(f, d), frac = ds / f;
    const np = { x: this.pos.x + ((m.x - this.pos.x) / d) * ds, y: this.pos.y + ((m.y - this.pos.y) / d) * ds, z: this.pos.z + ((m.z - this.pos.z) / d) * ds };
    const dt = (frac * 60) / N;
    const tool = this.tool;
    const zm = this.zmap;
    let res;
    if (tool.subtype === 'tap') {
      // tap: geometry of the thread is not represented in the Z-map (flagged); torque by energy estimate
      const hole = this.holes.find((h) => Math.hypot(h.x - np.x, h.y - np.y) < 0.5);
      const rd = hole ? hole.R : tool.D * 0.425;
      const inMat = !m.reverse && np.z < zm.heightNear(np.x + tool.D / 2 + 1, np.y);
      const tq = inMat ? tappingTorque({ mat: this.mat, tool, rd }) : { torque: 0 };
      res = { cutting: inMat, thrust: 0, torque: tq.torque, power: (tq.torque * 2 * Math.PI * N) / 60000, mrr: 0 };
      if (inMat && hole) hole.threaded = { pitch: tool.pitch, D: tool.D };
    } else {
      const pa = tool.pointAngle ?? 118;
      const cot = pa >= 179.9 ? 0 : 1 / Math.tan((pa / 2) * Math.PI / 180);
      const angles = 8;
      const engaged = (rho, lip, chisel) => {
        const ze = chisel ? np.z : np.z + rho * cot;
        let hit = 0;
        for (let a = 0; a < angles; a++) {
          const ang = (2 * Math.PI * a) / angles + (lip * 2 * Math.PI) / (tool.z || 2);
          const hgt = zm.heightNear(np.x + rho * Math.cos(ang), np.y + rho * Math.sin(ang));
          if (hgt > ze + 1e-6 && ze >= -1e-6) hit++;
        }
        return hit / angles;
      };
      const fr = drillForces({ mat: this.mat, tool, f, N, engaged, VB: this.lipWear.map((w) => w.VB), VBchisel: this.VBchisel, land: this.land });
      const R = tool.D / 2;
      const vol = zm.stamp(verticalToolBottom(tool, np.x, np.y, np.z), np.x - R, np.x + R, np.y - R, np.y + R);
      this.removed += vol;
      res = { cutting: vol > 1e-9 || fr.torque > 0, thrust: fr.thrust, torque: fr.torque, power: fr.power, mrr: (vol / Math.max(dt, 1e-12)) * 60, drill: fr };
      if (res.cutting) {
        const defl = drillDeflection({ F: Math.abs(fr.radialImbalance), D: tool.D, overhang: tool.flute ?? 60 });
        res.deflection = defl;
        res.oversize = 2 * defl;
      }
    }
    this.pos = np; this.time += dt;
    if (d - ds < 1e-9) { this.mi++; if (m.endHole) this._registerHole(m); }
    if (res.cutting) for (const w of this.lipWear) w.advance(dt, { V: (Math.PI * tool.D * N) / 1000, f, ap: tool.D / 2 });
    const VB = Math.max(...this.lipWear.map((w) => w.VB));
    const s = { ...res, t: this.time, x: np.x, y: np.y, z: np.z, depth: zm.H0 - np.z, VB, VBlips: this.lipWear.map((w) => w.VB), op: m.op, N, f };
    const H = this.hist;
    H.t.push(s.t); H.depth.push(s.depth); H.thrust.push(s.thrust || 0); H.torque.push(s.torque || 0); H.P.push(s.power || 0); H.mrr.push(s.mrr || 0); H.VB.push(s.VB); H.op.push(s.op); H.hole.push(m.hole ?? 0);
    this.last = s;
    if (s.cutting) this.lastCut = s;
    if (this.machine && s.power > this.machine.Pmax) this.events.push({ t: this.time, level: 'warning', msg: `Power ${s.power.toFixed(2)} kW exceeds ${this.machine.Pmax} kW` });
    return s;
  }
  _registerHole(m) {
    const ex = this.holes.find((h) => Math.hypot(h.x - m.x, h.y - m.y) < 0.5);
    const R = this.tool.D / 2;
    if (ex) { ex.R = Math.max(ex.R, R); ex.depth = Math.max(ex.depth, this.zmap.H0 - m.z); ex.ops.push(m.op); }
    else this.holes.push({ x: m.x, y: m.y, R, depth: this.zmap.H0 - m.z, ops: [m.op] });
  }
  runAll(max = 5e6) { let n = 0; while (!this.done && n < max) { this.step(); n++; } return n; }
}

/** Plan one hole operation at (x, y): approach, feed to depth (tip), retract. Optional peck. */
export function planHole({ x, y, depth, f, N, peck = 0, H, hole = 0, tool }) {
  const moves = [];
  const zTop = H + 2;
  const zEnd = H - depth;
  const f_ = tool?.subtype === 'tap' ? tool.pitch : f; // taps feed one pitch per revolution
  moves.push({ kind: 'rapid', x, y, z: H + 30 });
  moves.push({ kind: 'rapid', x, y, z: zTop });
  if (peck > 0 && tool?.subtype !== 'tap') {
    let z = H;
    while (z > zEnd + 1e-9) {
      const zn = Math.max(zEnd, z - peck);
      moves.push({ kind: 'feed', x, y, z: zn, f: f_, N, hole, endHole: zn <= zEnd + 1e-9 });
      moves.push({ kind: 'rapid', x, y, z: zTop });
      if (zn > zEnd) moves.push({ kind: 'rapid', x, y, z: zn + 0.5 });
      z = zn;
    }
  } else {
    moves.push({ kind: 'feed', x, y, z: zEnd, f: f_, N, hole, endHole: true });
    if (tool?.subtype === 'tap') moves.push({ kind: 'feed', x, y, z: zTop, f: f_, N, hole, reverse: true }); // spindle reversal, back out
  }
  moves.push({ kind: 'rapid', x, y, z: H + 30 });
  return moves;
}
