// Grinding mechanics (M-GRIND-01..05), after Malkin & Guo, "Grinding Technology".
// Units: vs m/s (wheel), vw mm/s (work / table speed), a (depth) mm, b width mm, ds, dw mm,
//        u specific energy J/mm³, forces N, power W, temperature °C.

export const GRINDING_DEFAULTS = {
  u: { value: 40, unit: 'J/mm³', status: 'estimated', note: 'Specific grinding energy for steels with Al₂O₃ wheels typically ≈20–70 J/mm³ (Malkin); depends strongly on h_eq and wheel condition — calibrate.' },
  forceRatio: { value: 0.35, unit: 'Ft/Fn', status: 'estimated', note: 'Typical 0.2–0.6.' },
  epsilon: { value: 0.75, unit: '-', status: 'estimated', note: 'Energy partition to workpiece; ≈0.6–0.85 for Al₂O₃ on steel, lower for CBN.' },
  G: { value: 30, unit: 'mm³/mm³', status: 'estimated', note: 'Grinding ratio; conventional wheels ≈5–100, CBN ≫ 100.' },
  burnTemp: { value: 720, unit: '°C', status: 'estimated', note: 'Illustrative tempering/burn threshold for hardened steel; material-specific.' },
};

/** Equivalent wheel diameter: de = ds·dw/(dw ± ds) (+ external, − internal); surface grinding de = ds. */
export function equivalentDiameter(ds, dw, type) {
  if (type === 'surface' || !(dw > 0)) return ds;
  if (type === 'internal') return (ds * dw) / (dw - ds);
  return (ds * dw) / (dw + ds);
}

export function grindingCalc({ type = 'surface', ds, dw = 0, vs, vw, a, b, u, forceRatio, epsilon, G, mat, T0 = 20 }) {
  const de = equivalentDiameter(ds, dw, type);
  const lc = Math.sqrt(a * de); // geometric contact length, mm
  const Qw = vw * a * b; // mm³/s
  const heq = (vw * a) / (vs * 1000); // equivalent chip thickness, mm (vs m/s → mm/s)
  const P = u * Qw; // W
  const Ft = P / vs; // N
  const Fn = Ft / forceRatio;
  // Temperature: Jaeger high-Péclet band source, θmax = 1.13·ε·q·√(α·lc/vw)/k
  let Tmax = null, Pe = null;
  if (mat) {
    const alpha = mat.k / (mat.density * mat.cp); // m²/s
    const q = (epsilon * P) / ((lc / 1000) * (b / 1000)); // W/m² into workpiece
    Pe = ((vw / 1000) * (lc / 1000)) / (4 * alpha);
    Tmax = T0 + (1.13 * q * Math.sqrt((alpha * (lc / 1000)) / (vw / 1000))) / mat.k;
  }
  const wheelWearRate = Qw / G; // mm³/s of wheel
  const radialWearRate = wheelWearRate / (Math.PI * ds * b); // mm/s of wheel radius
  return { de, lc, Qw, Qprime: vw * a, heq, P, Ft, Fn, Tmax, Pe, wheelWearRate, radialWearRate, specificEnergy: u };
}

// ---------------- Shaping / slotting (reciprocating single-point) ----------------

/**
 * Slotted-lever (crank and slotted lever) quick-return kinematics.
 * crank radius r, distance pivot→crank centre d (> r), lever length L (pivot→ram connection), crank speed nc rev/min.
 * Returns ram position/velocity over one crank revolution and the cut/return time ratio.
 */
export function quickReturn({ r, d, L, nc, n = 360 }) {
  const theta = [], x = [], v = [];
  const omega = (2 * Math.PI * nc) / 60;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    const beta = Math.atan2(r * Math.sin(t), d + r * Math.cos(t));
    theta.push(t); x.push(L * Math.sin(beta));
  }
  for (let i = 0; i < n; i++) {
    const dx = x[(i + 1) % n] - x[(i - 1 + n) % n];
    v.push((dx / ((2 * 2 * Math.PI) / n)) * omega / 1000 * 60); // m/min (x mm)
  }
  const alpha = Math.acos(r / d); // half the return-stroke crank angle (lever tangent to crank circle)
  const ratio = (Math.PI + 2 * Math.asin(r / d)) / (Math.PI - 2 * Math.asin(r / d));
  const stroke = 2 * L * (r / d);
  return { theta, x, v, ratio, stroke, alpha };
}

// ---------------- Sawing ----------------

/**
 * Band/hacksaw cutting. P tooth pitch mm, vs blade speed m/min (band) ; vf feed rate mm/min ;
 * Lc length of cut in contact (workpiece thickness along blade) ; kerf width mm.
 * Teeth engaged = Lc/P ; feed per tooth fz = vf·P/(vs·1000).
 */
export function sawingCalc({ mat, kc, P, vs, vf, Lc, kerf, height, setFactor = 1, strokeEff = 1 }) {
  const fz = (vf * P) / (vs * 1000) / strokeEff;
  const nEng = Lc / P;
  const Fc = nEng * kc(fz) * fz * kerf * setFactor;
  const time = height / vf; // min
  const power = (Fc * vs) / 60000; // kW
  const mrr = vf * kerf * Lc; // mm³/min
  return { fz, nEng, Fc, time, power, mrr };
}

// ---------------- Broaching ----------------

/**
 * Broach with roughing teeth of rise rz (mm/tooth) and pitch p (mm), width of cut b (mm per tooth: key width or π·D),
 * workpiece length Lw. Force vs broach position x (stroke) by summing engaged teeth.
 */
export function broachForceProfile({ teeth, p, Lw, b, kcFun, nSamples = 400 }) {
  const n = teeth.length; // array of rises per tooth (mm), 0 for sizing teeth
  const xMax = (n - 1) * p + Lw;
  const xs = [], F = [], engaged = [];
  for (let s = 0; s <= nSamples; s++) {
    const x = (s / nSamples) * xMax; // position of first tooth past the workpiece entry face
    let f = 0, ne = 0;
    for (let i = 0; i < n; i++) {
      const xi = x - i * p; // distance tooth i has travelled into the workpiece
      if (xi >= 0 && xi <= Lw && teeth[i] > 0) { f += kcFun(teeth[i]) * teeth[i] * b; ne++; }
    }
    xs.push(x); F.push(f); engaged.push(ne);
  }
  const Fmax = Math.max(...F);
  return { x: xs, F, engaged, Fmax, totalRise: teeth.reduce((s, r) => s + r, 0), maxEngaged: Math.ceil(Lw / p) };
}

/** Standard broach tooth list: nr roughing teeth of rise rz, ns semi-finishing (rz/2), nf sizing (0). */
export function broachTeeth(nr, rz, ns = 3, nf = 4) {
  return [...Array(nr).fill(rz), ...Array(ns).fill(rz / 2), ...Array(nf).fill(0)];
}
