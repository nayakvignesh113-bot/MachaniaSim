// Mechanistic twist-drill model (M-DRILL-01..03).
// Each cutting lip is discretised from the chisel-edge corner (ρ = c) to the periphery (ρ = R);
// each element is treated as an oblique-free orthogonal cutting element:
//   h  = (f/2)·sin κ            (κ = half point angle)
//   db = dρ / sin κ
//   γn(ρ) = atan( tan βρ / sin κ ),  tan βρ = (ρ/R)·tan β_helix   (web-thinning effect neglected — stated)
//   dFc = kc(h)·Kγ(γn)·h·db ;  dFth = dFc·tan(β_f − γn) ;  axial dFz = dFth·sin κ
// Chisel edge (ρ < c): orthogonal cutting at large negative rake γch with h = f/2 and an
// upper bound on the thrust ratio (default 2). Chisel parameters are ESTIMATED (calibrate).
// Units: D, f, ρ mm; N rev/min; forces N; torque N·m; power kW.

import { DEG } from '../core/units.js';
import { kienzleKc, rakeFactor, thrustRatio, wearLandForces, defaultWearLand } from './cutting.js';

// ESTIMATED: chosen so that the chisel edge carries roughly half to three-quarters of the thrust of a
// conventional twist drill, the range commonly reported for chisel-edge contributions. Calibrate.
export const CHISEL_DEFAULTS = { rake: -56, maxThrustRatio: 1.0, status: 'estimated' };

/**
 * @param o.mat material params; o.tool drill {D, pointAngle, helix, webRatio}
 * @param o.f feed mm/rev; o.N rev/min
 * @param o.engaged optional (rho, lip) => fraction 0..1 of element engaged (geometry coupling)
 * @param o.VB [VB_lip1, VB_lip2] mm; o.VBchisel mm
 * @param o.nEl elements per lip
 */
export function drillForces(o) {
  const { mat, tool, f, N } = o;
  const R = tool.D / 2;
  const kap = ((tool.pointAngle ?? 118) / 2) * DEG;
  const sk = Math.sin(kap);
  const c = Math.min(R * 0.95, ((tool.webRatio ?? 0.15) * tool.D) / 2);
  const kapSafe = Math.min(kap, 89.999 * DEG);
  const tb = Math.tan((tool.helix ?? 30) * DEG);
  const nEl = o.nEl || 60;
  const land = o.land || defaultWearLand(mat);
  const VB = o.VB || [0, 0];
  const chisel = { ...CHISEL_DEFAULTS, ...(o.chisel || {}) };
  const nLips = tool.z || 2; // twist drills 2; reamers / counterbores / countersinks: number of flutes
  const h = (f / nLips) * sk;
  const lips = [];
  let Fz = 0, T = 0, Fy = 0; // Fy: net radial imbalance (non-zero only if lips differ)
  for (let lip = 0; lip < nLips; lip++) {
    let fz = 0, tq = 0, frad = 0, lenEng = 0;
    const dr = (R - c) / nEl;
    for (let k = 0; k < nEl; k++) {
      const rho = c + (k + 0.5) * dr;
      const e = o.engaged ? o.engaged(rho, lip) : 1;
      if (e <= 0) continue;
      const db = (dr / sk) * e;
      const gn = tool.rake != null ? tool.rake : Math.atan((rho / R) * tb / sk) / DEG;
      const kc = kienzleKc(mat.kc11, mat.mc, h) * rakeFactor(gn, mat.rake0 ?? 6);
      let dFc = kc * h * db;
      let dFth = dFc * thrustRatio(mat.mu, gn);
      const w = wearLandForces(VB[lip] ?? VB[0] ?? 0, db, land.sigmaW, land.muW);
      dFc += w.dFc; dFth += w.dFth;
      fz += dFth * sk;
      frad += dFth * Math.cos(kapSafe);
      tq += dFc * rho;
      lenEng += db;
    }
    lips.push({ Fz: fz, T: tq / 1000, Frad: frad, lenEng });
    Fz += fz; T += tq / 1000;
    Fy += frad * Math.cos((2 * Math.PI * lip) / nLips); // vector sum of lip radial forces (cancels if equal)
  }
  // Chisel edge: two halves from ρ = 0 to c, h = f/2 per half (each half removes one lip's share).
  let FzCh = 0, TCh = 0;
  if (c > 0) {
    const nC = 10, dr = c / nC;
    const hc = f / 2;
    const kcC = kienzleKc(mat.kc11, mat.mc, hc) * rakeFactor(chisel.rake, mat.rake0 ?? 6);
    const ratio = Math.min(thrustRatio(mat.mu, chisel.rake), chisel.maxThrustRatio);
    for (let half = 0; half < 2; half++) {
      for (let k = 0; k < nC; k++) {
        const rho = (k + 0.5) * dr;
        const e = o.engaged ? o.engaged(rho, half, true) : 1;
        if (e <= 0) continue;
        let dFc = kcC * hc * dr * e;
        let dFz = dFc * ratio;
        const w = wearLandForces(o.VBchisel || 0, dr * e, land.sigmaW, land.muW);
        dFc += w.dFc; dFz += w.dFth;
        FzCh += dFz;
        TCh += (dFc * rho) / 1000;
      }
    }
  }
  const torque = T + TCh;
  const thrust = Fz + FzCh;
  const omega = (2 * Math.PI * N) / 60;
  return {
    thrust, torque, power: (torque * omega) / 1000,
    thrustLips: Fz, thrustChisel: FzCh, torqueLips: T, torqueChisel: TCh,
    radialImbalance: Fy, lips, h, c,
    mrr: (Math.PI * (tool.D * tool.D - 4 * (o.preHoleR || 0) ** 2) / 4) * f * N, // mm³/min
    Vc: (Math.PI * tool.D * N) / 1000,
  };
}

/**
 * Independent textbook reference (Sandvik Coromant drilling formulas) for verification:
 *   hex = (fn/2)·sinκr, kc = kc1·hex^−mc·(1 − γ0/100)
 *   Mc = fn·Dc²·kc / 8000  [N·m]  ;  Ff ≈ 0.5·kc·(Dc/2)·fn·sinκr  [N]
 * Used only in tests / as a cross-check line in the UI.
 */
export function sandvikDrillReference({ kc11, mc, D, f, pointAngle = 118, rake0 = 30 }) {
  const sk = Math.sin((pointAngle / 2) * DEG);
  const hex = (f / 2) * sk;
  const kc = kc11 * Math.pow(hex, -mc) * (1 - rake0 / 100);
  return { Mc: (f * D * D * kc) / 8000, Ff: 0.5 * kc * (D / 2) * f * sk, kc };
}

/** Static drill deflection as a cantilever under radial imbalance F [N]: δ = F L³ / (3 E I), I ≈ π(κd·D)⁴/64 */
export function drillDeflection({ F, D, overhang, E = 210, coreFactor = 0.8 }) {
  const d = coreFactor * D; // effective solid diameter of the fluted section (ESTIMATED factor)
  const I = (Math.PI * d ** 4) / 64; // mm⁴
  return (F * overhang ** 3) / (3 * E * 1000 * I); // mm (E in GPa → N/mm² ×1000)
}

/**
 * Tapping torque by an energy argument (M-DRILL-04, ESTIMATED): all material between the tap-drill radius rd
 * and the major radius R is cut by the chamfer teeth; per revolution the groove volume is 2π·r̄·A_groove, so
 *   T = kc(h)·A_groove·r̄,   h = (R − rd)/(n_chamfer·z)   (radial load per tooth)
 * A_groove = ∫ w(r) dr, w = P/8 + 2(R − r)·tan30° (ISO 60° form, P/8 crest flat). Flank friction of the full
 * threads is NOT included (stated) — measured tapping torques are typically higher.
 */
export function tappingTorque({ mat, tool, rd }) {
  const R = tool.D / 2, P = tool.pitch;
  const n = 200; let A = 0;
  for (let k = 0; k < n; k++) { const r = rd + ((k + 0.5) * (R - rd)) / n; A += Math.min(P, P / 8 + 2 * (R - r) * Math.tan(Math.PI / 6)) * ((R - rd) / n); }
  const h = Math.max((R - rd) / ((tool.chamferThreads || 3) * (tool.z || 3)), 0.005);
  const kc = kienzleKc(mat.kc11, mat.mc, h) * rakeFactor(tool.rake ?? 8, mat.rake0 ?? 6);
  const rbar = (R + rd) / 2;
  return { torque: (kc * A * rbar) / 1000, Agroove: A, h, kc };
}
