// Cutting tool database: tool materials (with provenance) and tool geometry library.
// All geometry is editable in the UI. Property status vocabulary as in materials.js.

const p = (value, unit, status, source, note) => ({ value, unit, status, source, ...(note ? { note } : {}) });
const TYP = 'Typical value range from tool-material handbooks/supplier literature; grade-dependent — replace with your supplier datasheet';
export const GROOVER = 'M.P. Groover, Fundamentals of Modern Manufacturing, Table "Representative values of n and C in the Taylor tool life equation" (textbook typical values; criterion and feed/depth not specified — UNCALIBRATED)';

/**
 * Tool materials. taylor.steel / taylor.nonSteel: {n, C [m/min]} for T in minutes.
 * null => no defensible default; the user must supply calibrated constants.
 */
export const TOOL_MATERIALS = [
  {
    id: 'hss', name: 'HSS (M2)',
    props: { density: p(8160, 'kg/m³', 'typical', TYP), E: p(217, 'GPa', 'estimated', TYP), k: p(24, 'W/m·K', 'estimated', TYP, 'literature range ≈20–40 W/m·K'), cp: p(420, 'J/kg·K', 'estimated', TYP), HV: p(850, 'HV', 'typical', TYP), Tmax: p(600, '°C', 'typical', TYP, 'hot-hardness / tempering limit') },
    taylor: { steel: { n: 0.125, C: 70, status: 'textbook', source: GROOVER }, nonSteel: { n: 0.125, C: 120, status: 'textbook', source: GROOVER } },
  },
  {
    id: 'hss-co', name: 'Cobalt HSS (M42)',
    props: { density: p(7980, 'kg/m³', 'typical', TYP), E: p(220, 'GPa', 'estimated', TYP), k: p(24, 'W/m·K', 'estimated', TYP), cp: p(420, 'J/kg·K', 'estimated', TYP), HV: p(900, 'HV', 'typical', TYP), Tmax: p(620, '°C', 'typical', TYP) },
    taylor: { steel: null, nonSteel: null },
  },
  {
    id: 'carbide', name: 'Cemented carbide (uncoated WC-Co)',
    props: { density: p(14900, 'kg/m³', 'typical', TYP), E: p(630, 'GPa', 'typical', TYP), k: p(90, 'W/m·K', 'estimated', TYP, 'WC-Co K-grades ≈80–110; P-grades with TiC/TaC ≈30–60'), cp: p(210, 'J/kg·K', 'estimated', TYP), HV: p(1600, 'HV', 'typical', TYP), Tmax: p(1000, '°C', 'typical', TYP) },
    taylor: { steel: { n: 0.25, C: 500, status: 'textbook', source: GROOVER }, nonSteel: { n: 0.25, C: 900, status: 'textbook', source: GROOVER } },
  },
  {
    id: 'coated-carbide', name: 'Coated carbide (TiAlN / TiCN–Al₂O₃)',
    props: { density: p(14500, 'kg/m³', 'typical', TYP), E: p(600, 'GPa', 'typical', TYP), k: p(50, 'W/m·K', 'estimated', TYP), cp: p(220, 'J/kg·K', 'estimated', TYP), HV: p(1700, 'HV', 'typical', TYP, 'substrate'), Tmax: p(1100, '°C', 'typical', TYP) },
    taylor: { steel: null, nonSteel: null },
  },
  {
    id: 'ceramic', name: 'Ceramic (Al₂O₃-based)',
    props: { density: p(3950, 'kg/m³', 'typical', TYP), E: p(380, 'GPa', 'typical', TYP), k: p(30, 'W/m·K', 'typical', TYP), cp: p(880, 'J/kg·K', 'typical', TYP), HV: p(1800, 'HV', 'typical', TYP), Tmax: p(1200, '°C', 'typical', TYP) },
    taylor: { steel: { n: 0.6, C: 3000, status: 'textbook', source: GROOVER }, nonSteel: null },
  },
  {
    id: 'cbn', name: 'PCBN',
    props: { density: p(3480, 'kg/m³', 'typical', TYP), E: p(680, 'GPa', 'estimated', TYP), k: p(100, 'W/m·K', 'estimated', TYP, 'PCBN grades ≈40–200 W/m·K'), cp: p(800, 'J/kg·K', 'estimated', TYP), HV: p(3500, 'HV', 'typical', TYP), Tmax: p(1300, '°C', 'typical', TYP) },
    taylor: { steel: null, nonSteel: null },
  },
  {
    id: 'pcd', name: 'PCD',
    props: { density: p(3900, 'kg/m³', 'estimated', TYP), E: p(850, 'GPa', 'estimated', TYP), k: p(500, 'W/m·K', 'estimated', TYP, 'strongly grade-dependent'), cp: p(700, 'J/kg·K', 'estimated', TYP), HV: p(8000, 'HV', 'typical', TYP), Tmax: p(700, '°C', 'typical', TYP, 'graphitisation in air') },
    taylor: { steel: null, nonSteel: null, note: 'PCD is not used on ferrous workpieces (chemical wear).' },
  },
];

/**
 * Tool geometry library.
 * Turning angle conventions (ISO 3002):
 *   rake γ [deg]   effective normal rake in the holder (negative inserts in negative holders ≈ −6°)
 *   kr [deg]       tool cutting edge angle κr (major edge vs feed direction); 90° = square shoulder
 *   krMinor [deg]  minor (end) cutting edge angle κr'
 *   rn [mm]        nose radius rε
 *   edgeLen [mm]   modelled cutting-edge length
 */
export const TOOLS = [
  // ---------- turning ----------
  { id: 'cnmg-0408-carb', kind: 'turning', subtype: 'general', name: 'CNMG 120408 carbide in PCLNR holder', material: 'carbide', rake: -6, clearance: 6, kr: 95, krMinor: 5, rn: 0.8, edgeLen: 12 },
  { id: 'cnmg-0408-coat', kind: 'turning', subtype: 'general', name: 'CNMG 120408 coated carbide (PCLNR)', material: 'coated-carbide', rake: -6, clearance: 6, kr: 95, krMinor: 5, rn: 0.8, edgeLen: 12 },
  { id: 'snmg-1204-carb', kind: 'turning', subtype: 'general', name: 'SNMG 120408 carbide in PSBNR holder (κr 75°)', material: 'carbide', rake: -6, clearance: 6, kr: 75, krMinor: 15, rn: 0.8, edgeLen: 12 },
  { id: 'dnmg-1504-carb', kind: 'turning', subtype: 'general', name: 'DNMG 150404 carbide (PDJNR, κr 93°)', material: 'carbide', rake: -6, clearance: 6, kr: 93, krMinor: 32, rn: 0.4, edgeLen: 14 },
  { id: 'hss-bit', kind: 'turning', subtype: 'general', name: 'HSS ground tool bit (γ 10°, κr 75°)', material: 'hss', rake: 10, clearance: 8, kr: 75, krMinor: 15, rn: 0.4, edgeLen: 10 },
  { id: 'ceramic-snga', kind: 'turning', subtype: 'general', name: 'SNGA 120408 ceramic (κr 75°)', material: 'ceramic', rake: -6, clearance: 6, kr: 75, krMinor: 15, rn: 0.8, edgeLen: 12 },
  { id: 'groove-3', kind: 'turning', subtype: 'grooving', name: 'Grooving/parting blade 3 mm carbide', material: 'carbide', rake: 6, clearance: 7, kr: 90, krMinor: 90, rn: 0.2, width: 3, edgeLen: 3 },
  { id: 'thread-60', kind: 'turning', subtype: 'threading', name: '60° metric threading insert (16ER full form)', material: 'coated-carbide', rake: 0, clearance: 8, threadAngle: 60, rn: 0.1, edgeLen: 4 },
  { id: 'boring-bar', kind: 'turning', subtype: 'boring', name: 'Boring bar Ø16, CCMT 09T304 carbide', material: 'carbide', rake: 0, clearance: 7, kr: 95, krMinor: 5, rn: 0.4, edgeLen: 6, barDia: 16, overhang: 64 },
  // ---------- drilling ----------
  { id: 'drill-hss-10', kind: 'drill', name: 'HSS twist drill Ø10 (118°)', material: 'hss', D: 10, pointAngle: 118, helix: 30, webRatio: 0.15, chiselAngle: 125, length: 133, flute: 87 },
  { id: 'drill-hss-20', kind: 'drill', name: 'HSS twist drill Ø20 (118°)', material: 'hss', D: 20, pointAngle: 118, helix: 30, webRatio: 0.14, chiselAngle: 125, length: 205, flute: 140 },
  { id: 'drill-carb-10', kind: 'drill', name: 'Solid carbide drill Ø10 (140°)', material: 'carbide', D: 10, pointAngle: 140, helix: 30, webRatio: 0.18, chiselAngle: 125, length: 103, flute: 61 },
  { id: 'centre-drill', kind: 'drill', name: 'Centre drill A4 (HSS, 118°)', material: 'hss', D: 4, pointAngle: 118, helix: 0, webRatio: 0.2, chiselAngle: 125, length: 50, flute: 6 },
  { id: 'reamer-10', kind: 'drill', subtype: 'reamer', name: 'HSS machine reamer Ø10 H7 (6 flutes, 45° chamfer)', material: 'hss', D: 10, pointAngle: 90, helix: 0, rake: 5, webRatio: 0, chiselAngle: 0, length: 133, flute: 38, z: 6 },
  { id: 'cbore-16', kind: 'drill', subtype: 'counterbore', name: 'HSS counterbore Ø16 (3 flutes, flat)', material: 'hss', D: 16, pointAngle: 180, helix: 15, rake: 10, webRatio: 0, length: 120, flute: 30, z: 3 },
  { id: 'csink-20', kind: 'drill', subtype: 'countersink', name: 'HSS countersink Ø20 × 90° (3 flutes)', material: 'hss', D: 20, pointAngle: 90, helix: 0, rake: 5, webRatio: 0, length: 70, flute: 12, z: 3 },
  { id: 'tap-m10', kind: 'drill', subtype: 'tap', name: 'HSS machine tap M10×1.5 (3 flutes, 3-thread chamfer)', material: 'hss', D: 10, pitch: 1.5, pointAngle: 180, helix: 0, rake: 8, webRatio: 0, length: 90, flute: 20, z: 3, chamferThreads: 3 },
  { id: 'drill-hss-8', kind: 'drill', name: 'HSS twist drill Ø8.5 (118°, M10 tap drill)', material: 'hss', D: 8.5, pointAngle: 118, helix: 30, webRatio: 0.15, chiselAngle: 125, length: 117, flute: 75 },
  // ---------- milling ----------
  { id: 'em-10-4f', kind: 'mill', subtype: 'end', name: 'Carbide end mill Ø10, 4 flutes, 30° helix', material: 'carbide', D: 10, z: 4, helix: 30, rake: 8, cornerR: 0, length: 72, flute: 22 },
  { id: 'em-16-3f-hss', kind: 'mill', subtype: 'end', name: 'HSS end mill Ø16, 3 flutes, 30° helix', material: 'hss', D: 16, z: 3, helix: 30, rake: 10, cornerR: 0, length: 92, flute: 32 },
  { id: 'slot-12-2f', kind: 'mill', subtype: 'slot', name: 'Carbide slot drill Ø12, 2 flutes', material: 'carbide', D: 12, z: 2, helix: 30, rake: 8, cornerR: 0, length: 83, flute: 26 },
  { id: 'ball-10-2f', kind: 'mill', subtype: 'ball', name: 'Carbide ball-nose Ø10, 2 flutes', material: 'carbide', D: 10, z: 2, helix: 30, rake: 8, cornerR: 5, length: 72, flute: 22 },
  { id: 'face-63-5', kind: 'mill', subtype: 'face', name: 'Face mill Ø63, 5 inserts, κr 45° (carbide)', material: 'carbide', D: 63, z: 5, helix: 0, rake: 0, kr: 45, cornerR: 0.8, length: 40, flute: 6 },
  { id: 'face-50-4-90', kind: 'mill', subtype: 'face', name: 'Shoulder mill Ø50, 4 inserts, κr 90°', material: 'carbide', D: 50, z: 4, helix: 0, rake: 5, kr: 90, cornerR: 0.8, length: 40, flute: 10 },
  // horizontal-arbor cutters (axis ∥ y)
  { id: 'slab-63', kind: 'mill', subtype: 'slab', name: 'HSS slab (plain) mill Ø63 × 50 wide, 8 teeth, 25° helix', material: 'hss', D: 63, z: 8, helix: 25, rake: 10, width: 50, horizontal: true },
  { id: 'side-80', kind: 'mill', subtype: 'side', name: 'HSS side & face cutter Ø80 × 10 wide, 18 teeth', material: 'hss', D: 80, z: 18, helix: 0, rake: 10, width: 10, horizontal: true },
  { id: 'angle-63', kind: 'mill', subtype: 'angle', name: 'HSS single-angle cutter Ø63, 45°, 16 teeth', material: 'hss', D: 63, z: 16, helix: 0, rake: 8, width: 16, angle: 45, horizontal: true },
];

export function getTool(id, extra = []) {
  return [...extra, ...TOOLS].find((t) => t.id === id);
}
export function getToolMaterial(id) {
  return TOOL_MATERIALS.find((m) => m.id === id);
}
/** Taylor-table class of a workpiece: 'steel' (ISO P, M), 'nonSteel' (ISO K, N) or null (S, H: no textbook default). */
export function taylorClass(material) {
  const g = (material.group || '')[0];
  if (g === 'P' || g === 'M') return 'steel';
  if (g === 'K' || g === 'N') return 'nonSteel';
  return null;
}

/** Taylor constants for a tool/material pair, or null if no defensible default exists. */
export function defaultTaylor(toolMaterialId, workMaterial) {
  const tm = getToolMaterial(toolMaterialId);
  const cls = taylorClass(workMaterial);
  if (!tm || !cls) return null;
  const t = tm.taylor[cls];
  return t ? { ...t, m: 0, p: 0, f0: 0.25, ap0: 2.0 } : null;
}
