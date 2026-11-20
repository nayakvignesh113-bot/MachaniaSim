// Lathe V2 — subsystem 2: transient tool thermal model with interface heat partition (M-THERM-04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolThermal, bandSourceKappa } from '../src/physics/thermal2.js';
const close = (a, b, rel, m) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-9, `${m}: ${a} vs ${b}`);

test('ADI finite-volume scheme conserves energy exactly (adiabatic section, applied flux)', () => {
  const t = new ToolThermal({ hConv: 0, far: 'adiabatic' });
  for (let k = 0; k < 40; k++) t.stepFlux(0.01, 5e7, 0.6, 2e7, 0.2);
  close(t.storedEnergy(), t.energyIn, 1e-9, 'stored = supplied');
});

test('Constant surface flux on a (1-D) semi-infinite tool: T_s = T0 + 2q√(αt/π)/k within 2 %', () => {
  const p = { k: 50, rho: 14500, cp: 220 };
  const t = new ToolThermal({ ...p, hConv: 0, far: 'adiabatic' });
  const q = 1e7, tt = 0.2;
  for (let k = 0; k < 200; k++) t.stepFlux(tt / 200, q, 12);
  const alpha = p.k / (p.rho * p.cp);
  const exact = 20 + (2 * q * Math.sqrt((alpha * tt) / Math.PI)) / p.k;
  close(t.contactMeans(t.T, q, 0.012, 0, 0).rake, exact, 0.02, 'surface temperature');
});

test('Band-source mean equals 2/3 of the trailing-edge value', () => {
  const k = 50, a = 1.4e-5, l = 4e-4, V = 2;
  const max = (2 / k) * Math.sqrt((a * l) / (Math.PI * V));
  close(bandSourceKappa(k, a, l, V), (2 / 3) * max, 1e-12, 'κ');
});

test('Coupled cutting: interface temperatures match on both sides; partition rises as the tool heats', () => {
  const t = new ToolThermal({ k: 50, rho: 14500, cp: 220, hConv: 20 });
  const chip = { k: 50, alpha: 50 / (7845 * 486) };
  const c = { Pf: 400, lc: 0.5, b: 2, Vch: 60, Tshear: 350, chip, Pw: 60, VB: 0.2, V: 150, work: chip };
  const first = t.stepCutting(0.05, c);
  let last; for (let k = 0; k < 400; k++) last = t.stepCutting(0.05, c);
  assert.ok(Math.abs(last.Trake - last.TchipSide) < 0.5, `rake ${last.Trake} vs chip ${last.TchipSide}`);
  assert.ok(Math.abs(last.Tflank - last.TworkSide) < 0.5, `flank ${last.Tflank} vs work ${last.TworkSide}`);
  assert.ok(last.R > first.R && last.R > 0, `R ${first.R} → ${last.R}`);
  assert.ok(t.max() > 350 && t.max() < 1500);
  const cool = t.max(); for (let k = 0; k < 40; k++) t.stepCutting(0.05, null, false); assert.ok(t.max() < cool, 'cools when idle');
});
