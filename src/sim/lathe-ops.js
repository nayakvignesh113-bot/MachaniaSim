// Lathe operation planner: converts operation parameters into tool-reference moves.
// Coordinates: z along the spindle (0 = chuck face), r radial. Reference points: see toolshape.js.

import { DEG } from '../core/units.js';
import { envAt } from '../geometry/toolshape.js';

export const LATHE_OPS = {
  turning: { name: 'Straight turning', toolKinds: ['general'] },
  facing: { name: 'Facing', toolKinds: ['general'] },
  step: { name: 'Step turning', toolKinds: ['general'] },
  taper: { name: 'Taper turning', toolKinds: ['general'] },
  grooving: { name: 'Grooving', toolKinds: ['grooving'] },
  parting: { name: 'Parting-off', toolKinds: ['grooving'] },
  threading: { name: 'Thread cutting', toolKinds: ['threading'] },
  drilling: { name: 'Drilling (tailstock)', toolKinds: ['drill'] },
  boring: { name: 'Boring', toolKinds: ['boring'] },
  chamfer: { name: 'Chamfering', toolKinds: ['general'] },
};

const CLR = 2; // approach clearance, mm

function stockRadius(wp, z1, z2) {
  let m = 0;
  const i0 = Math.max(0, wp.idx(Math.min(z1, z2))), i1 = Math.min(wp.n - 1, wp.idx(Math.max(z1, z2)));
  for (let i = i0; i <= i1; i++) m = Math.max(m, wp.R[i]);
  return m;
}

/** Split a total depth into n equal passes not exceeding apMax. */
function passes(total, apMax) {
  if (!(total > 1e-9)) return [];
  const n = Math.max(1, Math.ceil(total / apMax - 1e-9));
  return Array.from({ length: n }, (_, k) => (total * (k + 1)) / n);
}

/**
 * @returns {{moves: object[], warnings: string[], summary: string}}
 */
export function planLatheOp(op, p, wp, outline) {
  const L = wp.endZ();
  const moves = [];
  const warnings = [];
  const zOff = outline ? -outline.zmin : 0; // ref-z so that leftmost tool point sits at the target
  const feed = (z, r, extra = {}) => moves.push({ kind: 'feed', z, r, f: p.f, N: p.N, ...extra });
  const rapid = (z, r) => moves.push({ kind: 'rapid', z, r });
  switch (op) {
    case 'turning':
    case 'step': {
      const steps = op === 'step' ? p.steps : [{ D: p.Dt, L: p.Lc }];
      for (const st of steps) {
        const zEnd = L - st.L;
        if (zEnd < 0) warnings.push(`Requested length ${st.L} mm exceeds the workpiece; cut stops at the chuck face.`);
        const zStop = Math.max(zEnd, 1) + zOff;
        const R0 = stockRadius(wp, Math.max(zEnd, 0), L);
        const Rt = st.D / 2;
        if (Rt >= R0) { warnings.push(`Target Ø${st.D} ≥ current Ø${(2 * R0).toFixed(2)} — no material to remove.`); continue; }
        for (const depth of passes(R0 - Rt, p.ap)) {
          const r = R0 - depth;
          rapid(L + CLR, R0 + CLR);
          rapid(L + CLR, r);
          feed(zStop, r);
          feed(zStop + 0.5, r + 0.5); // 45° pull-off at feed
          rapid(zStop + 0.5, R0 + CLR);
        }
      }
      rapid(L + CLR * 5, stockRadius(wp, 0, L) + CLR * 5);
      return { moves, warnings, summary: `${moves.filter((m) => m.kind === 'feed').length / 2} pass(es)` };
    }
    case 'facing': {
      const R0 = stockRadius(wp, L - 1, L);
      const Rin = wp.innerAt(L) || 0;
      for (const depth of passes(p.stock, p.ap)) {
        const z = L - depth + zOff;
        rapid(z + CLR, R0 + CLR);
        rapid(z, R0 + CLR);
        // feed slightly past the axis (or into the bore) so no centre pip is left by the trailing edge
        // the leftmost tool point sits `lift` above the reference (≈ rε for κr ≥ 90°)
        const lift = outline ? envAt(outline.env, outline.env.lo, outline.zmin) ?? 0 : 0;
        const rEnd = Rin > 0 ? Rin - 0.3 - lift : -(lift + 0.3);
        feed(z, rEnd);
        feed(z + 0.5, rEnd + 0.5);
        rapid(z + CLR, R0 + CLR);
      }
      return { moves, warnings, summary: `${Math.ceil(p.stock / p.ap)} facing pass(es)` };
    }
    case 'taper': {
      // small diameter at the free end (z = L), large diameter at z = L − Lt
      const z1 = L, z2 = L - p.Lt;
      const rS = p.Dsmall / 2, rL = p.Dlarge / 2;
      const slope = (rL - rS) / (z1 - z2); // dr per unit (−z)
      const R0 = stockRadius(wp, z2, z1);
      const maxDepth = R0 - rS;
      const half = Math.atan(slope) / DEG;
      for (const depth of passes(maxDepth, p.ap)) {
        const off = maxDepth - depth;
        // line r(z) = rS + off + slope·(z1 − z), extended to the approach point
        const zs = z1 + CLR, rs = rS + off - slope * CLR;
        const ze = z2 + zOff, re = rS + off + slope * (z1 - z2);
        rapid(zs, R0 + CLR); rapid(zs, rs);
        feed(ze, re);
        rapid(ze, R0 + CLR);
      }
      return { moves, warnings, summary: `taper half-angle ${half.toFixed(3)}° (compound rest setting)` };
    }
    case 'chamfer': {
      const R0 = wp.outerAt(L - 0.05) ?? wp.R[wp.n - 1];
      const c = p.c;
      // tip follows r = (R0 − c) + (L − z); extend 1 mm beyond both ends
      rapid(L + 1, R0 + CLR); rapid(L + 1, R0 - c - 1);
      feed(L - c - 0.5, R0 + 0.5);
      rapid(L + CLR, R0 + CLR);
      return { moves, warnings, summary: `${c} × 45° chamfer` };
    }
    case 'grooving':
    case 'parting': {
      const w = p.width;
      const zg = p.z; // left (chuck-side) edge of groove, from chuck face
      const R0 = stockRadius(wp, zg, zg + w);
      const Rin = wp.innerAt(zg + w / 2) || 0;
      const rEnd = op === 'parting' ? Math.max(Rin - 0.3, -0.3) : p.Dg / 2;
      const nPlunge = op === 'parting' ? 1 : Math.max(1, Math.ceil((p.grooveWidth || w) / w - 1e-9));
      for (let k = 0; k < nPlunge; k++) {
        const z = zg + Math.min(k * w, Math.max(0, (p.grooveWidth || w) - w));
        rapid(z, R0 + CLR);
        feed(z, rEnd);
        rapid(z, R0 + CLR);
      }
      return { moves, warnings, summary: op === 'parting' ? 'part-off plunge' : `${nPlunge} plunge(s)` };
    }
    case 'threading': {
      const P = p.pitch;
      const H1 = 0.61343 * P; // ISO 68-1 external thread depth
      const R0 = (p.D ?? 2 * stockRadius(wp, L - p.Lt, L)) / 2;
      const n = Math.max(2, p.passes);
      const zEnd = L - p.Lt;
      // constant chip-area radial infeed: depth_k = H1·√(k/n); plus one spring pass
      const depths = [...Array.from({ length: n }, (_, k) => H1 * Math.sqrt((k + 1) / n)), H1];
      for (const dep of depths) {
        const r = R0 - dep;
        rapid(L + 3 * P, R0 + CLR); rapid(L + 3 * P, r);
        feed(zEnd, r, { f: P, thread: true });
        rapid(zEnd, R0 + CLR);
      }
      wp.threads.push({ z1: zEnd, z2: L, pitch: P, depth: H1, R: R0 });
      return { moves, warnings, summary: `M${(2 * R0).toFixed(1)}×${P}: H1 = ${H1.toFixed(3)} mm, ${depths.length} passes` };
    }
    case 'drilling': {
      const zStart = L + CLR;
      const zt = L - p.depth;
      if (p.peck > 0) {
        let z = L;
        while (z > zt + 1e-9) {
          const zn = Math.max(zt, z - p.peck);
          rapid(z + 0.5, 0); feed(zn, 0, { drill: true }); rapid(zStart, 0);
          z = zn;
        }
      } else { rapid(zStart, 0); feed(zt, 0, { drill: true }); rapid(zStart + 10, 0); }
      return { moves, warnings, summary: `drill depth ${p.depth} mm (tip)` };
    }
    case 'boring': {
      const zEnd = L - p.Lb;
      let Ri0 = 0;
      for (let i = wp.idx(zEnd); i < wp.n; i++) Ri0 = Math.max(Ri0, wp.Ri[i]);
      const Ribot = Math.min(...Array.from(wp.Ri.slice(wp.idx(zEnd), wp.idx(L))));
      if (!(Ribot > 0)) warnings.push('Boring requires an existing bore along the full boring length — drill first.');
      const Rt = p.Db / 2;
      const base = Math.max(Ribot, 0);
      for (const depth of passes(Rt - base, p.ap)) {
        const r = base + depth;
        rapid(L + CLR, Math.max(base - 1, 0)); rapid(L + CLR, r);
        feed(zEnd + zOff, r);
        feed(zEnd + zOff + 0.5, r - 0.5);
        rapid(L + CLR, r - 0.5);
      }
      return { moves, warnings, summary: `bore to Ø${p.Db}` };
    }
    default:
      throw new Error(`Unknown lathe operation ${op}`);
  }
}
