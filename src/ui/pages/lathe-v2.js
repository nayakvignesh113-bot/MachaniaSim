// Lathe V2 workspace: extends the v1 lathe page (all v1 operations and panels preserved) with
// guided workflow, beginner/advanced modes, model options, multi-mode wear, conjugate thermal field,
// deflection & time-domain chatter, surface/dimension prediction, run comparison and measured-data comparison.
import { h, numField, selectField, checkField, panel, kv, q, toast, table, download, pickFile, statusBadge } from '../dom.js';
import { Chart, drawField } from '../chart.js';
import { modelNote } from '../common.js';
import { LathePage } from './lathe.js';
import { ToolCondition } from '../../physics/wear2.js';
import { COOLANTS } from '../../physics/thermal.js';
import { getToolMaterial } from '../../core/tools.js';
import { turningLobes, lobeEnvelope, amplitudeSpectrum } from '../../physics/dynamics.js';
import { turningTimeDomain, vibratedProfile } from '../../physics/chatter.js';
import { kienzleKc, thrustRatio, defaultWearLand } from '../../physics/cutting.js';
import { KC_REFERENCE } from '../../physics/turning.js';
import { errorMetrics, interp, toCSV, fitWearPower } from '../../research/stats.js';
import { fitView } from '../fitview.js';
import { readTable } from './research.js';
import { fmt } from '../../core/units.js';

const STEPS = [
  { id: 1, label: '1 · Machine setup', help: 'Choose the bar material and size, how it is held, and the stiffness of the tool side. These set the forces (via kc1.1, mc) and the deflection.' },
  { id: 2, label: '2 · Operation', help: 'Pick the operation, its parameters (V, f, ap…) and the tool. The closed-form check shows the textbook values before you run.' },
  { id: 3, label: '3 · Simulation & models', help: 'Run the operation. Every revolution the tool is stamped into the geometry; forces, temperatures and wear are computed from the actual chip removed.' },
  { id: 4, label: '4 · Research & report', help: 'Compare runs, compare with your measurements (dynamometer, thermocouple, microscope), calibrate wear, and generate a report (Reports page).' },
];

function addTab(t, id, label, content, onShow) {
  const bar = t.el.children[0], host = t.el.children[1];
  const btn = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => { t.show(id); onShow?.(); } }, label);
  const el = h('div', { class: 'tabpage', role: 'tabpanel', hidden: true }, content);
  t.pages[id] = { btn, el }; bar.append(btn); host.append(el);
}

export class LathePageV2 extends LathePage {
  _v2init() {
    const s = this.s;
    s.m2 ||= { softening: true, shearModel: 'merchant', deflection: true, kTool: 20000, Kte: 0, Kre: 0, probe: true, px: 0.5, py: 0.5 };
    s.wcfg ||= { flankModel: 'taylor', A: null, B: null, Vref: 150, fref: 0.25, apref: 2, noseRatio: null, notchRatio: null, craterA: null, craterB: null, craterN: null, craterC: null, chipEta: null, chipBeta: null, chipSize: 0.1 };
    s.mode ||= 'beginner';
    s.runs ||= [];
    s.step ||= 0;
  }
  constructor(root) {
    super(root);
    this._v2init();
    this._buildV2();
  }

  // ---------------- engine configuration ----------------
  _wcfg() {
    const w = this.s.wcfg;
    return {
      flankModel: w.flankModel,
      power: w.flankModel === 'power' && w.A > 0 && w.B > 0 ? { A: w.A, B: w.B, Vref: w.Vref, fref: w.fref, apref: w.apref } : null,
      noseRatio: w.noseRatio, notchRatio: w.notchRatio,
      crater: w.craterA > 0 && w.craterB > 0 ? { A: w.craterA, B: w.craterB } : w.craterC > 0 && w.craterN > 0 ? { n: w.craterN, C: w.craterC } : null,
      chipping: w.chipEta > 0 && w.chipBeta > 0 ? { eta: w.chipEta, beta: w.chipBeta, size: w.chipSize || 0.1 } : null,
    };
  }
  _wear() {
    this._v2init();
    const s = this.s, id = s.tool.id;
    if (!(this.wears[id] instanceof ToolCondition)) this.wears[id] = new ToolCondition({ taylor: null, clearance: s.tool.clearance ?? 6, VB0: s.VB0 || 0, VBc: s.limits?.VB ?? 0.3 });
    const w = this.wears[id];
    w.taylor = s.taylor?.C && s.taylor?.n ? s.taylor : null;
    w.VBc = s.limits?.VB ?? 0.3; w.clearance = s.tool.clearance ?? 6;
    w.cfg = { ...w.cfg, ...this._wcfg() };
    return w;
  }
  _configureSim() {
    this._v2init();
    const s = this.s, sim = this.sim, m2 = s.m2;
    sim.mat = this.mat; sim.tool = s.tool; sim.outline = this.outline;
    sim.toolMat = getToolMaterial(s.tool.material);
    sim.wear = this._wear();
    sim.land = s.land || defaultWearLand(this.mat); sim.limits = s.limits; sim.machine = { Pmax: s.limits?.P ?? 7.5 };
    sim.support = s.support;
    sim.opts = { softening: m2.softening, shearModel: m2.shearModel, deflection: m2.deflection, kTool: m2.kTool > 0 ? m2.kTool : Infinity, edge: m2.Kte || m2.Kre ? { Kte: m2.Kte, Kre: m2.Kre } : null, probe: m2.probe ? { x: m2.px, y: m2.py } : null };
    const key = `${s.tool.material}|${s.coolant}`;
    if (sim._thermalKey !== key) { sim.coolant = s.coolant; sim.coolantH = COOLANTS[s.coolant]?.h; sim.resetThermal(); sim._thermalKey = key; }
  }

  // ---------------- UI additions ----------------
  _buildV2() {
    const s = this.s, side = this.root.querySelector('.side');
    const panels = [...side.querySelectorAll(':scope > .panel')]; // wp, op, tool, proc, nominal, log
    const stepOf = [1, 2, 2, 3, 2, 3];
    panels.forEach((p, i) => { p.dataset.step = stepOf[i]; });
    panels[3].classList.add('adv');
    // model options
    const m2 = s.m2, w = s.wcfg;
    const models = panel('Model options (cutting mechanics, deflection, thermal probe)',
      checkField(m2, 'softening', 'Temperature/strain-rate dependent kc (Johnson–Cook softening, M-CUT-05)', () => this._configureSim()),
      h('div', { class: 'help' }, `Scales kc by the JC rate·thermal factor at the Boothroyd shear-plane temperature relative to an assumed reference V = ${KC_REFERENCE.V} m/min, h = ${KC_REFERENCE.h} mm. Only materials with JC data are corrected.`),
      selectField(m2, 'shearModel', [{ value: 'merchant', label: 'Merchant: φ = 45° − (β − γ)/2' }, { value: 'lee-shaffer', label: 'Lee–Shaffer: φ = 45° − (β − γ)' }], { label: 'Shear-angle relation (chip thickness, temperatures)', onChange: () => this._configureSim() }),
      checkField(m2, 'deflection', 'Feed static deflection back into the machined geometry (M-TURN-05)', () => this._configureSim()),
      numField(m2, 'kTool', { label: 'Tool-side static stiffness (radial)', unit: 'N/mm', min: 100, status: 'estimated', help: 'Carriage + tool post + holder. Measure (dial gauge under known load) or use the tap-test static stiffness.', onChange: () => this._configureSim() }),
      h('div', { class: 'grid2' }, numField(m2, 'Kte', { label: 'Edge force Kte', unit: 'N/mm', min: 0, help: 'Ploughing (edge) coefficient; 0 = not included. Calibrate from the F/b-vs-h intercept.', onChange: () => this._configureSim() }), numField(m2, 'Kre', { label: 'Edge force Kre', unit: 'N/mm', min: 0, onChange: () => this._configureSim() })),
      h('div', { class: 'grid2' }, numField(m2, 'px', { label: 'Thermocouple probe x (from edge)', unit: 'mm', min: 0, max: 12 }), numField(m2, 'py', { label: 'probe depth y (below rake)', unit: 'mm', min: 0, max: 12 })),
      modelNote(['M-CUT-05', 'M-CUT-06', 'M-TURN-05', 'M-THERM-04']));
    this._wearBody = () => [
      selectField(w, 'flankModel', [{ value: 'taylor', label: 'Taylor–Miner (linear VB, textbook/calibrated Taylor constants)' }, { value: 'power', label: 'Calibrated progression VB = VB₀ + A·t^B (from microscope data)' }], { label: 'Flank-wear progression', onChange: () => this._configureSim() }),
      h('div', { class: 'grid3' }, numField(w, 'A', { label: 'A', unit: 'mm/min^B', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'B', { label: 'B', unit: '–', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'Vref', { label: 'at V', unit: 'm/min', onChange: () => this._configureSim() }), numField(w, 'fref', { label: 'at f', unit: 'mm/rev', onChange: () => this._configureSim() }), numField(w, 'apref', { label: 'at ap', unit: 'mm', onChange: () => this._configureSim() })),
      h('div', { class: 'help' }, 'A, B come from Measured data → microscope series → “Calibrate”. Other speeds are mapped through the Taylor life ratio.'),
      h('div', { class: 'grid2' }, numField(w, 'noseRatio', { label: 'Nose-wear rate VC/VB', unit: '–', allowEmpty: true, help: 'Empty → VC = VB (assumption). Sets the nose recession and diameter growth.', onChange: () => this._configureSim() }), numField(w, 'notchRatio', { label: 'Notch rate VN/VB', unit: '–', allowEmpty: true, help: 'Empty → notch not predicted.', onChange: () => this._configureSim() })),
      h('div', { class: 'subhead' }, 'Crater wear KT (choose one; empty = not predicted)'),
      h('div', { class: 'grid2' }, numField(w, 'craterA', { label: 'Usui A', unit: 'mm/(MPa·m/min·s)', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'craterB', { label: 'Usui B', unit: 'K', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'craterN', { label: 'or crater Taylor n', unit: '–', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'craterC', { label: 'crater Taylor C', unit: 'm/min', allowEmpty: true, onChange: () => this._configureSim() })),
      h('div', { class: 'subhead' }, 'Random edge chipping (Weibull; empty = off)'),
      h('div', { class: 'grid3' }, numField(w, 'chipEta', { label: 'η', unit: 'min', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'chipBeta', { label: 'β', unit: '–', allowEmpty: true, onChange: () => this._configureSim() }), numField(w, 'chipSize', { label: 'chip size', unit: 'mm', onChange: () => this._configureSim() })),
      h('div', { class: 'note' }, 'Couplings: VB → wear-land forces and flank heat; VC → nose recession (diameter); KT → effective rake increase (lower forces); chipping → VBmax; rake temperature above the tool hot-hardness limit → plastic-deformation flag. ISO 3685 criteria end tool life.'),
      modelNote(['M-WEAR-07', 'M-WEAR-08', 'M-WEAR-09', 'M-WEAR-10', 'M-WEAR-11'])];
    const wear = panel('Tool-wear model (flank, nose, notch, crater, chipping)', ...this._wearBody());
    this._wearPanel = wear;
    models.dataset.step = 3; wear.dataset.step = 3; models.classList.add('adv', 'collapsed'); wear.classList.add('adv', 'collapsed');
    this.researchPanel = panel('Research & reporting', h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => { this.tabs.show('cmp'); this._cmp(); } }, 'Compare runs'),
      h('button', { class: 'btn', type: 'button', onclick: () => { this.tabs.show('meas'); } }, 'Measured data'),
      h('a', { class: 'btn', href: '#/reports' }, 'Report…'), h('a', { class: 'btn', href: '#/research' }, 'DOE / calibration')));
    this.researchPanel.dataset.step = 4;
    panels[3].after(models, wear);
    side.append(this.researchPanel);
    // stepper + mode
    this.stepHelp = h('div', { class: 'note' });
    const stepBtns = [{ id: 0, label: 'All' }, ...STEPS].map((st) => h('button', { type: 'button', class: 'mini step-btn', 'data-step': st.id, onclick: () => { s.step = st.id; this._applyStep(); } }, st.label));
    const modeSel = h('select', { 'aria-label': 'Mode', onchange: (e) => { s.mode = e.target.value; this._applyStep(); } }, h('option', { value: 'beginner' }, 'Beginner'), h('option', { value: 'advanced' }, 'Advanced'));
    modeSel.value = s.mode;
    side.prepend(h('div', { class: 'box stepper' }, h('div', { class: 'row' }, h('b', {}, 'Workflow'), modeSel), h('div', { class: 'row' }, stepBtns), this.stepHelp));
    // results: extra charts and tabs
    this.cTemp = new Chart({ title: 'Temperature history', xLabel: 'Time (s)', yLabel: 'Temperature (°C)' });
    this.cWear = new Chart({ title: 'Tool wear modes', xLabel: 'Time (s)', yLabel: 'Wear (mm)' });
    this.cDefl = new Chart({ title: 'Radial deflection (workpiece + tool side)', xLabel: 'Time (s)', yLabel: 'Deflection (µm)' });
    this.tabs.pages.graphs.el.firstChild.append(this.cTemp.el, this.cWear.el, this.cDefl.el);
    this.cThist = new Chart({ title: 'Tool temperatures (conjugate model)', xLabel: 'Time (s)', yLabel: 'Temperature (°C)' });
    this.tabs.pages.thermal.el.firstChild.prepend(this.cThist.el);
    this.cDim = new Chart({ title: 'Dimensional deviation of the last turned section', xLabel: 'z from chuck face (mm)', yLabel: 'Ø − target (µm)' });
    this.cSurf = new Chart({ title: 'Predicted axial surface profile (θ = 0)', xLabel: 'Axial position (mm)', yLabel: 'Height (µm)' });
    this.surfInfo = h('div');
    this.tabs.pages.quality.el.firstChild.append(this.cDim.el, this.cSurf.el, this.surfInfo, modelNote(['M-SURF-01', 'M-SURF-02', 'M-TURN-05']));
    this.cTD = new Chart({ title: 'Time-domain radial vibration', xLabel: 'Time (s)', yLabel: 'Displacement (µm)', y2Label: 'Radial force (N)' });
    this.cTDs = new Chart({ title: 'Displacement spectrum (last 10 revolutions)', xLabel: 'Frequency (Hz)', yLabel: 'Amplitude (µm)' });
    this.tdInfo = h('div');
    this.tabs.pages.dyn.el.firstChild.append(h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this._timeDomain() }, 'Run time-domain chatter simulation at the operating point')), this.tdInfo, this.cTD.el, this.cTDs.el, modelNote(['M-DYN-06']));
    this.cmpEl = h('div'); this.cCmp = new Chart({ title: 'Run comparison', xLabel: 'Run', yLabel: 'Value', type: 'bar' });
    this.cmpMetric = { k: 'FcMean' };
    addTab(this.tabs, 'cmp', 'Compare', h('div', {}, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this._saveRun() }, 'Save last operation as a run'), h('button', { class: 'btn', type: 'button', onclick: () => this._cmpCSV() }, 'Export CSV'), h('button', { class: 'btn danger', type: 'button', onclick: () => { s.runs = []; this._cmp(); } }, 'Clear')),
      selectField(this.cmpMetric, 'k', RUN_METRICS.map((m) => ({ value: m.k, label: m.label })), { label: 'Chart metric', onChange: () => this._cmp() }), this.cCmp.el, this.cmpEl), () => this._cmp());
    this.measEl = h('div'); this.wearFitEl = h('div'); this.cMeas = new Chart({ title: 'Measured vs simulated', xLabel: 'Time (s)', yLabel: 'Value' });
    this.meas = { type: 'dyn', t: '', a: '', b: '', c: '', shift: 0 };
    addTab(this.tabs, 'meas', 'Measured', h('div', {},
      selectField(this.meas, 'type', [{ value: 'dyn', label: 'Dynamometer (t [s], Fc, Ff, Fp [N])' }, { value: 'tc', label: 'Thermocouple in the tool (t [s], T [°C]) at the probe point' }, { value: 'vb', label: 'Microscope / ToolVision wear series (cutting time [min], VB [mm])' }], { label: 'Data type', onChange: () => { Object.assign(this.meas, { t: '', a: '', b: '', c: '' }); this._measUI(); } }),
      h('button', { class: 'btn primary', type: 'button', onclick: async () => { const f = await pickFile('.csv,.txt,.xlsx,.xls'); if (!f) return; try { Object.assign(this.meas, { data: await readTable(f), name: f.name, t: '', a: '', b: '', c: '' }); this._measUI(); } catch (e) { toast(e.message, 'error'); } } }, 'Import CSV / TXT / XLSX'),
      numField(this.meas, 'shift', { label: 'Time shift applied to measurement', unit: 's', onChange: () => this._measCompare() }),
      this.measMap = h('div'), this.cMeas.el, this.measEl, this.wearFitEl), () => this._measCompare());
    this._applyStep();
  }
  _applyStep() {
    const s = this.s;
    this.root.querySelectorAll('.side > .panel').forEach((p) => {
      const stepOk = !s.step || String(s.step) === p.dataset.step;
      const modeOk = s.mode === 'advanced' || !p.classList.contains('adv');
      p.hidden = !(stepOk && modeOk);
    });
    this.root.querySelectorAll('.step-btn').forEach((b) => b.classList.toggle('on', String(s.step) === b.dataset.step));
    const st = STEPS.find((x) => x.id === s.step);
    this.stepHelp.textContent = st ? st.help : (s.mode === 'beginner' ? 'Beginner mode hides the advanced model panels. Work through steps 1 → 4, or choose “All”.' : 'Advanced mode: all model options, wear and dynamics parameters are visible.');
    for (const id of ['dyn', 'meas']) this.tabs.pages[id] && (this.tabs.pages[id].btn.hidden = s.mode === 'beginner');
  }

  run() {
    super.run();
    if (this._opStart) { this._opStart.histIdx = this.sim.hist.t.length; this._opStart.params = { ...this.p, V: this.p.V }; this._opStart.op = this.s.op; }
  }

  _frame(force = false) {
    super._frame(force);
    const now = performance.now();
    if (force || !this._t3 || now - this._t3 > 250) {
      this._t3 = now;
      this.view?.setChip(this.sim.last?.cutting ? this.sim.last : null);
      this.view?.setToolTemps(this.sim.thermal);
      if (this.tabs.active === 'thermal') this._thermal();
    }
  }
  _done() {
    super._done();
    this.view?.setChip(null); this.view?.setToolTemps(this.sim.thermal);
  }

  _live() {
    super._live();
    const L = this.sim.last?.cutting ? this.sim.last : this.sim.lastCut;
    const W = this.sim.wear;
    const add = (k, v, title = '', cls = '') => this.ro.append(h('div', { class: `ro ${cls}`, title }, h('div', { class: 'ro-k' }, k), h('div', { class: 'ro-v' }, v)));
    add('Rake interface T (conjugate)', L?.Trake != null ? q(L.Trake, 'temperature') : '—', 'Tool-side = chip-side mean contact temperature (M-THERM-04)');
    add('Heat to chip R', L?.R != null ? fmt(L.R, 3) : '—', 'Fraction of friction heat carried by the chip (R > 1: tool loses heat to the chip)');
    add('kc softening factor', L?.Ksoft != null ? fmt(L.Ksoft, 4) : '—', 'Johnson–Cook rate·thermal factor relative to the kc1.1 reference');
    add('Nose wear VC', W?.VC != null ? `${fmt(W.VC, 3)} mm` : '—');
    add('Notch VN / crater KT', W ? `${W.cfg?.notchRatio == null ? 'n.p.' : fmt(W.VN, 3)} / ${W.cfg?.crater ? fmt(W.KT, 4) : 'n.p.'} mm` : '—', 'n.p. = not predicted (no user coefficients)');
    add('Life criterion', W?.criterion?.(this.p.f ?? 0.2) || 'not reached', 'ISO 3685', W?.criterion?.(this.p.f ?? 0.2) ? 'bad' : '');
  }

  _charts(force = false) {
    super._charts(force);
    if (!this.cTemp) return; // during base-class construction
    const H = this.sim.hist, x = this._xData();
    const xl = this.cF.o.xLabel;
    [this.cTemp, this.cWear, this.cDefl].forEach((c) => (c.o.xLabel = xl));
    const nn = (a) => (a || []).map((v) => (v == null ? NaN : v));
    this.cTemp.setData([{ name: 'Rake interface (conjugate)', x, y: nn(H.Trake), color: '#dc2626' }, { name: 'Tool max', x, y: nn(H.Ttool), color: '#7c3aed' }, { name: 'Shear plane', x, y: nn(H.Tshear), color: '#d97706' }, ...(H.Tprobe?.some((v) => v != null) ? [{ name: 'Probe point', x, y: nn(H.Tprobe), color: '#0891b2' }] : [])]);
    const W = this.sim.wear;
    this.cWear.setData([{ name: 'VB', x, y: H.VB, color: '#111827' }, { name: 'VC', x, y: H.VC, color: '#2563eb' }, ...(W.cfg?.notchRatio != null ? [{ name: 'VN', x, y: H.VN, color: '#059669' }] : []), ...(W.cfg?.crater ? [{ name: 'KT', x, y: H.KT, color: '#dc2626' }] : [])], { zeroY: true });
    this.cDefl.setData([{ name: 'δ', x, y: H.defl.map((v) => v * 1000), color: '#0891b2' }], { zeroY: true });
  }

  _thermal() {
    if (!this.cThist) return;
    const T = this.sim.thermal, H = this.sim.hist;
    const W = 3, n = 60;
    drawField(this.fieldCanvas, T.resample(W, W, n), n, n, { title: `Tool section temperature, t = ${fmt(this.sim.time, 3)} s (${COOLANTS[this.s.coolant].name})`, wmm: W, hmm: W });
    const nn = (a) => (a || []).map((v) => (v == null ? NaN : v));
    this.cThist.setData([{ name: 'Rake interface', x: H.t, y: nn(H.Trake), color: '#dc2626' }, { name: 'Tool max', x: H.t, y: nn(H.Ttool), color: '#7c3aed' }, { name: 'Boothroyd max rake (upper bound)', x: H.t, y: nn(H.Tint).map((v, i) => H.Trake[i] == null ? NaN : v), color: '#9ca3af', dash: [4, 4] }]);
    const L = (this.sim.last?.cutting ? this.sim.last : this.sim.lastCut);
    const th = L?.thermal, c = th?.conj;
    this.thermalInfo.replaceChildren(
      th ? kv([
        ['Shear angle φ', `${fmt(th.phi, 3)}° (${this.s.m2.shearModel})`], ['Chip thickness hc', `${fmt(th.hc, 3)} mm (ratio rc = ${fmt(th.rc, 3)})`], ['Shear-plane T (Boothroyd)', q(th.Tshear, 'temperature')],
        ['Rake interface T (conjugate)', c ? q(c.Trake, 'temperature') : '—'], ['  chip-side check', c ? q(c.TchipSide, 'temperature') : '—'], ['Heat to chip R', c ? fmt(c.R, 3) : '—'],
        ['Flank-land interface T', c?.Tflank != null ? q(c.Tflank, 'temperature') : 'no wear land'], ['Heat to workpiece at land Rw', c?.Tflank != null ? fmt(c.Rw, 3) : '—'],
        ['Contact length (est. 2·hc)', q(th.contactLength, 'length')], ['Friction / shear power', `${fmt(th.Pf, 4)} / ${fmt(th.Ps, 4)} W`], ['Tool max (field)', q(T.max(), 'temperature')],
      ]) : h('div', { class: 'muted' }, 'Run a cutting operation to compute temperatures.'),
      h('div', { class: 'note' }, 'Model M-THERM-04: transient 2-D finite-volume conduction (ADI) in a 12 × 12 mm tool section with graded mesh; heat-flux boundary on the rake contact and flank land; heat partition from equal mean interface temperatures (chip side: Boothroyd shear-plane temperature + moving band source; workpiece side: moving band source). Assumptions: constant properties, 2-D section (no spreading across the edge width → upper bound), far faces at ambient, contact length ≈ 2 chip thicknesses (estimated), coolant convection coefficient estimated. Not a coupled FE chip-formation solution.'));
  }

  _quality() {
    super._quality();
    if (!this.cDim) return;
    const last = [...this.opLog].reverse().find((o) => o.op === 'turning' || o.op === 'step' || /turning/i.test(o.name));
    const wp = this.wp;
    if (last?.params?.Dt) {
      const end = wp.endZ(), z0 = Math.max(0, end - last.params.Lc);
      const zs = [], dev = [];
      for (let z = z0 + 3; z <= end - 2; z += Math.max(0.05, (end - z0) / 400)) { const r = wp.roughness(z - 0.5, z + 0.5); if (r) { zs.push(z); dev.push((r.meanDiameter - last.params.Dt) * 1000); } }
      this.cDim.setData([{ name: 'mean Ø − target', x: zs, y: dev, color: '#111827' }], { annotations: [{ y: 0, label: `target Ø${last.params.Dt}` }] });
    } else this.cDim.setData([]);
    const t = this.s.tool;
    if (t.kind === 'turning' && t.subtype === 'general') {
      const f = this.p.f ?? 0.2;
      const yRev = this._dynRes?.yRev ? this._dynRes.yRev.map((v) => v - this._dynRes.yRev.reduce((a, b) => a + b, 0) / this._dynRes.yRev.length) : new Array(40).fill(0);
      const pr = vibratedProfile({ f, rn: t.rn, kr: t.kr, krMinor: t.krMinor, yRev });
      this.cSurf.setData([{ name: 'surface', x: pr.x, y: pr.residual.map((v) => v * 1000), color: '#111827' }]);
      this.surfInfo.replaceChildren(kv([['Ra (predicted)', `${fmt(pr.Ra, 3)} µm`], ['Rz', `${fmt(pr.Rz, 3)} µm`], ['Rt', `${fmt(pr.Rt, 3)} µm`], ['Includes vibration', this._dynRes ? `yes — time-domain run at N = ${fmt(this._dynRes.N, 4)} rev/min (${this._dynRes.stable ? 'stable' : 'CHATTER'})` : 'no (run the time-domain simulation in Dynamics)'], ['Roundness (radial p-p over one rev)', this._dynRes ? `${fmt(this._dynRes.ppLate * 1000, 3)} µm` : '—']]),
        h('div', { class: 'note' }, 'Profile = lower envelope of successive tool-outline stamps, each shifted by the radial vibration at that revolution (θ = 0). Wear acts through nose recession (diameter) and the force increase (vibration, deflection); side flow, BUE and edge micro-geometry are not modelled.'));
    }
  }

  _dynInputs() {
    const L = this.sim.lastCut, s = this.s, m = this.mat;
    if (L?.A > 0 && L.l > 0) return { Kth: (L.Fth0 ?? L.Fth) / L.A, nr: Math.abs(L.nr ?? 0.5), b: L.l, h0: L.A / L.l, N: L.N, source: 'last simulated revolution' };
    const f = this.p.f ?? 0.2, kr = ((s.tool.kr ?? 90) * Math.PI) / 180, hh = f * Math.sin(kr);
    const kc = kienzleKc(m.kc11, m.mc, hh);
    return { Kth: kc * thrustRatio(m.mu, s.tool.rake ?? 0), nr: Math.abs(Math.cos(kr)) || 0.1, b: (this.p.ap ?? 1) / Math.sin(kr), h0: hh, N: this._N(), source: 'closed-form (no cut yet; nose radius neglected)' };
  }
  _lobes() {
    const s = this.s, d = this._dynInputs();
    const Ks = d.Kth * d.nr * d.nr;
    const mode = s.modes[0], N = d.N || this._N(), nMax = Math.max(3000, N * 1.5);
    const nL = Math.min(250, Math.ceil((60 * mode.fn * 1.6) / (0.1 * nMax)));
    const r = turningLobes({ modes: s.modes, Ks, fmin: mode.fn * 0.9, fmax: mode.fn * 1.6, nf: 500, lobes: nL });
    const env = lobeEnvelope(r.lobes, 300, 0.1 * nMax, nMax);
    const bAt = env.b[env.n.findIndex((x) => x >= N)] ?? null;
    this.cLobe.setData(r.lobes.filter((l) => l.n.some((x) => x <= nMax)).map((l, i) => ({ name: i ? '' : 'stability lobes', x: l.n, y: l.b, color: '#2563eb', width: 1.2 })), { xMin: 0, xMax: nMax, yMin: 0, yMax: Math.max(r.bAsymptote * 6, d.b * 1.5), annotations: [{ point: [N, d.b], label: `N=${fmt(N, 4)}, b=${fmt(d.b, 3)} mm`, color: '#dc2626' }, { y: r.bAsymptote, label: 'unconditional limit' }] });
    this.dynInfo.replaceChildren(kv([['Inputs from', d.source], ['Thrust specific force K_th', `${fmt(d.Kth, 4)} N/mm²`], ['Radial edge-normal component n_r', fmt(d.nr, 3)], ['Oriented Ks = K_th·n_r²', `${fmt(Ks, 4)} N/mm²`], ['Engaged edge b', `${fmt(d.b, 4)} mm`], ['b_lim,min', `${fmt(r.bAsymptote, 4)} mm`], ['Verdict (estimated modes)', bAt == null ? 'outside range' : d.b < bAt ? 'below the envelope → predicted STABLE' : 'above the envelope → predicted UNSTABLE']]),
      h('div', { class: 'note' }, 'V2: the regenerative chip-thickness change and the force are projected on the radial mode through the engaged-edge normal from the geometric engagement (square-shoulder tools are therefore much less chatter-prone than 45° tools).'));
  }
  _timeDomain() {
    const s = this.s, d = this._dynInputs();
    const N = d.N || this._N();
    const r = turningTimeDomain({ modes: s.modes, Kth: d.Kth, nr: d.nr, b: d.b, h0: d.h0, N, nrev: 40 });
    this._dynRes = { ...r, N };
    const step = Math.max(1, Math.floor(r.t.length / 3000));
    const ts = r.t.filter((_, i) => i % step === 0), ys = r.y.filter((_, i) => i % step === 0).map((v) => v * 1000), Fs = r.F.filter((_, i) => i % step === 0);
    this.cTD.setData([{ name: 'y (µm)', x: ts, y: ys, color: '#2563eb' }, { name: 'F_r (N)', x: ts, y: Fs, y2: true, color: '#dc2626' }]);
    const late = r.y.slice(r.y.length - r.n * 10), m = late.reduce((a, b) => a + b, 0) / late.length;
    const sp = amplitudeSpectrum(late.map((v) => (v - m) * 1000), 1 / r.dt);
    const lim = Math.min(sp.f.length, sp.f.findIndex((f) => f > s.modes[0].fn * 3) > 0 ? sp.f.findIndex((f) => f > s.modes[0].fn * 3) : sp.f.length);
    const kmax = sp.A.slice(1, lim).reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0) + 1;
    this.cTDs.setData([{ name: '|Y|', x: sp.f.slice(1, lim), y: sp.A.slice(1, lim), color: '#2563eb' }]);
    this.tdInfo.replaceChildren(kv([['Spindle speed', `${fmt(N, 4)} rev/min (τ = ${fmt(r.tau * 1000, 4)} ms)`], ['Result', r.stable ? 'STABLE (vibration decays)' : r.contactLoss ? 'CHATTER (tool leaves the cut)' : 'CHATTER (vibration grows)'], ['Growth ratio (late/early RMS)', fmt(r.growth, 3)], ['Dominant frequency', `${fmt(sp.f[kmax], 4)} Hz`], ['Peak-to-peak (last rev)', `${fmt(r.ppLate * 1000, 4)} µm`]]));
    this._quality();
  }

  // ---------------- run comparison ----------------
  _runSummary() {
    const o = this.opLog[this.opLog.length - 1];
    if (!o) return null;
    const H = this.sim.hist, i0 = o.histIdx ?? 0;
    const sl = (a) => (a || []).slice(i0);
    const cut = sl(H.Fc).map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    const mean = (a) => (cut.length ? cut.reduce((p, i) => p + (a[i] ?? 0), 0) / cut.length : 0);
    const end = this.wp.endZ(), Lc = o.params?.Lc || 10;
    const rr = this.wp.roughness(Math.max(0, end - Lc + 1), end - 1);
    return { label: `#${this.s.runs.length + 1} ${o.name}`, op: o.name, material: this.mat.name, tool: this.s.tool.name, V: o.params?.V, f: o.f, ap: o.params?.ap, N: o.N, FcMean: mean(sl(H.Fc)), FpMean: mean(sl(H.Fp)), Fpeak: Math.max(0, ...sl(H.F)), Pmean: mean(sl(H.P)), mrr: mean(sl(H.mrr)) / 1000, VB: this.sim.wear.VB, TrakeMax: Math.max(0, ...sl(H.Trake).filter((v) => v != null)), deflMax: Math.max(0, ...sl(H.defl)) * 1000, Ra: rr?.Ra ?? NaN, Rz: rr?.Rt ?? NaN, dD: o.params?.Dt && rr ? (rr.meanDiameter - o.params.Dt) * 1000 : NaN, time: o.duration };
  }
  _saveRun() { const r = this._runSummary(); if (!r) return toast('Run an operation first', 'warn'); this.s.runs.push(r); this._cmp(); toast(`Saved ${r.label}`, 'ok'); }
  _cmp() {
    const R = this.s.runs;
    const met = RUN_METRICS.find((m) => m.k === this.cmpMetric.k);
    this.cCmp.setData([{ name: met.label, x: R.map((_, i) => i + 1), y: R.map((r) => r[met.k]), color: '#2563eb' }], { yLabel: met.label, zeroY: true, xMin: 0.5, xMax: R.length + 0.5 });
    this.cmpEl.replaceChildren(R.length ? h('div', { class: 'scroll' }, table(['Run', 'V', 'f', 'ap', ...RUN_METRICS.map((m) => m.label)], R.map((r) => [r.label, fmt(r.V, 4), fmt(r.f, 3), fmt(r.ap, 3), ...RUN_METRICS.map((m) => fmt(r[m.k], 4))]))) : h('p', { class: 'muted' }, 'No saved runs. Run an operation, then “Save last operation as a run”; change V, f, ap, tool or coolant and repeat.'));
  }
  _cmpCSV() { const R = this.s.runs; if (!R.length) return; const hd = ['label', 'op', 'material', 'tool', 'V', 'f', 'ap', 'N', ...RUN_METRICS.map((m) => m.k)]; download('lathe_run_comparison.csv', toCSV(hd, R), 'text/csv'); }

  // ---------------- measured data ----------------
  _measUI() {
    const M = this.meas, d = M.data;
    if (!d) { this.measMap.replaceChildren(h('p', { class: 'muted' }, 'Import a file. Dynamometer and thermocouple data are compared with the simulated history of this workspace (time axis = simulation time); microscope series with VB versus cumulative cutting time.')); return; }
    const opts = [{ value: '', label: '—' }, ...d.headers.map((x) => ({ value: x, label: x }))];
    const g = (re) => d.headers.find((x) => re.test(x)) || '';
    M.t = M.t || g(/^t|time/i);
    const sel = (k, label) => selectField(M, k, opts, { label, onChange: () => this._measCompare() });
    const map = M.type === 'dyn' ? [sel('t', 'Time [s]'), (M.a ||= g(/fc|fz|tang/i), sel('a', 'Fc [N]')), (M.b ||= g(/ff|fx|feed/i), sel('b', 'Ff [N]')), (M.c ||= g(/fp|fy|rad|pass/i), sel('c', 'Fp [N]'))]
      : M.type === 'tc' ? [sel('t', 'Time [s]'), (M.a ||= g(/^t\w*c|temp/i), sel('a', 'Temperature [°C]'))]
      : [sel('t', 'Cutting time [min]'), (M.a ||= g(/vb/i), sel('a', 'VB [mm]')), h('button', { class: 'btn', type: 'button', onclick: () => this._calWear() }, 'Calibrate VB = VB₀ + A·t^B (current V, f, ap as reference)')];
    this.measMap.replaceChildren(h('div', { class: 'muted' }, `${M.name}: ${d.rows.length} rows`), h('div', { class: 'grid2' }, map));
    this._measCompare();
  }
  _measCompare() {
    const M = this.meas, d = M.data, H = this.sim.hist;
    if (!d || !M.t) return;
    const col = (k) => d.rows.map((r) => r[k]);
    const tt = col(M.t).map((v) => (Number.isFinite(v) ? v : NaN));
    let pairs = [];
    if (M.type === 'vb') {
      const xs = (H.cutT || []).map((v) => v / 60), ys = H.VB;
      const yv = col(M.a);
      this.cMeas.setData([{ name: 'measured VB', x: tt, y: yv, points: true, color: '#111827' }, { name: 'simulated VB', x: xs, y: ys, color: '#dc2626' }], { xLabel: 'Cutting time (min)', yLabel: 'VB (mm)' });
      pairs = [['VB', tt.map((t, i) => [t, yv[i]]).filter(([t]) => xs.length && t >= xs[0] && t <= xs[xs.length - 1]).map(([t, y]) => [y, interp(xs, ys, t)])]];
    } else {
      const sig = M.type === 'dyn' ? [['Fc', M.a, H.Fc], ['Ff', M.b, H.Ff], ['Fp', M.c, H.Fp]] : [['T probe', M.a, (H.Tprobe || []).map((v) => (v == null ? NaN : v))]];
      const series = [];
      for (const [name, c, sim] of sig) {
        if (!c) continue;
        const yv = col(c), tm = tt.map((t) => t + M.shift);
        series.push({ name: `${name} measured`, x: tm, y: yv, points: tm.length < 300 }, { name: `${name} simulated`, x: H.t, y: sim.map((v) => (v == null ? NaN : M.type === 'dyn' ? Math.abs(v) : v)) });
        pairs.push([name, tm.map((t, i) => [t, yv[i]]).filter(([t, y]) => Number.isFinite(y) && H.t.length && t >= H.t[0] && t <= H.t[H.t.length - 1]).map(([t, y]) => [y, M.type === 'dyn' ? Math.abs(interp(H.t, sim, t)) : interp(H.t, sim, t)])]);
      }
      this.cMeas.setData(series, { xLabel: 'Time (s)', yLabel: M.type === 'dyn' ? 'Force (N)' : 'Temperature (°C)' });
    }
    const rows = pairs.filter(([, p]) => p.length).map(([n, p]) => { const m = errorMetrics(p.map((x) => x[0]), p.map((x) => x[1])); return [n, m.n, fmt(m.MAE, 4), fmt(m.RMSE, 4), `${fmt(m.MAPE, 3)} %`, fmt(m.R2, 3), fmt(m.bias, 4)]; });
    this.measEl.replaceChildren(rows.length ? table(['Signal', 'n', 'MAE', 'RMSE', 'MAPE', 'R²', 'bias (sim − meas)'], rows) : h('p', { class: 'muted' }, 'No overlapping range between measurement and simulation yet.'), h('div', { class: 'note' }, 'Predicted-versus-measured comparison only; these metrics validate the model for this condition only if the data were not used for calibration.'));
  }
  _calWear() {
    const M = this.meas, d = M.data;
    const rows = d.rows.map((r) => ({ t: r[M.t], VB: r[M.a] })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.VB)).sort((a, b) => a.t - b.t);
    try {
      if (rows.length < 2) throw new Error('Select the cutting-time and VB columns (need ≥ 2 numeric rows)');
      const VB0 = rows[0].t === 0 ? rows[0].VB : 0;
      const fit = fitWearPower(rows, VB0);
      Object.assign(this.s.wcfg, { flankModel: 'power', A: +fit.A.toPrecision(5), B: +fit.B.toPrecision(5), Vref: this.p.V, fref: this.p.f, apref: this.p.ap ?? 1 });
      this.s.VB0 = VB0;
      this._wearPanel.body.replaceChildren(...this._wearBody());
      this._configureSim();
      this.wearFitEl?.replaceChildren(h('h4', {}, `Wear fit VB = ${fmt(VB0, 3)} + A·t^B`), fitView(fit, [['A', 'A', 'mm/min^B', 4], ['B', 'B', '', 4]], 'Wear fit residuals'));
      toast(`Calibrated: VB = ${fmt(VB0, 3)} + ${fmt(fit.A, 4)}·t^${fmt(fit.B, 3)} (R² ${fmt(fit.R2, 3)}, n = ${fit.n}). Applied to the wear model.`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  }

  report() {
    const r = super.report();
    const W = this.sim.wear, H = this.sim.hist;
    r.title = 'Centre lathe simulation (V2)';
    r.models = [...r.models.filter((m) => m !== 'M-THERM-02'), 'M-CUT-05', 'M-CUT-06', 'M-THERM-04', 'M-TURN-05', 'M-WEAR-07', 'M-WEAR-08', 'M-WEAR-09', 'M-WEAR-10', 'M-WEAR-11', 'M-DYN-06', 'M-SURF-01', 'M-SURF-02'];
    r.results.push(['Nose wear VC', `${fmt(W.VC, 3)} mm`], ['Max rake interface T (conjugate)', q(Math.max(0, ...H.Trake.filter((v) => v != null)), 'temperature')], ['Max deflection', `${fmt(Math.max(0, ...H.defl) * 1000, 3)} µm`], ['Tool-life criterion', W.criterion?.(this.p.f ?? 0.2) || 'not reached']);
    if (this._dynRes) r.results.push(['Time-domain dynamics', `${this._dynRes.stable ? 'stable' : 'chatter'} at N = ${fmt(this._dynRes.N, 4)} rev/min`]);
    r.charts.push(this.cTemp, this.cWear, this.cDim);
    r.limitations = r.limitations.filter((x) => !/not fed back/.test(x));
    if (!this.s.m2.deflection) r.limitations.push('Deflection feedback was switched off for this run: the machined geometry ignores workpiece and tool compliance.');
    r.method = latheV2Method(this.s);
    r.limitations.push('Thermal model is a 2-D tool section with an analytical chip side (upper-bound temperatures).', 'Chip curl in the 3-D view is illustrative; chip thickness and flow direction are computed.', 'Wear modes other than flank need user coefficients; without them they are reported as not predicted.');
    if (this.s.runs.length) r.params.push(...this.s.runs.map((x) => `${x.label}: V=${fmt(x.V, 4)}, f=${x.f}, ap=${x.ap} → Fc ${fmt(x.FcMean, 4)} N, Ra ${fmt(x.Ra, 3)} µm`));
    return r;
  }
  serialize() { const d = super.serialize(); d.wears = Object.fromEntries(Object.entries(this.wears).map(([k, w]) => [k, w.snapshot ? w.snapshot() : { VB: w.VB }])); return d; }
  restore(d) {
    super.restore(d);
    this._v2init();
    for (const [k, v] of Object.entries(d.wears || {})) if (k === this.s.tool.id) this._wear().restore?.(v);
    this._applyStep();
  }
}

/** Calculation methodology actually used for a Lathe V2 run, built from the active model options. */
export function latheV2Method(s) {
  const m2 = s.m2 || {}, w = s.wcfg || {};
  const shear = { merchant: 'Merchant (φ = 45° − (β − γ)/2)', 'lee-shaffer': 'Lee–Shaffer (φ = 45° − (β − γ))' }[m2.shearModel] || m2.shearModel || 'Merchant';
  const flank = w.flankModel === 'power' && w.A > 0 && w.B > 0
    ? `calibrated power law VB = VB₀ + A·t^B (A = ${w.A}, B = ${w.B}) fitted at V = ${w.Vref} m/min, f = ${w.fref} mm/rev, ap = ${w.apref} mm; other conditions advance by the equivalent time dt·T(ref)/T(V, f, ap) from the Taylor ratio (M-WEAR-07)`
    : 'Taylor–Miner damage accumulation (dVB/dt = VBc / T(V, f, ap))';
  const opt = (on, txt) => (on ? txt : null);
  return [
    'MachinaSim advances the cut one spindle revolution at a time (time step = 60/N s). Within each revolution the steps below are evaluated in order; every quantity is carried to the next revolution, so the result depends on the cutting history, not only on the nominal parameters.',
    '1. Kinematics and engagement: the tool outline (insert ISO geometry, κr, κr′, rε) is placed on the planned path. The engaged cutting-edge length l and the uncut chip area A are computed from the current axisymmetric workpiece profile, which is then updated by exact profile stamping; h = A/l is the equivalent chip thickness (M-TURN-02).',
    `2. Cutting forces: kc = kc1.1·h^(−mc) with rake correction (M-CUT-01, M-CUT-02)${m2.softening ? ', multiplied by a Johnson–Cook thermal and strain-rate softening factor evaluated relative to an assumed reference of V = 100 m/min, h = 0.25 mm (M-CUT-05)' : ''}. Thrust follows from the friction angle (M-CUT-03); shear angle by ${shear} (M-CUT-06). ${m2.Kte || m2.Kre ? `Edge (ploughing) forces Kte = ${m2.Kte}, Kre = ${m2.Kre} N/mm are added per unit engaged edge length (M-CUT-06).` : 'No edge (ploughing) forces were applied (Kte = Kre = 0).'} Flank-wear-land forces σw·VB·l and μw·σw·VB·l are added (M-WEAR-03). Fc, Ff and Fp are resolved through κr, then torque, power and MRR follow.`,
    '3. Tool temperature: a transient 2-D finite-volume conduction model of a 12 × 12 mm tool section (graded mesh, ADI time stepping) receives heat flux on the rake contact and on the flank wear land. The heat partition is found at each step by matching mean interface temperatures with the chip side (Boothroyd shear-plane temperature + moving band source) and the workpiece side (moving band source) (M-THERM-04).' + (m2.probe ? ` The temperature at the thermocouple location (${m2.px} mm, ${m2.py} mm) is recorded for comparison with measurements.` : ''),
    `4. Tool condition: flank wear by ${flank}; nose wear VC and notch wear VN as ratios of the flank-wear increment (M-WEAR-08); crater depth KT by ${w.craterA > 0 && w.craterB > 0 ? 'the Usui rate law with user constants' : w.craterC > 0 && w.craterN > 0 ? 'a crater-Taylor law with user constants' : '— not predicted (no constants given)'} (M-WEAR-09); random chipping by ${w.chipEta > 0 && w.chipBeta > 0 ? `a Weibull hazard (η = ${w.chipEta} min, β = ${w.chipBeta})` : '— not predicted (no Weibull constants given)'} (M-WEAR-10). Crater depth raises the effective rake angle; VC recedes the tool nose; tool life ends at the first ISO 3685 criterion reached, and a plastic-deformation flag is raised when the rake temperature exceeds the tool hot-hardness limit (M-WEAR-11).`,
    opt(m2.deflection, `5. Deflection feedback: the radial force (smoothed revolution to revolution) acting on a stepped beam representing the current workpiece profile (${s.support || 'chuck'}), in series with a tool-side stiffness of ${m2.kTool > 0 ? `${m2.kTool} N/mm` : 'infinity'}, gives the elastic deflection, which reduces the depth actually cut and is written into the machined diameter (M-TURN-05).`),
    '6. Surface and dimensions: the machined profile is the envelope of the tool-nose positions, including deflection and, when a time-domain dynamics run is made, the vibration displacement; Ra, Rq, Rz and Rt are evaluated over the assessed length, and the diameter deviation along the part is reported (M-SURF-01, M-SURF-02).',
    '7. Dynamics (on request): regenerative chatter is integrated in the time domain using the radial modal parameters k, ζ, fn and the delayed-chip-thickness force; frequency-domain stability lobes (Tlusty) are given for comparison (M-DYN-06, M-DYN-01).',
    'Parameter status: every constant used is labelled in the Mathematical models table as published, estimated, calibrated or validated. Values not calibrated against measurements on this machine and material make the reported numbers uncalibrated estimates, not validated predictions.',
  ].filter(Boolean);
}

const RUN_METRICS = [
  { k: 'FcMean', label: 'Mean Fc (N)' }, { k: 'FpMean', label: 'Mean Fp (N)' }, { k: 'Fpeak', label: 'Peak F (N)' }, { k: 'Pmean', label: 'Mean power (kW)' }, { k: 'mrr', label: 'Mean MRR (cm³/min)' },
  { k: 'VB', label: 'VB after run (mm)' }, { k: 'TrakeMax', label: 'Max rake T (°C)' }, { k: 'deflMax', label: 'Max deflection (µm)' }, { k: 'Ra', label: 'Geometric Ra (µm)' }, { k: 'Rz', label: 'Geometric Rt (µm)' }, { k: 'dD', label: 'Ø error (µm)' }, { k: 'time', label: 'Time (s)' },
];
