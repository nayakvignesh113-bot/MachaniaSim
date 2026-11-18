// Grinding workspace: surface, cylindrical and internal grinding with pass-by-pass removal, wheel wear and dressing.
import { h, numField, selectField, panel, q, kv, statusBadge, toast } from '../dom.js';
import { Chart } from '../chart.js';
import { ProcPage } from '../procpage.js';
import { lib, materialSelect, materialSummary, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { grindingCalc, GRINDING_DEFAULTS } from '../../physics/abrasive.js';
import { fmt } from '../../core/units.js';

const WHEELS = {
  al2o3: { name: 'Aluminium oxide (A60 J V)', G: 30, eps: 0.75, note: 'conventional, steels' },
  sic: { name: 'Silicon carbide (C60 J V)', G: 15, eps: 0.75, note: 'cast iron, non-ferrous' },
  cbn: { name: 'CBN (B126, vitrified)', G: 1500, eps: 0.4, note: 'hardened steels' },
  diamond: { name: 'Diamond (D126, resin)', G: 2000, eps: 0.4, note: 'carbides, ceramics; not for steel' },
};

export class GrindPage extends ProcPage {
  constructor(root) {
    super(root, { note: 'Mechanics-level grinding model (M-GRIND-01/02, M-THERM-03). Specific energy u, force ratio, energy partition ε and G-ratio are ESTIMATES unless calibrated. Wheel loading, glazing and the size effect on u are not modelled.' });
    this.s = { type: 'surface', material: 'en24', wheel: 'al2o3', ds: 200, b: 20, vs: 30, vw: 150, a: 0.02, stock: 0.2, Lw: 150, Bw: 60, cross: 15, dw: 50, dressEvery: 10, dressDepth: 0.02, u: GRINDING_DEFAULTS.u.value, ratio: GRINDING_DEFAULTS.forceRatio.value, eps: GRINDING_DEFAULTS.epsilon.value, G: WHEELS.al2o3.G, burn: GRINDING_DEFAULTS.burnTemp.value };
    const s = this.s;
    this.matSum = h('div');
    this.side.append(
      panel('Process', selectField(s, 'type', [{ value: 'surface', label: 'Surface grinding (reciprocating table)' }, { value: 'cylindrical', label: 'External cylindrical (plunge)' }, { value: 'internal', label: 'Internal (plunge)' }], { label: 'Grinding type', onChange: () => this.reset() }),
        materialSelect(s, () => { this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.reset(); }), this.matSum),
      panel('Wheel', selectField(s, 'wheel', Object.entries(WHEELS).map(([k, w]) => ({ value: k, label: `${w.name} — ${w.note}` })), { label: 'Abrasive', onChange: (v) => { s.G = WHEELS[v].G; s.eps = WHEELS[v].eps; this._gField?.sync(); this._eField?.sync(); this.reset(); } }),
        h('div', { class: 'grid2' }, numField(s, 'ds', { label: 'Wheel Ø ds', unit: 'mm', min: 5, max: 600, onChange: () => this.reset() }), numField(s, 'b', { label: 'Wheel width b', unit: 'mm', min: 1, max: 200, onChange: () => this.reset() }), numField(s, 'vs', { label: 'Wheel speed vs', unit: 'm/s', min: 5, max: 150, onChange: () => this.reset() }),
          numField(s, 'dressEvery', { label: 'Dress every', unit: 'passes', min: 1, step: 1 }), numField(s, 'dressDepth', { label: 'Dressing depth', unit: 'mm', min: 0.001, max: 0.2 }))),
      panel('Work & feeds', h('div', { class: 'grid2' },
        numField(s, 'vw', { label: s.type === 'surface' ? 'Table speed vw' : 'Work surface speed vw', unit: 'mm/s', min: 1, max: 2000, onChange: () => this.reset() }), numField(s, 'a', { label: 'Depth per pass a', unit: 'mm', min: 0.001, max: 1, onChange: () => this.reset() }),
        numField(s, 'stock', { label: 'Stock to remove', unit: 'mm', min: 0.001, onChange: () => this.reset() }), numField(s, 'Lw', { label: 'Work length', unit: 'mm', min: 5, onChange: () => this.reset() }),
        numField(s, 'Bw', { label: 'Work width (surface)', unit: 'mm', min: 1, onChange: () => this.reset() }), numField(s, 'cross', { label: 'Cross-feed per pass', unit: 'mm', min: 0.5, onChange: () => this.reset() }),
        numField(s, 'dw', { label: 'Work Ø (cyl./internal)', unit: 'mm', min: 2, onChange: () => this.reset() }))),
      panel('Model coefficients', h('div', { class: 'grid2' },
        numField(s, 'u', { label: 'Specific energy u', unit: 'J/mm³', min: 1, status: 'estimated', help: GRINDING_DEFAULTS.u.note, onChange: () => this.reset() }),
        numField(s, 'ratio', { label: 'Force ratio Ft/Fn', unit: '–', min: 0.05, max: 1, status: 'estimated', onChange: () => this.reset() }),
        (this._eField = numField(s, 'eps', { label: 'Energy partition ε', unit: '–', min: 0, max: 1, status: 'estimated', help: GRINDING_DEFAULTS.epsilon.note, onChange: () => this.reset() })),
        (this._gField = numField(s, 'G', { label: 'Grinding ratio G', unit: '–', min: 0.5, status: 'estimated', help: GRINDING_DEFAULTS.G.note, onChange: () => this.reset() })),
        numField(s, 'burn', { label: 'Burn threshold', unit: '°C', min: 100, status: 'estimated', help: GRINDING_DEFAULTS.burnTemp.note }))),
      modelNote(['M-GRIND-01', 'M-GRIND-02', 'M-THERM-03']));
    this.res = h('div');
    this.cF = new Chart({ title: 'Grinding forces per pass', xLabel: 'Pass', yLabel: 'Force (N)' });
    this.cT = new Chart({ title: 'Max workpiece surface temperature per pass', xLabel: 'Pass', yLabel: 'Temperature (°C)' });
    this.cW = new Chart({ title: 'Wheel diameter and size error', xLabel: 'Pass', yLabel: 'Wheel Ø (mm)', y2Label: 'Size error (µm)' });
    this.setTabs([{ id: 'r', label: 'Results', content: this.res }, { id: 'g', label: 'Graphs', content: h('div', {}, this.cF.el, this.cT.el, this.cW.el) }], (id) => id === 'g' && this._charts());
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this.reset();
  }
  get mat() { return materialParams(lib.material(this.s.material)); }
  resetState() { this.passes = []; this.pi = 0; this.phase = 0; this.wheelD = this.s.ds; this.removed = 0; this.err = 0; this.sinceDress = 0; this.hist = { pass: [], Fn: [], Ft: [], P: [], T: [], ds: [], err: [] }; }
  compute(plan) {
    const s = this.s;
    if (this.passes == null || plan) this.resetState();
    const crossN = s.type === 'surface' ? Math.max(1, Math.ceil(s.Bw / Math.min(s.cross, s.b))) : 1;
    const layers = Math.max(1, Math.ceil(s.stock / s.a - 1e-9));
    this.plan = { crossN, layers, total: crossN * layers };
    const c = this._calc(s.ds);
    this.res.replaceChildren(kv([
      ['Equivalent diameter de', `${fmt(c.de, 4)} mm`], ['Contact length lc', `${fmt(c.lc, 4)} mm`], ['Equivalent chip thickness heq', `${fmt(c.heq * 1000, 4)} µm`],
      ['Material removal rate Qw', `${fmt(c.Qw, 4)} mm³/s (Q′ = ${fmt(c.Qprime, 4)} mm²/s)`], ['Grinding power P', q(c.P / 1000, 'power')], ['Tangential force Ft', q(c.Ft, 'force')], ['Normal force Fn', q(c.Fn, 'force')],
      ['Specific energy u', h('span', {}, `${s.u} J/mm³ `, statusBadge('estimated'))], ['Max surface temperature', q(c.Tmax, 'temperature')], ['Péclet number', fmt(c.Pe, 3)],
      ['Thermal damage check', c.Tmax > s.burn ? h('b', { style: { color: '#c0392b' } }, `RISK: ${fmt(c.Tmax, 4)} °C > ${s.burn} °C`) : `below ${s.burn} °C threshold`],
      ['Wheel wear rate', `${fmt(c.wheelWearRate, 4)} mm³/s (radial ${fmt(c.radialWearRate * 1000, 4)} µm/s)`],
      ['Plan', `${this.plan.layers} infeed(s) × ${this.plan.crossN} cross-feed pass(es) = ${this.plan.total} passes`],
    ]), h('div', { class: 'note' }, 'Temperature: Jaeger moving band source at high Péclet number. Forces from constant specific energy.'));
  }
  _calc(ds) {
    const s = this.s;
    const dw = s.type === 'internal' ? Math.max(s.dw, ds * 1.05) : s.dw;
    return grindingCalc({ type: s.type, ds, dw, vs: s.vs, vw: s.vw, a: s.a, b: Math.min(s.b, s.type === 'surface' ? s.cross : s.b), u: s.u, forceRatio: s.ratio, epsilon: s.eps, G: s.G, mat: this.mat });
  }
  advance(dt) {
    const s = this.s;
    let rem = dt;
    while (rem > 0 && this.pi < this.plan.total) {
      const tPass = s.type === 'surface' ? (s.Lw + 2 * 10) / s.vw : (Math.PI * s.dw) / s.vw; // one table stroke / one work revolution
      const need = (1 - this.phase) * tPass;
      if (rem < need) { this.phase += rem / tPass; rem = 0; break; }
      rem -= need; this.phase = 0;
      // complete a pass
      const c = this._calc(this.wheelD);
      const vol = c.Qw * tPass;
      const dr = vol / s.G / (Math.PI * this.wheelD * s.b); // wheel radial wear this pass, mm
      this.wheelD -= 2 * dr;
      this.err += dr * 1000; // µm less removed than programmed (until re-zeroed after dressing)
      this.removed += vol;
      this.pi++; this.sinceDress++;
      const H = this.hist;
      H.pass.push(this.pi); H.Fn.push(c.Fn); H.Ft.push(c.Ft); H.P.push(c.P / 1000); H.T.push(c.Tmax); H.ds.push(this.wheelD); H.err.push(this.err);
      if (this.sinceDress >= s.dressEvery) { this.wheelD -= 2 * s.dressDepth; this.sinceDress = 0; this.err = 0; }
      if (this.wheelD < s.ds * 0.6) { toast('Wheel worn below 60 % of its diameter — replace wheel', 'warn'); this.pi = this.plan.total; }
    }
    this.t += dt;
    return this.pi >= this.plan.total;
  }
  onDone() { this._charts(); toast(`Grinding complete: ${this.pi} passes, ${fmt(this.removed, 4)} mm³ removed`, 'ok'); }
  _charts() {
    const H = this.hist;
    this.cF.setData([{ name: 'Fn', x: H.pass, y: H.Fn, color: '#2563eb' }, { name: 'Ft', x: H.pass, y: H.Ft, color: '#dc2626' }], { zeroY: true });
    this.cT.setData([{ name: 'Tmax', x: H.pass, y: H.T, color: '#dc2626' }], { annotations: [{ y: this.s.burn, label: 'burn threshold (estimated)', color: '#c0392b' }] });
    this.cW.setData([{ name: 'Wheel Ø', x: H.pass, y: H.ds, color: '#111827' }, { name: 'Size error', x: H.pass, y: H.err, y2: true, color: '#d97706' }]);
  }
  draw() {
    const { g, W, H } = this.ctx();
    if (!this.plan) return;
    const s = this.s;
    const prog = this.plan.total ? (this.pi + this.phase) / this.plan.total : 0;
    const removedDepth = Math.min(s.stock, (this.pi / this.plan.crossN) * s.a);
    const scale = Math.min((W - 80) / (s.type === 'surface' ? s.Lw + this.wheelD : s.dw + this.wheelD + 20), (H - 60) / Math.max(this.wheelD + 40, s.dw + 40));
    g.save(); g.translate(40, 20);
    const ang = this.t * 40;
    const wheel = (cx, cy, r) => { g.fillStyle = '#b9a27a'; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill(); g.strokeStyle = '#7a6440'; g.stroke(); g.strokeStyle = 'rgba(80,60,30,.5)'; for (let k = 0; k < 8; k++) { const a = ang + (k * Math.PI) / 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); g.stroke(); } g.fillStyle = '#555'; g.beginPath(); g.arc(cx, cy, r * 0.15, 0, 2 * Math.PI); g.fill(); };
    if (s.type === 'surface') {
      const wy = H - 70, wh = 30 * scale / scale;
      const tableX = (Math.sin(this.phase * Math.PI) * 0.5) * s.Lw * scale; // reciprocation
      const x0 = 10 + tableX;
      g.fillStyle = '#5b7083'; g.fillRect(x0 - 10, wy + wh, s.Lw * scale + 20, 18);
      const shown = 40;
      const surfY = wy + (removedDepth / Math.max(s.stock, 1e-9)) * 8;
      g.fillStyle = '#c9ced6'; g.fillRect(x0, surfY, s.Lw * scale, wy + wh - surfY);
      g.fillStyle = '#e5e7eb'; g.fillRect(x0, wy, s.Lw * scale, surfY - wy);
      const R = (this.wheelD / 2) * scale;
      const cx = 10 + (s.Lw * scale) / 2, cy = wy - R;
      wheel(cx, cy, R);
      if (this.running && !this.paused) { g.strokeStyle = '#f59e0b'; for (let k = 0; k < 10; k++) { g.beginPath(); g.moveTo(cx, wy); g.lineTo(cx + 20 + Math.random() * 40, wy - Math.random() * 25); g.stroke(); } }
      void shown;
      g.fillStyle = '#111'; g.font = '12px system-ui'; g.fillText(`removed depth ${fmt(removedDepth, 3)} / ${s.stock} mm (exaggerated)`, 10, H - 25);
    } else {
      const Rw = (s.dw / 2) * scale, Rs = (this.wheelD / 2) * scale;
      const cx = W / 2 - 40, cy = H / 2 - 10;
      if (s.type === 'cylindrical') {
        g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(cx - Rs * 0.6, cy, Rw, 0, 2 * Math.PI); g.fill(); g.strokeStyle = '#555'; g.stroke();
        wheel(cx - Rs * 0.6 + Rw + Rs, cy, Rs);
      } else {
        g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(cx, cy, Rw + 30 * (scale > 1 ? 1 : scale) + 20, 0, 2 * Math.PI); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, Rw, 0, 2 * Math.PI); g.fill(); g.strokeStyle = '#555'; g.stroke();
        wheel(cx + Rw - Rs, cy, Math.min(Rs, Rw * 0.9));
      }
    }
    g.restore();
    this.overlay.textContent = `pass ${this.pi}/${this.plan.total} · wheel Ø ${fmt(this.wheelD, 5)} mm · ${fmt(prog * 100, 3)} %`;
  }
  report() {
    const H = this.hist, s = this.s;
    this._charts();
    return { title: 'Grinding simulation', machine: `${s.type} grinding`, workpiece: `${lib.material(s.material).name}`, tool: `${WHEELS[s.wheel].name}, Ø${s.ds} × ${s.b} mm, vs ${s.vs} m/s`, params: [`vw = ${s.vw} mm/s, a = ${s.a} mm, stock ${s.stock} mm, dress every ${s.dressEvery} passes`], models: ['M-GRIND-01', 'M-GRIND-02', 'M-THERM-03'], results: [['Passes', String(this.pi)], ['Peak Fn', q(Math.max(0, ...H.Fn), 'force')], ['Peak Tmax', q(Math.max(0, ...H.T), 'temperature')], ['Final wheel Ø', `${fmt(this.wheelD, 5)} mm`]], charts: [this.cF, this.cT, this.cW], data: { headers: ['pass', 'Fn_N', 'Ft_N', 'P_kW', 'Tmax_C', 'wheel_D_mm', 'size_error_um'], rows: H.pass.map((p, i) => [p, H.Fn[i], H.Ft[i], H.P[i], H.T[i], H.ds[i], H.err[i]]) }, limitations: ['Specific energy, force ratio, partition and G-ratio are estimates.', 'No size effect, loading or glazing.'] };
  }
  serialize() { return { s: this.s }; }
  restore(d) { Object.assign(this.s, d.s); this.reset(); }
}
