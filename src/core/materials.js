// Workpiece material database with per-property provenance.
//
// Data status vocabulary (see VALIDATION_REGISTER.md):
//   'published'      value taken from an identified published source for this grade
//   'analogous'      published value for a closely related grade (mapping stated)
//   'typical'        handbook typical value; real stock varies with heat treatment — verify
//   'estimated'      engineering estimate; must be confirmed or calibrated by the user
//   'calibrated'     fitted by the user from their own experimental data (set at runtime)
//   'measured'       entered by the user from measurement (set at runtime)
//
// Nothing here is a validated machining prediction. kc1.1/mc values are cutting-tool-maker
// group values (VDI 3323 groups) — they are starting points, not lab-specific constants.

export const SOURCES = {
  ISCAR: 'ISCAR, "Materials group" table (DIN/ISO 513, VDI 3323): kc1 = specific cutting force for 1 mm² chip section, mc = chip thickness exponent. https://www.iscar.com/lms/wp-content/uploads/2021/04/Materials-group.pdf',
  SECO: 'Seco Tools, Milling catalogue 2025, SMG workpiece classification (kc1.1, mc)',
  ASM: 'ASM Handbook / MatWeb typical room-temperature property values for the named (or equivalent) grade',
  JC83: 'G.R. Johnson, W.H. Cook (1983), A constitutive model and data for metals subjected to large strains, high strain rates and high temperatures, Proc. 7th Int. Symp. Ballistics, 541–547',
  JD02: 'S.P.F.C. Jaspers, J.H. Dautzenberg (2002), Material behaviour in conditions similar to metal cutting: flow stress in the primary shear zone, J. Mater. Process. Technol. 122, 322–330',
  LL98: 'W.S. Lee, C.F. Lin (1998), High-temperature deformation behaviour of Ti6Al4V alloy evaluated by high strain-rate compression tests, J. Mater. Process. Technol. 75, 127–136',
};

const p = (value, unit, status, source, note) => ({ value, unit, status, source, ...(note ? { note } : {}) });

/**
 * Each material:
 *  id, name, designation, group (ISO 513 letter + VDI 3323 group no.)
 *  props: density [kg/m³], E [GPa], nu [-], k [W/m·K], cp [J/kg·K], HB, Rm [MPa], Tm [°C]
 *  kienzle: kc11 [N/mm²], mc [-]  (main cutting force, h and b in mm)
 *  jc: Johnson–Cook flow stress parameters (A,B [MPa], n, C, m, Tm [K], eps0 [1/s]) where published
 *  frictionMu: tool–chip mean friction coefficient used for thrust-force ratio (ESTIMATED by default)
 *  refRake: reference rake angle γ0 [deg] for which kc1.1 applies (VDI convention: 6° steel, 0°? see note)
 */
export const MATERIALS = [
  {
    id: 'mild-steel', name: 'Mild steel', designation: 'AISI 1018 / EN3 / C15 (<0.25 %C, annealed)', group: 'P · VDI 1',
    props: {
      density: p(7870, 'kg/m³', 'typical', SOURCES.ASM), E: p(205, 'GPa', 'typical', SOURCES.ASM), nu: p(0.29, '-', 'typical', SOURCES.ASM),
      k: p(51.9, 'W/m·K', 'typical', SOURCES.ASM), cp: p(486, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(125, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(420, 'MPa', 'published', SOURCES.ISCAR, 'Group reference tensile strength'), Tm: p(1515, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(1350, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.21, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 350, B: 275, n: 0.36, C: 0.022, m: 1.0, TmK: 1811, eps0: 1, status: 'analogous', source: SOURCES.JC83 + ' — 1006 steel used as analogue' },
  },
  {
    id: 'en8', name: 'EN8 steel', designation: 'EN8 / 080M40 / C40–C45 (≈0.4 %C, normalised)', group: 'P · VDI 2',
    props: {
      density: p(7845, 'kg/m³', 'typical', SOURCES.ASM), E: p(200, 'GPa', 'typical', SOURCES.ASM), nu: p(0.29, '-', 'typical', SOURCES.ASM),
      k: p(50.7, 'W/m·K', 'typical', SOURCES.ASM), cp: p(486, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(190, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(650, 'MPa', 'published', SOURCES.ISCAR), Tm: p(1460, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(1500, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.22, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 553.1, B: 600.8, n: 0.234, C: 0.0134, m: 1.0, TmK: 1733, eps0: 1, status: 'analogous', source: SOURCES.JD02 + ' — AISI 1045 used as analogue' },
  },
  {
    id: 'en24', name: 'EN24 steel', designation: 'EN24 / 817M40 / ≈AISI 4340 (Q&T ≈1000 MPa)', group: 'P · VDI 8',
    props: {
      density: p(7850, 'kg/m³', 'typical', SOURCES.ASM), E: p(205, 'GPa', 'typical', SOURCES.ASM), nu: p(0.29, '-', 'typical', SOURCES.ASM),
      k: p(44.5, 'W/m·K', 'typical', SOURCES.ASM), cp: p(475, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(300, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(1000, 'MPa', 'published', SOURCES.ISCAR), Tm: p(1427, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(1725, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.24, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 792, B: 510, n: 0.26, C: 0.014, m: 1.03, TmK: 1793, eps0: 1, status: 'analogous', source: SOURCES.JC83 + ' — 4340 steel' },
  },
  {
    id: 'ss304', name: 'Stainless steel 304', designation: 'AISI 304 / X5CrNi18-10 (austenitic)', group: 'M · VDI 14',
    props: {
      density: p(8000, 'kg/m³', 'typical', SOURCES.ASM), E: p(193, 'GPa', 'typical', SOURCES.ASM), nu: p(0.29, '-', 'typical', SOURCES.ASM),
      k: p(16.2, 'W/m·K', 'typical', SOURCES.ASM), cp: p(500, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(180, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(600, 'MPa', 'published', SOURCES.ISCAR), Tm: p(1400, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(2150, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.20, '-', 'published', SOURCES.ISCAR) },
  },
  {
    id: 'ss316', name: 'Stainless steel 316', designation: 'AISI 316 / X5CrNiMo17-12-2 (austenitic)', group: 'M · VDI 14',
    props: {
      density: p(8000, 'kg/m³', 'typical', SOURCES.ASM), E: p(193, 'GPa', 'typical', SOURCES.ASM), nu: p(0.30, '-', 'typical', SOURCES.ASM),
      k: p(16.3, 'W/m·K', 'typical', SOURCES.ASM), cp: p(500, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(180, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(600, 'MPa', 'published', SOURCES.ISCAR), Tm: p(1375, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(2150, 'N/mm²', 'published', SOURCES.ISCAR, 'VDI group 14 (austenitic) value; not 316-specific'), mc: p(0.20, '-', 'published', SOURCES.ISCAR) },
  },
  {
    id: 'cast-iron', name: 'Grey cast iron', designation: 'EN-GJL-250 / GG25 (ferritic-pearlitic)', group: 'K · VDI 15',
    props: {
      density: p(7200, 'kg/m³', 'typical', SOURCES.ASM), E: p(110, 'GPa', 'typical', SOURCES.ASM, 'Grey iron modulus varies strongly (≈80–140 GPa)'), nu: p(0.26, '-', 'typical', SOURCES.ASM),
      k: p(46, 'W/m·K', 'typical', SOURCES.ASM), cp: p(490, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(180, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(250, 'MPa', 'typical', SOURCES.ASM), Tm: p(1200, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(1150, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.20, '-', 'published', SOURCES.ISCAR) },
  },
  {
    id: 'al6061', name: 'Aluminium 6061-T6', designation: 'AA6061-T6 (wrought, age-hardenable)', group: 'N · VDI 22',
    props: {
      density: p(2700, 'kg/m³', 'typical', SOURCES.ASM), E: p(68.9, 'GPa', 'typical', SOURCES.ASM), nu: p(0.33, '-', 'typical', SOURCES.ASM),
      k: p(167, 'W/m·K', 'typical', SOURCES.ASM), cp: p(896, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(95, 'HB', 'typical', SOURCES.ASM),
      Rm: p(310, 'MPa', 'typical', SOURCES.ASM), Tm: p(582, '°C', 'typical', SOURCES.ASM, 'solidus'),
    },
    kienzle: { kc11: p(800, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.25, '-', 'published', SOURCES.ISCAR) },
  },
  {
    id: 'al7075', name: 'Aluminium 7075-T6', designation: 'AA7075-T6 (wrought, age-hardenable)', group: 'N · VDI 22',
    props: {
      density: p(2810, 'kg/m³', 'typical', SOURCES.ASM), E: p(71.7, 'GPa', 'typical', SOURCES.ASM), nu: p(0.33, '-', 'typical', SOURCES.ASM),
      k: p(130, 'W/m·K', 'typical', SOURCES.ASM), cp: p(960, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(150, 'HB', 'typical', SOURCES.ASM),
      Rm: p(572, 'MPa', 'typical', SOURCES.ASM), Tm: p(477, '°C', 'typical', SOURCES.ASM, 'solidus'),
    },
    kienzle: { kc11: p(800, 'N/mm²', 'published', SOURCES.ISCAR, 'VDI group 22 value'), mc: p(0.25, '-', 'published', SOURCES.ISCAR) },
  },
  {
    id: 'copper', name: 'Copper (electrolytic)', designation: 'Cu-ETP / C11000', group: 'N · VDI 28',
    props: {
      density: p(8940, 'kg/m³', 'typical', SOURCES.ASM), E: p(115, 'GPa', 'typical', SOURCES.ASM), nu: p(0.31, '-', 'typical', SOURCES.ASM),
      k: p(388, 'W/m·K', 'typical', SOURCES.ASM), cp: p(385, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(100, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(250, 'MPa', 'typical', SOURCES.ASM, 'half-hard'), Tm: p(1083, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(700, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.27, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 90, B: 292, n: 0.31, C: 0.025, m: 1.09, TmK: 1356, eps0: 1, status: 'published', source: SOURCES.JC83 + ' — OFHC copper' },
  },
  {
    id: 'brass', name: 'Brass', designation: 'CuZn39Pb3 / C36000 (free-cutting)', group: 'N · VDI 27',
    props: {
      density: p(8500, 'kg/m³', 'typical', SOURCES.ASM), E: p(97, 'GPa', 'typical', SOURCES.ASM), nu: p(0.31, '-', 'typical', SOURCES.ASM),
      k: p(115, 'W/m·K', 'typical', SOURCES.ASM), cp: p(380, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(90, 'HB', 'published', SOURCES.ISCAR),
      Rm: p(400, 'MPa', 'typical', SOURCES.ASM), Tm: p(885, '°C', 'typical', SOURCES.ASM, 'solidus'),
    },
    kienzle: { kc11: p(700, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.27, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 112, B: 505, n: 0.42, C: 0.009, m: 1.68, TmK: 1189, eps0: 1, status: 'analogous', source: SOURCES.JC83 + ' — cartridge brass (CuZn30)' },
  },
  {
    id: 'ti64', name: 'Titanium Ti-6Al-4V', designation: 'Ti-6Al-4V (Grade 5, α+β)', group: 'S · VDI 37',
    props: {
      density: p(4430, 'kg/m³', 'typical', SOURCES.ASM), E: p(113.8, 'GPa', 'typical', SOURCES.ASM), nu: p(0.342, '-', 'typical', SOURCES.ASM),
      k: p(6.7, 'W/m·K', 'typical', SOURCES.ASM), cp: p(526, 'J/kg·K', 'typical', SOURCES.ASM), HB: p(334, 'HB', 'typical', SOURCES.ASM),
      Rm: p(1050, 'MPa', 'published', SOURCES.ISCAR), Tm: p(1604, '°C', 'typical', SOURCES.ASM),
    },
    kienzle: { kc11: p(2110, 'N/mm²', 'published', SOURCES.ISCAR), mc: p(0.22, '-', 'published', SOURCES.ISCAR) },
    jc: { A: 782.7, B: 498.4, n: 0.28, C: 0.028, m: 1.0, TmK: 1878, eps0: 1e-5, status: 'published', source: SOURCES.LL98 },
  },
];

/** Default tool–chip friction coefficient for the thrust-force ratio. ESTIMATED. */
export const DEFAULT_FRICTION_MU = p(0.5, '-', 'estimated', 'Engineering estimate; orthogonal-cutting tests on steels typically give apparent μ ≈ 0.4–0.9. Calibrate from measured Ff/Fc.');

/** Reference rake angle for kc1.1 (König/Klocke convention: γ0 = +6° steel, +2° cast iron). */
export function referenceRake(material) {
  return material.group.startsWith('K') ? 2 : 6;
}

export function val(x) {
  return x && typeof x === 'object' && 'value' in x ? x.value : x;
}

/** Plain-number view of a material, used by the physics engines. */
export function materialParams(m) {
  return {
    id: m.id, name: m.name,
    density: val(m.props.density),
    E: val(m.props.E), nu: val(m.props.nu), k: val(m.props.k), cp: val(m.props.cp),
    HB: val(m.props.HB), Rm: val(m.props.Rm), Tm: val(m.props.Tm),
    kc11: val(m.kienzle.kc11), mc: val(m.kienzle.mc),
    mu: m.frictionMu != null ? val(m.frictionMu) : DEFAULT_FRICTION_MU.value,
    rake0: m.refRake != null ? val(m.refRake) : referenceRake(m),
    jc: m.jc || null,
  };
}

export function getMaterial(id, extra = []) {
  return [...extra, ...MATERIALS].find((m) => m.id === id);
}

/** Johnson–Cook flow stress [MPa]. eps plastic strain, rate [1/s], T [°C]. */
export function johnsonCook(jc, eps, rate, T, T0 = 20) {
  const TrK = T0 + 273.15;
  const Th = Math.min(1, Math.max(0, (T + 273.15 - TrK) / (jc.TmK - TrK)));
  const rateTerm = 1 + jc.C * Math.log(Math.max(rate / jc.eps0, 1));
  return (jc.A + jc.B * Math.pow(Math.max(eps, 0), jc.n)) * rateTerm * (1 - Math.pow(Th, jc.m));
}
