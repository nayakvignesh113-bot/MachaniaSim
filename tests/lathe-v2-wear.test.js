// Lathe V2 — subsystem 3 (multi-mode wear) and subsystem 4a (static deflection feedback) integrated in the lathe engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolCondition, ISO3685_CRITERIA } from '../src/physics/wear2.js';
import { taylorLife } from '../src/physics/wear.js';
import { LatheWorkpiece } from '../src/geometry/lathe.js';
import { outlineForTool } from '../src/geometry/toolshape.js';
import { LatheSim, newEdgeWear } from '../src/sim/lathe-sim.js';
import { workpieceDeflection } from '../src/physics/dynamics.js';
import { materialParams, getMaterial } from '../src/core/materials.js';
import { getTool, getToolMaterial } from '../src/core/tools.js';
const close = (a, b, rel, m) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${m}: ${a} vs ${b}`);
const en8 = materialParams(getMaterial('en8'));
const tay = { n: 0.25, C: 500, m: 0, p: 0 };

test('Taylor mode: VB reaches the criterion exactly at Taylor life; VC follows VB by default', () => {
  const w = new ToolCondition({ taylor: tay });
  const T = taylorLife(200, 0.25, 2, tay) * 60;
  for (let k = 0; k < 500; k++) w.advance(T / 500, { V: 200, f: 0.25, ap: 2 });
  close(w.VB, 0.3, 1e-9, 'VB'); close(w.VC, w.VB, 1e-12, 'VC'); assert.equal(w.criterion(0.25), 'VB ≥ 0.3 mm');
});

test('Calibrated power-law progression reproduces VB = VB0 + A·t^B at the reference condition and scales with speed', () => {
  const p = { A: 0.06, B: 0.55, Vref: 150, fref: 0.25, apref: 2 };
  const w = new ToolCondition({ taylor: tay, VB0: 0.02, cfg: { flankModel: 'power', power: p } });
  for (let k = 0; k < 600; k++) w.advance(1, { V: 150, f: 0.25, ap: 2 });
  close(w.VB, 0.02 + 0.06 * Math.pow(10, 0.55), 1e-9, 'VB(10 min)');
  const fast = new ToolCondition({ taylor: tay, cfg: { flankModel: 'power', power: p } });
  for (let k = 0; k < 600; k++) fast.advance(1, { V: 250, f: 0.25, ap: 2 });
  assert.ok(fast.VB > w.VB - 0.02, 'higher speed → faster wear');
});

test('Nose/notch ratios, crater Taylor life and ISO criteria', () => {
  const w = new ToolCondition({ taylor: tay, cfg: { noseRatio: 1.5, notchRatio: 3, crater: { n: 0.3, C: 600 } } });
  const T = taylorLife(220, 0.3, 2, tay) * 60;
  for (let k = 0; k < 200; k++) w.advance(T / 400, { V: 220, f: 0.3, ap: 2 });
  close(w.VC, 1.5 * w.VB, 1e-9, 'VC'); close(w.VN, 3 * w.VB, 1e-9, 'VN');
  close(w.radialWear, w.VC * Math.tan((6 * Math.PI) / 180), 1e-12, 'recession from nose wear');
  const Tc = taylorLife(220, 0.3, 2, { n: 0.3, C: 600 }) * 60;
  close(w.KT, (ISO3685_CRITERIA.KT(0.3) * (T / 2)) / Tc, 1e-9, 'KT');
  assert.ok(w.rakeIncrease(0.5) > 0);
});

test('Weibull edge chipping: fraction of edges still intact at t = η is e^−1 (±4 %)', () => {
  let intact = 0; const n = 3000;
  for (let s = 1; s <= n; s++) {
    const w = new ToolCondition({ cfg: { chipping: { eta: 5, beta: 2, size: 0.1 }, seed: s } });
    for (let k = 0; k < 50; k++) w.advance(6, { V: 100, f: 0.2, ap: 1 });
    if (w.chipped === 0) intact++;
  }
  close(intact / n, Math.exp(-1), 0.04, 'survival');
});

test('Engine: crater (rake increase) lowers Fc; conjugate thermal gives finite rake temperature', () => {
  const run = (KT) => {
    const wp = new LatheWorkpiece({ L: 40, D: 40, dz: 0.01 });
    const tool = getTool('cnmg-0408-carb');
    const sim = new LatheSim({ wp, mat: en8, tool, outline: outlineForTool(tool), toolMat: getToolMaterial('carbide'), wear: newEdgeWear(null, tool) });
    sim.wear.KT = KT;
    sim.load([{ kind: 'rapid', z: 42, r: 18 }, { kind: 'feed', z: 15, r: 18, f: 0.25, N: 800 }], 'turning');
    const s = []; while (!sim.done) { const x = sim.step(); if (x?.cutting) s.push(x); }
    return s[s.length - 5];
  };
  const a = run(0), b = run(0.08);
  assert.ok(b.Fc < a.Fc, `${b.Fc} < ${a.Fc}`);
  assert.ok(a.Trake > a.Tshear && a.Trake < 1500, `Trake ${a.Trake}`);
});

test('Deflection feedback: slender chucked bar is cut oversize by ≈ 2·Fp·compliance, growing toward the free end', () => {
  const wp = new LatheWorkpiece({ L: 150, D: 20, dz: 0.01 });
  const tool = getTool('cnmg-0408-carb');
  const sim = new LatheSim({ wp, mat: en8, tool, outline: outlineForTool(tool), toolMat: getToolMaterial('carbide'), wear: newEdgeWear(null, tool), opts: { deflection: true, kTool: Infinity } });
  sim.load([{ kind: 'rapid', z: 152, r: 9 }, { kind: 'feed', z: 40, r: 9, f: 0.2, N: 1500 }], 'turning');
  let last = null; const S = []; while (!sim.done) { const x = sim.step(); if (x?.cutting) { S.push(x); last = x; } }
  const at = (z) => S.reduce((b, x) => (Math.abs(x.z - z) < Math.abs(b.z - z) ? x : b));
  const sEnd = at(140), sIn = at(60);
  // the uncut Ø20 bar carries the load between chuck and tool → uniform cantilever δ = F z³/(3EI)
  const pred = (s) => 2 * Math.abs(s.Fp) * workpieceDeflection({ F: 1, D: 20, L: 150, z: s.z, E: en8.E });
  close(wp.roughness(138, 142).meanDiameter - 18, pred(sEnd), 0.1, 'mean oversize near free end');
  assert.ok(2 * wp.outerAt(140) - 18 > 2 * wp.outerAt(60) - 18 + 1e-3, 'taper: larger error at the free end');
  void last;
});
