// Research workspace: statistics, calibration and ToolVision verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorMetrics, fitKienzle, fitTaylor, fitExtendedTaylor, fullFactorial, taguchiDesign, anovaMainEffects, fitRSM, paretoFront, geneticAlgorithm, parseCSV, interp, ols } from '../src/research/stats.js';
import { measureFlankWear, syntheticWearImage, calibrate, otsu } from '../src/research/toolvision.js';
import { taylorLife } from '../src/physics/wear.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-9, `${msg}: ${a} vs ${b}`);

test('Error metrics on a known case', () => {
  const m = errorMetrics([1, 2, 3, 4], [1, 2, 3, 5]);
  close(m.MAE, 0.25, 1e-12, 'MAE'); close(m.RMSE, 0.5, 1e-12, 'RMSE'); close(m.R2, 1 - 1 / 5, 1e-12, 'R2');
});

test('Kienzle calibration recovers kc1.1 and mc from synthetic dynamometer data', () => {
  const rows = [0.08, 0.12, 0.2, 0.3, 0.45].map((h) => ({ h, b: 2, Fc: 1780 * 2 * Math.pow(h, 1 - 0.26) }));
  const r = fitKienzle(rows);
  close(r.kc11, 1780, 1e-9, 'kc11'); close(r.mc, 0.26, 1e-9, 'mc'); close(r.R2, 1, 1e-9, 'R2');
});

test('Taylor and extended Taylor calibration recover constants', () => {
  const t = { n: 0.28, C: 420 };
  const rows = [120, 160, 200, 260].map((V) => ({ V, T: taylorLife(V, 0.25, 2, t) }));
  const r = fitTaylor(rows); close(r.n, 0.28, 1e-9, 'n'); close(r.C, 420, 1e-9, 'C');
  const te = { n: 0.25, C: 500, m: 0.4, p: 0.15, f0: 0.25, ap0: 2 };
  const rows2 = [];
  for (const V of [150, 220]) for (const f of [0.15, 0.3]) for (const ap of [1, 3]) rows2.push({ V, f, ap, T: taylorLife(V, f, ap, te) });
  const e = fitExtendedTaylor(rows2);
  close(e.n, 0.25, 1e-6, 'n'); close(e.C, 500, 1e-6, 'C'); close(e.m, 0.4, 1e-6, 'm'); close(e.p, 0.15, 1e-6, 'p');
});

test('DOE: full factorial size; Taguchi L9 balance; ANOVA partitions SS for additive model', () => {
  const runs = fullFactorial([{ name: 'A', levels: [1, 2, 3] }, { name: 'B', levels: [10, 20] }]);
  assert.equal(runs.length, 6);
  const L9 = taguchiDesign([{ name: 'V', levels: [1, 2, 3] }, { name: 'f', levels: [1, 2, 3] }, { name: 'ap', levels: [1, 2, 3] }], 'L9');
  assert.equal(L9.length, 9);
  for (const k of ['V', 'f', 'ap']) for (const lv of [1, 2, 3]) assert.equal(L9.filter((r) => r[k] === lv).length, 3);
  const data = L9.map((r) => ({ ...r, y: 2 * r.V + 5 * r.f }));
  const an = anovaMainEffects(data, ['V', 'f', 'ap'], 'y');
  close(an.rows[0].SS + an.rows[1].SS, an.SST, 1e-9, 'SS add up'); assert.ok(an.rows[2].SS < 1e-9);
  close(an.rows[1].contribution, (100 * 25) / 29, 1e-9, '% contribution');
});

test('RSM recovers a quadratic; OLS standard errors finite', () => {
  const X = [], y = [];
  for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) { X.push([a, b]); y.push(3 + 2 * a - b + 0.5 * a * a + 1.5 * a * b); }
  const r = fitRSM(X, y);
  close(r.predict([0.3, -0.7]), 3 + 0.6 + 0.7 + 0.045 - 0.315, 1e-9, 'prediction');
  const o = ols([[1, 1], [1, 2], [1, 3], [1, 4]], [2.1, 3.9, 6.2, 7.8]); assert.ok(o.se.every(Number.isFinite));
});

test('Pareto front and GA', () => {
  const pts = [{ a: 1, b: 5 }, { a: 2, b: 2 }, { a: 3, b: 3 }, { a: 5, b: 1 }];
  assert.deepEqual(paretoFront(pts, ['a', 'b']).length, 3);
  const r = geneticAlgorithm((x) => (x[0] - 1.3) ** 2 + (x[1] + 0.4) ** 2, [[-3, 3], [-3, 3]], { pop: 40, gens: 80, seed: 3 });
  assert.ok(r.best.f < 1e-3, `GA best ${r.best.f}`);
});

test('CSV parser handles quotes, semicolons and decimal commas; interp', () => {
  const p = parseCSV('t;Fc;"note"\n0;100,5;"a;b"\n1;120;x\n');
  assert.deepEqual(p.headers, ['t', 'Fc', 'note']); assert.equal(p.rows[0].Fc, 100.5); assert.equal(p.rows[0].note, 'a;b');
  close(interp([0, 1, 2], [0, 10, 30], 1.5), 20, 1e-12, 'interp');
});

test('ToolVision: synthetic wear land measured within ±1 px; calibration converts to mm', () => {
  const land = (i) => 40 + Math.round(10 * Math.sin(i / 30));
  const img = syntheticWearImage(400, 200, 50, land, 10);
  const cal = calibrate(200, 1000); // 200 px = 1000 µm → 5 µm/px
  const r = measureFlankWear(img, { x1: 20, y1: 50, x2: 380, y2: 50 }, { depth: 120, side: 1, umPerPx: cal.umPerPx, umPerPxUnc: cal.umPerPxUnc });
  let s = 0, mx = 0; for (let i = 20; i < 380; i++) { s += land(i); mx = Math.max(mx, land(i)); }
  close(r.VBpx, s / 360, 0.03, 'VB px'); assert.ok(Math.abs(r.VBmaxPx - mx) <= 2);
  close(r.VB, (r.VBpx * 5) / 1000, 1e-12, 'VB mm'); assert.ok(r.confidence > 0.5 && r.uVB > 0);
  assert.ok(otsu([10, 10, 10, 200, 200]).t >= 10);
});
