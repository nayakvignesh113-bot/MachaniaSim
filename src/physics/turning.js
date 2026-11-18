// Turning mechanics (model ids M-TURN-01..05 in MATHEMATICAL_MODELS.md).
//
// Two entry points:
//   turningNominal()      — classical closed-form chip geometry (h = f·sinκr, b = ap/sinκr)
//   forcesFromEngagement() — forces from the ACTUAL engaged chip section computed by the
//                            geometric material-removal engine (equivalent chip thickness h = A/l)
// Units: V m/min, f mm/rev, ap mm, D mm, forces N, torque N·m, power kW, MRR mm³/min.

import { DEG, spindleSpeed } from '../core/units.js';
import { kienzleKc, rakeFactor, thrustRatio, wearLandForces, defaultWearLand, KIENZLE_H_RANGE } from './cutting.js';

/**
 * Core force law shared by nominal and geometric paths.
 * @param mat  plain material params (materialParams())
 * @param tool { rake } deg
 * @param A    uncut chip area per revolution, mm²
 * @param l    engaged cutting-edge length, mm
 * @param VB   flank wear land width, mm (average over the engaged edge)
 * @param land { sigmaW, muW } wear-land parameters (defaults estimated)
 */
export function edgeForces(mat, tool, A, l, VB = 0, land = null) {
  if (!(A > 0) || !(l > 0)) return { Fc: 0, Fth: 0, h: 0, kc: 0, warnings: [] };
  const h = A / l;
  const Kg = rakeFactor(tool.rake ?? 0, mat.rake0 ?? 6);
  const kc = kienzleKc(mat.kc11, mat.mc, h) * Kg;
  const Fc0 = kc * A;
  const Fth0 = Fc0 * thrustRatio(mat.mu, tool.rake ?? 0);
  const L = land || defaultWearLand(mat);
  const w = wearLandForces(VB, l, L.sigmaW, L.muW);
  const warnings = [];
  if (h < KIENZLE_H_RANGE[0]) warnings.push(`h = ${h.toFixed(3)} mm is below the Kienzle validity range (≥ ${KIENZLE_H_RANGE[0]} mm); kc is extrapolated.`);
  if (h > KIENZLE_H_RANGE[1]) warnings.push(`h = ${h.toFixed(3)} mm is above the Kienzle validity range.`);
  return { Fc: Fc0 + w.dFc, Fth: Fth0 + w.dFth, Fc0, Fth0, dFcWear: w.dFc, dFthWear: w.dFth, h, kc, Kg, warnings };
}

/**
 * Nominal (closed-form) turning calculation for longitudinal turning.
 * Nose radius neglected in the chip geometry (stated limitation; the geometric engine includes it).
 */
export function turningNominal({ mat, tool, V, f, ap, D, VB = 0, land = null }) {
  const kr = (tool.kr ?? 90) * DEG;
  const sk = Math.sin(kr);
  const h = f * sk;
  const b = ap / sk;
  const A = f * ap;
  const r = edgeForces(mat, tool, A, b, VB, land);
  // Chip flow normal to the major edge: thrust splits into feed (axial) and passive (radial) components.
  const Ff = r.Fth * Math.sin(kr);
  const Fp = r.Fth * Math.cos(kr);
  const N = spindleSpeed(V, D);
  const rMean = (D - ap) / 2; // centroid radius of the chip section, mm
  const Vm = (Math.PI * 2 * rMean * N) / 1000; // cutting speed at chip centroid, m/min
  const torque = (r.Fc * rMean) / 1000; // N·m
  const power = (r.Fc * Vm) / 60000; // kW  (= torque·ω)
  const mrr = Math.PI * (D - ap) * ap * f * N; // mm³/min, exact annulus volume rate
  return {
    h, b, A, kc: r.kc, Kg: r.Kg, Fc: r.Fc, Ff, Fp, Fth: r.Fth,
    R: Math.hypot(r.Fc, Ff, Fp), N, Vm, torque, power, mrr,
    mrrApprox: 1000 * V * f * ap, // textbook approximation (uses uncut diameter)
    specificEnergy: r.Fc / A, // N/mm² = J/mm³
    warnings: r.warnings,
  };
}

/**
 * Forces from the geometric engagement reported by the lathe material-removal engine.
 * @param eng { A (mm²/rev), l (mm), nz, nr (unit thrust direction on tool in z-r plane), rMean (mm) }
 * @param N spindle speed rev/min
 */
export function forcesFromEngagement({ mat, tool, eng, N, VB = 0, land = null }) {
  const r = edgeForces(mat, tool, eng.A, eng.l, VB, land);
  const Ff = r.Fth * eng.nz; // axial component on tool (+z away from chuck)
  const Fp = r.Fth * eng.nr; // radial component on tool (+r outward)
  const Vm = (2 * Math.PI * eng.rMean * N) / 1000;
  const torque = (r.Fc * eng.rMean) / 1000;
  return {
    ...r, Ff, Fp, R: Math.hypot(r.Fc, Ff, Fp), Vm, torque,
    power: (r.Fc * Vm) / 60000,
    mrr: 2 * Math.PI * eng.rMean * eng.A * N, // Pappus: V = 2π r̄ A per rev
  };
}

/**
 * Theoretical (kinematic) roughness of a turned surface  [µm].
 * Exact feed-mark profile built from the nose arc (radius rε) and the straight major/minor edges:
 *   leading side height  g(x, κr), trailing side g(x, κr′), with g = arc for x ≤ rε·sinκ, else tangent line.
 * Ra/Rt are evaluated numerically over one feed period. The classical approximations
 * Rt = f²/(8rε), Ra = f²/(32rε) (valid for f ≤ 2rε·sinκr′) are returned alongside for reference.
 */
export function theoreticalRoughness(f, rn, kr = 90, krMinor = 5) {
  const g = (x, kapDeg) => {
    const k = Math.min(kapDeg, 90) * DEG;
    if (rn > 0 && x <= rn * Math.sin(k)) return rn - Math.sqrt(Math.max(rn * rn - x * x, 0));
    if (kapDeg >= 90) return Infinity;
    const x0 = rn * Math.sin(k), y0 = rn * (1 - Math.cos(k));
    return y0 + (x - x0) * Math.tan(k);
  };
  const n = 4000;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i + 0.5) / n) * f; // distance behind the later stamp's tip
    y[i] = Math.min(g(x, Math.max(krMinor, 0.01)), g(f - x, kr));
  }
  let m = 0; for (const v of y) m += v; m /= n;
  let sa = 0, mx = -Infinity, mn = Infinity;
  for (const v of y) { sa += Math.abs(v - m); mx = Math.max(mx, v); mn = Math.min(mn, v); }
  const classic = rn > 0 ? { Rt: (1000 * f * f) / (8 * rn), Ra: (1000 * f * f) / (32 * rn) } : null;
  const arcOnly = rn > 0 && f <= 2 * rn * Math.sin(Math.max(krMinor, 0.01) * DEG);
  return { Ra: (sa / n) * 1000, Rt: (mx - mn) * 1000, classic, model: arcOnly ? 'nose-arc feed marks' : 'arc + minor-edge feed marks (classical f²/32rε not valid)' };
}
