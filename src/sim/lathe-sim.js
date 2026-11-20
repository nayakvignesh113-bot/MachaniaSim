// Lathe simulation engine: revolution-by-revolution coupled simulation
//   geometry (stamp tool) → engagement (A, l, thrust direction) → forces → thermal → wear → geometry (nose recession)
// Independent of rendering. Units per src/core/units.js.

import { forcesFromEngagement } from '../physics/turning.js';
import { drillForces } from '../physics/drilling.js';
import { cuttingTemperature, COOLANTS } from '../physics/thermal.js';
import { ToolThermal } from '../physics/thermal2.js';
import { assessCondition, ISO3685 } from '../physics/wear.js';
import { ToolCondition } from '../physics/wear2.js';
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
    this.hist = { t: [], z: [], r: [], Fc: [], Ff: [], Fp: [], F: [], T: [], P: [], mrr: [], h: [], VB: [], Tint: [], Tshear: [], defl: [], op: [], Trake: [], Ttool: [], R: [], KT: [], VC: [], VN: [], Ksoft: [] };
    // V2 options: thermal softening of kc, shear-angle relation, edge-force coefficients, deflection feedback
    this.opts = { softening: false, shearModel: 'merchant', edge: null, deflection: false, kTool: 2e4, ...(o.opts || {}) };
    this._FpPrev = 0; this._lcPrev = 0.3;
    this.last = null;
    this.alerts = [];
    this.events = [];
    this.removed = 0;
    this.resetThermal();
    this.support = o.support || 'chuck';
  }

  /** (Re)create the tool thermal model for the current tool material and coolant. */
  resetThermal() {
    const tp = this.toolMat?.props;
    this.thermal = new ToolThermal({ k: tp?.k.value ?? 50, rho: tp?.density.value ?? 14500, cp: tp?.cp.value ?? 220, hConv: (this.coolantH ?? COOLANTS[this.coolant]?.h) ?? 20, T0: this.T0 });
    this.fd = this.thermal; // backward-compatible alias
  }

  /** Radial compliance [mm/N] at axial position z: workpiece beam + tool-side structure. */
  compliance(z) {
    const wp = this.wp, zz = Math.min(Math.max(z, 0), wp.L);
    if (!this.mat.E) return 1 / (this.opts.kTool || Infinity);
    const E = this.mat.E * 1000; // N/mm²
    let cw;
    if (this.support === 'chuck') {
      // stepped cantilever, unit load at z (unit-load method): δ = ∫0^z (z − s)² / (E·I(s)) ds, I = π(R⁴ − Ri⁴)/4
      const n = 200; cw = 0;
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * zz;
        const R = wp.outerAt(s) ?? 0, Ri = wp.innerAt(s) ?? 0;
        const I = (Math.PI * (R ** 4 - Ri ** 4)) / 4;
        if (I > 0) cw += ((zz - s) ** 2 / (E * I)) * (zz / n);
      }
    } else {
      // centres / chuck + centre: closed-form uniform beam with the length-averaged equivalent diameter (approximation)
      let s4 = 0; const n = 100; for (let k = 0; k < n; k++) { const R = wp.outerAt(((k + 0.5) / n) * wp.L) ?? 0, Ri = wp.innerAt(((k + 0.5) / n) * wp.L) ?? 0; s4 += Math.max(R ** 4 - Ri ** 4, 1e-6); }
      const Deq = 2 * Math.pow(s4 / n, 0.25);
      cw = workpieceDeflection({ F: 1, D: Deq, L: wp.L, z: zz, E: this.mat.E, support: this.support });
    }
    return cw + 1 / (this.opts.kTool || Infinity);
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
    let th = null, tc = null;
    if (res.cutting) {
      if (!m.drill && res.h > 0) {
        th = cuttingTemperature({ mat: this.mat, Fc: res.Fc0 ?? res.Fc, Fth: res.Fth0 ?? res.Fth, gamma: res.rakeEff ?? this.tool.rake ?? 0, V: res.Vm, h: res.h, b: res.l, T0: this.T0, shearModel: this.opts.shearModel });
      }
      if (th) {
        const alpha = this.mat.k / (this.mat.density * this.mat.cp);
        tc = this.thermal.stepCutting(dt, { Pf: th.Pf, lc: th.contactLength, b: res.l, Vch: th.Vch, Tshear: th.Tshear, chip: { k: this.mat.k, alpha }, Pw: ((res.dFcWear || 0) * res.Vm) / 60, VB: this.wear.VB, V: res.Vm, work: { k: this.mat.k, alpha } }, true);
        this._lcPrev = th.contactLength;
      } else this.thermal.stepCutting(dt, null, false);
      const sigmaRake = th ? th.N / Math.max(th.contactLength * res.l, 1e-6) : 0;
      this.wear.advance(dt, { V: res.Vm, f, ap: res.ap ?? res.l, Trake: tc?.Trake, Tflank: tc?.Tflank, Tint: tc?.Trake, sigmaN: this.land.sigmaW, sigmaRake, Vch: th?.Vch, toolTmax: this.toolMat?.props?.Tmax?.value });
    } else {
      this.thermal.stepCutting(dt, null, false);
    }
    const W = this.wear;
    const sample = { ...res, t: this.time, z: np.z, r: np.r, VB: W.VB, VC: W.VC, VN: W.VN, KT: W.KT, Tint: tc?.Trake ?? null, Trake: tc?.Trake ?? null, R: tc?.R ?? null, TrakeBoothroyd: th?.TrakeMax ?? null, TrakeMax: th?.TrakeMax ?? null, Tshear: th?.Tshear ?? null, toolTmax: this.thermal.max(), thermal: th ? { ...th, conj: tc } : null, op: m.op, N, f };
    // workpiece deflection under the passive force (dimensional error estimate)
    if (res.cutting && !m.drill) {
      // the structure responds to the revolution-averaged force; an exponential moving average suppresses
      // rev-to-rev numerical scatter of the engagement-based thrust direction
      this._FpPrev = this._FpPrev ? 0.7 * this._FpPrev + 0.3 * res.Fp : res.Fp;
      sample.defl = Math.abs(this._FpPrev) * this.compliance(np.z);
    } else { sample.defl = 0; this._FpPrev = 0; }
    this._record(sample);
    this.last = sample;
    if (res.cutting) this.lastCut = sample;
    this.alerts = assessCondition({ VB: W.VB, VBmax: W.VBmax, KT: W.KT, T: sample.Trake, F: res.F, P: res.power }, this.limits || { VB: ISO3685.VB });
    const crit = W.criterion?.(f);
    if (crit && !this._critFlag) { this._critFlag = crit; this.events.push({ t: this.time, level: 'critical', msg: `Tool-life criterion reached (ISO 3685): ${crit}` }); }
    for (const fl of W.flags || []) if (!this.events.some((e) => e.msg === fl)) this.events.push({ t: this.time, level: 'warning', msg: fl });
    for (const ev of (W.events || []).splice(0)) this.events.push({ t: this.time, level: 'warning', msg: `Edge chipping event (${ev.size} mm) — random Weibull model` });
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
    // static deflection feedback (explicit, previous revolution's passive force): the tool cuts at a larger radius
    const dfl = this.opts.deflection ? Math.abs(this._FpPrev) * this.compliance(np.z) : 0;
    const Pr = internal ? np.r - rw - dfl : np.r + rw + dfl;
    const eng = this.wp.engagement(this.outline, np.z, Pr, d);
    const st = internal ? this.wp.stampInternal(this.outline, np.z, Pr) : this.wp.stampExternal(this.outline, np.z, Pr);
    this.removed += 2 * Math.PI * st.rMean * st.area;
    const A = st.area / frac; // chip area per revolution
    if (!(st.area > 1e-9) || eng.l <= 0) {
      return { cutting: false, Fc: 0, Ff: 0, Fp: 0, F: 0, torque: 0, power: 0, mrr: 0, h: 0, l: 0, Vm: (2 * Math.PI * Math.abs(Pr) * m.N) / 1000 };
    }
    const rakeEff = (this.tool.rake ?? 0) + (this.wear.rakeIncrease ? this.wear.rakeIncrease(this._lcPrev) : 0);
    const fr = forcesFromEngagement({ mat: this.mat, tool: { ...this.tool, rake: rakeEff }, eng: { A, l: eng.l, nz: eng.nz, nr: eng.nr, rMean: st.rMean }, N: m.N, VB: this.wear.VB, land: this.land, opts: { softening: this.opts.softening, shearModel: this.opts.shearModel, edge: this.opts.edge } });
    fr.rakeEff = rakeEff;
    if (this.machine && fr.power > this.machine.Pmax) this.events.push({ t: this.time, level: 'warning', msg: `Cutting power ${fr.power.toFixed(2)} kW exceeds machine rating ${this.machine.Pmax} kW` });
    return { cutting: true, ...fr, A, l: eng.l, nz: eng.nz, nr: eng.nr, rMean: st.rMean, ap: A / m.f };
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
    H.Trake.push(s.Trake); H.Ttool.push(s.toolTmax); (H.Tprobe ||= []).push(this.opts.probe ? this.thermal.at(this.opts.probe.x, this.opts.probe.y) : null); (H.cutT ||= []).push(this.wear.cutTime); H.R.push(s.R); H.KT.push(s.KT || 0); H.VC.push(s.VC || 0); H.VN.push(s.VN || 0); H.Ksoft.push(s.Ksoft ?? 1);
    if (H.t.length > 40000) for (const k of Object.keys(H)) H[k] = H[k].filter((_, i) => i % 2 === 0);
  }

  /** Run to completion (headless). Returns number of steps. */
  runAll(maxSteps = 5e6) {
    let n = 0;
    while (!this.done && n < maxSteps) { this.step(); n++; }
    return n;
  }
}

export function newEdgeWear(taylor, tool, cfg = {}) {
  return new ToolCondition({ taylor, clearance: tool.clearance ?? 6, cfg });
}
