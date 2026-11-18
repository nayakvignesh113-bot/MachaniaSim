// Shaping and slotting workspace: quick-return kinematics, stroke-by-stroke removal, cutting-stroke forces.
import { h, numField, selectField, panel, q, kv, toast } from '../dom.js';
import { Chart } from '../chart.js';
import { ProcPage } from '../procpage.js';
import { lib, materialSelect, materialSummary, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { quickReturn } from '../../physics/abrasive.js';
import { turningNominal } from '../../physics/turning.js';
import { taylorLife, EdgeWear } from '../../physics/wear.js';
import { defaultTaylor } from '../../core/tools.js';
import { fmt } from '../../core/units.js';

export class RecipPage extends ProcPage {
  constructor(root) {
    super(root, { note: 'Single-point reciprocating cutting: Kienzle forces during the cutting stroke (M-CUT-01..03), slotted-lever quick-return kinematics (M-RECIP-01). Tool life uses textbook HSS Taylor constants (uncalibrated) at the mean cutting-stroke speed.' });
    this.s = { mode: 'shaper', material: 'mild-steel', len: 150, width: 80, ap: 2, f: 0.4, r: 60, d: 150, nc: 40, kr: 60, rake: 10, rn: 0.4, depthTotal: 2, keyDepth: 6, keyWidth: 10 };
    const s = this.s;
    this.matSum = h('div');
    this.side.append(
      panel('Machine & work', selectField(s, 'mode', [{ value: 'shaper', label: 'Shaping machine (horizontal ram, plane surface)' }, { value: 'slotter', label: 'Slotting machine (vertical ram, keyway)' }], { label: 'Machine', onChange: () => this.reset() }),
        materialSelect(s, () => { this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.reset(); }), this.matSum,
        h('div', { class: 'grid2' }, numField(s, 'len', { label: 'Work length (stroke dir.)', unit: 'mm', min: 10, onChange: () => this.reset() }), numField(s, 'width', { label: 'Width to plane', unit: 'mm', min: 2, onChange: () => this.reset() }),
          numField(s, 'keyWidth', { label: 'Keyway width (slotter)', unit: 'mm', min: 2, onChange: () => this.reset() }), numField(s, 'keyDepth', { label: 'Keyway depth (slotter)', unit: 'mm', min: 0.5, onChange: () => this.reset() }))),
      panel('Mechanism & feeds', h('div', { class: 'grid2' },
        numField(s, 'r', { label: 'Crank radius r', unit: 'mm', min: 5, onChange: () => this.reset() }), numField(s, 'd', { label: 'Crank centre ↔ lever pivot d', unit: 'mm', min: 10, onChange: () => this.reset() }),
        numField(s, 'nc', { label: 'Strokes per minute', unit: '1/min', min: 1, max: 200, onChange: () => this.reset() }),
        numField(s, 'ap', { label: 'Depth of cut ap (shaper)', unit: 'mm', min: 0.05, onChange: () => this.reset() }), numField(s, 'f', { label: 'Feed per stroke f', unit: 'mm', min: 0.02, max: 3, onChange: () => this.reset() }))),
      panel('Tool (HSS)', h('div', { class: 'grid3' }, numField(s, 'kr', { label: 'κr', unit: '°', min: 30, max: 95, onChange: () => this.reset() }), numField(s, 'rake', { label: 'Rake γ', unit: '°', min: -10, max: 25, onChange: () => this.reset() }), numField(s, 'rn', { label: 'rε', unit: 'mm', min: 0.05, onChange: () => this.reset() }))),
      modelNote(['M-RECIP-01', 'M-CUT-01', 'M-WEAR-01']));
    this.res = h('div');
    this.cV = new Chart({ title: 'Ram velocity over one crank revolution', xLabel: 'Crank angle (deg)', yLabel: 'Ram velocity (m/min)' });
    this.cP = new Chart({ title: 'Cutting power during the stroke', xLabel: 'Crank angle (deg)', yLabel: 'Power (kW)' });
    this.cVB = new Chart({ title: 'Flank wear vs strokes', xLabel: 'Stroke', yLabel: 'VB (mm)' });
    this.setTabs([{ id: 'r', label: 'Results', content: this.res }, { id: 'g', label: 'Graphs', content: h('div', {}, this.cV.el, this.cP.el, this.cVB.el) }]);
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this.reset();
  }
  get mat() { return materialParams(lib.material(this.s.material)); }
  resetState() { this.stroke = 0; this.theta = 0; this.cut = []; this.vbH = { n: [], VB: [] }; }
  compute(plan) {
    const s = this.s;
    if (plan || !this.cut) this.resetState();
    const stroke = s.len + 30; // overtravel 15 mm each end
    if (s.r >= s.d) throw new Error('Crank radius must be smaller than the pivot distance d');
    const L = (stroke * s.d) / (2 * s.r); // lever length that gives the required stroke
    this.qr = quickReturn({ r: s.r, d: s.d, L, nc: s.nc, n: 360 });
    const slot = s.mode === 'slotter';
    const ap = slot ? s.keyWidth : s.ap; // slotter: full keyway width engaged, feed into depth
    const f = s.f;
    const vCut = this.qr.v.map(Math.abs);
    // cutting stroke = the longer crank arc
    const half = Math.asin(s.r / s.d);
    const cutAng = Math.PI + 2 * half;
    const vmean = (stroke / 1000) / ((cutAng / (2 * Math.PI)) * (60 / s.nc)); // m/min (mm→m, s→min below)
    const Vmean = vmean * 60;
    const tool = { kr: slot ? 90 : s.kr, rake: s.rake, rn: s.rn };
    const nom = turningNominal({ mat: this.mat, tool, V: Math.max(Vmean, 0.1), f, ap, D: 1e6 });
    this.Fc = nom.Fc; this.Ff = nom.Ff; this.Fp = nom.Fp;
    const strokesNeeded = slot ? Math.ceil(s.keyDepth / f) : Math.ceil(s.width / f) * Math.max(1, Math.ceil(s.depthTotal / s.ap));
    this.plan = { strokesNeeded, time: strokesNeeded / s.nc, Vmean };
    this.taylor = defaultTaylor('hss', lib.material(s.material));
    if (plan) this.wear = new EdgeWear({ taylor: this.taylor, clearance: 8 });
    const T = taylorLife(Vmean, f, ap, this.taylor);
    this.res.replaceChildren(kv([
      ['Stroke length', `${fmt(this.qr.stroke, 4)} mm (lever L = ${fmt(L, 4)} mm)`], ['Cut : return time ratio', fmt(this.qr.ratio, 4)],
      ['Mean cutting-stroke speed', q(Vmean, 'speed')], ['Peak ram speed', q(Math.max(...vCut), 'speed')],
      ['Uncut chip h = f·sinκr', `${fmt(nom.h, 3)} mm`], ['Cutting force Fc', q(this.Fc, 'force')], ['Feed force', q(this.Ff, 'force')], ['Passive force', q(this.Fp, 'force')],
      ['Peak cutting power', q((this.Fc * Math.max(...vCut)) / 60000, 'power')], ['Strokes required', String(strokesNeeded)], ['Machining time', `${fmt(this.plan.time, 4)} min`],
      ['Taylor life at mean speed', Number.isFinite(T) ? `${fmt(T, 4)} min (textbook HSS, uncalibrated)` : 'no defensible default'],
    ]));
    const ang = this.qr.theta.map((t) => (t * 180) / Math.PI);
    this.cV.setData([{ name: 'v', x: ang, y: this.qr.v, color: '#2563eb' }]);
    // cutting occurs when the ram moves in the cutting direction (v > 0 by construction of the longer arc)
    const cutDir = 1; // the longer (cutting) arc passes θ = 0, where dβ/dθ = r/(d + r) > 0
    this.cP.setData([{ name: 'P', x: ang, y: this.qr.v.map((v) => (v * cutDir > 0 ? (this.Fc * Math.abs(v)) / 60000 : 0)), color: '#d97706' }], { zeroY: true });
  }
  advance(dt) {
    const s = this.s;
    const rate = s.nc / 60; // strokes per second
    const add = dt === Infinity ? Infinity : dt * rate;
    const target = Math.min(this.plan.strokesNeeded, this.stroke + add);
    while (this.stroke < Math.floor(target)) {
      this.stroke++;
      const tCut = (60 / s.nc) * ((Math.PI + 2 * Math.asin(s.r / s.d)) / (2 * Math.PI)) * (s.len / (s.len + 30));
      this.wear.advance(tCut, { V: this.plan.Vmean, f: s.f, ap: s.mode === 'slotter' ? s.keyWidth : s.ap });
      if (this.stroke % Math.max(1, Math.floor(this.plan.strokesNeeded / 300)) === 0) { this.vbH.n.push(this.stroke); this.vbH.VB.push(this.wear.VB); }
    }
    this.theta = (target % 1) * 2 * Math.PI + (this.stroke ? 0 : 0);
    this.frac = target - Math.floor(target);
    return this.stroke >= this.plan.strokesNeeded;
  }
  onDone() { this.cVB.setData([{ name: 'VB', x: this.vbH.n, y: this.vbH.VB, color: '#111' }]); toast(`Done: ${this.stroke} strokes`, 'ok'); }
  draw() {
    const { g, W, H } = this.ctx();
    if (!this.qr) return;
    const s = this.s;
    const k = Math.round((this.frac || 0) * 359);
    const xr = this.qr.x[k] ?? 0;
    const xmin = Math.min(...this.qr.x), xmax = Math.max(...this.qr.x);
    const sc = (W - 120) / (s.len + 60);
    if (s.mode === 'shaper') {
      const top = 90, wy = H - 90;
      // work: planed strips (width direction shown as depth bars)
      const done = Math.min(s.width, this.stroke * s.f);
      g.fillStyle = '#5b7083'; g.fillRect(40, wy + 40, s.len * sc + 40, 20);
      g.fillStyle = '#c9ced6'; g.fillRect(60, wy, s.len * sc, 40);
      g.fillStyle = '#e8eaee'; g.fillRect(60, wy - 6, s.len * sc, 6);
      g.fillStyle = '#111'; g.font = '12px system-ui'; g.fillText(`planed width ${fmt(done, 4)} / ${s.width} mm   (side view; ${this.stroke} strokes)`, 60, H - 20);
      // ram + tool
      const tx = 60 + ((xr - xmin) / (xmax - xmin || 1)) * (s.len + 30) * sc - 15 * sc;
      g.fillStyle = '#3e4c5a'; g.fillRect(tx - 260, top, 260, 34);
      g.fillStyle = '#5b7083'; g.fillRect(tx - 30, top + 34, 26, wy - top - 40);
      g.fillStyle = '#e0a526'; g.beginPath(); g.moveTo(tx - 4, wy - 6); g.lineTo(tx - 22, wy - 6); g.lineTo(tx - 4, wy - 22); g.closePath(); g.fill();
    } else {
      // slotter: plan view of hub with keyway growing
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.32;
      g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(cx, cy, R * 0.45, 0, 2 * Math.PI); g.fill();
      const dep = Math.min(s.keyDepth, this.stroke * s.f);
      const kw = (s.keyWidth / 50) * R, kd = (dep / 50) * R * 2;
      g.fillStyle = '#fff'; g.fillRect(cx - kw / 2, cy - R * 0.45 - kd, kw, kd + 4);
      g.strokeStyle = '#555'; g.strokeRect(cx - kw / 2, cy - R * 0.45 - kd, kw, kd);
      const ramUp = (xr - xmin) / (xmax - xmin || 1);
      g.fillStyle = '#e0a526'; g.fillRect(cx - kw / 2 + 2, cy - R * 0.45 - kd + 2, kw - 4, 6 + 10 * ramUp);
      g.fillStyle = '#111'; g.font = '12px system-ui'; g.fillText(`keyway depth ${fmt(dep, 3)} / ${s.keyDepth} mm (plan view)`, 20, H - 20);
    }
    this.overlay.textContent = `stroke ${this.stroke}/${this.plan.strokesNeeded} · VB ${fmt(this.wear?.VB ?? 0, 3)} mm`;
  }
  report() {
    const s = this.s;
    return { title: s.mode === 'shaper' ? 'Shaping simulation' : 'Slotting simulation', machine: s.mode, workpiece: lib.material(s.material).name, tool: `HSS, κr ${s.kr}°, γ ${s.rake}°`, params: [`${s.nc} strokes/min, f = ${s.f} mm/stroke, ap = ${s.ap} mm`], models: ['M-RECIP-01', 'M-CUT-01', 'M-WEAR-01'], results: [['Fc', q(this.Fc, 'force')], ['Cut/return ratio', fmt(this.qr.ratio, 4)], ['Strokes', String(this.stroke)], ['VB', `${fmt(this.wear?.VB ?? 0, 3)} mm`]], charts: [this.cV, this.cP, this.cVB], data: { headers: ['crank_deg', 'v_m_min'], rows: this.qr.theta.map((t, i) => [(t * 180) / Math.PI, this.qr.v[i]]) }, limitations: ['Ram treated as rigid; inertia forces ignored.', 'HSS Taylor constants textbook values.'] };
  }
  serialize() { return { s: this.s }; }
  restore(d) { Object.assign(this.s, d.s); this.reset(); }
}
