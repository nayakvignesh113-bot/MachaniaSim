// Lathe V2 tool-condition model (M-WEAR-07..11): flank (VB), nose (VC), notch (VN), crater (KT) wear,
// random edge chipping, and deformation flags, with ISO 3685 tool-life criteria. Every coefficient is
// editable; nothing beyond the textbook Taylor constants is shipped as a default — modes without user
// coefficients are reported as "not predicted".

import { DEG } from '../core/units.js';
import { taylorLife } from './wear.js';
import { rng } from '../research/stats.js';

export const ISO3685_CRITERIA = { VB: 0.3, VBmax: 0.6, VN: 1.0, KT: (f) => 0.06 + 0.3 * f };

export const WEAR_DEFAULTS = {
  flankModel: 'taylor', // 'taylor' (linear Taylor–Miner) | 'power' (calibrated VB = VB0 + A·t^B at the reference condition) | 'usui'
  power: null, // { A, B, Vref, fref, apref } from Research → wear calibration
  usui: null, // { A, B } flank Usui coefficients
  noseRatio: null, // VC rate / VB rate (user); null → VC = VB (stated assumption)
  notchRatio: null, // VN rate / VB rate (user); null → notch not predicted
  crater: null, // { A, B } Usui coefficients for KT (mm/s per (MPa·m/min)), or { n, C } crater Taylor (KT criterion life)
  chipping: null, // { eta (min), beta, size (mm) } Weibull edge-chipping hazard
  seed: 1,
};

export class ToolCondition {
  constructor({ taylor = null, clearance = 6, VB0 = 0, VBc = ISO3685_CRITERIA.VB, cfg = {} } = {}) {
    Object.assign(this, { taylor, clearance, VBc });
    this.cfg = { ...WEAR_DEFAULTS, ...cfg };
    this.VB = VB0; this.VC = VB0; this.VN = 0; this.KT = 0; this.chipped = 0;
    this.cutTime = 0; this.cutDist = 0; this.damage = 0; this.events = []; this.flags = new Set();
    this._rng = rng(this.cfg.seed || 1);
    this.tPower = 0; // equivalent time at the power-law reference condition
  }
  get model() { return this.cfg.flankModel; }
  get VBmax() { return Math.max(this.VB, this.VC, this.VB + this.chipped); }
  /** Nose recession from nose wear (sets the machined diameter): Δr = VC·tanα */
  get radialWear() { return (this.cfg.noseRatio == null ? this.VB : this.VC) * Math.tan(this.clearance * DEG); }
  /** Effective rake increase from a crater of depth KT and width ≈ contact length (geometric estimate). */
  rakeIncrease(contactLength) { return this.KT > 0 && contactLength > 0 ? Math.atan((2 * this.KT) / contactLength) / DEG : 0; }
  canPredict() {
    const c = this.cfg;
    if (c.flankModel === 'power') return !!(c.power && c.power.A > 0);
    if (c.flankModel === 'usui') return !!(c.usui && c.usui.A > 0);
    return !!(this.taylor && this.taylor.C > 0 && this.taylor.n > 0);
  }
  /**
   * Advance by dt [s] of cutting.
   * s: {V m/min, f, ap, Trake °C, Tflank °C, sigmaN MPa (flank land), sigmaRake MPa, Vch m/min, toolTmax °C (hot-hardness limit)}
   */
  advance(dt, s) {
    if (!(dt > 0) || !(s.V > 0)) return;
    const c = this.cfg;
    this.cutTime += dt; this.cutDist += (s.V / 60) * dt;
    let dVB = 0;
    if (c.flankModel === 'power' && c.power?.A > 0) {
      const p = c.power;
      // speed/feed/depth dependence through the Taylor life ratio (equivalent-time Miner rule)
      const ratio = this.taylor ? taylorLife(p.Vref, p.fref, p.apref, this.taylor) / taylorLife(s.V, s.f, s.ap, this.taylor) : 1;
      const t0 = this.tPower / 60, t1 = (this.tPower + dt * (Number.isFinite(ratio) ? ratio : 1)) / 60; // min
      dVB = p.A * (Math.pow(t1, p.B) - Math.pow(Math.max(t0, 0), p.B));
      this.tPower += dt * (Number.isFinite(ratio) ? ratio : 1);
    } else if (c.flankModel === 'usui' && c.usui?.A > 0) {
      const T = (s.Tflank ?? s.Trake ?? 20) + 273.15;
      dVB = (c.usui.A * (s.sigmaN || 0) * s.V * Math.exp(-c.usui.B / T) * dt) / Math.tan(this.clearance * DEG);
    } else if (this.taylor?.C > 0 && this.taylor?.n > 0) {
      const Tl = taylorLife(s.V, s.f, s.ap, this.taylor) * 60;
      if (Tl > 0) { dVB = (this.VBc * dt) / Tl; this.damage += dt / Tl; }
    }
    this.VB += dVB;
    this.VC += c.noseRatio == null ? dVB : c.noseRatio * dVB;
    if (c.notchRatio != null) this.VN += c.notchRatio * dVB;
    // crater
    if (c.crater?.A > 0 && s.Trake != null) {
      this.KT += c.crater.A * (s.sigmaRake || 0) * (s.Vch ?? s.V) * Math.exp(-c.crater.B / (s.Trake + 273.15)) * dt;
    } else if (c.crater?.C > 0 && c.crater?.n > 0) {
      const Tc = taylorLife(s.V, s.f, s.ap, { n: c.crater.n, C: c.crater.C, m: 0, p: 0 }) * 60;
      if (Tc > 0) this.KT += (ISO3685_CRITERIA.KT(s.f) * dt) / Tc;
    }
    // random edge chipping: Weibull hazard h(t) = (β/η)(t/η)^(β−1)
    if (c.chipping?.eta > 0 && c.chipping?.beta > 0) {
      const tm = this.cutTime / 60, eta = c.chipping.eta, beta = c.chipping.beta;
      const H = (t) => Math.pow(t / eta, beta);
      const pEvent = 1 - Math.exp(-(H(tm) - H(Math.max(0, tm - dt / 60))));
      if (this._rng() < pEvent) { this.chipped += c.chipping.size || 0.1; this.events.push({ t: this.cutTime, type: 'chip', size: c.chipping.size || 0.1 }); }
    }
    if (s.toolTmax && s.Trake > s.toolTmax) this.flags.add('Rake temperature above the tool material hot-hardness limit: plastic deformation of the edge likely (not modelled quantitatively).');
  }
  /** First ISO 3685 criterion reached, or null. */
  criterion(f) {
    if (this.VB >= this.VBc - 1e-9) return `VB ≥ ${this.VBc} mm`;
    if (this.VBmax >= ISO3685_CRITERIA.VBmax) return 'VBmax ≥ 0.6 mm';
    if (this.VN >= ISO3685_CRITERIA.VN) return 'VN ≥ 1.0 mm';
    if (this.KT >= ISO3685_CRITERIA.KT(f)) return `KT ≥ 0.06 + 0.3f = ${ISO3685_CRITERIA.KT(f).toFixed(3)} mm`;
    return null;
  }
  remainingLife(V, f, ap) {
    if (!this.taylor?.C) return NaN;
    return Math.max(0, taylorLife(V, f, ap, this.taylor) * (1 - this.VB / this.VBc));
  }
  snapshot() { return { VB: this.VB, VC: this.VC, VN: this.VN, KT: this.KT, chipped: this.chipped, cutTime: this.cutTime, damage: this.damage, tPower: this.tPower }; }
  restore(o) { Object.assign(this, o); }
}
