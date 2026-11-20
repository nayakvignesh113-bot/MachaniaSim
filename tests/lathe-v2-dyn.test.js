// Lathe V2 — subsystems 4b/5: time-domain regenerative chatter vs Tlusty lobes; vibration-imprinted surface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { turningTimeDomain, roughnessParams, vibratedProfile } from '../src/physics/chatter.js';
import { turningLobes, lobeEnvelope } from '../src/physics/dynamics.js';
import { theoreticalRoughness } from '../src/physics/turning.js';
const close = (a, b, rel, m) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${m}: ${a} vs ${b}`);
const modes = [{ k: 2e7, zeta: 0.03, fn: 600 }];
const Kth = 1000, nr = 0.8;

test('Static response: deflection = F/k', () => {
  const r = turningTimeDomain({ modes: [{ k: 2e7, zeta: 0.3, fn: 600 }], Kth, nr, b: 0.2, h0: 0.1, N: 1000, nrev: 30 });
  const yEnd = r.y[r.y.length - 1];
  // equilibrium with regeneration: y(t) = y(t−τ) → h = h0, F = Kth·b·h0·nr
  close(yEnd, (Kth * 0.2 * 0.1 * nr) / (2e7 / 1000), 0.01, 'static deflection');
  assert.ok(r.stable);
});

test('Time-domain stability agrees with Tlusty lobes (0.7× stable, 1.4× unstable) at two speeds', () => {
  const Ks = Kth * nr * nr;
  const L = turningLobes({ modes, Ks, fmin: 500, fmax: 900, nf: 6000, lobes: 80 });
  for (const N of [1500, 3000]) {
    const env = lobeEnvelope(L.lobes, 2000, 1000, 4000);
    const bl = env.b[env.n.findIndex((x) => x >= N)];
    const s = turningTimeDomain({ modes, Kth, nr, b: 0.7 * bl, h0: 0.1, N, nrev: 60 });
    const u = turningTimeDomain({ modes, Kth, nr, b: 1.4 * bl, h0: 0.1, N, nrev: 60 });
    assert.ok(s.stable, `N=${N}: 0.7·b_lim should be stable (growth ${s.growth})`);
    assert.ok(!u.stable, `N=${N}: 1.4·b_lim should chatter (growth ${u.growth})`);
  }
});

test('Roughness parameters: Rz of a periodic profile equals its peak-to-valley; vibration-free profile matches kinematic Ra', () => {
  const x = Array.from({ length: 2000 }, (_, i) => i * 0.001), z = x.map((v) => 0.002 * Math.sin((2 * Math.PI * v) / 0.2));
  const r = roughnessParams(x, z);
  close(r.Rz, 4, 0.01, 'Rz'); close(r.Ra, (4 / Math.PI) * 1, 0.01, 'Ra of sine = 2A/π');
  const p = vibratedProfile({ f: 0.15, rn: 0.8, kr: 95, krMinor: 5, yRev: new Array(30).fill(0) });
  close(p.Ra, theoreticalRoughness(0.15, 0.8, 95, 5).Ra, 0.02, 'Ra');
  const v = vibratedProfile({ f: 0.15, rn: 0.8, kr: 95, krMinor: 5, yRev: Array.from({ length: 30 }, (_, k) => 0.004 * Math.sin(k * 2.1)) });
  assert.ok(v.Rz > p.Rz * 1.5, 'vibration raises Rz');
});
