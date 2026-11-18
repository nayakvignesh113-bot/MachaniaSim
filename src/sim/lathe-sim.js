// Lathe simulation engine: revolution-by-revolution coupled simulation
//   geometry (stamp tool) → engagement (A, l, thrust direction) → forces → thermal → wear → geometry (nose recession)
// Independent of rendering. Units per src/core/units.js.

import { forcesFromEngagement } from '../physics/turning.js';
import { drillForces } from '../physics/drilling.js';
import { cuttingTemperature, ToolFD, COOLANTS } from '../physics/thermal.js';
import { EdgeWear, assessCondition, ISO3685 } from '../physics/wear.js';
import { defaultWearLand } from '../physics/cutting.js';
import { workpieceDeflection } from '../physics/dynamics.js';

export class LatheSim {
  /**
   * @param o.wp LatheWorkpiece ; o.mat material params ; o.tool tool record ; o.outline tool outline (null for drills)
   * @param o.toolMat tool material record ; o.wear EdgeWear ; o.coolant key ; o.limits ; o.machine {Pmax, Nmax}
   */
  constructor(o) {
    Object.assign(this, o);
    this.land = o.land || defaultWearLand(o.mat);
    this.coolant = o.coolant || 'dry';
    this.T0 = o.T0 ?? 20;
    this.pos = o.startPos ? { ...o.startPos } : { z: o.wp.L + 20, r: o.wp.D0 / 2 + 20 };
    this.moves = []; this.mi = 0;
    this.time = 0;
    this.hist = { t: [], z: [], r: [], Fc: [], Ff: [], Fp: [], F: [], T: [], P: [], mrr: [], h: [], VB: [], Tint: [], Tshear: [], defl: [], op: [] };
    this.last = null;
    this.alerts = [];
    this.events = [];
    this.removed = 0;
    const tp = o.toolMat?.props;
    this.fd = new ToolFD({ W: 4, H: 4, nx: 21, ny: 21, k: tp?.k.value ?? 50, rho: tp?.density.value ?? 14500, cp: tp?.cp.value ?? 220, hConv: (o.coolantH ?? COOLANTS[this.coolant]?.h) ?? 20, T0: this.T0 });
    this.support = o.support || 'chuck';
  }

  load(moves, opName) { this.moves = moves.map((m) => ({ ...m, op: opName })); this.mi = 0; this.opName = opName; }
  get done() { return this.mi >= this.moves.length; }

  /** Advance the simulation. Rapids complete in one call; feed moves advance one spindle revolution. */
  step() {
    if (this.done) return null;
    const m = this.moves[this.mi];
    const dz = m.z - this.pos.z, dr = m.r - this.pos.r;
    const dist = Math.hypot(dz, dr);
    if (dist < 1e-9) { this.mi++; return { kind: 'skip' }; }
    if (m.kind === 'rapid') {
      const tRapid = (dist / 4000) * 60; // 4 m/min rapid traverse (display/time only)
      this.time += tRapid;
      this.pos = { z: m.z, r: m.r };
      this.mi++;
      if (this._engagedAt(this.pos, [dz / dist, dr / dist])) {
        const msg = `Rapid move into material at z=${m.z.toFixed(2)}, r=${m.r.toFixed(2)} (collision)`;
        this.events.push({ t: this.time, level: 'critical', msg });
      }
      return { kind: 'rapid', dt: tRapid };
    }
    const f = m.f, N = m.N;
    const ds = Math.min(f, dist);
    const frac = ds / f; // fraction of a revolution
    // Threading: each revolution re-enters the helical groove cut by the previous pass, so the relative
    // tool motion against existing material is the radial infeed, not the axial (helix) travel.
    const d = m.thread ? [0, -1] : [dz / dist, dr / dist];
    const np = { z: this.pos.z + (dz / dist) * ds, r: this.pos.r + (dr / dist) * ds };
    const dt = (frac * 60) / N;
    const res = m.drill ? this._drillRev(np, m, frac) : this._toolRev(np, d, m, frac);
    this.pos = np;
    this.time += dt;
    if (dist - ds < 1e-9) this.mi++;
    // coupled thermal + wear
    let th = null;
    if (res.cutting) {
      if (!m.drill && res.h > 0) {
        th = cuttingTemperature({ mat: this.mat, Fc: res.Fc0 ?? res.Fc, Fth: res.Fth0 ?? res.Fth, gamma: this.tool.rake ?? 0, V: res.Vm, h: res.h, b: res.l, T0: this.T0 });
      }
      const Tint = th ? th.TinterfaceMean : null;
      this.fd.step(dt, th ? th.contactLength : 0.3, Tint ?? this.T0, !!th);
      this.wear.advance(dt, { V: res.Vm, f, ap: res.ap ?? res.l, Tint, sigmaN: this.land.sigmaW });
    } else {
      this.fd.step(dt, 0, this.T0, false);
    }
    const sample = { ...res, t: this.time, z: np.z, r: np.r, VB: this.wear.VB, Tint: th?.TinterfaceMean ?? null, TrakeMax: th?.TrakeMax ?? null, Tshear: th?.Tshear ?? null, toolTmax: this.fd.max(), thermal: th, op: m.op, N, f };
    // workpiece deflection under the passive force (dimensional error estimate)
    if (res.cutting && !m.drill) {
      const D = 2 * (this.wp.outerAt(np.z) ?? this.wp.D0 / 2);
      sample.defl = workpieceDeflection({ F: Math.abs(res.Fp), D: Math.max(D, 1), L: this.wp.L, z: Math.min(Math.max(np.z, 0), this.wp.L), E: this.mat.E, support: this.support });
    } else sample.defl = 0;
    this._record(sample);
    this.last = sample;
    if (res.cutting) this.lastCut = sample;
    this.alerts = assessCondition({ VB: this.wear.VB, T: sample.Tint, F: res.F, P: res.power }, this.limits || { VB: ISO3685.VB });
    return sample;
  }

  _engagedAt(pos, d) {
    if (!this.outline) return false;
    const e = this.wp.engagement(this.outline, pos.z, pos.r, d);
    return e.l > 0.05;
  }

  _toolRev(np, d, m, frac) {
    const internal = this.outline.internal;
    const rw = this.wear.radialWear;
    const Pr = internal ? np.r - rw : np.r + rw;
    const eng = this.wp.engagement(this.outline, np.z, Pr, d);
    const st = internal ? this.wp.stampInternal(this.outline, np.z, Pr) : this.wp.stampExternal(this.outline, np.z, Pr);
    this.removed += 2 * Math.PI * st.rMean * st.area;
    const A = st.area / frac; // chip area per revolution
    if (!(st.area > 1e-9) || eng.l <= 0) {
      return { cutting: false, Fc: 0, Ff: 0, Fp: 0, F: 0, torque: 0, power: 0, mrr: 0, h: 0, l: 0, Vm: (2 * Math.PI * Math.abs(Pr) * m.N) / 1000 };
    }
    const fr = forcesFromEngagement({ mat: this.mat, tool: this.tool, eng: { A, l: eng.l, nz: eng.nz, nr: eng.nr, rMean: st.rMean }, N: m.N, VB: this.wear.VB, land: this.land });
    if (this.machine && fr.power > this.machine.Pmax) this.events.push({ t: this.time, level: 'warning', msg: `Cutting power ${fr.power.toFixed(2)} kW exceeds machine rating ${this.machine.Pmax} kW` });
    return { cutting: true, ...fr, A, l: eng.l, rMean: st.rMean, ap: A / m.f };
  }

  _drillRev(np, m, frac) {
    const tool = this.tool;
    const zt = np.z; // tip position (on axis)
    const ts = Math.tan(((tool.pointAngle ?? 118) / 2) * Math.PI / 180);
    const wp = this.wp;
    // lip element at radius ρ sits at z = zt + ρ / tan(σ/2): engaged if inside current material
    const engaged = (rho) => { const z = zt + rho / ts; const Ro = wp.outerAt(z); if (Ro == null) return 0; const Ri = wp.innerAt(z); return rho > Ri && rho < Ro ? 1 : 0; };
    const fr = drillForces({ mat: this.mat, tool, f: m.f, N: m.N, engaged, VB: [this.wear.VB, this.wear.VB], land: this.land });
    const st = wp.stampDrill(tool.D / 2, tool.pointAngle ?? 118, zt, tool.flute ?? 100);
    this.removed += 2 * Math.PI * st.rMean * st.area;
    const cutting = st.area > 1e-9;
    if (!cutting) return { cutting: false, Fc: 0, Ff: 0, Fp: 0, F: 0, torque: 0, power: 0, mrr: 0, h: 0, l: 0, Vm: (Math.PI * tool.D * m.N) / 1000 };
    return {
      cutting, Fc: (fr.torque * 1000) / Math.max(st.rMean, 1e-3), Ff: fr.thrust, Fp: 0, F: fr.thrust, torque: fr.torque, power: fr.power,
      mrr: (2 * Math.PI * st.rMean * st.area * m.N) / frac, h: fr.h, l: 0, Vm: (Math.PI * tool.D * m.N) / 1000, thrust: fr.thrust, drill: fr,
    };
  }

  _record(s) {
    const H = this.hist;
    H.t.push(s.t); H.z.push(s.z); H.r.push(s.r); H.Fc.push(s.Fc || 0); H.Ff.push(s.Ff || 0); H.Fp.push(s.Fp || 0); H.F.push(s.F || 0);
    H.T.push(s.torque || 0); H.P.push(s.power || 0); H.mrr.push(s.mrr || 0); H.h.push(s.h || 0); H.VB.push(s.VB); H.Tint.push(s.Tint); H.Tshear.push(s.Tshear); H.defl.push(s.defl || 0); H.op.push(s.op);
    if (H.t.length > 40000) for (const k of Object.keys(H)) H[k] = H[k].filter((_, i) => i % 2 === 0);
  }

  /** Run to completion (headless). Returns number of steps. */
  runAll(maxSteps = 5e6) {
    let n = 0;
    while (!this.done && n < maxSteps) { this.step(); n++; }
    return n;
  }
}

export function newEdgeWear(taylor, tool) {
  return new EdgeWear({ model: 'taylor-miner', taylor, clearance: tool.clearance ?? 6 });
}
