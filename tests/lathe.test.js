// Geometry + coupled lathe simulation tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LatheWorkpiece } from '../src/geometry/lathe.js';
import { outlineForTool } from '../src/geometry/toolshape.js';
import { planLatheOp } from '../src/sim/lathe-ops.js';
import { LatheSim, newEdgeWear } from '../src/sim/lathe-sim.js';
import { materialParams, getMaterial } from '../src/core/materials.js';
import { getTool, getToolMaterial, defaultTaylor } from '../src/core/tools.js';
import { turningNominal, theoreticalRoughness, edgeForces } from '../src/physics/turning.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${msg}: ${a} vs ${b} (rel tol ${rel})`);
const matRec = getMaterial('en8');
const mat = materialParams(matRec);

function makeSim(toolId, wp, opts = {}) {
  const tool = { ...getTool(toolId), ...(opts.toolOverride || {}) };
  const outline = tool.kind === 'drill' ? null : outlineForTool(tool);
  const taylor = defaultTaylor(tool.material, matRec);
  return new LatheSim({ wp, mat, tool, outline, toolMat: getToolMaterial(tool.material), wear: newEdgeWear(opts.noWear ? null : taylor, tool), machine: { Pmax: 100 } });
}

test('Outline: CNMG reference point is the lowest point; leftmost offset small', () => {
  const o = outlineForTool(getTool('cnmg-0408-carb'));
  assert.ok(Math.abs(o.rmin) < 1e-9);
  assert.ok(o.zmin < 0 && o.zmin > -1.0, `zmin ${o.zmin}`);
});

test('Straight turning, sharp 90° tool: geometric A, l, h and Fc match the closed-form model (M-TURN-02)', () => {
  const wp = new LatheWorkpiece({ L: 60, D: 40, dz: 0.005 });
  const sim = makeSim('cnmg-0408-carb', wp, { toolOverride: { kr: 90, krMinor: 30, rn: 0.001, rake: 6 }, noWear: true });
  const f = 0.25, ap = 2, N = 800;
  sim.load([{ kind: 'rapid', z: 62, r: 18 }, { kind: 'feed', z: 20, r: 18, f, N }], 'turning');
  const samples = [];
  while (!sim.done) { const s = sim.step(); if (s && s.cutting) samples.push(s); }
  const mid = samples.slice(Math.floor(samples.length / 2), Math.floor(samples.length / 2) + 20);
  const A = mid.reduce((s, x) => s + x.A, 0) / mid.length;
  const l = mid.reduce((s, x) => s + x.l, 0) / mid.length;
  const Fc = mid.reduce((s, x) => s + x.Fc, 0) / mid.length;
  // exact uncut chip area = f·ap minus the residual feed-mark triangle f·Rt/2, Rt = f/(cotκr + cotκr′)
  const Rt = f / (1 / Math.tan(Math.PI / 2) + 1 / Math.tan((30 * Math.PI) / 180));
  const Aexact = f * ap - (f * Rt) / 2;
  close(A, Aexact, 0.005, 'A');
  close(l, ap, 0.01, 'l');
  const ref = edgeForces(mat, { rake: 6 }, Aexact, ap);
  close(Fc, ref.Fc, 0.01, 'Fc');
  const nom = turningNominal({ mat, tool: { kr: 90, rake: 6 }, V: (Math.PI * 40 * N) / 1000, f, ap, D: 40 });
  close(Fc, nom.Fc, 0.05, 'Fc vs textbook (A = f·ap)');
  const Ff = mid.reduce((s, x) => s + x.Ff, 0) / mid.length;
  close(Ff, ref.Fth, 0.02, 'Ff');
  // final diameter
  close(2 * wp.outerAt(40), 36, 1e-3, 'diameter');
});

test('Turned profile roughness equals the kinematic prediction (geometry ↔ theory)', () => {
  const wp = new LatheWorkpiece({ L: 40, D: 30, dz: 0.002 });
  const sim = makeSim('cnmg-0408-carb', wp, { noWear: true });
  const f = 0.12;
  sim.load([{ kind: 'rapid', z: 42, r: 14 }, { kind: 'feed', z: 5, r: 14, f, N: 1000 }], 'turning');
  sim.runAll();
  const r = wp.roughness(15, 30);
  const th = theoreticalRoughness(f, 0.8, 95, 5);
  close(r.Ra, th.Ra, 0.08, 'Ra');
  close(r.Rt, th.Rt, 0.08, 'Rt');
});

test('Volume conservation: removed volume (Pappus) = workpiece volume loss', () => {
  const wp = new LatheWorkpiece({ L: 50, D: 40, dz: 0.01 });
  const v0 = wp.volume();
  const sim = makeSim('cnmg-0408-carb', wp);
  const plan = planLatheOp('turning', { Dt: 33, Lc: 30, ap: 2, f: 0.3, N: 900 }, wp, sim.outline);
  sim.load(plan.moves, 'turning'); sim.runAll();
  close(v0 - wp.volume(), sim.removed, 0.005, 'volume');
  close(2 * wp.outerAt(35), 33, 2e-3, 'final Ø (wear recession is µm-level)');
});

test('Facing shortens the part; parting separates it; drilling makes a bore', () => {
  const wp = new LatheWorkpiece({ L: 80, D: 40, dz: 0.01 });
  let sim = makeSim('cnmg-0408-carb', wp);
  let plan = planLatheOp('facing', { stock: 1.5, ap: 1, f: 0.2, N: 600 }, wp, sim.outline);
  sim.load(plan.moves, 'facing'); sim.runAll();
  assert.ok(wp.outerAt(78.45) > 19.9 && wp.outerAt(78.55) < 1e-6, 'face at z = 78.5 across the full radius');
  sim = makeSim('drill-hss-10', wp);
  plan = planLatheOp('drilling', { depth: 20, f: 0.15, N: 700 }, wp, null);
  sim.load(plan.moves, 'drilling');
  let maxThrust = 0; while (!sim.done) { const s = sim.step(); if (s?.cutting) maxThrust = Math.max(maxThrust, s.thrust); }
  close(2 * wp.innerAt(70), 10, 1e-3, 'bore Ø');
  assert.ok(maxThrust > 100, 'thrust');
  sim = makeSim('groove-3', wp);
  plan = planLatheOp('parting', { z: 40, width: 3, f: 0.08, N: 500 }, wp, sim.outline);
  sim.load(plan.moves, 'parting'); sim.runAll();
  assert.ok(wp.partedAt != null && wp.partedAt >= 40 && wp.partedAt <= 40.25, `parted at ${wp.partedAt} (separation where the flat blade bottom breaks through; corner radius leaves a pip)`);
  assert.ok(wp.endZ() <= 40.25);
});

test('Threading: ISO depth H1 = 0.61343P reached; flank forces balance axially', () => {
  const wp = new LatheWorkpiece({ L: 40, D: 20, dz: 0.005 });
  const sim = makeSim('thread-60', wp);
  const plan = planLatheOp('threading', { pitch: 1.5, Lt: 20, passes: 6, N: 200 }, wp, sim.outline);
  sim.load(plan.moves, 'threading');
  const ff = [];
  while (!sim.done) { const s = sim.step(); if (s?.cutting && s.op === 'threading') ff.push(s); }
  let rmin = Infinity; for (let i = wp.idx(25); i < wp.idx(35); i++) rmin = Math.min(rmin, wp.R[i]);
  close(10 - rmin, 0.61343 * 1.5, 0.02, 'thread depth');
  // mid-thread revolution of the final full pass (away from the part end and the run-out)
  const lastPass = ff.filter((s) => s.z < 35 && s.z > 22).slice(-3)[0];
  assert.ok(Math.abs(lastPass.Ff) < 0.1 * Math.abs(lastPass.Fp) + 1, `axial ${lastPass.Ff} vs radial ${lastPass.Fp}: symmetric flanks cancel axially`);
});

test('Wear coupling: flank wear raises forces and nose recession increases diameter', () => {
  const run = (VB0) => {
    const wp = new LatheWorkpiece({ L: 40, D: 40, dz: 0.01 });
    const sim = makeSim('cnmg-0408-carb', wp);
    sim.wear.VB = VB0;
    sim.load([{ kind: 'rapid', z: 42, r: 18 }, { kind: 'feed', z: 15, r: 18, f: 0.25, N: 800 }], 'turning');
    const s = []; while (!sim.done) { const x = sim.step(); if (x?.cutting) s.push(x); }
    return { Fc: s[s.length - 5].Fc, Fp: s[s.length - 5].Fp, D: 2 * wp.outerAt(25) };
  };
  const a = run(0), b = run(0.3);
  assert.ok(b.Fc > a.Fc * 1.05 && Math.abs(b.Fp) > Math.abs(a.Fp));
  close(b.D - a.D, 2 * 0.3 * Math.tan((6 * Math.PI) / 180), 0.05, 'ΔD = 2·VB·tanα');
});
