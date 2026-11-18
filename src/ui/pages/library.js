// Material and tool libraries with provenance; custom (user) materials and tools.
import { h, tabs, table, statusBadge, toast, numField, download, pickFile } from '../dom.js';
import { lib } from '../common.js';
import { MATERIALS, SOURCES } from '../../core/materials.js';
import { TOOL_MATERIALS, TOOLS, GROOVER } from '../../core/tools.js';

const STATUSES = ['published', 'analogous', 'typical', 'estimated', 'measured', 'calibrated'];

export class LibraryPage {
  constructor(root) {
    this.root = root;
    this.matEl = h('div'); this.tmEl = h('div'); this.toolEl = h('div'); this.srcEl = h('div');
    const t = tabs([
      { id: 'mat', label: 'Workpiece materials', content: this.matEl },
      { id: 'tm', label: 'Tool materials & life constants', content: this.tmEl },
      { id: 'tools', label: 'Tool geometry', content: this.toolEl },
      { id: 'src', label: 'Sources', content: this.srcEl },
    ]);
    root.append(h('div', { class: 'content' }, h('h1', {}, 'Libraries'), h('p', { class: 'lead' }, 'Every value carries a status and a source. Shipped data are read-only; duplicate an entry to create an editable custom copy (stored in this browser, included in exported projects via the library export).'),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => download('machinasim_custom_library.json', JSON.stringify({ materials: lib.customMaterials, tools: lib.customTools }, null, 1), 'application/json') }, 'Export custom library'),
        h('button', { class: 'btn', type: 'button', onclick: async () => { const f = await pickFile('.json'); if (!f) return; try { const d = JSON.parse(await f.text()); lib.customMaterials.push(...(d.materials || [])); lib.customTools.push(...(d.tools || [])); lib.save(); this.render(); toast('Custom library imported', 'ok'); } catch (e) { toast(e.message, 'error'); } } }, 'Import custom library')),
      t.el));
    this.render();
  }
  render() {
    const P = ['density', 'E', 'nu', 'k', 'cp', 'HB', 'Rm', 'Tm'];
    const cell = (p) => (p ? h('span', {}, `${p.value} `, statusBadge(p.status)) : '—');
    const mats = lib.materials();
    this.matEl.replaceChildren(h('div', { class: 'scroll', style: { maxHeight: '60vh' } }, table(['Material', 'Designation', 'Group', 'kc1.1 N/mm²', 'mc', 'ρ kg/m³', 'E GPa', 'ν', 'k W/m·K', 'cp J/kg·K', 'HB', 'Rm MPa', 'Johnson–Cook', ''],
      mats.map((m) => [h('b', {}, m.name), m.designation || '', m.group, cell(m.kienzle.kc11), cell(m.kienzle.mc), ...P.slice(0, 7).map((k) => cell(m.props[k])), m.jc ? h('span', { title: m.jc.source }, `A ${m.jc.A}, B ${m.jc.B}, n ${m.jc.n}, C ${m.jc.C}, m ${m.jc.m} `, statusBadge(m.jc.status)) : '—',
        h('span', {}, h('button', { class: 'mini', type: 'button', onclick: () => this._dupMat(m) }, 'Duplicate'), MATERIALS.includes(m) ? '' : h('button', { class: 'mini', type: 'button', onclick: () => this._delMat(m) }, 'Delete'))]))),
    this.editHost = h('div'));
    this.tmEl.replaceChildren(table(['Tool material', 'ρ', 'E GPa', 'k W/m·K', 'cp', 'Hardness', 'Max T °C', 'Taylor (steel) n / C', 'Taylor (non-steel) n / C'], TOOL_MATERIALS.map((t) => [h('b', {}, t.name), cell(t.props.density), cell(t.props.E), cell(t.props.k), cell(t.props.cp), cell(t.props.HV), cell(t.props.Tmax),
      t.taylor.steel ? h('span', {}, `${t.taylor.steel.n} / ${t.taylor.steel.C} `, statusBadge('textbook')) : h('span', { class: 'muted' }, 'none — calibrate'), t.taylor.nonSteel ? h('span', {}, `${t.taylor.nonSteel.n} / ${t.taylor.nonSteel.C} `, statusBadge('textbook')) : h('span', { class: 'muted' }, 'none — calibrate')])),
    h('div', { class: 'note' }, `Taylor defaults: ${GROOVER}. They are representative textbook values with unspecified criterion and conditions — always calibrate for research use.`));
    const tools = lib.tools();
    this.toolEl.replaceChildren(h('div', { class: 'scroll', style: { maxHeight: '65vh' } }, table(['Tool', 'Kind', 'Material', 'Key geometry', ''], tools.map((t) => [t.name, `${t.kind}${t.subtype ? ' / ' + t.subtype : ''}`, t.material,
      Object.entries(t).filter(([k]) => !['id', 'name', 'kind', 'subtype', 'material'].includes(k)).map(([k, v]) => `${k}=${v}`).join(', '),
      h('span', {}, h('button', { class: 'mini', type: 'button', onclick: () => this._dupTool(t) }, 'Duplicate'), TOOLS.includes(t) ? '' : h('button', { class: 'mini', type: 'button', onclick: () => { lib.customTools = lib.customTools.filter((x) => x !== t); lib.save(); this.render(); } }, 'Delete'))]))), this.toolEdit = h('div'));
    this.srcEl.replaceChildren(h('ul', {}, Object.entries(SOURCES).map(([k, v]) => h('li', {}, h('b', {}, k), ': ', v))), h('p', { class: 'note' }, 'Physical property values marked “typical” are handbook typical values for the named or equivalent grade (ASM Handbook / MatWeb); actual stock depends on heat treatment and supplier.'));
  }
  _dupMat(m) {
    const c = structuredClone(m); c.id = `${m.id}-custom-${Date.now().toString(36)}`; c.name = `${m.name} (custom)`;
    lib.customMaterials.unshift(c); lib.save(); this.render(); this._editMat(c);
  }
  _delMat(m) { lib.customMaterials = lib.customMaterials.filter((x) => x !== m); lib.save(); this.render(); }
  _editMat(m) {
    const fields = [];
    const edit = (obj, label, unit) => {
      const st = h('select', { onchange: (e) => { obj.status = e.target.value; lib.save(); } }, STATUSES.map((s) => h('option', { value: s }, s))); st.value = obj.status;
      const src = h('input', { type: 'text', value: obj.source || '', placeholder: 'source / reference', onchange: (e) => { obj.source = e.target.value; lib.save(); } });
      fields.push(h('div', { class: 'grid3' }, numField(obj, 'value', { label, unit, onChange: () => lib.save() }), h('div', { class: 'field' }, h('label', {}, 'status'), st), h('div', { class: 'field' }, h('label', {}, 'source'), src)));
    };
    const nm = h('input', { type: 'text', value: m.name, onchange: (e) => { m.name = e.target.value; lib.save(); this.render(); this._editMat(m); } });
    edit(m.kienzle.kc11, 'kc1.1', 'N/mm²'); edit(m.kienzle.mc, 'mc', '–');
    for (const [k, p] of Object.entries(m.props)) edit(p, k, p.unit);
    this.editHost.replaceChildren(h('div', { class: 'box' }, h('h3', {}, 'Edit custom material'), h('div', { class: 'field' }, h('label', {}, 'Name'), nm), ...fields, h('div', { class: 'note' }, 'Changes are saved immediately. Re-select the material in a workspace to use new values.')));
  }
  _dupTool(t) {
    const c = { ...t, id: `${t.id}-custom-${Date.now().toString(36)}`, name: `${t.name} (custom)` };
    lib.customTools.unshift(c); lib.save(); this.render();
    const nums = Object.entries(c).filter(([, v]) => typeof v === 'number');
    this.toolEdit.replaceChildren(h('div', { class: 'box' }, h('h3', {}, `Edit ${c.name}`), h('div', { class: 'grid3' }, nums.map(([k]) => numField(c, k, { label: k, onChange: () => { lib.save(); } })))));
  }
}
