// Tool wear and tool life (M-WEAR-01..06).
// No wear equation here is universally applicable; every coefficient is editable and carries a status.

import { DEG } from '../core/units.js';

/** ISO 3685 tool-life criteria (turning): VB_B = 0.3 mm average, VB_Bmax = 0.6 mm, KT = 0.06 + 0.3f mm */
export const ISO3685 = { VB: 0.3, VBmax: 0.6, KT: (f) => 0.06 + 0.3 * f };

/**
 * Extended Taylor tool life [min]:  V·T^n·(f/f0)^m·(ap/ap0)^p = C
 * Plain Taylor when m = p = 0.
 */
export function taylorLife(V, f, ap, t) {
  if (!t || !(t.n > 0) || !(t.C > 0) || !(V > 0)) return NaN;
  const ff = t.m ? Math.pow(f / (t.f0 || 1), t.m) : 1;
  const aa = t.p ? Math.pow(ap / (t.ap0 || 1), t.p) : 1;
  return Math.pow(t.C / (V * ff * aa), 1 / t.n);
}
/** Cutting speed for a target tool life T [min]. */
export function taylorSpeed(T, f, ap, t) {
  const ff = t.m ? Math.pow(f / (t.f0 || 1), t.m) : 1;
  const aa = t.p ? Math.pow(ap / (t.ap0 || 1), t.p) : 1;
  return t.C / (Math.pow(T, t.n) * ff * aa);
}

/**
 * Wear-state integrator for one cutting edge.
 * model 'taylor-miner': VB grows at the Taylor-equivalent rate dVB/dt = (VBc − VB0)/T(V,f,ap) (Palmgren–Miner
 *   linear damage; reproduces Taylor life at constant conditions; captures variable-speed history, e.g. facing).
 * model 'usui': dW/dt = A·σn·vs·exp(−B/Tabs) (radial wear depth W, mm/s), VB = W / tan α.
 *   A [mm²/N … user units], B [K] must be calibrated — no defaults are shipped.
 */
export class EdgeWear {
  constructor({ model = 'taylor-miner', taylor = null, usui = null, VBc = ISO3685.VB, VB0 = 0, clearance = 6, crater = null }) {
    Object.assign(this, { model, taylor, usui, VBc, clearance });
    this.VB = VB0;
    this.KT = 0;
    this.damage = 0; // Miner sum (fraction of Taylor life consumed)
    this.cutTime = 0; // s
    this.cutDist = 0; // m
    this.crater = crater; // { A, B } Usui coefficients for crater depth (optional)
    this.history = [];
  }
  get radialWear() { return this.VB * Math.tan(this.clearance * DEG); } // tool-nose recession, mm
  canPredict() {
    if (this.model === 'usui') return !!(this.usui && this.usui.A > 0 && this.usui.B > 0);
    return !!(this.taylor && this.taylor.C > 0 && this.taylor.n > 0);
  }
  /**
   * Advance by dt [s] of cutting.
   * @param s {V m/min, f, ap, Tint °C (interface), sigmaN MPa (flank normal stress), vs m/min (sliding)}
   */
  advance(dt, s) {
    if (!(dt > 0) || !(s.V > 0)) return;
    this.cutTime += dt;
    this.cutDist += (s.V / 60) * dt;
    if (this.model === 'usui') {
      if (!this.canPredict()) return;
      const Tabs = (s.Tint ?? 20) + 273.15;
      const dW = this.usui.A * (s.sigmaN || 0) * (s.vs ?? s.V) * Math.exp(-this.usui.B / Tabs) * dt;
      this.VB += dW / Math.tan(this.clearance * DEG);
    } else {
      if (!this.canPredict()) return;
      const Tl = taylorLife(s.V, s.f, s.ap, this.taylor) * 60; // s
      if (!(Tl > 0)) return;
      this.damage += dt / Tl;
      this.VB += (this.VBc * dt) / Tl;
    }
    if (this.crater && this.crater.A > 0 && s.TrakeMax) {
      const Tabs = s.TrakeMax + 273.15;
      this.KT += this.crater.A * (s.sigmaRake || 0) * (s.Vch ?? s.V) * Math.exp(-this.crater.B / Tabs) * dt;
    }
  }
  /** Remaining life [min] at current conditions (Taylor-Miner only). */
  remainingLife(V, f, ap) {
    if (this.model !== 'taylor-miner' || !this.canPredict()) return NaN;
    const T = taylorLife(V, f, ap, this.taylor);
    return Math.max(0, T * (1 - this.VB / this.VBc));
  }
}

/** Archard wear volume  Vw = K·Fn·L / H   (K dimensionless, Fn N, L mm, H N/mm²) → mm³ */
export function archardVolume(K, Fn, L, H) {
  return (K * Fn * L) / H;
}

/** Weibull reliability for random edge fracture: R(t) = exp(−(t/η)^β). η, β must come from user data. */
export function weibullReliability(t, eta, beta) {
  if (!(eta > 0) || !(beta > 0)) return NaN;
  return Math.exp(-Math.pow(t / eta, beta));
}

/** Tool condition assessment against user-defined limits. Returns alerts sorted by severity. */
export function assessCondition(state, limits) {
  const alerts = [];
  const chk = (val, lim, name, unit) => {
    if (lim == null || !Number.isFinite(val)) return;
    if (val >= lim) alerts.push({ level: 'critical', msg: `${name} ${val.toFixed(3)} ${unit} ≥ limit ${lim} ${unit}` });
    else if (val >= 0.8 * lim) alerts.push({ level: 'warning', msg: `${name} ${val.toFixed(3)} ${unit} is ≥ 80 % of limit ${lim} ${unit}` });
  };
  chk(state.VB, limits.VB, 'Flank wear VB', 'mm');
  chk(state.VBmax, limits.VBmax, 'VBmax', 'mm');
  chk(state.KT, limits.KT, 'Crater depth KT', 'mm');
  chk(state.T, limits.T, 'Interface temperature', '°C');
  chk(state.F, limits.F, 'Resultant force', 'N');
  chk(state.P, limits.P, 'Cutting power', 'kW');
  return alerts.sort((a, b) => (a.level === 'critical' ? -1 : 1) - (b.level === 'critical' ? -1 : 1));
}
