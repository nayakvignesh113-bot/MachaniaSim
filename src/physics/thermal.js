// Thermal models (M-THERM-01..04).
// 1) Analytical cutting temperatures (Boothroyd/Weiner shear-plane partition + Boothroyd secondary-zone
//    maximum rake temperature). Reduced-order; no coolant effect in this level.
// 2) 2-D explicit finite-difference transient conduction in the tool cross-section with a prescribed
//    tool–chip interface temperature (Dirichlet) on the contact strip and convection elsewhere.
//    This is a reduced-order tool-field model, NOT a coupled chip–tool–workpiece solution.
// 3) Grinding: Jaeger high-Péclet moving band source (θmax = 1.13·ε·q·√(α·lc/vw)/k).

import { merchantAnalysis } from './cutting.js';

/** Boothroyd fraction of shear-plane heat conducted into the workpiece. RT = ρ c V h / k (thermal number). */
export function boothroydGamma(RT, phiRad) {
  const x = RT * Math.tan(phiRad);
  if (x <= 0) return 0.5;
  const g = x <= 10 ? 0.5 - 0.35 * Math.log10(x) : 0.3 - 0.15 * Math.log10(x);
  return Math.min(0.9, Math.max(0.02, g));
}

/** Coolant convection coefficients [W/m²K] — ORDER-OF-MAGNITUDE ESTIMATES, user editable. */
export const COOLANTS = {
  dry: { name: 'Dry (still air)', h: 20, status: 'estimated' },
  mql: { name: 'Minimum quantity lubrication', h: 250, status: 'estimated' },
  wet: { name: 'Wet (spray / mist)', h: 1500, status: 'estimated' },
  flood: { name: 'Flood coolant', h: 5000, status: 'estimated' },
};

/**
 * Analytical cutting temperatures.
 * @param mat {density, cp, k} ; @param Fc, Fth N ; gamma deg ; V m/min ; h, b mm ; T0 °C
 * @param contactFactor tool–chip contact length l = contactFactor × chip thickness (ESTIMATED, default 2)
 */
export function cuttingTemperature({ mat, Fc, Fth, gamma, V, h, b, T0 = 20, contactFactor = 2, shearModel = 'merchant' }) {
  if (!(Fc > 0) || !(h > 0) || !(b > 0) || !(V > 0)) return null;
  const m = merchantAnalysis({ Fc, Fth, gamma, V, h, b, shearModel });
  const rho = mat.density, c = mat.cp, k = mat.k;
  const v = V / 60; // m/s
  const hm = h / 1000, bm = b / 1000;
  const RT = (rho * c * v * hm) / k;
  const phi = (m.phi * Math.PI) / 180;
  const G = boothroydGamma(RT, phi);
  const mdotc = rho * c * v * hm * bm; // W/K  (heat capacity flow of the chip)
  const dTs = ((1 - G) * m.Ps) / mdotc;
  const dTf = m.Pf / mdotc; // mean chip temperature rise from secondary zone
  const l0 = contactFactor; // l/hc
  const dTm = 1.13 * Math.sqrt(RT / l0) * dTf; // Boothroyd max rake-face rise
  const TrakeMax = T0 + dTs + dTm;
  const warnings = [];
  if (mat.Tm && TrakeMax > 0.8 * mat.Tm) warnings.push(`Estimated rake-face temperature (${TrakeMax.toFixed(0)} °C) exceeds 80 % of the workpiece melting point: outside the validity of this reduced-order model (no thermal softening, constant properties). Real interface temperatures saturate below the solidus — treat as an upper-bound indicator only.`);
  return {
    warnings,
    ...m, RT, Gamma: G,
    Tshear: T0 + dTs,
    TchipMean: T0 + dTs + dTf,
    TrakeMax: T0 + dTs + dTm,
    TinterfaceMean: T0 + dTs + (2 / 3) * dTm, // reduced estimate used as BC for the tool field
    contactLength: contactFactor * m.hc,
    heatToWork: G * m.Ps,
  };
}

/**
 * 2-D explicit FD conduction in a rectangular tool section (x along rake face from the edge, y into the tool).
 * Rake contact strip x ∈ [0, lc] on y = 0 held at Tint while `active`; free faces: convection (h);
 * far faces (x = W, y = H): held at ambient (heat-sink at holder) — documented boundary assumption.
 */
export class ToolFD {
  constructor({ W = 4, H = 4, nx = 40, ny = 40, k = 50, rho = 14500, cp = 220, hConv = 20, T0 = 20 }) {
    Object.assign(this, { W, H, nx, ny, k, rho, cp, hConv, T0 });
    this.dx = W / 1000 / (nx - 1);
    this.dy = H / 1000 / (ny - 1);
    this.alpha = k / (rho * cp);
    const lim = 1 / (2 * this.alpha * (1 / this.dx ** 2 + 1 / this.dy ** 2));
    this.dtMax = 0.9 * lim;
    this.T = new Float64Array(nx * ny).fill(T0);
    this.N = new Float64Array(nx * ny);
    this.time = 0;
  }
  reset() { this.T.fill(this.T0); this.time = 0; }
  /** Advance by dt seconds. lc contact length mm; Tint interface temperature °C; active boolean. */
  step(dt, lc, Tint, active = true) {
    const { nx, ny, dx, dy, alpha, k, hConv, T0 } = this;
    let rem = dt;
    while (rem > 1e-15) {
      const h = Math.min(rem, this.dtMax);
      const T = this.T, Nn = this.N;
      const nc = Math.max(1, Math.round((lc / 1000) / dx));
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const id = j * nx + i;
          if (i === nx - 1 || j === ny - 1) { Nn[id] = T0; continue; }
          if (j === 0 && i <= nc && active) { Nn[id] = Tint; continue; }
          const Tc = T[id];
          // ghost nodes with convective (Robin) condition on free faces i = 0 and j = 0
          const Tw = i > 0 ? T[id - 1] : T[id + 1] - (2 * dx * hConv / k) * (Tc - T0);
          const Ts = j > 0 ? T[id - nx] : T[id + nx] - (2 * dy * hConv / k) * (Tc - T0);
          const Te = T[id + 1], Tn = T[id + nx];
          Nn[id] = Tc + alpha * h * ((Te - 2 * Tc + Tw) / dx ** 2 + (Tn - 2 * Tc + Ts) / dy ** 2);
        }
      }
      this.T = Nn; this.N = T;
      rem -= h; this.time += h;
    }
    return this.T;
  }
  max() { let m = -Infinity; for (const v of this.T) m = Math.max(m, v); return m; }
  at(xmm, ymm) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.round(xmm / 1000 / this.dx)));
    const j = Math.min(this.ny - 1, Math.max(0, Math.round(ymm / 1000 / this.dy)));
    return this.T[j * this.nx + i];
  }
}

/** Analytical 1-D semi-infinite solid with constant surface temperature step: used to verify ToolFD. */
export function semiInfiniteStep(Ts, T0, alpha, x, t) {
  return T0 + (Ts - T0) * erfc(x / (2 * Math.sqrt(alpha * t)));
}
export function erfc(x) {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7)
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - y * Math.exp(-z * z);
  return 1 - s * erf;
}
