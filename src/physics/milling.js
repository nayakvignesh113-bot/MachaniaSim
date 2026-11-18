// Mechanistic milling force model (M-MILL-01..04), after Altintas, "Manufacturing Automation".
// Angle convention: tooth immersion φ measured CLOCKWISE from +y, feed along +x, spindle CW (viewed from above).
//   h(φ) = fz·sin φ·sin κ  (+ runout term)  — engaged for φst ≤ φ ≤ φex and h > 0
//   dFt = kc(h)·Kγ·h·db  (Kienzle, consistent with turning/drilling)    — or linear Ktc/Kte model
//   dFr = Kr·dFt ,  dFa = Ka·dFt   (oblique ratios, Stabler η = i)
//   Fx = −Ft cos φ − Fr sin φ ;  Fy = Ft sin φ − Fr cos φ   (on the cutter, machine axes)
// Units: mm, N, N·m, rev/min, kW.

import { DEG } from '../core/units.js';
import { kienzleKc, rakeFactor, obliqueRatios, wearLandForces, defaultWearLand } from './cutting.js';

/** Entry/exit immersion angles [rad]. ae radial depth (mm), D cutter diameter, mode 'up'|'down'|'slot'. */
export function immersionAngles(ae, D, mode) {
  const R = D / 2;
  const ae_ = Math.min(Math.max(ae, 0), D);
  if (mode === 'slot' || ae_ >= D - 1e-9) return { st: 0, ex: Math.PI };
  const a = Math.acos(1 - ae_ / R); // engagement arc
  if (mode === 'up') return { st: 0, ex: a };
  return { st: Math.PI - a, ex: Math.PI }; // down milling
}

/**
 * Discretise the cutter edge into elements {z (height above tip), r, kap (edge angle to axis), db, lag}.
 * subtype 'end'|'slot' (flat, κ = 90°), 'face' (lead angle kr), 'ball'.
 */
export function cutterElements(tool, ap, nz = 24) {
  const R = tool.D / 2;
  const ti = Math.tan((tool.helix ?? 0) * DEG);
  const els = [];
  if (tool.subtype === 'ball') {
    const zmax = Math.min(ap, R);
    const kmax = Math.acos(1 - zmax / R);
    const dk = kmax / nz;
    for (let k = 0; k < nz; k++) {
      const kap = (k + 0.5) * dk;
      const z = R * (1 - Math.cos(kap));
      els.push({ z, r: R * Math.sin(kap), kap, db: R * dk, lag: (z * ti) / R });
    }
    if (ap > R) {
      const n2 = Math.max(4, Math.round((nz * (ap - R)) / R));
      const dz = (ap - R) / n2;
      for (let k = 0; k < n2; k++) { const z = R + (k + 0.5) * dz; els.push({ z, r: R, kap: Math.PI / 2, db: dz, lag: (z * ti) / R }); }
    }
    return els;
  }
  const kap = (tool.subtype === 'face' ? tool.kr ?? 90 : 90) * DEG;
  const dz = ap / nz;
  for (let k = 0; k < nz; k++) {
    const z = (k + 0.5) * dz;
    const r = R + z / Math.tan(kap); // lead-angle edges move outward with height (κ < 90°)
    els.push({ z, r, kap, db: dz / Math.sin(kap), lag: (z * ti) / R });
  }
  return els;
}

/**
 * Instantaneous cutter forces at rotation angle phi0 (immersion of tooth 0 at the tip).
 * @param o {mat, tool, fz, ap, ae, mode, runout[], VB[], coeffModel:'kienzle'|'linear', lin:{Ktc,Krc,Kac,Kte,Kre,Kae}, engaged(phi, el, j)}
 */
export function millingForcesAt(phi0, o, els = null) {
  const { tool, fz } = o;
  const Z = tool.z;
  const elements = els || cutterElements(tool, o.ap);
  const { st, ex } = o.immersion || immersionAngles(o.ae, tool.D, o.mode);
  const mat = o.mat;
  const ratios = obliqueRatios(mat.mu, tool.rake ?? 0, tool.helix ?? 0);
  const Kg = rakeFactor(tool.rake ?? 0, mat.rake0 ?? 6);
  const land = o.land || defaultWearLand(mat);
  const run = o.runout || null;
  let Fx = 0, Fy = 0, Fz = 0, T = 0;
  const perTooth = new Array(Z).fill(0);
  const hTooth = new Array(Z).fill(0);
  for (let j = 0; j < Z; j++) {
    const VBj = o.VB ? o.VB[j] || 0 : 0;
    const dRun = run ? (run[j] || 0) - (run[(j - 1 + Z) % Z] || 0) : 0;
    for (const el of elements) {
      let phi = phi0 + (j * 2 * Math.PI) / Z - el.lag;
      phi = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (phi < st || phi > ex) continue;
      const sk = Math.sin(el.kap);
      let h = (fz * Math.sin(phi) + dRun) * sk;
      if (h <= 0) continue;
      if (o.engaged) { const e = o.engaged(phi, el, j); if (e <= 0) continue; }
      let dFt, dFthEdge, dFa;
      if (o.coeffModel === 'linear' && o.lin) {
        const L = o.lin;
        dFt = L.Ktc * h * el.db + L.Kte * el.db;
        dFthEdge = L.Krc * h * el.db + L.Kre * el.db;
        dFa = (L.Kac || 0) * h * el.db + (L.Kae || 0) * el.db;
      } else {
        dFt = kienzleKc(mat.kc11, mat.mc, h) * Kg * h * el.db;
        dFthEdge = ratios.kr * dFt;
        dFa = ratios.ka * dFt;
      }
      if (VBj > 0) { const w = wearLandForces(VBj, el.db, land.sigmaW, land.muW); dFt += w.dFc; dFthEdge += w.dFth; }
      // edge-normal thrust splits into radial (sin κ) and axial (cos κ) components
      const dFr = dFthEdge * sk;
      const dFz = dFthEdge * Math.cos(el.kap) + dFa;
      const c = Math.cos(phi), s = Math.sin(phi);
      Fx += -dFt * c - dFr * s;
      Fy += dFt * s - dFr * c;
      Fz += dFz;
      T += (dFt * el.r) / 1000;
      perTooth[j] += dFt;
      hTooth[j] = Math.max(hTooth[j], h);
    }
  }
  return { Fx, Fy, Fz, F: Math.hypot(Fx, Fy, Fz), T, perTooth, hTooth };
}

/** Forces over one cutter revolution (nSteps samples). Returns arrays and mean/peak values. */
export function millingForceCycle(o, nSteps = 360) {
  const els = cutterElements(o.tool, o.ap, o.nz || 24);
  const out = { phi: [], Fx: [], Fy: [], Fz: [], F: [], T: [], perTooth: [] };
  let sx = 0, sy = 0, sz = 0, sT = 0, peak = 0;
  for (let k = 0; k < nSteps; k++) {
    const phi = (k / nSteps) * 2 * Math.PI;
    const r = millingForcesAt(phi, o, els);
    out.phi.push(phi / DEG); out.Fx.push(r.Fx); out.Fy.push(r.Fy); out.Fz.push(r.Fz); out.F.push(r.F); out.T.push(r.T); out.perTooth.push(r.perTooth);
    sx += r.Fx; sy += r.Fy; sz += r.Fz; sT += r.T; peak = Math.max(peak, r.F);
  }
  const N = o.N || 0;
  const Tm = sT / nSteps;
  return {
    ...out,
    mean: { Fx: sx / nSteps, Fy: sy / nSteps, Fz: sz / nSteps, T: Tm },
    peakF: peak,
    power: (Tm * 2 * Math.PI * N) / 60 / 1000,
    mrr: o.ap * o.ae * o.fz * o.tool.z * N, // mm³/min
    vf: o.fz * o.tool.z * N, // mm/min
    Vc: (Math.PI * o.tool.D * N) / 1000,
  };
}

/**
 * Closed-form average forces for zero-helix cutters with LINEAR coefficients (Altintas eq.):
 *   F̄x = (N·a·c/8π)[Ktc cos2φ − Krc(2φ − sin2φ)] + (N·a/2π)[−Kte sinφ + Kre cosφ]
 *   F̄y = (N·a·c/8π)[Ktc(2φ − sin2φ) + Krc cos2φ] − (N·a/2π)[Kte cosφ + Kre sinφ]
 * evaluated φst → φex. Used as an analytical verification benchmark.
 */
export function averageForcesClosedForm({ Z, a, c, Ktc, Krc, Kte = 0, Kre = 0, st, ex }) {
  const fx = (p) => (Z * a * c / (8 * Math.PI)) * (Ktc * Math.cos(2 * p) - Krc * (2 * p - Math.sin(2 * p))) + (Z * a / (2 * Math.PI)) * (-Kte * Math.sin(p) + Kre * Math.cos(p));
  const fy = (p) => (Z * a * c / (8 * Math.PI)) * (Ktc * (2 * p - Math.sin(2 * p)) + Krc * Math.cos(2 * p)) - (Z * a / (2 * Math.PI)) * (Kte * Math.cos(p) + Kre * Math.sin(p));
  return { Fx: fx(ex) - fx(st), Fy: fy(ex) - fy(st) };
}

/** Kinematic roughness of milled surfaces. */
export function millingRoughness({ tool, fz, ae, wall = false }) {
  if (wall || tool.subtype === 'end' || tool.subtype === 'slot') {
    // peripheral feed marks on the wall: cusp height of successive tooth arcs (radius R)
    const R = tool.D / 2;
    const Rt = (1000 * fz * fz) / (8 * R);
    return { Rt, Ra: Rt / 3.9, surface: 'side wall (peripheral feed marks)' };
  }
  if (tool.subtype === 'ball') {
    const R = tool.D / 2;
    const step = ae; // stepover
    const cusp = R - Math.sqrt(Math.max(R * R - (step / 2) ** 2, 0));
    return { Rt: cusp * 1000, Ra: (cusp * 1000) / 3.9, surface: 'scallop between stepovers' };
  }
  const rn = tool.cornerR || 0.8;
  const Rt = (1000 * fz * fz) / (8 * rn);
  return { Rt, Ra: Rt / 3.9, surface: 'floor (insert corner radius marks)' };
}
