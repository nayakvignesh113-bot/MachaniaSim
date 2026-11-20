// Lathe V2 — subsystem 1: cutting mechanics extensions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { materialParams, getMaterial } from '../src/core/materials.js';
import { shearAngle, jcRateThermal, edgePloughForces, merchantAnalysis } from '../src/physics/cutting.js';
import { turningNominal, softeningFactor, KC_REFERENCE, edgeForces } from '../src/physics/turning.js';
import { fitLinearEdge, fitWearPower } from '../src/research/stats.js';
const close = (a, b, rel, m) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${m}: ${a} vs ${b}`);
const en8 = materialParams(getMaterial('en8'));

test('Shear-angle relations: Merchant and Lee–Shaffer closed forms', () => {
  const b = 0.5, g = 0.1;
  close(shearAngle('merchant', b, g), Math.PI / 4 - 0.2, 1e-12, 'Merchant');
  close(shearAngle('lee-shaffer', b, g), Math.PI / 4 - 0.4, 1e-12, 'Lee–Shaffer');
  const m = merchantAnalysis({ Fc: 1000, Fth: 400, gamma: 6, V: 100, h: 0.2, b: 2, shearModel: 'lee-shaffer' });
  close(m.Ps + m.Pf, m.Ptot, 1e-9, 'energy balance holds for Lee–Shaffer');
});

test('JC rate/thermal factor: 1 at reference, 0 at melting, monotone in T', () => {
  const jc = en8.jc;
  close(jcRateThermal(jc, 20, jc.eps0), 1, 1e-12, 'reference');
  assert.ok(jcRateThermal(jc, jc.TmK - 273.15, 1) < 0.01);
  assert.ok(jcRateThermal(jc, 400, 1) < jcRateThermal(jc, 200, 1));
});

test('Thermal-softening factor: K = 1 exactly at the kc reference condition; K < 1 at higher speed (M-CUT-05)', () => {
  const tool = { rake: 6 };
  const k0 = softeningFactor(en8, tool, KC_REFERENCE.h, 2, KC_REFERENCE.V);
  close(k0.K, 1, 1e-4, 'reference');
  const k1 = softeningFactor(en8, tool, KC_REFERENCE.h, 2, 300);
  assert.ok(k1.K < 1 && k1.Tsh > k0.Tsh_ref, `K ${k1.K}, Tsh ${k1.Tsh} vs ${k0.Tsh_ref}`);
  assert.equal(softeningFactor({ ...materialParams(getMaterial('ss304')), jc: null }, tool, 0.2, 2, 300).K, 1);
});

test('Softening is inactive without Johnson–Cook data and when disabled', () => {
  const ss = materialParams(getMaterial('ss304'));
  const a = turningNominal({ mat: ss, tool: { kr: 90, rake: 6 }, V: 250, f: 0.2, ap: 2, D: 50, opts: { softening: true } });
  const b = turningNominal({ mat: ss, tool: { kr: 90, rake: 6 }, V: 250, f: 0.2, ap: 2, D: 50 });
  assert.equal(a.Fc, b.Fc); assert.equal(a.Ksoft, 1);
});

test('Edge (ploughing) forces add Kte·l and Kre·l; linear edge calibration recovers coefficients', () => {
  const r0 = edgeForces(en8, { rake: 6 }, 0.5, 2), r1 = edgeForces(en8, { rake: 6 }, 0.5, 2, 0, null, { edge: { Kte: 20, Kre: 35 } });
  close(r1.Fc - r0.Fc, 40, 1e-9, 'ΔFc'); close(r1.Fth - r0.Fth, 70, 1e-9, 'ΔFth');
  assert.deepEqual(edgePloughForces(null, 2), { dFc: 0, dFth: 0 });
  const rows = [0.05, 0.1, 0.2, 0.3].map((h) => ({ h, b: 2, F: 2 * (2100 * h + 25) }));
  const f = fitLinearEdge(rows); close(f.Kc, 2100, 1e-9, 'Kc'); close(f.Ke, 25, 1e-9, 'Ke');
});

test('Empirical wear-progression fit VB = VB0 + A·t^B recovers constants', () => {
  const rows = [1, 2, 5, 10, 20].map((t) => ({ t, VB: 0.02 + 0.05 * Math.pow(t, 0.6) }));
  const r = fitWearPower(rows, 0.02); close(r.A, 0.05, 1e-9, 'A'); close(r.B, 0.6, 1e-9, 'B');
});
