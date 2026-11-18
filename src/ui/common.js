// Shared UI pieces for machine pages: library access (incl. user-custom items), run controls, results.
import { h, numField, selectField, panel, q, kv, statusBadge } from './dom.js';
import { MATERIALS, materialParams } from '../core/materials.js';
import { TOOLS, TOOL_MATERIALS, getToolMaterial, defaultTaylor } from '../core/tools.js';
import { COOLANTS } from '../physics/thermal.js';
import { ISO3685 } from '../physics/wear.js';
import { defaultWearLand } from '../physics/cutting.js';

export const lib = {
  customMaterials: [], customTools: [],
  load() {
    try { this.customMaterials = JSON.parse(localStorage.getItem('ms.customMaterials') || '[]'); this.customTools = JSON.parse(localStorage.getItem('ms.customTools') || '[]'); } catch { this.customMaterials = []; this.customTools = []; }
  },
  save() { try { localStorage.setItem('ms.customMaterials', JSON.stringify(this.customMaterials)); localStorage.setItem('ms.customTools', JSON.stringify(this.customTools)); } catch {} },
  materials() { return [...this.customMaterials, ...MATERIALS]; },
  tools() { return [...this.customTools, ...TOOLS]; },
  material(id) { return this.materials().find((m) => m.id === id) || MATERIALS[0]; },
  tool(id) { return this.tools().find((t) => t.id === id); },
};
lib.load();

export function materialSelect(cfg, onChange) {
  return selectField(cfg, 'material', lib.materials().map((m) => ({ value: m.id, label: `${m.name} — ${m.group}` })), { label: 'Workpiece material', onChange });
}

export function materialSummary(m) {
  const p = materialParams(m);
  return h('div', { class: 'matsum' },
    kv([
      ['kc1.1', h('span', {}, `${p.kc11} N/mm² `, statusBadge(m.kienzle.kc11.status))],
      ['mc', h('span', {}, `${p.mc} `, statusBadge(m.kienzle.mc.status))],
      ['Hardness', `${p.HB} HB`], ['Rm', `${p.Rm} MPa`], ['k', `${p.k} W/m·K`], ['ρ', `${p.density} kg/m³`],
    ]),
    h('div', { class: 'src' }, 'Source: ', m.kienzle.kc11.source.split(' http')[0]));
}

/** Editable copy of the tool + Taylor constants + wear-land parameters. */
export function toolEditor(state, rebuild) {
  const t = state.tool;
  const tm = getToolMaterial(t.material);
  const els = [];
  els.push(h('div', { class: 'toolname' }, t.name));
  els.push(selectField(t, 'material', TOOL_MATERIALS.map((m) => ({ value: m.id, label: m.name })), { label: 'Tool material', onChange: () => { state.taylor = null; rebuild(); } }));
  const geo = [];
  if (t.kind === 'turning') {
    if (t.subtype !== 'threading') {
      geo.push(numField(t, 'rake', { label: 'Rake γ', unit: '°', min: -30, max: 30, onChange: rebuild }));
      geo.push(numField(t, 'clearance', { label: 'Clearance α', unit: '°', min: 1, max: 20, onChange: rebuild }));
    }
    if (t.subtype === 'general' || t.subtype === 'boring') {
      geo.push(numField(t, 'kr', { label: 'Approach κr', unit: '°', min: 30, max: 100, onChange: rebuild }));
      geo.push(numField(t, 'krMinor', { label: 'Minor edge κr′', unit: '°', min: 0.5, max: 60, onChange: rebuild }));
    }
    if (t.subtype === 'grooving') geo.push(numField(t, 'width', { label: 'Blade width', unit: 'mm', min: 0.5, max: 12, onChange: rebuild }));
    if (t.subtype === 'threading') geo.push(numField(t, 'threadAngle', { label: 'Included angle', unit: '°', min: 29, max: 80, onChange: rebuild }));
    geo.push(numField(t, 'rn', { label: 'Nose radius rε', unit: 'mm', min: 0.001, max: 3, onChange: rebuild }));
  } else if (t.kind === 'drill') {
    geo.push(numField(t, 'D', { label: 'Diameter', unit: 'mm', min: 0.5, max: 60, onChange: rebuild }));
    geo.push(numField(t, 'pointAngle', { label: 'Point angle', unit: '°', min: 60, max: 180, onChange: rebuild }));
    if (t.helix != null) geo.push(numField(t, 'helix', { label: 'Helix angle', unit: '°', min: 0, max: 45, onChange: rebuild }));
    if (t.webRatio) geo.push(numField(t, 'webRatio', { label: 'Web thickness / D', unit: '–', min: 0.02, max: 0.4, onChange: rebuild }));
  } else if (t.kind === 'mill') {
    geo.push(numField(t, 'D', { label: 'Diameter', unit: 'mm', min: 1, max: 200, onChange: rebuild }));
    geo.push(numField(t, 'z', { label: 'Teeth Z', unit: '–', min: 1, max: 40, step: 1, onChange: rebuild }));
    geo.push(numField(t, 'helix', { label: 'Helix', unit: '°', min: 0, max: 60, onChange: rebuild }));
    geo.push(numField(t, 'rake', { label: 'Rake γ', unit: '°', min: -20, max: 25, onChange: rebuild }));
    if (t.subtype === 'face') geo.push(numField(t, 'kr', { label: 'Lead κr', unit: '°', min: 10, max: 90, onChange: rebuild }));
  }
  els.push(h('div', { class: 'grid2' }, geo));
  // Taylor
  if (!state.taylor) state.taylor = defaultTaylor(t.material, lib.material(state.material)) || { n: null, C: null, m: 0, p: 0, f0: 0.25, ap0: 2, status: 'missing' };
  const tay = state.taylor;
  const st = tay.status === 'missing' ? 'estimated' : tay.status === 'textbook' ? 'textbook' : tay.status || 'calibrated';
  els.push(h('div', { class: 'subhead' }, 'Tool life model (extended Taylor) ', statusBadge(tay.status === 'missing' ? 'estimated' : st)));
  if (tay.status === 'missing') els.push(h('div', { class: 'warn' }, `No defensible default Taylor constants for ${tm.name} on this material class. Enter calibrated n and C (or calibrate in Research → Calibration) to enable wear prediction.`));
  els.push(h('div', { class: 'grid2' },
    numField(tay, 'n', { label: 'n', unit: '–', min: 0.01, max: 2, allowEmpty: true, onChange: () => { tay.status = 'user'; } }),
    numField(tay, 'C', { label: 'C', unit: 'm/min', min: 1, allowEmpty: true, onChange: () => { tay.status = 'user'; } }),
    numField(tay, 'm', { label: 'feed exponent m', unit: '–', min: 0, max: 3 }),
    numField(tay, 'p', { label: 'depth exponent p', unit: '–', min: 0, max: 3 })));
  if (tay.source) els.push(h('div', { class: 'src' }, tay.source));
  return h('div', {}, els);
}

export function processPanel(state, { showCoolant = true } = {}) {
  if (!state.land) state.land = defaultWearLand(materialParams(lib.material(state.material)));
  if (!state.limits) state.limits = { VB: ISO3685.VB, VBmax: ISO3685.VBmax, T: 900, F: 5000, P: 7.5 };
  return h('div', {},
    showCoolant ? selectField(state, 'coolant', Object.entries(COOLANTS).map(([k, v]) => ({ value: k, label: `${v.name} (h ≈ ${v.h} W/m²K, estimated)` })), { label: 'Cooling condition' }) : null,
    h('div', { class: 'grid2' },
      numField(state, 'VB0', { label: 'Initial flank wear VB₀', unit: 'mm', min: 0, max: 1.5 }),
      numField(state.limits, 'VB', { label: 'Replace at VB', unit: 'mm', min: 0.05, max: 1.5, help: 'ISO 3685: 0.3 mm' }),
      numField(state.limits, 'T', { label: 'Temperature alert', unit: '°C', min: 50 }),
      numField(state.limits, 'F', { label: 'Force alert', unit: 'N', min: 1 }),
      numField(state.limits, 'P', { label: 'Machine power', unit: 'kW', min: 0.1 })),
    h('div', { class: 'subhead' }, 'Wear-land contact (force–wear coupling) ', statusBadge('estimated')),
    h('div', { class: 'grid2' },
      numField(state.land, 'sigmaW', { label: 'Land normal stress σw', unit: 'N/mm²', min: 1 }),
      numField(state.land, 'muW', { label: 'Land friction μw', unit: '–', min: 0, max: 2 })));
}

export const SPEEDS = [
  { value: '1', label: '1× real time' }, { value: '5', label: '5×' }, { value: '20', label: '20×' }, { value: '100', label: '100×' },
  { value: '1000', label: '1000×' }, { value: 'max', label: 'As fast as possible' },
];

/** Run-control bar. handlers: run, pause, step, finish, reset, undo */
export function runBar(handlers, state) {
  const speed = h('select', { 'aria-label': 'Simulation speed', onchange: (e) => (state.speed = e.target.value) }, SPEEDS.map((s) => h('option', { value: s.value }, s.label)));
  speed.value = state.speed || '20';
  state.speed = speed.value;
  const btn = (label, fn, cls = '') => h('button', { type: 'button', class: `btn ${cls}`, onclick: fn }, label);
  const pause = btn('Pause', () => handlers.pause());
  const el = h('div', { class: 'runbar' },
    btn('▶ Run operation', () => handlers.run(), 'primary'), pause, btn('Step', () => handlers.step()), btn('Finish', () => handlers.finish()),
    btn('Undo op', () => handlers.undo()), btn('Reset part', () => handlers.reset(), 'danger'), speed);
  el.setPaused = (p) => { pause.textContent = p ? 'Resume' : 'Pause'; };
  return el;
}

/** Live readout grid; returns element with update(pairs). */
export function readouts() {
  const el = h('div', { class: 'readouts' });
  el.update = (items) => {
    el.innerHTML = '';
    for (const it of items) el.append(h('div', { class: `ro ${it.cls || ''}`, title: it.title || '' }, h('div', { class: 'ro-k' }, it.k), h('div', { class: 'ro-v' }, it.v)));
  };
  return el;
}

export function alertsBox() {
  const el = h('div', { class: 'alerts', 'aria-live': 'polite' });
  el.update = (alerts, events) => {
    el.innerHTML = '';
    const all = [...(alerts || []), ...(events || []).slice(-6).reverse()];
    if (!all.length) { el.append(h('div', { class: 'ok' }, 'No alerts.')); return; }
    for (const a of all) el.append(h('div', { class: `alert ${a.level}` }, a.level === 'critical' ? '⛔ ' : '⚠ ', a.msg));
  };
  return el;
}

/** Frame-paced simulation driver. stepFn returns false when finished. */
export class Driver {
  constructor(sim, { onFrame, onDone }) { this.sim = sim; this.onFrame = onFrame; this.onDone = onDone; this.running = false; this.paused = false; }
  start(speed) {
    this.speed = speed; this.running = true; this.paused = false;
    this._wall = performance.now(); this._simT0 = this.sim.time;
    const loop = () => {
      if (!this.running) return;
      if (!this.paused) {
        const t0 = performance.now();
        const sp = this.speed === 'max' ? Infinity : Number(this.speed);
        const target = this._simT0 + ((t0 - this._wall) / 1000) * sp;
        let n = 0;
        while (!this.sim.done && (sp === Infinity || this.sim.time < target) && performance.now() - t0 < 14) { this.sim.step(); n++; }
        if (sp !== Infinity && this.sim.time < target - 5) { this._simT0 = this.sim.time; this._wall = t0; } // can't keep up: re-anchor
        this.onFrame?.(n);
        if (this.sim.done) { this.running = false; this.onDone?.(); return; }
      }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }
  pause() { this.paused = !this.paused; if (!this.paused) { this._wall = performance.now(); this._simT0 = this.sim.time; } return this.paused; }
  stop() { this.running = false; cancelAnimationFrame(this._raf); }
  finish() { this.stop(); let n = 0; while (!this.sim.done && n < 5e6) { this.sim.step(); n++; } this.onFrame?.(n); this.onDone?.(); }
}

export function modelNote(ids) {
  return h('div', { class: 'modelnote' }, 'Models: ', ids.map((id) => h('a', { href: `#/models?m=${id}`, class: 'mid' }, id)));
}
