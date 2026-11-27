// Confidence intervals and residuals of the calibration fits (M-RES-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tQuantile, tCDF, fitKienzle, fitTaylor, fitExtendedTaylor, fitLinearEdge, fitWearPower, rng } from '../src/research/stats.js';

// Box–Muller normal from the seeded generator
function normal(R) { return Math.sqrt(-2 * Math.log(R() || 1e-12)) * Math.cos(2 * Math.PI * R()); }

test('Student-t quantiles match tables (two-sided 95 %)', () => {
  const table = { 1: 12.706, 2: 4.303, 3: 3.182, 5: 2.571, 10: 2.228, 20: 2.086, 60: 2.000 };
  for (const [dof, v] of Object.entries(table)) assert.ok(Math.abs(tQuantile(0.975, +dof) - v) < 2e-3, `dof ${dof}`);
  assert.ok(Math.abs(tCDF(0, 7) - 0.5) < 1e-12);
  assert.ok(Number.isNaN(tQuantile(0.975, 0)));
});

test('Kienzle: exact data → zero-width intervals and zero residuals', () => {
  const rows = [0.05, 0.1, 0.2, 0.3, 0.4].map((h) => ({ h, b: 2, Fc: 1800 * h ** (1 - 0.25) * 2 }));
  const k = fitKienzle(rows);
  assert.ok(Math.abs(k.kc11 - 1800) < 1e-6 && Math.abs(k.mc - 0.25) < 1e-9);
  assert.ok(k.ci.kc11[1] - k.ci.kc11[0] < 1e-6);
  assert.ok(k.residuals.every((r) => Math.abs(r.res) < 1e-6));
  assert.equal(k.dof, 3);
});

test('Kienzle: 95 % intervals cover the true parameters at the nominal rate (Monte Carlo)', () => {
  const R = rng(7), N = 600; let hitK = 0, hitM = 0;
  for (let s = 0; s < N; s++) {
    const rows = [0.05, 0.08, 0.12, 0.18, 0.25, 0.35].map((h) => ({ h, b: 2, Fc: 1800 * h ** 0.75 * 2 * Math.exp(0.05 * normal(R)) }));
    const k = fitKienzle(rows);
    if (k.ci.kc11[0] <= 1800 && 1800 <= k.ci.kc11[1]) hitK++;
    if (k.ci.mc[0] <= 0.25 && 0.25 <= k.ci.mc[1]) hitM++;
  }
  for (const hit of [hitK, hitM]) assert.ok(hit / N > 0.92 && hit / N < 0.98, `coverage ${hit / N}`);
});

test('Two points leave no degrees of freedom → no interval', () => {
  const k = fitKienzle([{ h: 0.1, b: 2, Fc: 700 }, { h: 0.3, b: 2, Fc: 1500 }]);
  assert.equal(k.dof, 0); assert.equal(k.ci.kc11, null); assert.equal(k.ci.mc, null);
});

test('Taylor and wear power law: intervals contain the estimate, residuals are measured − fitted', () => {
  const R = rng(3);
  const tf = fitTaylor([100, 150, 200, 250, 300].map((V) => ({ V, T: (400 / V) ** (1 / 0.25) * Math.exp(0.08 * normal(R)) })));
  assert.ok(tf.ci.n[0] < tf.n && tf.n < tf.ci.n[1] && tf.ci.C[0] < tf.C && tf.C < tf.ci.C[1]);
  for (const r of tf.residuals) assert.ok(Math.abs(r.res - (r.obs - r.pred)) < 1e-12);
  const wf = fitWearPower([1, 2, 4, 8, 12, 16].map((t) => ({ t, VB: 0.02 + 0.05 * t ** 0.45 * Math.exp(0.03 * normal(R)) })), 0.02);
  assert.ok(wf.ci.A[0] < 0.05 * 1.2 && wf.ci.A[1] > 0.05 * 0.8);
  assert.ok(wf.ci.B[0] < 0.45 && 0.45 < wf.ci.B[1]);
});

test('Extended Taylor: delta-method intervals cover the true exponents (Monte Carlo)', () => {
  const R = rng(11), N = 300, truth = { n: 0.25, C: 400, m: 0.4, p: 0.15 };
  const hits = { n: 0, C: 0, m: 0, p: 0 };
  for (let s = 0; s < N; s++) {
    const rows = [];
    for (const V of [120, 180, 260]) for (const f of [0.1, 0.2, 0.3]) for (const ap of [1, 2, 3]) {
      const T = (truth.C / (V * (f / 0.25) ** truth.m * (ap / 2) ** truth.p)) ** (1 / truth.n);
      rows.push({ V, f, ap, T: T * Math.exp(0.05 * normal(R)) });
    }
    const e = fitExtendedTaylor(rows);
    for (const k of Object.keys(hits)) if (e.ci[k][0] <= truth[k] && truth[k] <= e.ci[k][1]) hits[k]++;
  }
  for (const [k, v] of Object.entries(hits)) assert.ok(v / N > 0.88, `${k} coverage ${v / N}`);
});

test('Edge-force fit: interval on Ke contains the true edge coefficient', () => {
  const R = rng(5);
  const e = fitLinearEdge([0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((h) => ({ h, b: 3, F: 3 * (2000 * h + 25) * (1 + 0.02 * normal(R)) })));
  assert.ok(e.ci.Ke[0] < 25 && 25 < e.ci.Ke[1]);
  assert.ok(e.ci.Kc[0] < 2000 && 2000 < e.ci.Kc[1]);
});

test('Outlier screen flags a gross error and stays quiet on clean scatter', async () => {
  const { outliers } = await import('../src/research/stats.js');
  const R = rng(21);
  const rows = [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35].map((h) => ({ h, b: 2, Fc: 1800 * h ** 0.75 * 2 * Math.exp(0.03 * normal(R)) }));
  assert.equal(outliers(fitKienzle(rows)).length, 0);
  rows[4].Fc *= 1.6;
  assert.deepEqual(outliers(fitKienzle(rows)), [4]);
});
