// Z-map milling and drilling simulation tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZMap, verticalToolBottom } from '../src/geometry/zmap.js';
import { MillSim, planMillOp } from '../src/sim/mill-sim.js';
import { DrillSim, planHole, radialIK } from '../src/sim/drill-sim.js';
import { millingForceCycle } from '../src/physics/milling.js';
import { drillForces } from '../src/physics/drilling.js';
import { materialParams, getMaterial } from '../src/core/materials.js';
import { getTool } from '../src/core/tools.js';

const close = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-9, `${msg}: ${a} vs ${b} (rel tol ${rel})`);
const al = materialParams(getMaterial('al6061'));
const en8 = materialParams(getMaterial('en8'));

test('Slot milling: geometry-coupled forces equal the analytical full-slot cycle; slot volume', () => {
  const zm = new ZMap({ W: 80, Dp: 50, H: 30, g: 0.2 });
  const tool = getTool('em-10-4f');
  const sim = new MillSim({ zmap: zm, mat: al, tool });
  sim.load(planMillOp('slot', { y: 25, depth: 3, ap: 3, fz: 0.05, N: 3000 }, zm, tool).moves, 'slot');
  const s = []; const v0 = zm.volume();
  while (!sim.done) { const x = sim.step(); if (x?.cutting) s.push(x); }
  const mid = s[Math.floor(s.length / 2)];
  const ref = millingForceCycle({ mat: al, tool, fz: 0.05, ap: 3, ae: 10, mode: 'slot', N: 3000 }, 48);
  close(mid.Fx, ref.mean.Fx, 0.02, 'Fx'); close(mid.Fy, ref.mean.Fy, 0.02, 'Fy'); close(mid.T, ref.mean.T, 0.02, 'T');
  close(v0 - zm.volume(), 10 * 3 * 80, 0.03, 'slot volume (grid discretisation)');
  close(zm.heightNear(40, 25), 27, 1e-6, 'slot floor');
});

test('Shoulder (end) milling engagement: half-immersion down-milling matches analytical', () => {
  const zm = new ZMap({ W: 80, Dp: 50, H: 30, g: 0.2 });
  const tool = getTool('em-10-4f');
  const sim = new MillSim({ zmap: zm, mat: al, tool });
  sim.load(planMillOp('end', { ae: 5, depth: 4, ap: 4, fz: 0.05, N: 3000 }, zm, tool).moves, 'end');
  const s = []; while (!sim.done) { const x = sim.step(); if (x?.cutting) s.push(x); }
  const mid = s[Math.floor(s.length / 2)];
  // material on the −y side of the cutter moving +x with CW spindle → down (climb) milling
  const ref = millingForceCycle({ mat: al, tool, fz: 0.05, ap: 4, ae: 5, mode: 'down', N: 3000 }, 48);
  close(mid.T, ref.mean.T, 0.06, 'torque');
  close(zm.heightNear(40, 49), 26, 1e-6, 'shoulder floor'); close(zm.heightNear(40, 40), 30, 1e-6, 'untouched');
});

test('Face milling with 45° face mill removes the layer; slab milling (horizontal) works', () => {
  const zm = new ZMap({ W: 100, Dp: 60, H: 30, g: 0.5 });
  const tool = getTool('face-63-5');
  const sim = new MillSim({ zmap: zm, mat: en8, tool });
  sim.load(planMillOp('face', { depth: 1, ap: 1, fz: 0.15, N: 600 }, zm, tool).moves, 'face');
  sim.runAll();
  close(zm.heightNear(50, 30), 29, 1e-6, 'faced'); close(zm.heightNear(5, 55), 29, 1e-6, 'corner faced');
  const z2 = new ZMap({ W: 100, Dp: 60, H: 30, g: 0.5 });
  const slab = getTool('slab-63');
  const s2 = new MillSim({ zmap: z2, mat: en8, tool: slab });
  s2.load(planMillOp('peripheral', { depth: 2, ap: 2, fz: 0.08, N: 80 }, z2, slab).moves, 'peripheral');
  let peakT = 0; while (!s2.done) { const x = s2.step(); if (x?.cutting) peakT = Math.max(peakT, x.T); }
  assert.ok(Math.abs(z2.heightNear(50, 30) - 28) < 0.01, 'slab floor (feed-mark cusp ≪ 0.01 mm)');
  assert.ok(peakT > 0);
});

test('Drilling on the radial drill: through-hole geometry, thrust rises at full engagement', () => {
  const zm = new ZMap({ W: 60, Dp: 60, H: 20, g: 0.2 });
  const tool = getTool('drill-hss-10');
  const sim = new DrillSim({ zmap: zm, mat: en8, tool });
  sim.load(planHole({ x: 30, y: 30, depth: 25, f: 0.2, N: 700, H: 20, tool }), 'drilling');
  const s = []; while (!sim.done) { const x = sim.step(); if (x?.cutting) s.push(x); }
  const full = drillForces({ mat: en8, tool, f: 0.2, N: 700 });
  const peak = Math.max(...s.map((x) => x.thrust));
  close(peak, full.thrust, 0.08, 'full-engagement thrust');
  const pkT = Math.max(...s.map((x) => x.torque));
  assert.ok(s[0].torque < 0.3 * pkT, 'torque ramps up as the lips enter (chisel engages first)');
  assert.equal(zm.heightNear(30, 30), 0, 'through hole');
  assert.equal(zm.heightNear(30, 30 + 5.6), 20, 'outside hole untouched');
  const ik = radialIK(30, 30); assert.ok(ik.ok);
});

test('Step drilling: pilot hole removes chisel/inner-lip engagement → lower thrust for the main drill', () => {
  const run = (pilot) => {
    const zm = new ZMap({ W: 40, Dp: 40, H: 20, g: 0.2 });
    if (pilot) { const p = new DrillSim({ zmap: zm, mat: en8, tool: getTool('drill-hss-8') }); p.load(planHole({ x: 20, y: 20, depth: 26, f: 0.15, N: 900, H: 20 }), 'drilling'); p.runAll(); }
    const s = new DrillSim({ zmap: zm, mat: en8, tool: getTool('drill-hss-20') });
    s.load(planHole({ x: 20, y: 20, depth: 15, f: 0.2, N: 350, H: 20 }), 'drilling');
    let pk = 0; while (!s.done) { const x = s.step(); if (x?.cutting) pk = Math.max(pk, x.thrust); }
    return pk;
  };
  assert.ok(run(true) < 0.6 * run(false));
});

test('Z-map tool envelopes: drill cone, ball nose', () => {
  const b = verticalToolBottom({ kind: 'drill', D: 10, pointAngle: 90 }, 0, 0, 0);
  close(b(3, 0), 3, 1e-12, '90° cone');
  const ball = verticalToolBottom({ kind: 'mill', subtype: 'ball', D: 10 }, 0, 0, 0);
  close(ball(5, 0), 5, 1e-12, 'ball equator'); assert.equal(ball(0, 0), 0);
});
