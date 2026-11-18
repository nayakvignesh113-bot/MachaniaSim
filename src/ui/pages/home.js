// Dashboard: process selection, recent projects, model status overview.
import { h, toast } from '../dom.js';
import { MODELS, STATUS_LABEL } from '../../core/models.js';
import { VERSION } from '../../core/version.js';

const PROCESSES = [
  { id: 'lathe', t: 'Centre lathe', d: 'Straight, facing, step, taper, grooving, parting, threading, drilling, boring, chamfering. Exact axisymmetric material removal; forces from the actual engaged chip section; wear–force–temperature coupling.', tag: '3-D · geometry-coupled' },
  { id: 'drill', t: 'Radial drilling machine', d: 'Arm/head inverse kinematics; centre, twist, step drilling, reaming, counterboring, countersinking, tapping. Lip-by-lip mechanistic thrust and torque with engagement from the Z-map.', tag: '3-D · geometry-coupled' },
  { id: 'mill', t: 'Milling (vertical & horizontal)', d: 'Face, end, slot, side, slab, angular, profile, contour, ball-nose and pocket milling. Tooth-by-tooth Altintas mechanistic forces, per-tooth wear, stability lobes.', tag: '3-D · geometry-coupled' },
  { id: 'grind', t: 'Grinding', d: 'Surface, cylindrical and internal grinding: specific-energy forces and power, Jaeger temperature and burn check, G-ratio wheel wear, dressing.', tag: 'mechanics + 2-D' },
  { id: 'recip', t: 'Shaping & slotting', d: 'Quick-return kinematics, stroke-by-stroke material removal, cutting-stroke forces and power.', tag: 'mechanics + 2-D' },
  { id: 'saw', t: 'Sawing', d: 'Horizontal/vertical band saw and power hacksaw: tooth engagement, feed per tooth, cutting force, kerf progression, cutting time.', tag: 'mechanics + 2-D' },
  { id: 'broach', t: 'Broaching', d: 'Internal/external broaches: rise per tooth, engaged teeth, force profile vs stroke, final size.', tag: 'mechanics + 2-D' },
];

export class HomePage {
  constructor(root, app) {
    this.app = app;
    this.recent = h('div');
    const counts = {};
    for (const m of MODELS) counts[m.status] = (counts[m.status] || 0) + 1;
    root.append(h('div', { class: 'content' },
      h('h1', {}, 'MachinaSim'),
      h('p', { class: 'lead' }, `Universal conventional machining simulation & research platform · v${VERSION}. Every result names its model, inputs, data status and limitations.`),
      h('div', { class: 'cards' }, PROCESSES.map((p) => h('a', { class: 'card', href: `#/${p.id}` }, h('h3', {}, p.t), h('p', {}, p.d), h('span', { class: 'badge tag' }, p.tag)))),
      h('h2', {}, 'Research'),
      h('div', { class: 'cards' },
        h('a', { class: 'card', href: '#/research' }, h('h3', {}, 'Experiments, calibration & DOE'), h('p', {}, 'Import CSV/XLSX measurements, compare with models (MAE, RMSE, R²), calibrate Kienzle and Taylor constants with separate validation data, factorial/Taguchi designs, ANOVA, RSM, GA optimisation, Pareto fronts.')),
        h('a', { class: 'card', href: '#/vision' }, h('h3', {}, 'ToolVision'), h('p', {}, 'Calibrated microscope-image measurement of flank wear (VB, VBmax, area) with confidence and uncertainty; wear-progression tracking.')),
        h('a', { class: 'card', href: '#/library' }, h('h3', {}, 'Material & tool libraries'), h('p', {}, 'Editable databases with per-property provenance: published, analogous, typical, estimated, calibrated.')),
        h('a', { class: 'card', href: '#/models' }, h('h3', {}, 'Models & validation register'), h('p', {}, Object.entries(counts).map(([k, v]) => `${v} ${STATUS_LABEL[k].toLowerCase()}`).join(' · ')))),
      h('h2', {}, 'Saved projects (this browser)'), this.recent));
    this.show();
  }
  show() {
    const list = this.app.projects();
    this.recent.replaceChildren(list.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Saved'), h('th', {}, 'Workspaces'), h('th', {}, ''))),
      h('tbody', {}, list.map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, new Date(p.saved).toLocaleString()), h('td', {}, (p.pages || []).join(', ')),
        h('td', {}, h('button', { class: 'mini', onclick: async () => { try { await this.app.loadProject(p.name); } catch (e) { toast(e.message, 'error'); } } }, 'Load'), ' ',
          h('button', { class: 'mini', onclick: () => { const d = this.app.serializeProject(p.name); void d; const j = localStorage.getItem(`ms.project.${p.name}`); const c = JSON.parse(j); c.name = `${p.name} (copy)`; localStorage.setItem(`ms.project.${c.name}`, JSON.stringify(c)); const l = this.app.projects(); l.unshift({ ...p, name: c.name }); localStorage.setItem('ms.projects', JSON.stringify(l)); this.show(); } }, 'Duplicate'), ' ',
          h('button', { class: 'mini', onclick: () => { if (confirm(`Delete “${p.name}”?`)) { this.app.deleteProject(p.name); this.show(); } } }, 'Delete')))))) : h('p', { class: 'muted' }, 'No saved projects yet. Use Save in the header to store the state of all open workspaces.'));
  }
}
