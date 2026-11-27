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
  async show() {
    let list = [];
    try { list = await this.app.projects(); } catch (e) { this.recent.replaceChildren(h('div', { class: 'warn' }, `Project storage unavailable: ${e.message}`)); return; }
    const kind = await this.app.store.kind().catch(() => '?');
    const est = await this.app.store.estimate();
    const info = h('p', { class: 'muted' }, `Stored in ${kind === 'indexeddb' ? 'IndexedDB' : 'localStorage (≈ 5 MB limit)'}${est?.quota ? ` · ${(est.usage / 1e6).toFixed(1)} MB used of ≈ ${(est.quota / 1e9).toFixed(1)} GB available to this site` : ''}${this.app.store.migrated ? ` · ${this.app.store.migrated} project(s) moved from older localStorage storage` : ''}. Use Export for a portable copy.`);
    const act = (fn) => async () => { try { await fn(); } catch (e) { toast(e.message, 'error'); } this.show(); };
    this.recent.replaceChildren(list.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Saved'), h('th', {}, 'Size'), h('th', {}, 'Workspaces'), h('th', {}, ''))),
      h('tbody', {}, list.map((p) => h('tr', {}, h('td', {}, p.name), h('td', {}, new Date(p.saved).toLocaleString()), h('td', {}, p.size ? `${(p.size / 1e6).toFixed(2)} MB` : '—'), h('td', {}, (p.pages || []).join(', ')),
        h('td', {}, h('button', { class: 'mini', onclick: async () => { try { await this.app.loadProject(p.name); } catch (e) { toast(e.message, 'error'); } } }, 'Load'), ' ',
          h('button', { class: 'mini', onclick: act(() => this.app.duplicateProject(p.name)) }, 'Duplicate'), ' ',
          h('button', { class: 'mini', onclick: () => { if (confirm(`Delete “${p.name}”?`)) act(() => this.app.deleteProject(p.name))(); } }, 'Delete')))))) : h('p', { class: 'muted' }, 'No saved projects yet. Use Save in the header to store the state of all open workspaces.'), info);
  }
}
