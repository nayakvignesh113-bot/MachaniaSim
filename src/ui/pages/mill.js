// Milling workspace (vertical and horizontal knee-type machines).
import { h, numField, selectField, panel, tabs, q, kv, toast, checkField } from '../dom.js';
import { Chart, drawField } from '../chart.js';
import { lib, materialSelect, materialSummary, toolEditor, processPanel, runBar, readouts, alertsBox, Driver, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { getToolMaterial } from '../../core/tools.js';
import { spindleSpeed, fmt } from '../../core/units.js';
import { ZMap } from '../../geometry/zmap.js';
import { MillSim, MILL_OPS, planMillOp, MILL_MACHINE } from '../../sim/mill-sim.js';
import { EdgeWear, taylorLife } from '../../physics/wear.js';
import { millingForceCycle, immersionAngles, millingRoughness } from '../../physics/milling.js';
import { millingLobes, DEFAULT_MODES, lobeEnvelope, periodicResponse, amplitudeSpectrum } from '../../physics/dynamics.js';
import { cuttingTemperature, ToolFD, COOLANTS } from '../../physics/thermal.js';
import { kienzleKc, obliqueRatios } from '../../physics/cutting.js';
import { webglAvailable } from '../../render/scene.js';

const OP_TOOL = { face: 'face-63-5', end: 'em-10-4f', slot: 'slot-12-2f', side: 'side-80', peripheral: 'slab-63', angular: 'angle-63', profile: 'em-16-3f-hss', contour: 'em-10-4f', ball: 'ball-10-2f', pocket: 'em-10-4f' };
const OP_P = {
  face: { depth: 1.5, ap: 1.5, fz: 0.12, V: 150, stepover: 40 },
  end: { depth: 6, ap: 6, ae: 4, fz: 0.05, V: 120 },
  slot: { depth: 4, ap: 4, y: 40, fz: 0.04, V: 100 },
  side: { depth: 6, ap: 6, y0: 70, fz: 0.05, V: 30 },
  peripheral: { depth: 2, ap: 2, fz: 0.08, V: 25 },
  angular: { depth: 4, ap: 4, fz: 0.04, V: 25 },
  profile: { depth: 5, ap: 5, ae: 2, fz: 0.05, V: 30 },
  contour: { depth: 5, ap: 5, Db: 40, fz: 0.04, V: 120 },
  ball: { depth: 1, stepover: 0.8, fz: 0.05, V: 120, x1: 30, x2: 90, y1: 25, y2: 55 },
  pocket: { depth: 4, ap: 2, cx: 60, cy: 40, Lx: 50, Ly: 30, stepover: 6, fz: 0.04, V: 120 },
};

export class MillPage {
  constructor(root) {
    this.root = root;
    this.s = { material: 'al6061', W: 120, Dp: 80, H: 40, op: 'slot', speed: '20', coolant: 'flood', VB0: 0, climb: false, runout: 0, modesX: DEFAULT_MODES.millX.map((m) => ({ ...m })), modesY: DEFAULT_MODES.millY.map((m) => ({ ...m })), op_: structuredClone(OP_P) };
    this.s.toolId = OP_TOOL.slot; this.s.tool = { ...lib.tool(this.s.toolId) };
    this.wears = {}; this.opLog = [];
    this._build(); this.resetPart();
  }
  get p() { return this.s.op_[this.s.op]; }
  get mat() { return materialParams(lib.material(this.s.material)); }
  get horizontal() { return !!this.s.tool?.horizontal; }

  _build() {
    const s = this.s;
    this.matSum = h('div');
    const wp = panel('Workpiece block (in vise)', materialSelect(s, () => { s.taylor = null; s.land = null; this._refreshTool(); this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.resetPart(); }), this.matSum,
      h('div', { class: 'grid3' }, numField(s, 'W', { label: 'Length X', quantity: 'length', min: 20, max: 300, onChange: () => this.resetPart() }), numField(s, 'Dp', { label: 'Width Y', quantity: 'length', min: 20, max: 200, onChange: () => this.resetPart() }), numField(s, 'H', { label: 'Height Z', quantity: 'length', min: 5, max: 120, onChange: () => this.resetPart() })));
    this.opSel = selectField(s, 'op', Object.entries(MILL_OPS).map(([k, v]) => ({ value: k, label: `${v.name}${v.vertical ? '' : ' — horizontal'}` })), { label: 'Operation', onChange: () => this._onOp() });
    this.opParams = h('div');
    this.toolSel = selectField(s, 'toolId', [], { label: 'Cutter', onChange: () => this._refreshTool() });
    this.toolEd = h('div');
    const op = panel('Operation & parameters', this.opSel, this.opParams);
    const tp = panel('Cutter', this.toolSel, this.toolEd, numField(s, 'runout', { label: 'Radial runout (tooth 1 offset)', unit: 'mm', min: 0, max: 0.2, help: 'Single-tooth radial offset; produces unequal tooth loads.' }));
    const proc = panel('Process, wear & limits', processPanel(s)); proc.classList.add('collapsed');
    this.nominal = h('div');
    const nom = panel('Closed-form check (analytical cycle)', this.nominal, modelNote(['M-MILL-01', 'M-MILL-03']));
    this.log = h('ol', { class: 'oplog' });
    const left = h('div', { class: 'side' }, wp, op, tp, proc, nom, panel('Process plan', this.log));
    this.vpHost = h('div', { class: 'viewport' }); this.overlay = h('div', { class: 'vp-overlay' });
    this.bar = runBar({ run: () => this.run(), pause: () => this.driver?.running && this.bar.setPaused(this.driver.pause()), step: () => this._step(), finish: () => this.driver?.running && this.driver.finish(), reset: () => this.resetPart(true), undo: () => toast('Reset the block to start again.', 'info') }, s);
    const centre = h('div', { class: 'centre' }, h('div', { class: 'vp-wrap' }, this.vpHost, this.overlay, h('div', { class: 'vp-legend' }, h('span', { class: 'lg ff' }, 'Fx'), h('span', { class: 'lg fp' }, 'Fy'), h('span', { class: 'lg fc' }, 'Fz'))), this.bar);
    this.ro = readouts(); this.alerts = alertsBox();
    this.cRev = new Chart({ title: 'Forces over one revolution (last cut)', xLabel: 'Cutter rotation angle (deg)', yLabel: 'Force (N)' });
    this.cTooth = new Chart({ title: 'Tangential force per tooth (last cut)', xLabel: 'Cutter rotation angle (deg)', yLabel: 'Ft per tooth (N)' });
    this.cT = new Chart({ title: 'Mean forces vs time', xLabel: 'Time (s)', yLabel: 'Mean force (N)' });
    this.cP = new Chart({ title: 'Power and MRR', xLabel: 'Time (s)', yLabel: 'Power (kW)', y2Label: 'MRR (cm³/min)' });
    this.cVB = new Chart({ title: 'Flank wear per tooth', xLabel: 'Tooth', yLabel: 'VB (mm)', type: 'bar' });
    this.fieldCanvas = h('canvas', { class: 'field-canvas' }); this.cCyc = new Chart({ title: 'Tooth temperature cycling (FD, interface BC on/off)', xLabel: 'Time (ms)', yLabel: 'T at 0.2 mm below rake (°C)' });
    this.thInfo = h('div');
    this.cLobe = new Chart({ title: 'Milling stability lobes (ZOA, 2-DOF)', xLabel: 'Spindle speed (rev/min)', yLabel: 'Axial depth limit a_lim (mm)', height: 280 });
    this.cVib = new Chart({ title: 'Forced vibration (x) over one revolution', xLabel: 'Rotation angle (deg)', yLabel: 'Displacement (µm)' });
    this.cSpec = new Chart({ title: 'Force spectrum (Fx)', xLabel: 'Frequency (Hz)', yLabel: 'Amplitude (N)', type: 'bar' });
    this.dynInfo = h('div');
    const mx = s.modesX[0], my = s.modesY[0];
    const dyn = h('div', {}, h('div', { class: 'warn' }, 'Modal parameters are ESTIMATES — use tap-test FRFs for real predictions.'),
      h('div', { class: 'grid3' }, numField(mx, 'k', { label: 'kx', unit: 'N/m', min: 1e4, onChange: () => this._dyn() }), numField(mx, 'zeta', { label: 'ζx', unit: '–', min: 0.001, max: 0.5, onChange: () => this._dyn() }), numField(mx, 'fn', { label: 'fn,x', unit: 'Hz', min: 1, onChange: () => this._dyn() }),
        numField(my, 'k', { label: 'ky', unit: 'N/m', min: 1e4, onChange: () => this._dyn() }), numField(my, 'zeta', { label: 'ζy', unit: '–', min: 0.001, max: 0.5, onChange: () => this._dyn() }), numField(my, 'fn', { label: 'fn,y', unit: 'Hz', min: 1, onChange: () => this._dyn() })),
      this.cLobe.el, this.dynInfo, this.cVib.el, this.cSpec.el, modelNote(['M-DYN-02', 'M-DYN-03']));
    this.qual = h('div');
    this.tabs = tabs([
      { id: 'live', label: 'Live', content: h('div', {}, this.ro, this.alerts) },
      { id: 'rev', label: 'Per revolution', content: h('div', {}, this.cRev.el, this.cTooth.el, modelNote(['M-MILL-01', 'M-MILL-02'])) },
      { id: 'graphs', label: 'Graphs', content: h('div', {}, this.cT.el, this.cP.el, this.cVB.el) },
      { id: 'thermal', label: 'Thermal', content: h('div', {}, this.cCyc.el, this.fieldCanvas, this.thInfo) },
      { id: 'dyn', label: 'Dynamics', content: dyn },
      { id: 'quality', label: 'Quality', content: this.qual },
    ], { onChange: (id) => this._tab(id) });
    this.root.append(h('div', { class: 'workspace' }, left, centre, h('div', { class: 'results' }, this.tabs.el)));
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this._onOp(true);
    this._mountView();
  }
  _mountView() {
    if (!webglAvailable()) { this.vpHost.append(h('div', { class: 'nogl' }, 'WebGL unavailable; simulation still runs.')); return; }
    const want = this.horizontal;
    if (this.view && this.view.horizontal === want) return;
    this.view?.dispose(); this.view = null;
    import('../../render/machines3d.js').then(({ Mill3D }) => {
      this.view = new Mill3D(this.vpHost, { horizontal: want });
      if (this.zm) this.view.setBlock(this.zm);
      this.view.setTool(this.s.tool);
      this.view.setToolPos(this.sim.pos.x, this.sim.pos.y, this.sim.pos.z, 0);
    });
  }
  _onOp(init) {
    const s = this.s, p = this.p;
    const vertical = MILL_OPS[s.op].vertical;
    const tools = lib.tools().filter((t) => t.kind === 'mill' && !!t.horizontal === !vertical && (s.op !== 'ball' || t.subtype === 'ball') && (s.op !== 'face' || t.subtype === 'face') && (s.op !== 'angular' || t.subtype === 'angle') && (s.op === 'angular' || t.subtype !== 'angle'));
    if (!tools.find((t) => t.id === s.toolId)) s.toolId = tools.find((t) => t.id === OP_TOOL[s.op])?.id || tools[0]?.id;
    this.toolSel.setOptions(tools.map((t) => ({ value: t.id, label: t.name })));
    const f = [];
    const nf = (k, label, quantity, o = {}) => f.push(numField(p, k, { label, quantity, onChange: () => this._nominal(), ...o }));
    nf('depth', 'Total depth', 'length', { min: 0.05 });
    if (p.ap != null) nf('ap', 'Max axial depth per pass ap', 'length', { min: 0.05 });
    if (s.op === 'end' || s.op === 'profile') nf('ae', 'Radial depth ae', 'length', { min: 0.05 });
    if (s.op === 'slot') nf('y', 'Slot centre y', 'length');
    if (s.op === 'side') nf('y0', 'Cutter left face y', 'length');
    if (s.op === 'face' || s.op === 'ball' || s.op === 'pocket') nf('stepover', 'Stepover', 'length', { min: 0.05 });
    if (s.op === 'contour') nf('Db', 'Boss diameter', 'length');
    if (s.op === 'pocket') { nf('Lx', 'Pocket length X', 'length'); nf('Ly', 'Pocket width Y', 'length'); nf('cx', 'Centre x', 'length'); nf('cy', 'Centre y', 'length'); }
    if (s.op === 'ball') { nf('x1', 'Raster x from', 'length'); nf('x2', 'to', 'length'); nf('y1', 'y from', 'length'); nf('y2', 'to', 'length'); }
    nf('fz', 'Feed per tooth fz', 'length', { min: 0.002, max: 1 });
    nf('V', 'Cutting speed V', 'speed', { min: 1, max: 1500 });
    if (!vertical) f.push(checkField(s, 'climb', 'Climb (down) milling — unchecked = conventional (up)'));
    this.opParams.replaceChildren(...f);
    if (!init) this._refreshTool();
    this._nominal();
  }
  _refreshTool() {
    const s = this.s; const base = lib.tool(s.toolId); if (!base) return;
    const switched = !s.tool || s.tool.id !== base.id;
    if (switched) { s.tool = { ...base }; s.taylor = null; }
    this.toolEd.replaceChildren(toolEditor(s, () => this._refreshTool()));
    if (this.sim) this._configure();
    if (this.view && this.view.horizontal !== this.horizontal) this._mountView(); else this.view?.setTool(s.tool);
    this._nominal();
  }
  _wear() {
    const s = this.s, id = s.tool.id, Z = s.tool.z;
    if (!this.wears[id] || this.wears[id].length !== Z) this.wears[id] = Array.from({ length: Z }, () => new EdgeWear({ taylor: null, VB0: s.VB0 || 0, clearance: 8 }));
    for (const w of this.wears[id]) { w.taylor = s.taylor?.C && s.taylor?.n ? s.taylor : null; w.VBc = s.limits?.VB ?? 0.3; }
    return this.wears[id];
  }
  _configure() {
    const s = this.s;
    Object.assign(this.sim, { mat: this.mat, tool: s.tool, toolMat: getToolMaterial(s.tool.material), land: s.land, wear: this._wear(), climb: s.climb, machine: { ...MILL_MACHINE, Pmax: s.limits?.P ?? MILL_MACHINE.Pmax } });
    this.sim.runout = s.runout > 0 ? Array.from({ length: s.tool.z }, (_, j) => (j === 0 ? s.runout : 0)) : null;
    this.sim._els = null;
  }
  resetPart(ask) {
    if (ask && this.opLog.length && !confirm('Reset the block?')) return;
    this.driver?.stop();
    const s = this.s;
    this.zm = new ZMap({ W: s.W, Dp: s.Dp, H: s.H, g: Math.max(0.2, Math.min(0.5, Math.sqrt((s.W * s.Dp) / 150000))) });
    this.sim = new MillSim({ zmap: this.zm, mat: this.mat, tool: s.tool });
    this._configure();
    this.opLog = []; this.log?.replaceChildren();
    this.view?.setBlock(this.zm);
    this._live();
  }
  _N() { return Math.min(spindleSpeed(this.p.V, this.s.tool.D), MILL_MACHINE.Nmax); }
  run() {
    const s = this.s;
    if (this.driver?.running) return toast('Already running', 'warn');
    if (MILL_OPS[s.op].vertical === !!s.tool.horizontal) return toast('Cutter type does not match the operation', 'error');
    const N = this._N();
    const plan = planMillOp(s.op, { ...this.p, N }, this.zm, s.tool);
    plan.warnings.forEach((w) => toast(w, 'warn'));
    if (!plan.moves.length) return;
    this._configure();
    this.sim.load(plan.moves, s.op);
    this.view?.setRpm(N);
    this._start = { t: this.sim.time, name: MILL_OPS[s.op].name, tool: s.tool.name, N, fz: this.p.fz };
    this.driver = new Driver(this.sim, { onFrame: () => this._frame(), onDone: () => this._done() });
    this.bar.setPaused(false); this.driver.start(s.speed);
  }
  _step() { if (!this.driver?.running) return toast('Run an operation first', 'info'); if (!this.driver.paused) this.bar.setPaused(this.driver.pause()); this.sim.step(); this._frame(true); }
  _frame(force) {
    const sim = this.sim, m = sim.moves[Math.min(sim.mi, sim.moves.length - 1)];
    this.view?.setToolPos(sim.pos.x, sim.pos.y, sim.pos.z, m?.y0);
    this.view?.setForces(sim.last);
    const now = performance.now();
    if (force || !this._t1 || now - this._t1 > 120) { this._t1 = now; this._live(); }
    if (force || !this._t2 || now - this._t2 > 500) { this._t2 = now; if (this.tabs.active === 'rev') this._rev(); if (this.tabs.active === 'graphs') this._charts(); }
  }
  _done() {
    const o = this._start;
    this.opLog.push({ ...o, duration: this.sim.time - o.t });
    this.log.append(h('li', {}, h('b', {}, o.name), ` — ${o.tool}; N = ${fmt(o.N, 4)} rev/min; fz = ${o.fz} mm; ${fmt(this.sim.time - o.t, 3)} s`));
    this.view?.setRpm(0); this.view?.setForces(null);
    this._live(); this._rev(); this._charts(); this._quality();
  }
  _tab(id) { if (id === 'rev') this._rev(); if (id === 'graphs') this._charts(); if (id === 'thermal') this._thermal(); if (id === 'dyn') this._dyn(); if (id === 'quality') this._quality(); }
  _live() {
    const L = this.sim.last?.cutting ? this.sim.last : this.sim.lastCut;
    const VB = this.sim.wear.map((w) => w.VB);
    this.ro.update([
      { k: 'Spindle N', v: L ? `${fmt(L.N, 4)} rev/min` : '—' },
      { k: 'Feed rate vf', v: L ? `${fmt(L.fz * this.s.tool.z * L.N, 4)} mm/min` : '—' },
      { k: 'Mean Fx (machine X)', v: q(L?.Fx ?? 0, 'force'), cls: 'ff' },
      { k: 'Mean Fy (machine Y)', v: q(L?.Fy ?? 0, 'force'), cls: 'fp' },
      { k: 'Mean Fz (axial)', v: q(L?.Fz ?? 0, 'force'), cls: 'fc' },
      { k: 'Peak resultant', v: q(L?.F ?? 0, 'force') },
      { k: 'Mean torque', v: q(L?.T ?? 0, 'torque') },
      { k: 'Power', v: q(L?.P ?? 0, 'power') },
      { k: 'MRR (geometric)', v: q(L?.mrr ?? 0, 'mrr') },
      { k: 'Engaged fraction', v: L ? `${fmt(100 * L.cycle.engagedFrac, 3)} % of rev` : '—' },
      { k: 'VB max / min tooth', v: `${fmt(Math.max(...VB), 3)} / ${fmt(Math.min(...VB), 3)} mm` },
      { k: 'Removed volume', v: `${fmt(this.sim.removed / 1000, 4)} cm³` },
      { k: 'Sim time', v: `${fmt(this.sim.time, 4)} s` },
    ]);
    this.alerts.update([], this.sim.events);
    this.overlay.textContent = this.sim.last?.cutting ? `${MILL_OPS[this.sim.last.op]?.name} — P ${fmt(L.P, 3)} kW · Fpk ${fmt(L.F, 4)} N` : 'Idle';
  }
  _rev() {
    const c = this.sim.lastCycle;
    if (!c) return;
    const S = c.series;
    this.cRev.setData([{ name: 'Fx', x: S.phi, y: S.Fx, color: '#2563eb' }, { name: 'Fy', x: S.phi, y: S.Fy, color: '#059669' }, { name: 'Fz', x: S.phi, y: S.Fz, color: '#dc2626' }], { xMin: 0, xMax: 360 });
    const Z = this.s.tool.z;
    this.cTooth.setData(Array.from({ length: Z }, (_, j) => ({ name: `tooth ${j + 1}`, x: S.phi, y: S.perTooth.map((pt) => pt[j]) })), { xMin: 0, xMax: 360 });
  }
  _charts() {
    const H = this.sim.hist;
    this.cT.setData([{ name: 'Fx', x: H.t, y: H.Fx, color: '#2563eb' }, { name: 'Fy', x: H.t, y: H.Fy, color: '#059669' }, { name: 'Fz', x: H.t, y: H.Fz, color: '#dc2626' }]);
    this.cP.setData([{ name: 'Power', x: H.t, y: H.P, color: '#d97706' }, { name: 'MRR', x: H.t, y: H.mrr.map((v) => v / 1000), y2: true, color: '#0891b2' }]);
    const VB = this.sim.wear.map((w) => w.VB);
    this.cVB.setData([{ name: 'VB', x: VB.map((_, i) => i + 1), y: VB, color: '#111827' }], { zeroY: true });
  }
  _thermal() {
    const s = this.s, p = this.p, t = s.tool, m = this.mat;
    const N = this._N();
    const ae = s.op === 'end' || s.op === 'profile' ? p.ae : s.op === 'face' ? Math.min(p.stepover, t.D) : t.D;
    const { st, ex } = immersionAngles(ae, t.D, s.op === 'end' || s.op === 'profile' ? 'down' : 'slot');
    const hmax = p.fz * Math.max(Math.sin(st), Math.sin(ex), st < Math.PI / 2 && ex > Math.PI / 2 ? 1 : 0);
    const hm = Math.max(0.005, (p.fz * (Math.cos(st) - Math.cos(ex))) / Math.max(ex - st, 1e-6));
    const b = Math.min(p.ap ?? p.depth, t.flute ?? 20);
    const Fc = kienzleKc(m.kc11, m.mc, hm) * hm * b;
    const r = obliqueRatios(m.mu, t.rake ?? 0, t.helix ?? 0);
    const th = cuttingTemperature({ mat: m, Fc, Fth: r.kr * Fc, gamma: t.rake ?? 0, V: p.V, h: hm, b });
    const tp = getToolMaterial(t.material).props;
    const fd = new ToolFD({ W: 2, H: 2, nx: 21, ny: 21, k: tp.k.value, rho: tp.density.value, cp: tp.cp.value, hConv: COOLANTS[s.coolant].h, T0: 20 });
    const Trev = 60 / N, tin = ((ex - st) / (2 * Math.PI)) * Trev;
    const ts = [], Ts = [];
    const nrev = 12, sub = 40;
    for (let k = 0; k < nrev; k++) for (let j = 0; j < sub; j++) {
      const tt = (j / sub) * Trev; const on = tt < tin;
      fd.step(Trev / sub, th ? th.contactLength : 0.1, th ? th.TinterfaceMean : 20, on && !!th);
      ts.push((k * Trev + tt) * 1000); Ts.push(fd.at(0.2, 0.2));
    }
    this.cCyc.setData([{ name: 'T (0.2, 0.2 mm)', x: ts, y: Ts, color: '#dc2626' }]);
    drawField(this.fieldCanvas, fd.T, fd.nx, fd.ny, { title: `Tooth section after ${nrev} revolutions (end of idle phase)`, wmm: 2, hmm: 2 });
    this.thInfo.replaceChildren(kv([['Mean chip thickness h̄', `${fmt(hm, 3)} mm`], ['Max chip thickness', `${fmt(hmax, 3)} mm`], ['Tooth in cut per rev', `${fmt(tin * 1000, 3)} ms of ${fmt(Trev * 1000, 3)} ms`], ['Interface T while cutting (est.)', th ? q(th.TinterfaceMean, 'temperature') : '—'], ['Cooling (h, estimated)', `${COOLANTS[s.coolant].name}, ${COOLANTS[s.coolant].h} W/m²K`]]),
      h('div', { class: 'note' }, 'Intermittent cutting: the interface temperature (reduced-order Boothroyd estimate at mean chip thickness) is applied only while the tooth is engaged, then the tooth cools by conduction and coolant convection. The resulting cycle amplitude drives thermal-fatigue (comb) cracking; no crack-initiation model is applied.'), modelNote(['M-THERM-01', 'M-THERM-02']));
  }
  _dyn() {
    const s = this.s, p = this.p, t = s.tool, m = this.mat;
    const ae = s.op === 'end' || s.op === 'profile' ? p.ae : s.op === 'face' ? Math.min(p.stepover, t.D) : t.D;
    const mode = s.op === 'end' || s.op === 'profile' ? 'down' : 'slot';
    const { st, ex } = immersionAngles(ae, t.D, mode);
    const hm = Math.max(0.01, (p.fz * (Math.cos(st) - Math.cos(ex))) / Math.max(ex - st, 1e-6));
    const Kt = kienzleKc(m.kc11, m.mc, hm);
    const Kr = obliqueRatios(m.mu, t.rake ?? 0, t.helix ?? 0).kr;
    const fmin = Math.min(s.modesX[0].fn, s.modesY[0].fn) * 0.8, fmax = Math.max(s.modesX[0].fn, s.modesY[0].fn) * 1.6;
    const N = this._N();
    const nMax = Math.max(N * 2, 6000);
    const nL = Math.min(120, Math.ceil((60 * fmax) / (t.z * 0.1 * nMax)));
    const r = millingLobes({ modesX: s.modesX, modesY: s.modesY, Kt, Kr, Z: t.z, st, ex, fmin, fmax, nf: 700, lobes: nL });
    const a = p.ap ?? p.depth;
    const env = lobeEnvelope(r.lobes, 300, 0.1 * nMax, nMax);
    const aAt = env.b[env.n.findIndex((x) => x >= N)];
    this.cLobe.setData(r.lobes.map((l, i) => ({ name: i ? '' : 'lobes', x: l.n, y: l.b, color: '#2563eb', width: 1.2 })), { xMin: 0, xMax: nMax, yMin: 0, yMax: Math.max(r.aAsymptote * 6, a * 1.5), annotations: [{ point: [N, a], label: `N=${fmt(N, 4)}, ap=${a} mm`, color: '#dc2626' }, { y: r.aAsymptote, label: 'unconditional limit' }] });
    this.dynInfo.replaceChildren(kv([['Kt (kc at h̄)', `${fmt(Kt, 4)} N/mm²`], ['Kr', fmt(Kr, 3)], ['Immersion', `${fmt((st * 180) / Math.PI, 3)}° → ${fmt((ex * 180) / Math.PI, 3)}°`], ['a_lim,min', `${fmt(r.aAsymptote, 4)} mm`], ['Verdict (estimated modes)', aAt == null ? 'outside range' : a < aAt ? 'predicted STABLE' : 'predicted UNSTABLE (chatter)']]));
    // forced vibration from the analytical cycle
    const cyc = millingForceCycle({ mat: m, tool: t.horizontal ? { ...t, subtype: 'end' } : t, fz: p.fz, ap: a, ae, mode, N }, 256);
    const x = periodicResponse(cyc.Fx, 60 / N, s.modesX);
    this.cVib.setData([{ name: 'x', x: cyc.phi, y: x, color: '#2563eb' }], { xMin: 0, xMax: 360 });
    const sp = amplitudeSpectrum(cyc.Fx, (256 * N) / 60);
    const n = Math.min(sp.f.length, 40);
    this.cSpec.setData([{ name: '|Fx|', x: sp.f.slice(1, n), y: sp.A.slice(1, n), color: '#2563eb' }]);
  }
  _quality() {
    const s = this.s, p = this.p, t = s.tool;
    const r = millingRoughness({ tool: t, fz: p.fz, ae: p.stepover ?? p.ae ?? t.D });
    this.qual.replaceChildren(kv([['Surface', r.surface], ['Theoretical Rt', `${fmt(r.Rt, 3)} µm`], ['Theoretical Ra', `${fmt(r.Ra, 3)} µm`], ['Runout effect', s.runout > 0 ? `tooth 1 offset ${s.runout} mm → feed marks at one per revolution (fz_eff up to ${fmt(p.fz + s.runout, 3)} mm)` : 'none']]),
      h('div', { class: 'note' }, 'Kinematic (theoretical) roughness. Measured roughness must be calibrated (Research → Experiments). Z-map grid resolution limits geometric surface detail.'), modelNote(['M-MILL-03']));
  }
  _nominal() {
    if (!this.nominal) return;
    const s = this.s, p = this.p, t = s.tool;
    if (!t) return;
    const ae = s.op === 'end' || s.op === 'profile' ? p.ae : s.op === 'face' ? Math.min(p.stepover, t.D) : t.D;
    const mode = s.op === 'end' || s.op === 'profile' ? 'down' : s.op === 'face' ? 'slot' : 'slot';
    const N = this._N();
    const a = Math.min(p.ap ?? p.depth, t.horizontal ? t.width : 1e9);
    const c = millingForceCycle({ mat: this.mat, tool: t.horizontal ? { ...t, subtype: 'end' } : t, fz: p.fz, ap: t.horizontal ? t.width : a, ae: t.horizontal ? Math.min(t.D, 2 * Math.sqrt(Math.max(0, a * (t.D - a)))) : ae, mode: t.horizontal ? 'up' : mode, N }, 360);
    const T = taylorLife(p.V, p.fz, a, s.taylor);
    this.nominal.replaceChildren(kv([['N', `${fmt(N, 4)} rev/min`], ['Feed rate vf', `${fmt(c.vf, 4)} mm/min`], ['Mean Fx / Fy / Fz', `${fmt(c.mean.Fx, 4)} / ${fmt(c.mean.Fy, 4)} / ${fmt(c.mean.Fz, 4)} N`], ['Peak resultant', q(c.peakF, 'force')], ['Mean torque', q(c.mean.T, 'torque')], ['Power', q(c.power, 'power')], ['MRR (ap·ae·vf)', q(c.mrr, 'mrr')], ['Taylor life', Number.isFinite(T) ? `${fmt(T, 3)} min` : 'needs n, C'],
      ['Assumed engagement', t.horizontal ? `slab: arc for depth ${a} mm, width ${t.width} mm` : `${mode}, ae = ${fmt(ae, 3)} mm`]]));
  }
  show() { this.view?.vp.resume(); }
  hide() { this.view?.vp.pause(); }
  report() {
    const s = this.s, H = this.sim.hist;
    this._charts(); this._rev();
    const pk = (a) => (a.length ? Math.max(...a.map(Math.abs)) : 0);
    return {
      title: 'Milling simulation', machine: `${this.horizontal ? 'Horizontal' : 'Vertical'} knee-type milling machine`,
      workpiece: `${lib.material(s.material).name} block ${s.W} × ${s.Dp} × ${s.H} mm`, tool: `${s.tool.name}`,
      params: this.opLog.map((o) => `${o.name}: N=${fmt(o.N, 4)} rev/min, fz=${o.fz} mm (${o.tool})`),
      models: ['M-MILL-01', 'M-MILL-02', 'M-MILL-03', 'M-WEAR-01', 'M-WEAR-02', 'M-DYN-02', 'M-THERM-02'],
      results: [['Peak resultant', q(pk(H.F), 'force')], ['Peak mean torque', q(pk(H.T), 'torque')], ['Peak power', q(pk(H.P), 'power')], ['Peak MRR', q(pk(H.mrr), 'mrr')], ['VB per tooth', this.sim.wear.map((w) => fmt(w.VB, 3)).join(', ') + ' mm'], ['Removed', `${fmt(this.sim.removed / 1000, 4)} cm³`], ['Time', `${fmt(this.sim.time, 4)} s`]],
      charts: [this.cRev, this.cTooth, this.cT, this.cP], snapshot: this.view?.vp.snapshot(),
      data: { headers: ['t_s', 'Fx_N', 'Fy_N', 'Fz_N', 'Fpeak_N', 'T_Nm', 'P_kW', 'MRR_mm3_min', 'VBmax_mm', 'op'], rows: H.t.map((t, i) => [t, H.Fx[i], H.Fy[i], H.Fz[i], H.F[i], H.T[i], H.P[i], H.mrr[i], H.VBmax[i], H.op[i]]) },
      limitations: ['Rigid cutter in the force model (vibration not fed back).', 'Engagement boundary resolution ≈ 1.5 grid cells.', 'Plunge (end-cutting edge) forces not modelled.'],
    };
  }
  serialize() { return { s: this.s, zm: this.zm.toJSON(), hist: this.sim.hist, opLog: this.opLog }; }
  restore(d) {
    Object.assign(this.s, d.s); this.resetPart();
    this.zm.h.set(d.zm.h); this.zm.dirty = { i0: 0, i1: this.zm.nx - 1, j0: 0, j1: this.zm.ny - 1 }; this.zm.holesChanged = true; this.view?.setBlock(this.zm);
    Object.assign(this.sim.hist, d.hist || {}); this.opLog = d.opLog || [];
    this.opSel.sel.value = this.s.op; this._onOp(); this._charts();
  }
}
