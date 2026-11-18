// Verification tests for the physics engines (node --test). Each test cites the benchmark it checks.
import test from 'node:test';
import assert from 'node:assert/strict';

import { spindleSpeed, cuttingSpeed, toDisplay, fromDisplay } from '../src/core/units.js';
import { MATERIALS, materialParams, getMaterial, johnsonCook } from '../src/core/materials.js';
import { TOOLS, getTool, defaultTaylor } from '../src/core/tools.js';
import { kienzleForce, kienzleKc, thrustRatio, obliqueRatios, merchantAnalysis, rakeFactor } from '../src/physics/cutting.js';
import { turningNominal, theoreticalRoughness } from '../src/physics/turning.js';
import { drillForces, sandvikDrillReference } from '../src/physics/drilling.js';
import { millingForceCycle, averageForcesClosedForm, immersionAngles } from '../src/physics/milling.js';
import { cuttingTemperature, ToolFD, semiInfiniteStep, erfc, boothroydGamma } from '../src/physics/thermal.js';
import { taylorLife, taylorSpeed, EdgeWear } from '../src/physics/wear.js';
import { directionalFactors, frf, turningLobes, workpieceDeflection, periodicResponse } from '../src/physics/dynamics.js';
import { grindingCalc, quickReturn, broachForceProfile, broachTeeth } from '../src/physics/abrasive.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${msg}: ${a} vs ${b} (rel tol ${rel})`);
const en8 = materialParams(getMaterial('en8'));

test('units: N = 1000V/(πD) and inverse', () => {
  close(spindleSpeed(100, 50), 636.6198, 1e-6, 'N');
  close(cuttingSpeed(636.6198, 50), 100, 1e-6, 'V');
  close(fromDisplay(toDisplay(123.4, 'force', 'imperial'), 'force', 'imperial'), 123.4, 1e-12, 'roundtrip');
  close(toDisplay(100, 'temperature', 'imperial'), 212, 1e-12, '°F');
});

test('database: every material has kc1.1, mc and provenance; no NaN', () => {
  for (const m of MATERIALS) {
    const p = materialParams(m);
    for (const k of ['density', 'E', 'k', 'cp', 'kc11', 'mc']) assert.ok(Number.isFinite(p[k]) && p[k] > 0, `${m.id}.${k}`);
    assert.ok(m.kienzle.kc11.source && m.kienzle.kc11.status, `${m.id} provenance`);
  }
  assert.equal(defaultTaylor('carbide', getMaterial('ti64')), null, 'no textbook Taylor default for titanium');
  assert.ok(defaultTaylor('carbide', getMaterial('en8')).C === 500);
});

test('Johnson–Cook reduces to A + Bεⁿ at reference rate and room temperature', () => {
  const jc = getMaterial('en24').jc;
  close(johnsonCook(jc, 0.5, 1, 20), jc.A + jc.B * Math.pow(0.5, jc.n), 1e-12, 'JC');
});

test('Kienzle: Fc = kc1.1·b·h^(1−mc) (M-CUT-01)', () => {
  close(kienzleForce(1500, 0.22, 2, 0.2), 1500 * 2 * Math.pow(0.2, 0.78), 1e-12, 'Fc');
  close(kienzleKc(1500, 0.22, 1), 1500, 1e-12, 'kc at h=1');
});

test('Turning nominal: κr=90°, γ=γ0 → Fc equals Kienzle, Ff=Fth, Fp=0; P = T·ω; exact MRR', () => {
  const tool = { kr: 90, rake: 6, rn: 0 };
  const r = turningNominal({ mat: en8, tool, V: 150, f: 0.25, ap: 2, D: 50 });
  close(r.Fc, kienzleForce(1500, 0.22, 2, 0.25), 1e-9, 'Fc');
  close(r.Ff, r.Fc * thrustRatio(0.5, 6), 1e-9, 'Ff');
  assert.ok(Math.abs(r.Fp) < 1e-9);
  close(r.power, (r.torque * 2 * Math.PI * r.N) / 60 / 1000, 1e-9, 'P = Tω');
  close(r.mrr, Math.PI * 48 * 2 * 0.25 * r.N, 1e-12, 'MRR');
  close(r.mrrApprox, 1000 * 150 * 0.25 * 2, 1e-12, 'textbook MRR');
});

test('Turning nominal: κr=75° → h = f·sinκr, b = ap/sinκr', () => {
  const r = turningNominal({ mat: en8, tool: { kr: 75, rake: 6 }, V: 150, f: 0.3, ap: 2, D: 60 });
  close(r.h, 0.3 * Math.sin((75 * Math.PI) / 180), 1e-12, 'h');
  close(r.b, 2 / Math.sin((75 * Math.PI) / 180), 1e-12, 'b');
});

test('Rake correction is 1 at reference rake and monotone', () => {
  assert.equal(rakeFactor(6, 6), 1);
  assert.ok(rakeFactor(-6, 6) > 1 && rakeFactor(15, 6) < 1);
});

test('Oblique ratios reduce to orthogonal at i = 0', () => {
  const r = obliqueRatios(0.5, 8, 0);
  close(r.kr, thrustRatio(0.5, 8), 1e-12, 'Kr');
  assert.ok(Math.abs(r.ka) < 1e-12);
});

test('Merchant: chip ratio and energy balance P = Ps + Pf (M-CUT-04)', () => {
  const m = merchantAnalysis({ Fc: 1000, Fth: 450, gamma: 6, V: 120, h: 0.2, b: 2 });
  close(m.Ps + m.Pf, m.Ptot, 1e-9, 'energy balance');
  close(m.Vch, 120 * m.rc, 1e-12, 'chip speed');
});

test('Roughness: exact feed-mark profile → Rt ≈ f²/(8rε), Ra ≈ f²/(32rε) in the arc regime', () => {
  const r = theoreticalRoughness(0.1, 0.8, 95, 5);
  close(r.Rt, (1000 * 0.01) / (8 * 0.8), 2e-3, 'Rt');
  close(r.Ra, (1000 * 0.01) / (32 * 0.8), 0.04, 'Ra');
  const big = theoreticalRoughness(0.4, 0.8, 95, 5);
  assert.ok(big.Rt < big.classic.Rt, 'beyond 2rε·sinκr′ the straight minor edge lies below the arc: classical formula overestimates');
});

test('Drilling: lip model torque within ±30 % of the Sandvik reference formula; positive thrust; MRR', () => {
  const tool = getTool('drill-hss-10');
  const r = drillForces({ mat: en8, tool, f: 0.2, N: 800 });
  const ref = sandvikDrillReference({ kc11: 1500, mc: 0.22, D: 10, f: 0.2, pointAngle: 118, rake0: 30 });
  assert.ok(r.torque > 0.7 * ref.Mc && r.torque < 1.3 * ref.Mc, `torque ${r.torque} vs ${ref.Mc}`);
  assert.ok(r.thrust > 0 && r.thrustChisel > 0);
  close(r.mrr, Math.PI * 25 * 0.2 * 800, 1e-12, 'MRR');
  assert.ok(Math.abs(r.radialImbalance) < 1e-9, 'symmetric lips cancel radially');
});

test('Drilling: unequal lip wear produces radial imbalance and higher thrust', () => {
  const tool = getTool('drill-hss-10');
  const a = drillForces({ mat: en8, tool, f: 0.2, N: 800 });
  const b = drillForces({ mat: en8, tool, f: 0.2, N: 800, VB: [0.3, 0.1] });
  assert.ok(b.thrust > a.thrust && Math.abs(b.radialImbalance) > 1);
});

test('Milling: numerical mean forces equal the Altintas closed form (zero helix, linear law) — M-MILL-01', () => {
  const mat = { ...en8, mc: 0, kc11: 2000, mu: 0.5 };
  for (const [mode, ae] of [['slot', 10], ['up', 3], ['down', 3]]) {
    const tool = { D: 10, z: 4, helix: 0, rake: 6, subtype: 'end' };
    const fz = 0.1, ap = 2;
    const cyc = millingForceCycle({ mat, tool, fz, ap, ae, mode, N: 1000, nz: 1 }, 7200);
    const { st, ex } = immersionAngles(ae, 10, mode);
    const Krc = 2000 * thrustRatio(0.5, 6);
    const cf = averageForcesClosedForm({ Z: 4, a: ap, c: fz, Ktc: 2000, Krc, st, ex });
    close(cyc.mean.Fx, cf.Fx, 2e-3, `${mode} Fx`);
    close(cyc.mean.Fy, cf.Fy, 2e-3, `${mode} Fy`);
  }
});

test('Milling: helix smooths force (lower peak/mean) at equal mean torque', () => {
  const t0 = { D: 10, z: 2, helix: 0, rake: 6, subtype: 'end' }, t1 = { ...t0, helix: 30 };
  const o = { mat: en8, fz: 0.08, ap: 8, ae: 10, mode: 'slot', N: 1000, nz: 40 };
  const a = millingForceCycle({ ...o, tool: t0 }, 720), b = millingForceCycle({ ...o, tool: t1 }, 720);
  assert.ok(b.peakF < a.peakF);
  close(b.mean.T, a.mean.T, 0.02, 'mean torque');
});

test('Thermal: FD tool solver matches 1-D semi-infinite erfc solution (M-THERM-03 verification)', () => {
  const fd = new ToolFD({ W: 4, H: 4, nx: 41, ny: 81, k: 50, rho: 8000, cp: 500, hConv: 0, T0: 20 });
  const t = 0.05;
  fd.step(t, 4, 520, true); // whole top face held at 520 °C
  const x = 0.4; // mm depth
  const exact = semiInfiniteStep(520, 20, 50 / (8000 * 500), x / 1000, t);
  close(fd.at(1.0, x), exact, 0.03, 'T(x,t)');
  close(erfc(0), 1, 1e-7, 'erfc(0)');
});

test('Thermal: Boothroyd partition decreases with thermal number; temperatures exceed ambient', () => {
  assert.ok(boothroydGamma(1, 0.4) > boothroydGamma(50, 0.4));
  const r = cuttingTemperature({ mat: en8, Fc: 1000, Fth: 450, gamma: 6, V: 150, h: 0.2, b: 2 });
  assert.ok(r.Tshear > 100 && r.TrakeMax > r.Tshear);
});

test('Wear: Taylor life & inverse; Taylor–Miner integrator reaches VBc at T (M-WEAR-01/02)', () => {
  const t = { n: 0.25, C: 500 };
  const T = taylorLife(200, 0.25, 2, t);
  close(T, Math.pow(500 / 200, 4), 1e-12, 'T');
  close(taylorSpeed(T, 0.25, 2, t), 200, 1e-12, 'V');
  const w = new EdgeWear({ taylor: t, VBc: 0.3 });
  const dt = (T * 60) / 1000;
  for (let k = 0; k < 1000; k++) w.advance(dt, { V: 200, f: 0.25, ap: 2 });
  close(w.VB, 0.3, 1e-6, 'VB at Taylor life');
});

test('Dynamics: closed-form directional factors equal numerical average (Altintas–Budak)', () => {
  const Kr = 0.3, st = 0.4, ex = 2.6;
  const df = directionalFactors(st, ex, Kr);
  // numerical: a_xx(φ) = −sin2φ − Kr(1 − cos2φ), etc. integrated φst→φex
  const n = 20000; let axx = 0, axy = 0, ayx = 0, ayy = 0;
  for (let k = 0; k < n; k++) {
    const p = st + ((k + 0.5) * (ex - st)) / n, w = (ex - st) / n;
    axx += (-Math.sin(2 * p) - Kr * (1 - Math.cos(2 * p))) * w;
    axy += (-(1 + Math.cos(2 * p)) - Kr * Math.sin(2 * p)) * w;
    ayx += ((1 - Math.cos(2 * p)) - Kr * Math.sin(2 * p)) * w;
    ayy += (Math.sin(2 * p) - Kr * (1 + Math.cos(2 * p))) * w;
  }
  close(df.axx, axx, 1e-6, 'axx'); close(df.axy, axy, 1e-6, 'axy'); close(df.ayx, ayx, 1e-6, 'ayx'); close(df.ayy, ayy, 1e-6, 'ayy');
});

test('Dynamics: SDOF FRF static limit; Tlusty asymptote b = 2kζ(1+ζ)/Ks', () => {
  const mode = { k: 2e7, zeta: 0.03, fn: 600 };
  close(frf(mode, 0).re, 1 / 2e7, 1e-12, 'static');
  const Ks = 2000;
  const r = turningLobes({ modes: [mode], Ks, fmin: 600, fmax: 700, nf: 20000 });
  close(r.bAsymptote, ((2 * 2e7 * 0.03 * (1 + 0.03)) / (Ks * 1e6)) * 1000, 2e-3, 'b_lim min');
});

test('Dynamics: deflection formulas and periodic response static check', () => {
  close(workpieceDeflection({ F: 100, D: 20, L: 100, z: 100, E: 200 }), (100 * 1e6) / (3 * 200000 * Math.PI * 20 ** 4 / 64), 1e-12, 'cantilever');
  const x = periodicResponse(new Array(64).fill(100), 0.01, [{ k: 1e7, zeta: 0.05, fn: 500 }]);
  close(x[0], 10, 1e-9, '100 N / 1e7 N/m = 10 µm');
});

test('Grinding: P = u·Q, Ft = P/vs, de for surface = ds', () => {
  const r = grindingCalc({ type: 'surface', ds: 200, vs: 30, vw: 200, a: 0.02, b: 10, u: 40, forceRatio: 0.35, epsilon: 0.75, G: 30, mat: en8 });
  close(r.P, 40 * 200 * 0.02 * 10, 1e-12, 'P');
  close(r.Ft, r.P / 30, 1e-12, 'Ft');
  close(r.lc, Math.sqrt(0.02 * 200), 1e-12, 'lc');
  assert.ok(r.Tmax > 20);
});

test('Shaper quick return: ratio from geometry (r/d = 0.5 → 2)', () => {
  const q = quickReturn({ r: 50, d: 100, L: 400, nc: 30 });
  close(q.ratio, 2, 1e-12, 'ratio');
  close(Math.max(...q.x) - Math.min(...q.x), q.stroke, 2e-3, 'stroke');
});

test('Broaching: peak force = engaged teeth × per-tooth force', () => {
  const teeth = broachTeeth(20, 0.05, 0, 0);
  const kcFun = () => 3000;
  const r = broachForceProfile({ teeth, p: 10, Lw: 35, b: 8, kcFun, nSamples: 2000 });
  close(r.Fmax, 4 * 3000 * 0.05 * 8, 1e-12, 'Fmax');
});
