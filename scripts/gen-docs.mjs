// Generates MATHEMATICAL_MODELS.md and VALIDATION_REGISTER.md from the model registry and data tables,
// so the documentation can never drift from the code. Run: node scripts/gen-docs.mjs
import { writeFileSync } from 'node:fs';
import { MODELS, STATUS_LABEL } from '../src/core/models.js';
import { MATERIALS, SOURCES } from '../src/core/materials.js';
import { TOOL_MATERIALS, GROOVER } from '../src/core/tools.js';
import { VERSION } from '../src/core/version.js';

const byProcess = {};
for (const m of MODELS) (byProcess[m.process] ||= []).push(m);

let md = `# MachinaSim — Mathematical models\n\n_Generated from \`src/core/models.js\` (v${VERSION}). Do not edit by hand; run \`node scripts/gen-docs.mjs\`._\n\n`;
md += 'Internal units: mm, N, N·m, kW, m/min, rev/min, °C, s (tool life in min). See `src/core/units.js`.\n\n';
for (const [proc, list] of Object.entries(byProcess)) {
  md += `## ${proc}\n\n`;
  for (const m of list) {
    md += `### ${m.id} — ${m.name}\n\n- **Equation(s):** \`${m.eq}\`\n- **Variables / inputs:** ${m.vars}\n- **Assumptions:** ${m.assumptions}\n- **Validity range:** ${m.validity}\n- **Status:** ${STATUS_LABEL[m.status]}\n- **Automated verification:** ${m.tests}\n- **References:** ${m.refs}\n\n`;
  }
}
md += '## Data sources\n\n' + Object.entries(SOURCES).map(([k, v]) => `- **${k}:** ${v}`).join('\n') + `\n- **Taylor defaults:** ${GROOVER}\n`;
writeFileSync(new URL('../MATHEMATICAL_MODELS.md', import.meta.url), md);

let vr = `# MachinaSim — Verification & validation register\n\n_Generated from \`src/core/models.js\` (v${VERSION})._\n\n`;
vr += 'Status vocabulary (specification §23): **Implemented, unvalidated** · **Verified against analytical benchmarks** (the code reproduces an equation or an independent analytical/numerical solution in the automated tests) · **Calibrated against experimental data** · **Independently validated** · **Limited / experimental**.\n\n';
vr += '> No model in this release is marked _calibrated_ or _independently validated_: no experimental data set has been used by the developers. Calibration is performed by the user in Research → Experiments, and calibrated coefficients are tagged `calibrated` with their data source.\n\n';
vr += '| ID | Model | Status | Automated test | Validity |\n|---|---|---|---|---|\n';
for (const m of MODELS) vr += `| ${m.id} | ${m.name} | ${STATUS_LABEL[m.status]} | ${m.tests} | ${m.validity} |\n`;
vr += '\n## Verification benchmarks in the test suite\n\n';
vr += [
  'Kienzle force law reproduced exactly (physics.test.js).',
  'Geometry-coupled turning: chip area from the stamped profile equals f·ap − f·Rt/2 within 0.5 %; engaged edge = ap within 1 %; Fc within 1 % of the closed form (lathe.test.js).',
  'Machined-profile roughness from the geometry engine equals the exact kinematic Ra/Rt within 8 % (lathe.test.js).',
  'Volume conservation: removed volume by Pappus = workpiece volume loss within 0.5 % (lathe.test.js).',
  'Threading reaches ISO 68-1 depth H1 = 0.61343P within 2 %; symmetric flank forces cancel axially (lathe.test.js).',
  'Flank wear: ΔD = 2·VB·tanα nose recession reproduced within 5 %; forces increase (lathe.test.js).',
  'Milling: numerical mean forces equal Altintas closed-form averages (slot, up, down) within 0.2 % (physics.test.js).',
  'Milling with Z-map engagement: slot and shoulder forces equal analytical cycles within 2–6 % (prismatic.test.js).',
  'Drilling lip model torque within ±30 % of the Sandvik reference formula (physics.test.js) — a loose cross-check, not validation.',
  'FD tool conduction equals the semi-infinite erfc solution within 3 % (physics.test.js).',
  'Taylor–Miner wear integrator reaches VBc exactly at the Taylor life (physics.test.js).',
  'Tlusty minimum stability limit equals 2kζ(1+ζ)/Ks within 0.2 %; Altintas–Budak directional factors equal numerical integrals (physics.test.js).',
  'Kienzle, Taylor and extended-Taylor calibration recover known constants from synthetic data exactly (research.test.js).',
  'ToolVision measures a synthetic wear land within 3 % (mean) and ±2 px (max) (research.test.js).',
  'V2: JC softening factor is exactly 1 at the kc reference and < 1 at higher speed; Lee–Shaffer energy balance; edge-force and wear-progression calibration recover constants (lathe-v2-mech.test.js).',
  'V2: ADI thermal scheme conserves energy to round-off; constant-flux surface temperature within 2 % of 2q√(αt/π)/k; chip-/tool-side interface temperatures equal within 0.5 K (lathe-v2-thermal.test.js).',
  'V2: Weibull chipping survival at t = η equals e^−1 within 4 % (3000 edges); crater lowers Fc; nose wear sets recession (lathe-v2-wear.test.js).',
  'V2: deflection feedback reproduces the cantilever oversize 2·Fp·z³/(3EI) within 10 % (lathe-v2-wear.test.js).',
  'V2: time-domain chatter is stable at 0.7·b_lim and unstable at 1.4·b_lim of the Tlusty envelope at two speeds (lathe-v2-dyn.test.js).',
].map((x) => `- ${x}`).join('\n') + '\n\n## Data provenance summary\n\n| Material | kc1.1 / mc status | Physical properties | Johnson–Cook |\n|---|---|---|---|\n' +
  MATERIALS.map((m) => `| ${m.name} | ${m.kienzle.kc11.status} / ${m.kienzle.mc.status} | ${[...new Set(Object.values(m.props).map((p) => p.status))].join(', ')} | ${m.jc ? m.jc.status : '—'} |`).join('\n') +
  '\n\n| Tool material | Property status | Taylor defaults |\n|---|---|---|\n' + TOOL_MATERIALS.map((t) => `| ${t.name} | ${[...new Set(Object.values(t.props).map((p) => p.status))].join(', ')} | ${t.taylor.steel ? `steel n=${t.taylor.steel.n}, C=${t.taylor.steel.C}` : 'steel: none'}; ${t.taylor.nonSteel ? `non-steel n=${t.taylor.nonSteel.n}, C=${t.taylor.nonSteel.C}` : 'non-steel: none'} |`).join('\n') + '\n';
writeFileSync(new URL('../VALIDATION_REGISTER.md', import.meta.url), vr);
console.log('Generated MATHEMATICAL_MODELS.md and VALIDATION_REGISTER.md');
