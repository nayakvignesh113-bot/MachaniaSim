// 2-D cutting-tool outlines in the lathe axial section (z along the spindle axis, r radial).
// The reference ("programmed") point is the origin. Outlines are densely sampled closed polygons
// with outward normals, used both for material removal (envelopes) and engagement (leading edges).

import { DEG } from '../core/units.js';

const SEG = 0.02; // max boundary segment length, mm

function norm(v) { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; }

/** Rounded corner between two edges leaving a sharp corner at origin along unit dirs e1, e2. */
function roundedCorner(e1, e2, rn) {
  const u = norm([e1[0] + e2[0], e1[1] + e2[1]]);
  const cosE = e1[0] * e2[0] + e1[1] * e2[1];
  const half = Math.acos(Math.min(1, Math.max(-1, cosE))) / 2;
  if (!(rn > 0) || half < 1e-6) return { pts: [[0, 0]], t1: [0, 0], t2: [0, 0] };
  const dc = rn / Math.sin(half);
  const c = [u[0] * dc, u[1] * dc];
  const dt = rn / Math.tan(half);
  const t1 = [e1[0] * dt, e1[1] * dt], t2 = [e2[0] * dt, e2[1] * dt];
  const a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]);
  const a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
  // For a convex corner (included angle ε < 180°) the outside arc spans 180° − ε: the short way.
  let sweep = a2 - a1;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  // fine angular sampling: chord sagitta rn·Δθ²/8 < 1e-6 mm keeps kinematic roughness exact
  const nArc = Math.max(8, Math.ceil(Math.abs(sweep) / Math.sqrt(8e-6 / rn)));
  const pts = [];
  for (let k = 0; k <= nArc; k++) { const a = a1 + (sweep * k) / nArc; pts.push([c[0] + rn * Math.cos(a), c[1] + rn * Math.sin(a)]); }
  return { pts, t1, t2, c };
}

function densify(poly) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / SEG));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

function signedArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Build the outline object: dense points, segment midpoints, lengths and outward normals, envelopes. */
export function buildOutline(poly, { internal = false } = {}) {
  let P = densify(poly);
  if (signedArea(P) < 0) P = P.reverse(); // make CCW
  const segs = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const dz = b[0] - a[0], dr = b[1] - a[1];
    const L = Math.hypot(dz, dr);
    if (L < 1e-12) continue;
    // CCW polygon: outward normal = (dr, −dz)/L
    segs.push({ mz: (a[0] + b[0]) / 2, mr: (a[1] + b[1]) / 2, L, nz: dr / L, nr: -dz / L });
  }
  let zmin = Infinity, zmax = -Infinity, rmin = Infinity, rmax = -Infinity;
  for (const p of P) { zmin = Math.min(zmin, p[0]); zmax = Math.max(zmax, p[0]); rmin = Math.min(rmin, p[1]); rmax = Math.max(rmax, p[1]); }
  // envelopes on a fine grid
  const de = 0.0025;
  const ne = Math.max(2, Math.ceil((zmax - zmin) / de) + 1);
  const lo = new Float64Array(ne).fill(Infinity), hi = new Float64Array(ne).fill(-Infinity);
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const za = Math.min(a[0], b[0]), zb = Math.max(a[0], b[0]);
    const k0 = Math.max(0, Math.ceil((za - zmin) / de - 1e-9)), k1 = Math.min(ne - 1, Math.floor((zb - zmin) / de + 1e-9));
    for (let k = k0; k <= k1; k++) {
      const z = zmin + k * de;
      const t = zb - za > 1e-12 ? (z - a[0]) / (b[0] - a[0]) : 0;
      const r = zb - za > 1e-12 ? a[1] + t * (b[1] - a[1]) : Math.min(a[1], b[1]);
      const r2 = zb - za > 1e-12 ? r : Math.max(a[1], b[1]);
      if (r < lo[k]) lo[k] = r;
      if (r2 > hi[k]) hi[k] = r2;
    }
  }
  for (let k = 0; k < ne; k++) { if (!Number.isFinite(lo[k])) lo[k] = k > 0 ? lo[k - 1] : rmin; if (!Number.isFinite(hi[k])) hi[k] = k > 0 ? hi[k - 1] : rmax; }
  return { points: P, segs, zmin, zmax, rmin, rmax, env: { z0: zmin, de, lo, hi, n: ne }, internal };
}

export function envAt(env, arr, zl) {
  const x = (zl - env.z0) / env.de;
  if (x < 0 || x > env.n - 1) return null;
  const k = Math.floor(x), t = x - k;
  return k >= env.n - 1 ? arr[env.n - 1] : arr[k] + t * (arr[k + 1] - arr[k]);
}

/** General external turning tool. Reference point = lowest point of the nose (min r). */
export function generalToolPolygon(tool) {
  const kr = (tool.kr ?? 90) * DEG, krm = Math.max(0.5, tool.krMinor ?? 5) * DEG;
  const e1 = [-Math.cos(kr), Math.sin(kr)];
  const e2 = [Math.cos(krm), Math.sin(krm)];
  const Lmaj = tool.edgeLen ?? 12, Lmin = Math.max(2, (tool.edgeLen ?? 12) * 0.45);
  const rc = roundedCorner(e1, e2, tool.rn ?? 0);
  const A = [e1[0] * Lmaj, e1[1] * Lmaj], B = [e2[0] * Lmin, e2[1] * Lmin];
  const Htop = Math.max(A[1], B[1], 6);
  const arc = rc.pts.slice();
  // order: major end → t1 → arc → t2 → minor end → top corners
  const poly = [A, ...arc, B, [B[0], Htop], [A[0], Htop]];
  return translateToMin(poly);
}

function translateToMin(poly, flip = false) {
  let best = null;
  for (const p of densify(poly)) if (!best || p[1] < best[1] - 1e-12 || (Math.abs(p[1] - best[1]) < 1e-12 && p[0] < best[0])) best = p;
  return poly.map((p) => [p[0] - best[0], flip ? -(p[1] - best[1]) : p[1] - best[1]]);
}

/** Grooving / parting blade of width w: reference = bottom-left (−z side) extreme, r = 0 at the bottom. */
export function groovingToolPolygon(tool, height = 40) {
  const w = tool.width ?? 3, rn = Math.min(tool.rn ?? 0.2, w / 2.5);
  const poly = [[0, height]];
  const nA = Math.max(8, Math.ceil((Math.PI / 2) / Math.sqrt(8e-6 / Math.max(rn, 1e-3))));
  for (let k = 0; k <= nA; k++) { const a = Math.PI + (Math.PI / 2) * (k / nA); poly.push([rn + rn * Math.cos(a), rn + rn * Math.sin(a)]); }
  for (let k = 0; k <= nA; k++) { const a = 1.5 * Math.PI + (Math.PI / 2) * (k / nA); poly.push([w - rn + rn * Math.cos(a), rn + rn * Math.sin(a)]); }
  poly.push([w, height]);
  return poly;
}

/** Symmetric threading insert (included angle α). Reference = tip (lowest point), z centred. */
export function threadingToolPolygon(tool) {
  const half = ((tool.threadAngle ?? 60) / 2) * DEG;
  const kr = 90 - half / DEG;
  return generalToolPolygon({ kr, krMinor: kr, rn: tool.rn ?? 0.1, edgeLen: tool.edgeLen ?? 4 });
}

/** Internal (boring) tool: mirror of a general tool, tip pointing +r. Reference = highest point. */
export function boringToolPolygon(tool) {
  const g = generalToolPolygon(tool);
  return g.map((p) => [p[0], -p[1]]);
}

export function outlineForTool(tool) {
  switch (tool.subtype) {
    case 'grooving': return buildOutline(groovingToolPolygon(tool));
    case 'threading': return buildOutline(threadingToolPolygon(tool));
    case 'boring': return buildOutline(boringToolPolygon(tool), { internal: true });
    default: return buildOutline(generalToolPolygon(tool));
  }
}
