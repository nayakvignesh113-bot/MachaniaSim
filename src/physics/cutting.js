// Shared cutting-mechanics relations used by the process-specific engines.
// Units: h, b, VB, l in mm; kc in N/mm²; forces in N; angles in degrees at the API, radians inside.

import { DEG } from '../core/units.js';

/** Validity range commonly quoted for the Kienzle law (chip thickness, mm). Outside it the value is extrapolated. */
export const KIENZLE_H_RANGE = [0.05, 1.6];
/** Floor applied to h to keep kc finite at vanishing chip thickness (mm). Below this, cutting is treated as ploughing-free extrapolation. */
export const H_FLOOR = 0.005;

/**
 * Kienzle specific cutting force  kc = kc1.1 · h^(−mc)   [N/mm²]
 * @param {number} kc11 N/mm² (h = b = 1 mm)
 * @param {number} mc   chip-thickness exponent
 * @param {number} h    uncut chip thickness, mm
 */
export function kienzleKc(kc11, mc, h) {
  return kc11 * Math.pow(Math.max(h, H_FLOOR), -mc);
}

/** Main cutting force by Kienzle: Fc = kc1.1 · b · h^(1−mc)  [N] */
export function kienzleForce(kc11, mc, b, h) {
  if (!(b > 0) || !(h > 0)) return 0;
  return kienzleKc(kc11, mc, h) * b * h;
}

/**
 * Rake-angle correction of kc (König/Klocke practice: ≈1–1.5 % per degree relative to the
 * reference rake γ0 of the kc1.1 data). K = 1 − c·(γ − γ0), clamped to [0.6, 1.6].
 * APPROXIMATION — documented in MATHEMATICAL_MODELS.md (M-CUT-02).
 */
export function rakeFactor(gammaDeg, gamma0Deg, c = 0.015) {
  return Math.min(1.6, Math.max(0.6, 1 - c * (gammaDeg - gamma0Deg)));
}

/** Mean friction angle β = atan(μ) [rad]. */
export function frictionAngle(mu) {
  return Math.atan(mu);
}

/**
 * Thrust/cutting force ratio in orthogonal cutting from the force circle:
 * Fth/Fc = tan(β − γn). Clamped at ≥ 0 (thrust cannot reverse in this simple model).
 */
export function thrustRatio(mu, gammaDeg) {
  return Math.max(0, Math.tan(frictionAngle(mu) - gammaDeg * DEG));
}

/**
 * Oblique cutting force-coefficient ratios (Armarego & Whitfield; Stabler chip-flow rule η = i).
 * Returns Kr/Kt and Ka/Kt. With i = 0 reduces to Kr/Kt = tan(β − γn), Ka/Kt = 0.
 */
export function obliqueRatios(mu, gammaNDeg, incDeg) {
  const b = frictionAngle(mu);
  const g = gammaNDeg * DEG;
  const i = incDeg * DEG;
  const ti = Math.tan(i);
  const den = Math.cos(b - g) + ti * ti * Math.sin(b);
  const kr = Math.max(0, Math.sin(b - g) / (Math.cos(i) * den));
  const ka = (Math.cos(b - g) * ti - ti * Math.sin(b)) / den;
  return { kr, ka };
}

/**
 * Additional forces from rubbing on a flank-wear land (simplified Waldorf-type land model):
 *   ΔFth = σw · VB · l    (normal to the clearance face)
 *   ΔFc  = μw · σw · VB · l
 * σw: mean normal stress on the land [N/mm²]; μw: land friction coefficient.
 * Defaults (σw ≈ Rm/√3, μw = 0.5) are ESTIMATES — calibrate (VALIDATION_REGISTER M-WEAR-03).
 */
export function wearLandForces(VB, l, sigmaW, muW) {
  if (!(VB > 0) || !(l > 0)) return { dFc: 0, dFth: 0 };
  const dFth = sigmaW * VB * l;
  return { dFc: muW * dFth, dFth };
}

export function defaultWearLand(mat) {
  return { sigmaW: (mat.Rm || 500) / Math.sqrt(3), muW: 0.5, status: 'estimated' };
}

/**
 * Merchant orthogonal cutting relations from measured/predicted forces.
 * Fc, Fth [N], gamma [deg], V [m/min], h, b [mm]. Returns angles in degrees, speeds in m/min.
 */
export function merchantAnalysis({ Fc, Fth, gamma, V, h, b }) {
  const g = gamma * DEG;
  const beta = g + Math.atan2(Fth, Fc); // friction angle from the force circle
  let phi = Math.PI / 4 - (beta - g) / 2; // Merchant minimum-energy shear angle
  phi = Math.min(Math.max(phi, 5 * DEG), 60 * DEG);
  const rc = Math.sin(phi) / Math.cos(phi - g); // chip thickness ratio h/hc
  const Fs = Fc * Math.cos(phi) - Fth * Math.sin(phi);
  const Fn = Fc * Math.sin(phi) + Fth * Math.cos(phi);
  const F = Fc * Math.sin(g) + Fth * Math.cos(g); // rake-face friction force
  const N = Fc * Math.cos(g) - Fth * Math.sin(g);
  const Vs = (V * Math.cos(g)) / Math.cos(phi - g);
  const Vch = V * rc;
  const As = (h * b) / Math.sin(phi);
  return {
    beta: beta / DEG, phi: phi / DEG, rc, hc: h / rc, Fs, Fn, F, N, Vs, Vch,
    mu: F / N, tauS: Fs / As, // N/mm² shear-plane stress
    shearStrain: Math.cos(g) / (Math.sin(phi) * Math.cos(phi - g)),
    Ps: (Fs * Vs) / 60, // W
    Pf: (F * Vch) / 60, // W
    Ptot: (Fc * V) / 60, // W
  };
}
