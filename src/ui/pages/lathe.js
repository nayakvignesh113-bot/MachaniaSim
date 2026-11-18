// Centre lathe workspace.
import { h, numField, selectField, panel, tabs, q, kv, toast, checkField } from '../dom.js';
import { Chart, drawField } from '../chart.js';
import { lib, materialSelect, materialSummary, toolEditor, processPanel, runBar, readouts, alertsBox, Driver, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { getToolMaterial } from '../../core/tools.js';
import { spindleSpeed, fmt } from '../../core/units.js';
import { LatheWorkpiece } from '../../geometry/lathe.js';
import { outlineForTool } from '../../geometry/toolshape.js';
import { planLatheOp, LATHE_OPS } from '../../sim/lathe-ops.js';
import { LatheSim } from '../../sim/lathe-sim.js';
import { EdgeWear, taylorLife } from '../../physics/wear.js';
import { turningNominal, theoreticalRoughness } from '../../physics/turning.js';
import { cuttingTemperature, ToolFD, COOLANTS } from '../../physics/thermal.js';
import { turningLobes, DEFAULT_MODES, lobeEnvelope } from '../../physics/dynamics.js';
import { kienzleKc } from '../../physics/cutting.js';
import { webglAvailable } from '../../render/scene.js';

const OP_DEFAULTS = {
  turning: { Dt: 44, Lc: 80, ap: 1.5, f: 0.25, V: 150 },
  facing: { stock: 1, ap: 1, f: 0.2, V: 120 },
  step: { steps: [{ D: 44, L: 80 }, { D: 38, L: 40 }], ap: 1.5, f: 0.25, V: 150 },
  taper: { Dlarge: 44, Dsmall: 36, Lt: 40, ap: 1, f: 0.15, V: 120 },
  grooving: { z: 60, width: 3, grooveWidth: 6, Dg: 40, f: 0.06, V: 80 },
  parting: { z: 20, width: 3, f: 0.05, V: 70 },
  threading: { pitch: 2, Lt: 30, passes: 8, V: 40 },
  drilling: { depth: 40, f: 0.15, V: 22, peck: 0 },
  boring: { Db: 24, Lb: 30, ap: 0.8, f: 0.12, V: 120 },
  chamfer: { c: 1.5, f: 0.1, V: 100 },
};
const TOOL_FOR_OP = { turning: 'cnmg-0408-carb', facing: 'cnmg-0408-carb', step: 'cnmg-0408-carb', taper: 'cnmg-0408-carb', chamfer: 'snmg-1204-carb', grooving: 'groove-3', parting: 'groove-3', threading: 'thread-60', drilling: 'drill-hss-20', boring: 'boring-bar' };

export class LathePage {
  constructor(root) {
    this.root = root;
    this.s = { material: 'en8', D: 50, L: 150, bore: 0, support: 'chuck', op: 'turning', coolant: 'dry', VB0: 0, speed: '20', xAxis: 't', modes: DEFAULT_MODES.lathe.map((m) => ({ ...m })), op_: structuredClone(OP_DEFAULTS) };
    this.s.toolId = TOOL_FOR_OP.turning;
    this.s.tool = { ...lib.tool(this.s.toolId) };
    this.wears = {}; // persistent wear per tool id
    this.undo = [];
    this.opLog = [];
    this._build();
    this.resetPart();
  }

  get p() { return this.s.op_[this.s.op]; }
  get mat() { return materialParams(lib.material(this.s.material)); }

  _build() {
    const s = this.s;
    // ---------- left: configuration ----------
    this.matSum = h('div');
    const matSel = materialSelect(s, () => { this.s.taylor = null; this.s.land = null; this._refreshTool(); this._refreshMat(); this.resetPart(); });
    const wpPanel = panel('Workpiece',
      matSel, this.matSum,
      h('div', { class: 'grid2' },
        numField(s, 'D', { label: 'Bar diameter', quantity: 'length', min: 5, max: 300, onChange: () => this.resetPart() }),
        numField(s, 'L', { label: 'Stick-out length', quantity: 'length', min: 10, max: 600, onChange: () => this.resetPart() }),
        numField(s, 'bore', { label: 'Initial bore Ø', quantity: 'length', min: 0, max: 280, onChange: () => this.resetPart() })),
      selectField(s, 'support', [{ value: 'chuck', label: 'Chuck only (cantilever)' }, { value: 'chuck-centre', label: 'Chuck + tailstock centre' }, { value: 'centres', label: 'Between centres' }], { label: 'Work holding', onChange: (v) => { this.sim.support = v; this.view?.setSupport(v); } }));
    this.opSel = selectField(s, 'op', Object.entries(LATHE_OPS).map(([k, v]) => ({ value: k, label: v.name })), { label: 'Operation', onChange: () => this._onOp() });
    this.opParams = h('div');
    this.toolSel = selectField(s, 'toolId', [], { label: 'Cutting tool', onChange: () => this._refreshTool() });
    this.toolEd = h('div');
    const opPanel = panel('Operation & parameters', this.opSel, this.opParams);
    const toolPanel = panel('Cutting tool', this.toolSel, this.toolEd);
    const procPanel = panel('Process, wear & limits', processPanel(s));
    procPanel.classList.add('collapsed');
    this.nominal = h('div', { class: 'nominal' });
    const nomPanel = panel('Closed-form check (nominal)', this.nominal, modelNote(['M-TURN-01', 'M-CUT-01', 'M-WEAR-01']));
    this.log = h('ol', { class: 'oplog' });
    const logPanel = panel('Process plan (completed operations)', this.log);
    const left = h('div', { class: 'side' }, wpPanel, opPanel, toolPanel, procPanel, nomPanel, logPanel);

    // ---------- centre: viewport ----------
    this.vpHost = h('div', { class: 'viewport' });
    this.overlay = h('div', { class: 'vp-overlay' });
    const legend = h('div', { class: 'vp-legend' }, h('span', { class: 'lg fc' }, 'Fc'), h('span', { class: 'lg ff' }, 'Ff'), h('span', { class: 'lg fp' }, 'Fp'));
    const views = h('div', { class: 'vp-views' },
      ['iso', 'front', 'top', 'tool'].map((v) => h('button', { type: 'button', class: 'mini', onclick: () => this.view?.viewPreset(v) }, v)),
      h('label', { class: 'mini-check' }, h('input', { type: 'checkbox', onchange: (e) => this.view?.setSection(e.target.checked) }), 'section'));
    this.bar = runBar({ run: () => this.run(), pause: () => this.pause(), step: () => this.stepOnce(), finish: () => this.finish(), reset: () => this.resetPart(true), undo: () => this.undoOp() }, s);
    const centre = h('div', { class: 'centre' }, h('div', { class: 'vp-wrap' }, this.vpHost, this.overlay, legend, views), this.bar);

    // ---------- results ----------
    this.ro = readouts();
    this.alerts = alertsBox();
    this.warnBox = h('div', { class: 'warnbox' });
    this.cF = new Chart({ title: 'Cutting forces', xLabel: 'Time (s)', yLabel: 'Force (N)' });
    this.cTP = new Chart({ title: 'Torque and power', xLabel: 'Time (s)', yLabel: 'Torque (N·m)', y2Label: 'Power (kW)' });
    this.cMRR = new Chart({ title: 'Material removal rate', xLabel: 'Time (s)', yLabel: 'MRR (cm³/min)' });
    this.cVB = new Chart({ title: 'Flank wear and temperature', xLabel: 'Time (s)', yLabel: 'VB (mm)', y2Label: 'Interface T (°C)' });
    const xSel = selectField(s, 'xAxis', [{ value: 't', label: 'Time (s)' }, { value: 'rev', label: 'Spindle revolutions' }, { value: 'dist', label: 'Cutting distance (m)' }], { label: 'x-axis', onChange: () => this._charts(true) });
    const graphs = h('div', { class: 'graphs' }, xSel, this.cF.el, this.cTP.el, this.cMRR.el, this.cVB.el);
    this.fieldCanvas = h('canvas', { class: 'field-canvas' });
    this.thermalInfo = h('div');
    const thermal = h('div', {}, this.fieldCanvas, this.thermalInfo, modelNote(['M-THERM-01', 'M-THERM-02']));
    this.cProf = new Chart({ title: 'Machined profile', xLabel: 'z from chuck face (mm)', yLabel: 'Diameter (mm)' });
    this.qualInfo = h('div');
    const quality = h('div', {}, this.cProf.el, this.qualInfo, modelNote(['M-TURN-03', 'M-TURN-04', 'M-WEAR-05']));
    this.cLobe = new Chart({ title: 'Stability lobes (turning, SDOF)', xLabel: 'Spindle speed (rev/min)', yLabel: 'Limiting chip width b_lim (mm)', height: 280 });
    this.dynInfo = h('div');
    const m0 = s.modes[0];
    const dyn = h('div', {},
      h('div', { class: 'warn' }, 'Modal parameters below are ESTIMATES. Measure the tool–holder FRF (tap test) for real chatter predictions.'),
      h('div', { class: 'grid3' }, numField(m0, 'k', { label: 'Stiffness k', unit: 'N/m', min: 1e4, onChange: () => this._lobes() }), numField(m0, 'zeta', { label: 'Damping ζ', unit: '–', min: 0.001, max: 0.5, onChange: () => this._lobes() }), numField(m0, 'fn', { label: 'Natural freq. fn', unit: 'Hz', min: 1, onChange: () => this._lobes() })),
      this.cLobe.el, this.dynInfo, modelNote(['M-DYN-01']));
    this.tabs = tabs([
      { id: 'live', label: 'Live', content: h('div', {}, this.ro, this.alerts, this.warnBox) },
      { id: 'graphs', label: 'Graphs', content: graphs },
      { id: 'thermal', label: 'Thermal', content: thermal },
      { id: 'quality', label: 'Quality', content: quality },
      { id: 'dyn', label: 'Dynamics', content: dyn },
    ], { onChange: (id) => this._onTab(id) });
    const right = h('div', { class: 'results' }, this.tabs.el);
    this.root.append(h('div', { class: 'workspace' }, left, centre, right));
    if (webglAvailable()) {
      import('../../render/lathe3d.js').then(({ Lathe3D }) => {
        this.view = new Lathe3D(this.vpHost);
        this.view.setSupport(s.support);
        if (this.wp) this.view.setWorkpiece(this.wp);
        this._refreshTool();
      }).catch((e) => { this.vpHost.append(h('div', { class: 'nogl' }, `3-D view unavailable: ${e.message}`)); });
    } else this.vpHost.append(h('div', { class: 'nogl' }, 'WebGL is not available in this browser; the simulation and all results still run.'));
    this._refreshMat();
    this._onOp(true);
  }

  _refreshMat() { this.matSum.replaceChildren(materialSummary(lib.material(this.s.material))); this._nominal(); }

  _onOp(init = false) {
    const s = this.s, op = s.op, p = this.p;
    const kinds = LATHE_OPS[op].toolKinds;
    const tools = lib.tools().filter((t) => (kinds.includes('drill') ? t.kind === 'drill' && !t.subtype : t.kind === 'turning' && kinds.includes(t.subtype)));
    if (!tools.find((t) => t.id === s.toolId)) s.toolId = tools.find((t) => t.id === TOOL_FOR_OP[op])?.id || tools[0]?.id;
    this.toolSel.setOptions(tools.map((t) => ({ value: t.id, label: t.name })));
    const f = [];
    const nf = (k, label, quantity, o = {}) => f.push(numField(p, k, { label, quantity, onChange: () => this._nominal(), ...o }));
    switch (op) {
      case 'turning': nf('Dt', 'Target diameter', 'length', { min: 0.5 }); nf('Lc', 'Length of cut (from free end)', 'length', { min: 0.5 }); nf('ap', 'Max depth per pass ap', 'length', { min: 0.05, max: 10 }); break;
      case 'facing': nf('stock', 'Face stock to remove', 'length', { min: 0.05 }); nf('ap', 'Max depth per pass', 'length', { min: 0.05 }); break;
      case 'step': {
        p.steps.forEach((st, i) => { f.push(h('div', { class: 'grid2' }, numField(st, 'D', { label: `Step ${i + 1} Ø`, quantity: 'length', min: 0.5 }), numField(st, 'L', { label: `Step ${i + 1} length`, quantity: 'length', min: 0.5 }))); });
        nf('ap', 'Max depth per pass', 'length', { min: 0.05 }); break;
      }
      case 'taper': nf('Dlarge', 'Large Ø (inboard)', 'length'); nf('Dsmall', 'Small Ø (at free end)', 'length'); nf('Lt', 'Taper length', 'length'); nf('ap', 'Max depth per pass', 'length', { min: 0.05 }); break;
      case 'grooving': nf('z', 'Groove left edge z (from chuck)', 'length'); nf('grooveWidth', 'Groove width', 'length', { min: 0.5 }); nf('Dg', 'Groove bottom Ø', 'length'); break;
      case 'parting': nf('z', 'Parting position z (from chuck)', 'length'); break;
      case 'threading': nf('pitch', 'Pitch P', 'length', { min: 0.2, max: 6 }); nf('Lt', 'Thread length', 'length'); nf('passes', 'Infeed passes', null, { unit: '–', min: 2, max: 30, step: 1 }); break;
      case 'drilling': nf('depth', 'Drill depth (tip)', 'length'); nf('peck', 'Peck depth (0 = none)', 'length', { min: 0 }); break;
      case 'boring': nf('Db', 'Bore to Ø', 'length'); nf('Lb', 'Bore length', 'length'); nf('ap', 'Max depth per pass', 'length', { min: 0.05 }); break;
      case 'chamfer': nf('c', 'Chamfer size (45°)', 'length', { min: 0.1 }); break;
    }
    if (op !== 'threading') nf('f', op === 'drilling' ? 'Feed f (per rev)' : 'Feed f', 'feed', { min: 0.005, max: 2 });
    nf('V', 'Cutting speed V (at stock Ø)', 'speed', { min: 1, max: 1500 });
    this.opParams.replaceChildren(...f);
    if (!init) this._refreshTool();
    this._nominal();
  }

  _refreshTool() {
    const s = this.s;
    const base = lib.tool(s.toolId);
    if (!base) return;
    if (!s.tool || s.tool.id !== base.id) { s.tool = { ...base }; s.taylor = null; }
    this.toolEd.replaceChildren(toolEditor(s, () => this._refreshTool()));
    this.outline = s.tool.kind === 'drill' ? null : outlineForTool(s.tool);
    this.view?.setTool(s.tool, this.outline);
    if (this.sim) this._configureSim();
    this._nominal();
  }

  /** Current spindle speed from V at the current stock diameter (conventional lathe: constant N during an op). */
  _N() {
    const p = this.p;
    if (this.s.op === 'drilling') return spindleSpeed(p.V, this.s.tool.D);
    let D = this.wp ? 2 * Math.max(...Array.from(this.wp.R.subarray(Math.max(0, this.wp.idx(this.wp.endZ() - (p.Lc || p.Lt || p.Lb || 10))), this.wp.idx(this.wp.endZ()) + 1))) : this.s.D;
    if (this.s.op === 'boring') D = p.Db;
    if (this.s.op === 'grooving' || this.s.op === 'parting') D = 2 * (this.wp?.outerAt(p.z) ?? this.s.D / 2);
    return Math.min(spindleSpeed(p.V, Math.max(D, 1)), 3000);
  }

  _wear() {
    const s = this.s, id = s.tool.id;
    if (!this.wears[id]) this.wears[id] = new EdgeWear({ taylor: s.taylor?.C ? s.taylor : null, clearance: s.tool.clearance ?? 6, VB0: s.VB0 || 0, VBc: s.limits?.VB ?? 0.3 });
    const w = this.wears[id];
    w.taylor = s.taylor?.C && s.taylor?.n ? s.taylor : null;
    w.VBc = s.limits?.VB ?? 0.3; w.clearance = s.tool.clearance ?? 6;
    return w;
  }

  _configureSim() {
    const s = this.s, sim = this.sim;
    sim.mat = this.mat; sim.tool = s.tool; sim.outline = this.outline;
    sim.toolMat = getToolMaterial(s.tool.material);
    sim.wear = this._wear();
    sim.land = s.land; sim.limits = s.limits; sim.machine = { Pmax: s.limits?.P ?? 7.5 };
    sim.support = s.support;
    const tp = sim.toolMat.props;
    sim.fd = new ToolFD({ W: 4, H: 4, nx: 21, ny: 21, k: tp.k.value, rho: tp.density.value, cp: tp.cp.value, hConv: COOLANTS[s.coolant]?.h ?? 20, T0: 20 });
  }

  resetPart(confirmUser = false) {
    if (confirmUser && this.opLog.length && !confirm('Reset the workpiece to bar stock? Completed operations will be cleared.')) return;
    this.driver?.stop();
    const s = this.s;
    if (s.bore >= s.D) { toast('Bore must be smaller than the bar diameter', 'error'); s.bore = 0; }
    this.wp = new LatheWorkpiece({ L: s.L, D: s.D, bore: s.bore, dz: s.L > 300 ? 0.02 : 0.01 });
    this.sim = new LatheSim({ wp: this.wp, mat: this.mat, tool: s.tool, outline: this.outline, toolMat: getToolMaterial(s.tool.material), wear: this._wear(), limits: s.limits, coolant: s.coolant, support: s.support });
    this._configureSim();
    this.undo = []; this.opLog = []; this.log.replaceChildren();
    this.view?.setWorkpiece(this.wp);
    this.view?.setToolPos(this.sim.pos.z, this.sim.pos.r);
    this._live(); this._charts(true); this._quality(); this._nominal();
  }

  run() {
    const s = this.s;
    if (this.driver?.running) { toast('An operation is already running', 'warn'); return; }
    if (this.wp.partedAt != null && s.op !== 'facing') toast('Part has been parted off; remaining stock is used.', 'warn');
    const p = { ...this.p, N: this._N() };
    if (s.op === 'threading') p.f = p.pitch;
    let plan;
    try { plan = planLatheOp(s.op, p, this.wp, this.outline); } catch (e) { toast(e.message, 'error'); return; }
    if (!plan.moves.length) { toast(plan.warnings[0] || 'Nothing to cut', 'warn'); return; }
    plan.warnings.forEach((w) => toast(w, 'warn'));
    this.undo.push({ wp: this.wp.clone(), opLog: this.opLog.length, wear: { ...this.sim.wear } , hist: this.sim.hist.t.length });
    if (this.undo.length > 10) this.undo.shift();
    this._configureSim();
    this.sim.load(plan.moves, s.op);
    this.view?.setRpm(p.N);
    this._opStart = { t: this.sim.time, name: LATHE_OPS[s.op].name, summary: plan.summary, N: p.N, f: p.f, tool: s.tool.name };
    this.driver = new Driver(this.sim, { onFrame: () => this._frame(), onDone: () => this._done() });
    this.bar.setPaused(false);
    this.driver.start(s.speed);
  }
  pause() { if (this.driver?.running) this.bar.setPaused(this.driver.pause()); }
  stepOnce() {
    if (!this.driver?.running) { toast('Start an operation first (Run), then use Step while paused.', 'info'); return; }
    if (!this.driver.paused) this.bar.setPaused(this.driver.pause());
    this.sim.step(); this._frame(true);
    if (this.sim.done) { this.driver.stop(); this._done(); }
  }
  finish() { if (this.driver?.running) this.driver.finish(); }
  undoOp() {
    this.driver?.stop();
    const u = this.undo.pop();
    if (!u) { toast('Nothing to undo', 'info'); return; }
    this.wp.R.set(u.wp.R); this.wp.Ri.set(u.wp.Ri); this.wp.partedAt = u.wp.partedAt; this.wp.threads = u.wp.threads; this.wp.version++;
    Object.assign(this.sim.wear, u.wear);
    for (const k of Object.keys(this.sim.hist)) this.sim.hist[k].length = u.hist;
    this.opLog.length = u.opLog; this.log.lastChild?.remove();
    this.sim.moves = []; this.sim.mi = 0;
    this._charts(true); this._quality(); this._live();
  }

  _frame(force = false) {
    const sim = this.sim;
    this.view?.setToolPos(sim.pos.z, sim.pos.r);
    this.view?.setForces(sim.last);
    const now = performance.now();
    if (force || !this._tLive || now - this._tLive > 100) { this._tLive = now; this._live(); }
    if (force || !this._tCh || now - this._tCh > 400) { this._tCh = now; if (this.tabs.active === 'graphs') this._charts(); if (this.tabs.active === 'thermal') this._thermal(); }
  }
  _done() {
    this.view?.setRpm(0); this.view?.setForces(null);
    const o = this._opStart;
    if (o) {
      const dt = this.sim.time - o.t;
      this.opLog.push({ ...o, duration: dt, VB: this.sim.wear.VB, removed: this.sim.removed });
      this.log.append(h('li', {}, h('b', {}, o.name), ` — ${o.summary}; ${o.tool}; N = ${fmt(o.N, 4)} rev/min; f = ${o.f} mm/rev; ${fmt(dt, 3)} s; VB = ${fmt(this.sim.wear.VB, 3)} mm`));
      this._opStart = null;
    }
    this._live(); this._charts(true); this._quality(); this._thermal();
    if (this.sim.events.some((e) => e.level === 'critical')) toast('Critical event during the operation — see Live → alerts', 'error');
  }

  _onTab(id) { if (id === 'graphs') this._charts(true); if (id === 'thermal') this._thermal(); if (id === 'quality') this._quality(); if (id === 'dyn') this._lobes(); }

  _live() {
    const L = this.sim.last?.cutting ? this.sim.last : this.sim.lastCut, s = this.s;
    const w = this.sim.wear;
    const items = [
      { k: 'Spindle N', v: L ? `${fmt(L.N || 0, 4)} rev/min` : '—' },
      { k: 'Cutting speed Vc', v: L ? q(L.Vm, 'speed') : '—', title: 'At the chip-section centroid' },
      { k: 'Chip h (=A/l)', v: L?.cutting ? q(L.h, 'length') : '—', title: 'Equivalent chip thickness from the geometric engagement' },
      { k: 'Chip area A', v: L?.cutting ? `${fmt(L.A, 4)} mm²` : '—' },
      { k: 'Engaged edge l', v: L?.cutting && L.l ? q(L.l, 'length') : '—' },
      { k: 'Fc (tangential)', v: q(L?.Fc ?? 0, 'force'), cls: 'fc' },
      { k: 'Ff (feed / axial)', v: q(L?.Ff ?? 0, 'force'), cls: 'ff' },
      { k: 'Fp (passive / radial)', v: q(L?.Fp ?? 0, 'force'), cls: 'fp' },
      { k: 'Resultant', v: q(L?.F ?? 0, 'force') },
      { k: 'Torque', v: q(L?.torque ?? 0, 'torque') },
      { k: 'Power', v: q(L?.power ?? 0, 'power') },
      { k: 'MRR', v: q(L?.mrr ?? 0, 'mrr') },
      { k: 'kc', v: L?.kc ? `${fmt(L.kc, 4)} N/mm²` : '—' },
      { k: 'Flank wear VB', v: `${fmt(w.VB, 3)} mm`, cls: w.VB >= (s.limits?.VB ?? 0.3) ? 'bad' : '' },
      { k: 'Tool life used', v: w.taylor ? `${fmt(100 * w.VB / w.VBc, 3)} %` : 'no Taylor constants' },
      { k: 'Interface T (est.)', v: L?.Tint ? q(L.Tint, 'temperature') : '—', title: 'Reduced-order Boothroyd estimate' },
      { k: 'Tool field max T', v: q(this.sim.fd.max(), 'temperature'), title: 'FD tool section with prescribed interface temperature' },
      { k: 'Workpiece deflection', v: L?.defl ? `${fmt(L.defl * 1000, 3)} µm` : '—' },
      { k: 'Sim time', v: `${fmt(this.sim.time, 4)} s` },
      { k: 'Removed volume', v: `${fmt(this.sim.removed / 1000, 4)} cm³` },
    ];
    this.ro.update(items);
    this.alerts.update(this.sim.alerts, this.sim.events);
    this.warnBox.replaceChildren(...[...(L?.warnings || []), ...(L?.thermal?.warnings || [])].map((x) => h('div', { class: 'warn' }, x)));
    const cutNow = this.sim.last?.cutting;
    this.overlay.textContent = cutNow ? `${LATHE_OPS[L.op]?.name || ''}  Fc ${fmt(L.Fc, 4)} N · P ${fmt(L.power, 3)} kW · VB ${fmt(w.VB, 3)} mm` : this.sim.done ? (L ? 'Idle — readouts show the last cutting revolution' : 'Idle') : 'Positioning';
  }

  _xData() {
    const H = this.sim.hist;
    if (this.s.xAxis === 'rev') { let c = 0; return H.t.map(() => ++c); }
    if (this.s.xAxis === 'dist') return this._dist();
    return H.t;
  }
  _dist() {
    const H = this.sim.hist; const out = []; let d = 0;
    for (let i = 0; i < H.t.length; i++) { const dt = i ? H.t[i] - H.t[i - 1] : 0; if (H.Fc[i] > 0 && H.P[i] > 0 && H.Fc[i] > 0) d += (H.P[i] * 1000 / H.Fc[i]) * dt; out.push(d); }
    return out;
  }
  _charts(force = false) {
    const H = this.sim.hist;
    const x = this._xData();
    const xl = { t: 'Time (s)', rev: 'Spindle revolutions', dist: 'Cutting distance (m)' }[this.s.xAxis];
    [this.cF, this.cTP, this.cMRR, this.cVB].forEach((c) => (c.o.xLabel = xl));
    this.cF.setData([{ name: 'Fc', x, y: H.Fc, color: '#dc2626' }, { name: 'Ff', x, y: H.Ff, color: '#2563eb' }, { name: 'Fp', x, y: H.Fp, color: '#059669' }]);
    this.cTP.setData([{ name: 'Torque', x, y: H.T, color: '#7c3aed' }, { name: 'Power', x, y: H.P, y2: true, color: '#d97706' }]);
    this.cMRR.setData([{ name: 'MRR', x, y: H.mrr.map((v) => v / 1000), color: '#0891b2' }], { zeroY: true });
    this.cVB.setData([{ name: 'VB', x, y: H.VB, color: '#111827' }, { name: 'Interface T', x, y: H.Tint.map((v) => (v == null ? NaN : v)), y2: true, color: '#dc2626' }], { annotations: [{ y: this.s.limits?.VB ?? 0.3, label: 'replacement criterion', color: '#dc2626' }] });
  }
  _thermal() {
    const fd = this.sim.fd;
    drawField(this.fieldCanvas, fd.T, fd.nx, fd.ny, { title: `Tool temperature field at t = ${fmt(this.sim.time, 3)} s (${COOLANTS[this.s.coolant].name})`, wmm: fd.W, hmm: fd.H });
    const th = (this.sim.last?.cutting ? this.sim.last : this.sim.lastCut)?.thermal;
    this.thermalInfo.replaceChildren(th ? kv([
      ['Shear angle φ (Merchant)', `${fmt(th.phi, 3)}°`], ['Chip ratio rc', fmt(th.rc, 3)], ['Thermal number R_T', fmt(th.RT, 3)],
      ['Heat into work Γ', fmt(th.Gamma, 3)], ['Shear-plane T', q(th.Tshear, 'temperature')], ['Mean chip T', q(th.TchipMean, 'temperature')],
      ['Max rake-face T', q(th.TrakeMax, 'temperature')], ['Contact length (est.)', q(th.contactLength, 'length')], ['Shear power', `${fmt(th.Ps, 4)} W`], ['Friction power', `${fmt(th.Pf, 4)} W`],
    ]) : h('div', { class: 'muted' }, 'Run a cutting operation to compute temperatures.'),
    h('div', { class: 'note' }, 'Reduced-order analytical temperatures (no coolant effect at this level). The FD field uses the estimated interface temperature as a boundary condition and the selected coolant convection coefficient (estimated) on free faces. Not a resolved chip–tool thermal simulation.'));
  }
  _quality() {
    const wp = this.wp;
    const zs = [], Do = [], Di = [];
    const step = Math.max(1, Math.floor(wp.n / 1500));
    for (let i = 0; i < wp.n; i += step) { zs.push(wp.zOf(i)); Do.push(2 * wp.R[i]); Di.push(wp.Ri[i] > 0 ? 2 * wp.Ri[i] : NaN); }
    this.cProf.setData([{ name: 'Outer Ø', x: zs, y: Do, color: '#111827' }, { name: 'Bore Ø', x: zs, y: Di, color: '#2563eb' }], { zeroY: true });
    const s = this.s, t = s.tool;
    const rows = [];
    const lastTurn = [...this.opLog].reverse().find((o) => /turning/i.test(o.name));
    const end = wp.endZ();
    if (t.kind === 'turning' && t.subtype === 'general') {
      const f = this.p.f ?? 0.2;
      const th = theoreticalRoughness(f, t.rn, t.kr, t.krMinor);
      rows.push(['Theoretical Ra (current f, rε)', `${fmt(th.Ra, 3)} µm`], ['Theoretical Rt', `${fmt(th.Rt, 3)} µm`], ['Classical f²/32rε', th.classic ? `${fmt(th.classic.Ra, 3)} µm` : '—'], ['Profile regime', th.model]);
    }
    if (lastTurn) {
      const L = Math.min(20, end * 0.3);
      const r = wp.roughness(end - L - 2, end - 2);
      if (r) rows.push(['Geometric Ra of machined profile (last 20 mm)', `${fmt(r.Ra, 3)} µm`], ['Geometric Rt', `${fmt(r.Rt, 3)} µm`], ['Mean machined Ø', `${fmt(r.meanDiameter, 6)} mm`]);
    }
    const H = this.sim.hist;
    const dmax = H.defl.length ? Math.max(...H.defl) : 0;
    rows.push(['Max workpiece deflection (passive force)', `${fmt(dmax * 1000, 3)} µm → Ø error ≈ +${fmt(2 * dmax * 1000, 3)} µm`]);
    rows.push(['Tool-nose recession (VB·tanα)', `${fmt(this.sim.wear.radialWear * 1000, 3)} µm → Ø error ≈ +${fmt(2000 * this.sim.wear.radialWear, 3)} µm`]);
    if (wp.partedAt != null) rows.push(['Parted off at z', `${fmt(wp.partedAt, 5)} mm`]);
    wp.threads.forEach((th) => rows.push(['Thread', `P = ${th.pitch} mm over z = ${fmt(th.z1, 4)}–${fmt(th.z2, 4)} mm, H1 = ${fmt(th.depth, 4)} mm`]));
    this.qualInfo.replaceChildren(kv(rows), h('div', { class: 'note' }, 'Geometric roughness is the ideal kinematic surface produced by the simulated tool outline; actual roughness also depends on BUE, vibration, side flow and wear and must be calibrated experimentally. Deflection is reported but not fed back into the geometry (stated limitation).'));
  }
  _lobes() {
    const s = this.s, m = this.mat;
    const f = this.p.f ?? 0.2;
    const kr = (s.tool.kr ?? 90) * Math.PI / 180;
    const h_ = f * Math.sin(kr);
    const Ks = kienzleKc(m.kc11, m.mc, h_);
    const mode = s.modes[0];
    const N = this._N();
    const nMax = Math.max(3000, N * 1.5);
    // enough lobes to cover the plotted speed range down to ~0.1·nMax
    const nLobes = Math.min(250, Math.ceil((60 * mode.fn * 1.6) / (0.1 * nMax)));
    const r = turningLobes({ modes: s.modes, Ks, fmin: mode.fn * 0.9, fmax: mode.fn * 1.6, nf: 500, lobes: nLobes });
    const series = r.lobes.filter((l) => l.n.some((x) => x <= nMax)).map((l, i) => ({ name: i === 0 ? 'stability lobes' : '', x: l.n, y: l.b, color: '#2563eb', width: 1.2 }));
    const b = (this.p.ap ?? 1) / Math.sin(kr);
    const env = lobeEnvelope(r.lobes, 300, 0.1 * nMax, nMax);
    const bAt = env.b[env.n.findIndex((x) => x >= N)] ?? null;
    this.cLobe.setData(series, { xMin: 0, xMax: nMax, yMin: 0, yMax: Math.max(r.bAsymptote * 6, b * 1.5), annotations: [{ point: [N, b], label: `operating point N=${fmt(N, 4)}, b=${fmt(b, 3)} mm`, color: '#dc2626' }, { y: r.bAsymptote, label: 'unconditional stability limit' }] });
    const verdict = bAt == null ? 'outside computed range' : b < bAt ? 'below the lobe envelope → predicted STABLE' : 'above the lobe envelope → predicted UNSTABLE (chatter)';
    this.dynInfo.replaceChildren(kv([['Ks (kc at h)', `${fmt(Ks, 4)} N/mm²`], ['Unconditional limit b_lim,min', `${fmt(r.bAsymptote, 4)} mm`], ['Operating chip width b', `${fmt(b, 4)} mm`], ['Verdict (estimated modes)', verdict]]));
  }

  _nominal() {
    if (!this.nominal) return;
    const s = this.s, p = this.p, t = s.tool;
    if (!t) return;
    const m = this.mat;
    const rows = [];
    if (t.kind === 'turning' && ['turning', 'step', 'taper', 'facing', 'chamfer', 'boring'].includes(s.op)) {
      const D = s.op === 'boring' ? p.Db : s.D;
      const ap = p.ap ?? 1, f = p.f ?? 0.2;
      const r = turningNominal({ mat: m, tool: t, V: p.V, f, ap, D });
      rows.push(['N', `${fmt(r.N, 4)} rev/min`], ['h = f·sinκr', `${fmt(r.h, 4)} mm`], ['kc', `${fmt(r.kc, 4)} N/mm²`], ['Fc', q(r.Fc, 'force')], ['Ff', q(r.Ff, 'force')], ['Fp', q(r.Fp, 'force')], ['Torque', q(r.torque, 'torque')], ['Power', q(r.power, 'power')], ['MRR (exact)', q(r.mrr, 'mrr')], ['MRR ≈ 1000·V·f·ap', q(r.mrrApprox, 'mrr')]);
      const T = taylorLife(p.V, f, ap, s.taylor);
      rows.push(['Taylor tool life', Number.isFinite(T) ? `${fmt(T, 3)} min` : 'needs n, C']);
      const th = cuttingTemperature({ mat: m, Fc: r.Fc, Fth: Math.hypot(r.Ff, r.Fp), gamma: t.rake ?? 0, V: p.V, h: r.h, b: r.b });
      if (th) { rows.push(['Rake-face max T (est.)', q(th.TrakeMax, 'temperature')]); th.warnings.forEach((w) => rows.push(['⚠', w])); }
      r.warnings.forEach((w) => rows.push(['⚠', w]));
    } else rows.push(['', 'Closed-form check is shown for single-point turning operations; other operations use the geometry-coupled engine (Live tab).']);
    this.nominal.replaceChildren(kv(rows));
  }

  show() { this.view?.vp.resume(); }
  hide() { this.view?.vp.pause(); }
  report() {
    const s = this.s, H = this.sim.hist;
    const peak = (a) => (a.length ? Math.max(...a.map(Math.abs)) : 0);
    const mean = (a) => { const v = a.filter((x, i) => H.Fc[i] > 0); return v.length ? v.reduce((p, c) => p + c, 0) / v.length : 0; };
    this._charts(true);
    return {
      title: 'Centre lathe simulation',
      machine: 'Conventional centre lathe (constant spindle speed per operation)',
      workpiece: `${lib.material(s.material).name} bar Ø${s.D} × ${s.L} mm (bore Ø${s.bore}); ${s.support}`,
      tool: `${s.tool.name}; γ=${s.tool.rake}°, α=${s.tool.clearance}°, κr=${s.tool.kr ?? '—'}°, κr′=${s.tool.krMinor ?? '—'}°, rε=${s.tool.rn} mm`,
      params: this.opLog.map((o) => `${o.name}: N=${fmt(o.N, 4)} rev/min, f=${o.f} mm/rev (${o.summary})`),
      models: ['M-CUT-01', 'M-CUT-02', 'M-CUT-03', 'M-TURN-02', 'M-TURN-03', 'M-THERM-01', 'M-THERM-02', 'M-WEAR-01', 'M-WEAR-02', 'M-WEAR-03', 'M-WEAR-05', 'M-DYN-01'],
      results: [['Peak Fc', q(peak(H.Fc), 'force')], ['Mean Fc (cutting)', q(mean(H.Fc), 'force')], ['Peak Ff', q(peak(H.Ff), 'force')], ['Peak Fp', q(peak(H.Fp), 'force')], ['Peak torque', q(peak(H.T), 'torque')], ['Peak power', q(peak(H.P), 'power')], ['Peak MRR', q(peak(H.mrr), 'mrr')], ['Final VB', `${fmt(this.sim.wear.VB, 3)} mm`], ['Max interface T (est.)', q(Math.max(0, ...H.Tint.filter((x) => x != null)), 'temperature')], ['Removed volume', `${fmt(this.sim.removed / 1000, 4)} cm³`], ['Machining time', `${fmt(this.sim.time, 4)} s`]],
      charts: [this.cF, this.cTP, this.cVB, this.cProf],
      snapshot: this.view?.vp.snapshot(),
      data: { headers: ['t_s', 'Fc_N', 'Ff_N', 'Fp_N', 'torque_Nm', 'power_kW', 'MRR_mm3_min', 'VB_mm', 'Tint_C', 'op'], rows: H.t.map((t, i) => [t, H.Fc[i], H.Ff[i], H.Fp[i], H.T[i], H.P[i], H.mrr[i], H.VB[i], H.Tint[i] ?? '', H.op[i]]) },
      limitations: ['Kienzle coefficients are VDI 3323 group values (published, not lab-calibrated).', 'Friction coefficient μ, wear-land stress and coolant coefficients are estimates.', 'Taylor constants are textbook values unless calibrated.', 'Deflection and vibration are not fed back into the machined geometry.'],
    };
  }
  serialize() { return { s: this.s, wp: this.wp.toJSON(), opLog: this.opLog, hist: this.sim.hist, wears: Object.fromEntries(Object.entries(this.wears).map(([k, w]) => [k, { VB: w.VB, damage: w.damage, cutTime: w.cutTime }])) }; }
  restore(d) {
    this.driver?.stop();
    Object.assign(this.s, d.s);
    this.resetPart();
    const wp = LatheWorkpiece.fromJSON(d.wp);
    this.wp.R.set(wp.R); this.wp.Ri.set(wp.Ri); this.wp.partedAt = wp.partedAt; this.wp.threads = wp.threads; this.wp.version++;
    this.opLog = d.opLog || [];
    this.log.replaceChildren(...this.opLog.map((o) => h('li', {}, h('b', {}, o.name), ` — ${o.summary}; N = ${fmt(o.N, 4)}; f = ${o.f}`)));
    if (d.hist) Object.assign(this.sim.hist, d.hist);
    for (const [k, v] of Object.entries(d.wears || {})) { this.s.tool.id === k && Object.assign(this._wear(), v); }
    this.opSel.sel.value = this.s.op; this._onOp(); this._refreshMat();
    this._charts(true); this._quality(); this._live();
  }
}
