// Mathematical models & validation register (generated from src/core/models.js).
import { h, table } from '../dom.js';
import { MODELS, STATUS_LABEL } from '../../core/models.js';

export class ModelsPage {
  constructor(root) {
    this.root = root;
    this.filter = h('input', { type: 'text', placeholder: 'Filter (process, id, name)…', oninput: () => this.render(), style: { maxWidth: '320px' } });
    this.body = h('div');
    root.append(h('div', { class: 'content' }, h('h1', {}, 'Mathematical models & validation register'),
      h('p', { class: 'lead' }, 'Every result in MachinaSim is produced by one of these models. Status follows the specification: implemented-unvalidated, verified against analytical benchmarks, calibrated, independently validated, limited/experimental. “Verified” means the code reproduces the stated equation or an independent analytical solution in the automated test suite — it does not mean the model has been validated against experiments.'),
      h('div', { class: 'field' }, this.filter), this.body));
    this.render();
  }
  render(highlight) {
    const f = this.filter.value.toLowerCase();
    const list = MODELS.filter((m) => !f || `${m.id} ${m.process} ${m.name}`.toLowerCase().includes(f));
    this.body.replaceChildren(table(['ID', 'Process', 'Model', 'Equation(s)', 'Variables / inputs', 'Assumptions', 'Validity', 'Status', 'Automated test', 'References'],
      list.map((m) => [h('a', { id: m.id, class: 'mid' }, m.id), m.process, h('b', {}, m.name), h('code', {}, m.eq), m.vars, m.assumptions, m.validity, h('span', { class: `badge st-${m.status}` }, STATUS_LABEL[m.status]), m.tests, m.refs])));
    if (highlight) setTimeout(() => { const el = document.getElementById(highlight); el?.scrollIntoView({ block: 'center' }); el?.closest('tr')?.animate([{ background: '#fff3c4' }, { background: 'transparent' }], { duration: 2200 }); }, 50);
  }
  show(params) { if (params?.m) this.render(params.m); }
}
