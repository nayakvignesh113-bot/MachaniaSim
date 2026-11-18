// Radial drilling machine workspace.
import { h, numField, selectField, panel, tabs, q, kv, toast } from '../dom.js';
import { Chart } from '../chart.js';
import { lib, materialSelect, materialSummary, toolEditor, processPanel, runBar, readouts, alertsBox, Driver, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { getToolMaterial } from '../../core/tools.js';
import { spindleSpeed, fmt } from '../../core/units.js';
import { ZMap } from '../../geometry/zmap.js';
import { DrillSim, DRILL_OPS, planHole, radialIK, RADIAL_DRILL } from '../../sim/drill-sim.js';
import { EdgeWear, taylorLife } from '../../physics/wear.js';
import { drillForces, sandvikDrillReference } from '../../physics/drilling.js';
import { cuttingTemperature } from '../../physics/thermal.js';
import { webglAvailable } from '../../render/scene.js';

const OP_TOOL = { centre: 'centre-drill', drilling: 'drill-hss-10', step: 'drill-hss-20', reaming: 'reamer-10', counterbore: 'cbore-16', countersink: 'csink-20', tapping: 'tap-m10' };
const OP_PARAMS = {
  centre: { depth: 4, f: 0.05, V: 15, peck: 0 },
  drilling: { depth: 25, f: 0.15, V: 25, peck: 0 },
  step: { depth: 20, f: 0.2, V: 25, peck: 0, pilotId: 'drill-hss-8' },
  reaming: { depth: 22, f: 0.3, V: 8, peck: 0 },
  counterbore: { depth: 8, f: 0.1, V: 15, peck: 0 },
  countersink: { depth: 4, f: 0.08, V: 12, peck: 0 },
  tapping: { depth: 18, f: 1.5, V: 6, peck: 0 },
};

export class DrillPage {
  constructor(root) {
    this.root = root;
    this.s = { material: 'en8', W: 120, Dp: 80, H: 25, g: 0.2, op: 'drilling', speed: '20', coolant: 'flood', VB0: 0, VB0b: 0, VBchisel: 0, holes: [{ x: 30, y: 40 }, { x: 60, y: 40 }, { x: 90, y: 40 }], op_: structuredClone(OP_PARAMS) };
    this.s.toolId = OP_TOOL.drilling; this.s.tool = { ...lib.tool(this.s.toolId) };
    this.wears = {};
    this.opLog = [];
    this._build();
    this.resetPart();
  }
  get p() { return this.s.op_[this.s.op]; }
  get mat() { return materialParams(lib.material(this.s.material)); }

  _build() {
    const s = this.s;
    this.matSum = h('div');
    this.holesEl = h('div');
    const wp = panel('Workpiece block & holes', materialSelect(s, () => { s.taylor = null; s.land = null; this._refreshTool(); this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.resetPart(); }), this.matSum,
      h('div', { class: 'grid3' }, numField(s, 'W', { label: 'Length X', quantity: 'length', min: 20, max: 400, onChange: () => this.resetPart() }), numField(s, 'Dp', { label: 'Width Y', quantity: 'length', min: 20, max: 300, onChange: () => this.resetPart() }), numField(s, 'H', { label: 'Height', quantity: 'length', min: 2, max: 120, onChange: () => this.resetPart() })),
      h('div', { class: 'subhead' }, 'Hole positions (block coordinates)'), this.holesEl,
      h('button', { class: 'mini', type: 'button', onclick: () => { s.holes.push({ x: s.W / 2, y: s.Dp / 2 }); this._holes(); } }, '+ hole'));
    this.opSel = selectField(s, 'op', Object.entries(DRILL_OPS).map(([k, v]) => ({ value: k, label: v.name })), { label: 'Operation', onChange: () => this._onOp() });
    this.opParams = h('div');
    this.toolSel = selectField(s, 'toolId', [], { label: 'Tool', onChange: () => this._refreshTool() });
    this.toolEd = h('div');
    this.cond = h('div');
    const op = panel('Operation & parameters', this.opSel, this.opParams);
    const tp = panel('Tool', this.toolSel, this.toolEd, h('div', { class: 'subhead' }, 'Lip condition (for asymmetric wear studies)'),
      h('div', { class: 'grid3' }, numField(s, 'VB0', { label: 'Lip 1 VB₀', unit: 'mm', min: 0 }), numField(s, 'VB0b', { label: 'Lip 2 VB₀', unit: 'mm', min: 0 }), numField(s, 'VBchisel', { label: 'Chisel VB', unit: 'mm', min: 0 })),
      h('button', { class: 'mini', type: 'button', onclick: () => { this.wears = {}; this._setWear(); toast('Fresh tool fitted', 'ok'); this._live(); } }, 'Fit fresh tool (apply VB₀)'));
    const proc = panel('Process, wear & limits', processPanel(s, { showCoolant: false }));
    proc.classList.add('collapsed');
    this.nominal = h('div');
    const nom = panel('Closed-form check (full engagement)', this.nominal, modelNote(['M-DRILL-01', 'M-DRILL-02', 'M-DRILL-04']));
    this.log = h('ol', { class: 'oplog' });
    const left = h('div', { class: 'side' }, wp, op, tp, proc, nom, panel('Process plan', this.log));

    this.vpHost = h('div', { class: 'viewport' });
    this.overlay = h('div', { class: 'vp-overlay' });
    this.bar = runBar({ run: () => this.run(), pause: () => this.driver?.running && this.bar.setPaused(this.driver.pause()), step: () => this._step(), finish: () => this.driver?.running && this.driver.finish(), reset: () => this.resetPart(true), undo: () => toast('Undo is available on the lathe; reset the block here.', 'info') }, s);
    const centre = h('div', { class: 'centre' }, h('div', { class: 'vp-wrap' }, this.vpHost, this.overlay, h('div', { class: 'vp-legend' }, h('span', { class: 'lg ff' }, 'Thrust'))), this.bar);

    this.ro = readouts(); this.alerts = alertsBox();
    this.cF = new Chart({ title: 'Thrust and torque', xLabel: 'Time (s)', yLabel: 'Thrust (N)', y2Label: 'Torque (N·m)' });
    this.cD = new Chart({ title: 'Thrust vs depth (last hole)', xLabel: 'Tip depth below top face (mm)', yLabel: 'Thrust (N)' });
    this.cP = new Chart({ title: 'Power and MRR', xLabel: 'Time (s)', yLabel: 'Power (kW)', y2Label: 'MRR (cm³/min)' });
    this.cVB = new Chart({ title: 'Lip flank wear', xLabel: 'Time (s)', yLabel: 'VB (mm)' });
    this.cLip = new Chart({ title: 'Force contributions (current revolution)', xLabel: 'Component', yLabel: 'Force (N) / Torque (N·m ×100)', type: 'bar' });
    this.lipInfo = h('div');
    this.holeTbl = h('div');
    this.tabs = tabs([
      { id: 'live', label: 'Live', content: h('div', {}, this.ro, this.alerts) },
      { id: 'graphs', label: 'Graphs', content: h('div', {}, this.cF.el, this.cD.el, this.cP.el, this.cVB.el) },
      { id: 'lips', label: 'Lips & chisel', content: h('div', {}, this.cLip.el, this.lipInfo, modelNote(['M-DRILL-01', 'M-DRILL-02', 'M-DRILL-03'])) },
      { id: 'holes', label: 'Holes', content: this.holeTbl },
    ], { onChange: (id) => this._tab(id) });
    this.root.append(h('div', { class: 'workspace' }, left, centre, h('div', { class: 'results' }, this.tabs.el)));
    if (webglAvailable()) import('../../render/machines3d.js').then(({ RadialDrill3D }) => { this.view = new RadialDrill3D(this.vpHost); this.view.setBlock(this.zm); this._refreshTool(); this.view.setToolPos(s.holes[0].x, s.holes[0].y, s.H + 40); }).catch((e) => this.vpHost.append(h('div', { class: 'nogl' }, e.message)));
    else this.vpHost.append(h('div', { class: 'nogl' }, 'WebGL unavailable; simulation still runs.'));
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this._holes();
    this._onOp(true);
  }

  _holes() {
    const s = this.s;
    this.holesEl.replaceChildren(...s.holes.map((hh, i) => {
      const ik = radialIK(hh.x, hh.y);
      return h('div', { class: 'grid3' }, numField(hh, 'x', { label: `#${i + 1} x`, unit: 'mm', min: 0, max: s.W, onChange: () => this._holes() }), numField(hh, 'y', { label: 'y', unit: 'mm', min: 0, max: s.Dp, onChange: () => this._holes() }),
        h('div', { class: 'field' }, h('label', {}, ik.ok ? `arm ${fmt((ik.theta * 180) / Math.PI, 3)}°, head ${fmt(ik.rho, 4)} mm` : 'out of reach'), h('button', { class: 'mini', type: 'button', onclick: () => { s.holes.splice(i, 1); this._holes(); } }, 'remove')));
    }));
  }

  _onOp(init) {
    const s = this.s, p = this.p;
    const sub = DRILL_OPS[s.op].sub;
    const tools = lib.tools().filter((t) => t.kind === 'drill' && sub.includes(t.subtype));
    if (!tools.find((t) => t.id === s.toolId)) s.toolId = tools.find((t) => t.id === OP_TOOL[s.op])?.id || tools[0]?.id;
    this.toolSel.setOptions(tools.map((t) => ({ value: t.id, label: t.name })));
    const f = [];
    f.push(numField(p, 'depth', { label: s.op === 'tapping' ? 'Thread depth' : 'Depth (tip below top face)', quantity: 'length', min: 0.1, onChange: () => this._nominal() }));
    if (s.op !== 'tapping') f.push(numField(p, 'f', { label: 'Feed f', quantity: 'feed', min: 0.005, max: 2, onChange: () => this._nominal() }));
    f.push(numField(p, 'V', { label: 'Cutting speed V (periphery)', quantity: 'speed', min: 0.5, max: 400, onChange: () => this._nominal() }));
    if (s.op !== 'tapping') f.push(numField(p, 'peck', { label: 'Peck depth (0 = none)', quantity: 'length', min: 0 }));
    if (s.op === 'step') f.push(selectField(p, 'pilotId', lib.tools().filter((t) => t.kind === 'drill' && !t.subtype).map((t) => ({ value: t.id, label: `Pilot: ${t.name}` })), { label: 'Pilot drill (run first, same holes)' }));
    if (s.op === 'tapping') f.push(h('div', { class: 'warn' }, 'Thread geometry is not represented in the Z-map (holes are flagged as threaded). Tapping torque uses an energy estimate (M-DRILL-04) excluding flank friction.'));
    this.opParams.replaceChildren(...f);
    if (!init) this._refreshTool();
    this._nominal();
  }

  _refreshTool() {
    const s = this.s; const base = lib.tool(s.toolId); if (!base) return;
    if (!s.tool || s.tool.id !== base.id) { s.tool = { ...base }; s.taylor = null; }
    this.toolEd.replaceChildren(toolEditor(s, () => this._refreshTool()));
    this.view?.setTool(s.tool);
    if (this.sim) this._configure();
    this._nominal();
  }
  _setWear() {
    const s = this.s, id = s.tool.id;
    if (!this.wears[id]) this.wears[id] = [new EdgeWear({ taylor: s.taylor?.C ? s.taylor : null, VB0: s.VB0 || 0, clearance: 8, VBc: s.limits?.VB ?? 0.3 }), new EdgeWear({ taylor: s.taylor?.C ? s.taylor : null, VB0: s.VB0b || 0, clearance: 8, VBc: s.limits?.VB ?? 0.3 })];
    for (const w of this.wears[id]) { w.taylor = s.taylor?.C && s.taylor?.n ? s.taylor : null; w.VBc = s.limits?.VB ?? 0.3; }
    if (this.sim) { this.sim.lipWear = this.wears[id]; this.sim.VBchisel = s.VBchisel || 0; }
    return this.wears[id];
  }
  _configure() {
    const s = this.s;
    Object.assign(this.sim, { mat: this.mat, tool: s.tool, toolMat: getToolMaterial(s.tool.material), land: s.land, machine: { ...RADIAL_DRILL, Pmax: s.limits?.P ?? RADIAL_DRILL.Pmax } });
    this._setWear();
  }
  resetPart(ask) {
    if (ask && this.opLog.length && !confirm('Reset the block? Completed operations are cleared.')) return;
    this.driver?.stop();
    const s = this.s;
    this.zm = new ZMap({ W: s.W, Dp: s.Dp, H: s.H, g: Math.max(0.15, Math.min(0.4, Math.sqrt((s.W * s.Dp) / 250000))) });
    this.sim = new DrillSim({ zmap: this.zm, mat: this.mat, tool: s.tool, toolMat: getToolMaterial(s.tool.material) });
    this._configure();
    this.opLog = []; this.log?.replaceChildren();
    this.view?.setBlock(this.zm);
    this._live(); this._charts();
  }
  _N() { return Math.min(spindleSpeed(this.p.V, this.s.tool.D), RADIAL_DRILL.Nmax); }
  run() {
    const s = this.s;
    if (this.driver?.running) return toast('Already running', 'warn');
    const bad = s.holes.filter((hh) => !radialIK(hh.x, hh.y).ok);
    if (bad.length) return toast('A hole is outside the radial arm reach', 'error');
    if (!s.holes.length) return toast('Add at least one hole position', 'warn');
    const p = this.p;
    const moves = [];
    const N = this._N();
    if (s.op === 'step') {
      const pilot = lib.tool(p.pilotId);
      this._queue = [{ tool: pilot, N: Math.min(spindleSpeed(p.V, pilot.D), RADIAL_DRILL.Nmax), f: p.f * 0.8 }, { tool: s.tool, N, f: p.f }];
    } else this._queue = [{ tool: s.tool, N, f: s.op === 'tapping' ? s.tool.pitch : p.f }];
    this._runQueue(moves);
  }
  _runQueue() {
    const s = this.s, p = this.p;
    const job = this._queue.shift();
    if (!job) return;
    this.sim.tool = job.tool; this.view?.setTool(job.tool);
    const moves = s.holes.flatMap((hh, i) => planHole({ x: hh.x, y: hh.y, depth: p.depth, f: job.f, N: job.N, peck: p.peck, H: s.H, hole: i + 1, tool: job.tool }));
    this.sim.load(moves, s.op);
    this.view?.setRpm(job.N);
    this._start = { t: this.sim.time, name: `${DRILL_OPS[s.op].name} — ${job.tool.name}`, N: job.N, f: job.f };
    this.driver = new Driver(this.sim, { onFrame: () => this._frame(), onDone: () => this._done() });
    this.bar.setPaused(false);
    this.driver.start(s.speed);
  }
  _step() { if (!this.driver?.running) return toast('Run an operation first', 'info'); if (!this.driver.paused) this.bar.setPaused(this.driver.pause()); this.sim.step(); this._frame(true); }
  _frame(force) {
    const sim = this.sim;
    this.view?.setToolPos(sim.pos.x, sim.pos.y, sim.pos.z);
    this.view?.setForces(sim.last);
    const now = performance.now();
    if (force || !this._t1 || now - this._t1 > 120) { this._t1 = now; this._live(); }
    if (force || !this._t2 || now - this._t2 > 500) { this._t2 = now; if (this.tabs.active === 'graphs') this._charts(); if (this.tabs.active === 'lips') this._lips(); }
  }
  _done() {
    const o = this._start;
    this.opLog.push({ ...o, duration: this.sim.time - o.t });
    this.log.append(h('li', {}, h('b', {}, o.name), ` — ${this.s.holes.length} hole(s), N = ${fmt(o.N, 4)} rev/min, f = ${o.f} mm/rev, ${fmt(this.sim.time - o.t, 3)} s`));
    if (this.sim.tool !== this.s.tool) this.sim.tool = this.s.tool;
    if (this._queue?.length) { this._runQueue(); return; }
    this.view?.setRpm(0); this.view?.setForces(null);
    this._live(); this._charts(); this._lips(); this._holeTable();
  }
  _tab(id) { if (id === 'graphs') this._charts(); if (id === 'lips') this._lips(); if (id === 'holes') this._holeTable(); }
  _live() {
    const L = this.sim.last?.cutting ? this.sim.last : this.sim.lastCut;
    const w = this.sim.lipWear;
    const ik = radialIK(this.sim.pos.x, this.sim.pos.y);
    this.ro.update([
      { k: 'Arm angle / head radius', v: `${fmt((ik.theta * 180) / Math.PI, 3)}° / ${fmt(ik.rho, 4)} mm` },
      { k: 'Spindle N', v: L ? `${fmt(L.N, 4)} rev/min` : '—' },
      { k: 'Tip depth', v: L ? q(L.depth, 'length') : '—' },
      { k: 'Thrust', v: q(L?.thrust ?? 0, 'force'), cls: 'ff' },
      { k: 'Torque', v: q(L?.torque ?? 0, 'torque') },
      { k: 'Power', v: q(L?.power ?? 0, 'power') },
      { k: 'MRR', v: q(L?.mrr ?? 0, 'mrr') },
      { k: 'Thrust: lips / chisel', v: L?.drill ? `${fmt(L.drill.thrustLips, 4)} / ${fmt(L.drill.thrustChisel, 4)} N` : '—' },
      { k: 'VB lip 1 / lip 2', v: `${fmt(w[0].VB, 3)} / ${fmt(w[1].VB, 3)} mm` },
      { k: 'Radial imbalance', v: L?.drill ? q(Math.abs(L.drill.radialImbalance), 'force') : '—' },
      { k: 'Hole oversize (est.)', v: L?.oversize != null ? `${fmt(L.oversize * 1000, 3)} µm` : '—', title: 'Static drill deflection under lip-force imbalance (trend only)' },
      { k: 'Sim time', v: `${fmt(this.sim.time, 4)} s` },
    ]);
    this.alerts.update([], this.sim.events);
    this.overlay.textContent = this.sim.last?.cutting ? `Drilling — thrust ${fmt(L.thrust, 4)} N · torque ${fmt(L.torque, 3)} N·m` : 'Idle';
  }
  _charts() {
    const H = this.sim.hist;
    this.cF.setData([{ name: 'Thrust', x: H.t, y: H.thrust, color: '#2563eb' }, { name: 'Torque', x: H.t, y: H.torque, y2: true, color: '#7c3aed' }]);
    const lastHole = H.hole.length ? H.hole[H.hole.length - 1] : 0;
    const idx = H.hole.map((hh, i) => (hh === lastHole && H.thrust[i] > 0 ? i : -1)).filter((i) => i >= 0);
    this.cD.setData([{ name: 'Thrust', x: idx.map((i) => H.depth[i]), y: idx.map((i) => H.thrust[i]), color: '#2563eb' }]);
    this.cP.setData([{ name: 'Power', x: H.t, y: H.P, color: '#d97706' }, { name: 'MRR', x: H.t, y: H.mrr.map((v) => v / 1000), y2: true, color: '#0891b2' }]);
    this.cVB.setData([{ name: 'VB (max lip)', x: H.t, y: H.VB, color: '#111827' }]);
  }
  _lips() {
    const L = this.sim.last?.cutting ? this.sim.last : this.sim.lastCut;
    if (!L?.drill) { this.lipInfo.replaceChildren(h('div', { class: 'muted' }, 'Run a drilling operation.')); return; }
    const d = L.drill;
    const lab = d.lips.map((_, i) => `Lip ${i + 1} Fz`);
    this.cLip.setData([{ name: 'thrust', x: [...lab.map((_, i) => i), lab.length], y: [...d.lips.map((l) => l.Fz), d.thrustChisel], color: '#2563eb' }]);
    this.lipInfo.replaceChildren(kv([...d.lips.map((l, i) => [`Lip ${i + 1}`, `Fz ${fmt(l.Fz, 4)} N, T ${fmt(l.T, 3)} N·m, engaged edge ${fmt(l.lenEng, 3)} mm`]), ['Chisel edge', `Fz ${fmt(d.thrustChisel, 4)} N, T ${fmt(d.torqueChisel, 3)} N·m (estimated model)`], ['Uncut chip per lip h', `${fmt(d.h, 3)} mm`], ['Chisel half-length c', `${fmt(d.c, 3)} mm`]]),
      h('div', { class: 'note' }, 'Bars: lip axial thrust contributions then chisel-edge thrust (last bar). Unequal lip wear produces a radial force imbalance → drill deflection → hole oversize trend.'));
  }
  _holeTable() {
    const hs = this.sim.holes;
    this.holeTbl.replaceChildren(hs.length ? h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['#', 'x', 'y', 'Ø', 'depth', 'operations', 'thread'].map((x) => h('th', {}, x)))),
      h('tbody', {}, hs.map((hh, i) => h('tr', {}, h('td', {}, i + 1), h('td', {}, fmt(hh.x, 4)), h('td', {}, fmt(hh.y, 4)), h('td', {}, fmt(2 * hh.R, 4)), h('td', {}, fmt(hh.depth, 4)), h('td', {}, hh.ops.join(', ')), h('td', {}, hh.threaded ? `M${hh.threaded.D}×${hh.threaded.pitch}` : '—'))))) : h('div', { class: 'muted' }, 'No holes machined yet.'));
  }
  _nominal() {
    if (!this.nominal) return;
    const s = this.s, t = s.tool, p = this.p;
    if (!t || s.op === 'tapping') { this.nominal.replaceChildren(h('div', { class: 'muted' }, 'Tapping torque is computed during simulation (energy estimate).')); return; }
    const N = this._N();
    const r = drillForces({ mat: this.mat, tool: t, f: p.f, N });
    const rows = [['N', `${fmt(N, 4)} rev/min`], ['Thrust', q(r.thrust, 'force')], ['  of which chisel', q(r.thrustChisel, 'force')], ['Torque', q(r.torque, 'torque')], ['Power', q(r.power, 'power')], ['MRR', q(r.mrr, 'mrr')]];
    if (!t.subtype) { const ref = sandvikDrillReference({ kc11: this.mat.kc11, mc: this.mat.mc, D: t.D, f: p.f, pointAngle: t.pointAngle }); rows.push(['Sandvik reference torque', `${fmt(ref.Mc, 4)} N·m`], ['Sandvik reference thrust', `${fmt(ref.Ff, 4)} N`]); }
    const T = taylorLife(p.V, p.f, t.D / 2, s.taylor);
    rows.push(['Taylor life (periphery speed)', Number.isFinite(T) ? `${fmt(T, 3)} min` : 'needs n, C']);
    const lip = r.lips[0];
    const th = cuttingTemperature({ mat: this.mat, Fc: (lip.T * 1000) / ((t.D / 2) * 0.6), Fth: lip.Fz / Math.sin(((t.pointAngle || 118) / 2) * Math.PI / 180), gamma: 20, V: p.V * 0.6, h: r.h, b: lip.lenEng });
    if (th) rows.push(['Lip rake-face T (reduced-order est.)', q(th.TrakeMax, 'temperature')]);
    this.nominal.replaceChildren(kv(rows));
  }
  show() { this.view?.vp.resume(); }
  hide() { this.view?.vp.pause(); }
  report() {
    const s = this.s, H = this.sim.hist;
    this._charts();
    const pk = (a) => (a.length ? Math.max(...a) : 0);
    return {
      title: 'Radial drilling simulation', machine: 'Radial drilling machine (arm/head inverse kinematics)',
      workpiece: `${lib.material(s.material).name} block ${s.W} × ${s.Dp} × ${s.H} mm; ${s.holes.length} hole positions`,
      tool: `${s.tool.name}; point ${s.tool.pointAngle}°, helix ${s.tool.helix}°`,
      params: this.opLog.map((o) => `${o.name}: N=${fmt(o.N, 4)} rev/min, f=${o.f} mm/rev`),
      models: ['M-DRILL-01', 'M-DRILL-02', 'M-DRILL-03', 'M-DRILL-04', 'M-WEAR-01', 'M-WEAR-02', 'M-WEAR-03'],
      results: [['Peak thrust', q(pk(H.thrust), 'force')], ['Peak torque', q(pk(H.torque), 'torque')], ['Peak power', q(pk(H.P), 'power')], ['Peak MRR', q(pk(H.mrr), 'mrr')], ['Final VB (lips)', this.sim.lipWear.map((w) => fmt(w.VB, 3)).join(' / ') + ' mm'], ['Holes', String(this.sim.holes.length)], ['Machining time', `${fmt(this.sim.time, 4)} s`]],
      charts: [this.cF, this.cD, this.cP], snapshot: this.view?.vp.snapshot(),
      data: { headers: ['t_s', 'depth_mm', 'thrust_N', 'torque_Nm', 'power_kW', 'MRR_mm3_min', 'VB_mm', 'hole', 'op'], rows: H.t.map((t, i) => [t, H.depth[i], H.thrust[i], H.torque[i], H.P[i], H.mrr[i], H.VB[i], H.hole[i], H.op[i]]) },
      limitations: ['Chisel-edge model parameters are estimates (calibrate with a dynamometer).', 'Web-thinning effect on lip rake neglected.', 'Thread geometry not represented in the Z-map.', 'Hole oversize is a static-deflection trend only.'],
    };
  }
  serialize() { return { s: this.s, zm: this.zm.toJSON(), holes: this.sim.holes, hist: this.sim.hist, opLog: this.opLog }; }
  restore(d) {
    Object.assign(this.s, d.s); this.resetPart();
    this.zm.h.set(d.zm.h); this.zm.dirty = { i0: 0, i1: this.zm.nx - 1, j0: 0, j1: this.zm.ny - 1 }; this.zm.holesChanged = true;
    this.sim.holes = d.holes || []; Object.assign(this.sim.hist, d.hist || {}); this.opLog = d.opLog || [];
    this.opSel.sel.value = this.s.op; this._onOp(); this._holes(); this._charts(); this._holeTable();
  }
}
