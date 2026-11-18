// MachinaSim unit system.
//
// INTERNAL CONVENTION (machining-practice units, used by every physics module):
//   length          mm
//   cutting speed   m/min
//   spindle speed   rev/min
//   feed            mm/rev (turning, drilling), mm/tooth (milling)
//   force           N
//   torque          N·m
//   power           kW
//   MRR             mm³/min   (display also cm³/min)
//   stress/kc       N/mm² (= MPa)
//   temperature     °C (absolute K only inside equations that need it)
//   time            s (simulation clock), min (tool life, Taylor)
//
// Every physics function documents its units; conversions happen only at the UI edge.

export const UNIT_SYSTEMS = {
  metric: {
    length: { unit: 'mm', f: 1 },
    speed: { unit: 'm/min', f: 1 },
    feed: { unit: 'mm/rev', f: 1 },
    force: { unit: 'N', f: 1 },
    torque: { unit: 'N·m', f: 1 },
    power: { unit: 'kW', f: 1 },
    mrr: { unit: 'cm³/min', f: 1e-3 },
    temperature: { unit: '°C', f: 1, o: 0 },
    stress: { unit: 'MPa', f: 1 },
    roughness: { unit: 'µm', f: 1 },
  },
  imperial: {
    length: { unit: 'in', f: 1 / 25.4 },
    speed: { unit: 'ft/min', f: 3.280839895 },
    feed: { unit: 'in/rev', f: 1 / 25.4 },
    force: { unit: 'lbf', f: 0.2248089431 },
    torque: { unit: 'lbf·ft', f: 0.7375621493 },
    power: { unit: 'hp', f: 1.341022090 },
    mrr: { unit: 'in³/min', f: 1 / 16387.064 },
    temperature: { unit: '°F', f: 1.8, o: 32 },
    stress: { unit: 'ksi', f: 0.1450377377 },
    roughness: { unit: 'µin', f: 39.37007874 },
  },
};

/** Convert an internal value of quantity `q` to the display system. */
export function toDisplay(value, q, system = 'metric') {
  const u = UNIT_SYSTEMS[system][q];
  if (!u || value == null || !Number.isFinite(value)) return value;
  return value * u.f + (u.o || 0);
}
export function fromDisplay(value, q, system = 'metric') {
  const u = UNIT_SYSTEMS[system][q];
  if (!u) return value;
  return (value - (u.o || 0)) / u.f;
}
export function unitLabel(q, system = 'metric') {
  return UNIT_SYSTEMS[system][q]?.unit ?? '';
}

export const DEG = Math.PI / 180;
export const rad = (deg) => deg * DEG;
export const deg = (r) => r / DEG;

/** Spindle speed N [rev/min] from cutting speed V [m/min] and diameter D [mm]. N = 1000V/(πD) */
export function spindleSpeed(V, D) {
  if (!(D > 0)) return Infinity;
  return (1000 * V) / (Math.PI * D);
}
/** Cutting speed V [m/min] from N [rev/min] and D [mm]. V = πDN/1000 */
export function cuttingSpeed(N, D) {
  return (Math.PI * D * N) / 1000;
}

/** Format a number with sensible significant digits. */
export function fmt(x, sig = 4) {
  if (x == null || Number.isNaN(x)) return '—';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : '−∞';
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-3) return x.toExponential(sig - 1);
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return x.toFixed(Math.min(digits, 6));
}
