// Broaching workspace: rise per tooth, engaged teeth, force profile vs stroke, final dimension.
import { h, numField, selectField, panel, q, kv, toast } from '../dom.js';
import { Chart } from '../chart.js';
import { ProcPage } from '../procpage.js';
import { lib, materialSelect, materialSummary, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { kienzleKc, rakeFactor } from '../../physics/cutting.js';
import { broachForceProfile, broachTeeth } from '../../physics/abrasive.js';
import { taylorLife } from '../../physics/wear.js';
import { defaultTaylor } from '../../core/tools.js';
import { fmt } from '../../core/units.js';

export class BroachPage extends ProcPage {
  constructor(root) {
    super(root, { note: 'Broaching (M-BROACH-01): each engaged tooth removes its rise per tooth rz over the cut width b; total force = Σ kc(rz)·rz·b over teeth inside the workpiece. Chip-space adequacy uses the user-entered gullet area.' });
    this.s = { type: 'keyway', material: 'en8', width: 8, Dhole: 30, Lw: 40, nr: 24, rz: 0.06, ns: 3, nf: 4, pitch: 12, V: 4, rake: 15, capacity: 100, gullet: 20 };
    const s = this.s;
    this.matSum = h('div');
    this.side.append(
      panel('Job', selectField(s, 'type', [{ value: 'keyway', label: 'Internal keyway' }, { value: 'round', label: 'Internal round hole (sizing)' }, { value: 'surface', label: 'External surface' }], { label: 'Broach type', onChange: () => this.reset() }),
        materialSelect(s, () => { this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.reset(); }), this.matSum,
        h('div', { class: 'grid2' }, numField(s, 'width', { label: 'Key / surface width b', unit: 'mm', min: 1, onChange: () => this.reset() }), numField(s, 'Dhole', { label: 'Hole Ø (round)', unit: 'mm', min: 3, onChange: () => this.reset() }), numField(s, 'Lw', { label: 'Work length Lw', unit: 'mm', min: 2, onChange: () => this.reset() }))),
      panel('Broach', h('div', { class: 'grid2' },
        numField(s, 'nr', { label: 'Roughing teeth', unit: '–', min: 1, step: 1, onChange: () => this.reset() }), numField(s, 'rz', { label: 'Rise per tooth rz', unit: 'mm', min: 0.005, max: 0.3, onChange: () => this.reset() }),
        numField(s, 'ns', { label: 'Semi-finishing teeth (rz/2)', unit: '–', min: 0, step: 1, onChange: () => this.reset() }), numField(s, 'nf', { label: 'Sizing teeth (0 rise)', unit: '–', min: 0, step: 1, onChange: () => this.reset() }),
        numField(s, 'pitch', { label: 'Tooth pitch p', unit: 'mm', min: 2, onChange: () => this.reset() }), numField(s, 'rake', { label: 'Hook (rake) angle', unit: '°', min: 0, max: 25, onChange: () => this.reset() }),
        numField(s, 'gullet', { label: 'Gullet area (user)', unit: 'mm²', min: 1, onChange: () => this.reset() }), numField(s, 'V', { label: 'Broaching speed V', unit: 'm/min', min: 0.5, max: 30, onChange: () => this.reset() }),
        numField(s, 'capacity', { label: 'Machine capacity', unit: 'kN', min: 1, onChange: () => this.reset() }))),
      modelNote(['M-BROACH-01', 'M-CUT-01']));
    this.res = h('div');
    this.cF = new Chart({ title: 'Broaching force vs stroke', xLabel: 'Broach travel (mm)', yLabel: 'Force (kN)', y2Label: 'Teeth engaged' });
    this.setTabs([{ id: 'r', label: 'Results', content: h('div', {}, this.res, this.cF.el) }]);
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this.reset();
  }
  get mat() { return materialParams(lib.material(this.s.material)); }
  resetState() { this.x = 0; }
  compute(plan) {
    if (plan) this.resetState();
    const s = this.s, m = this.mat;
    const b = s.type === 'round' ? Math.PI * s.Dhole : s.width;
    const teeth = broachTeeth(s.nr, s.rz, s.ns, s.nf);
    const kcFun = (h) => kienzleKc(m.kc11, m.mc, h) * rakeFactor(s.rake, m.rake0);
    const r = broachForceProfile({ teeth, p: s.pitch, Lw: s.Lw, b, kcFun, nSamples: 600 });
    this.prof = r; this.teeth = teeth; this.b = b;
    const chipArea = s.rz * s.Lw; // curled chip of one tooth over the work length (uncompressed)
    const K = s.gullet / chipArea;
    const Fmax = r.Fmax / 1000;
    const tay = taylorLife(s.V, s.rz, b, defaultTaylor('hss', lib.material(s.material)));
    this.cF.setData([{ name: 'Force', x: r.x, y: r.F.map((f) => f / 1000), color: '#dc2626' }, { name: 'Teeth engaged', x: r.x, y: r.engaged, y2: true, color: '#2563eb' }], { zeroY: true, annotations: [{ y: s.capacity, label: 'machine capacity', color: '#c0392b' }] });
    this.res.replaceChildren(kv([
      ['Cut width b', `${fmt(b, 4)} mm`], ['Total rise (final depth / Ø change)', `${fmt(r.totalRise, 4)} mm${s.type === 'round' ? ` → Ø ${fmt(s.Dhole + 2 * r.totalRise, 5)} mm` : ''}`],
      ['kc at rz', `${fmt(kcFun(s.rz), 4)} N/mm²`], ['Force per roughing tooth', q(kcFun(s.rz) * s.rz * b, 'force')], ['Max teeth engaged', String(Math.max(...r.engaged))],
      ['Peak broaching force', h('b', { style: { color: Fmax > s.capacity ? '#c0392b' : 'inherit' } }, `${fmt(Fmax, 4)} kN${Fmax > s.capacity ? ' — EXCEEDS machine capacity' : ''}`)],
      ['Peak power', q((r.Fmax * s.V) / 60000, 'power')], ['Broach length (teeth)', `${fmt((teeth.length - 1) * s.pitch, 4)} mm`], ['Stroke time', `${fmt(((teeth.length - 1) * s.pitch + s.Lw) / (s.V * 1000) * 60, 4)} s`],
      ['Chip-space factor gullet/(rz·Lw)', `${fmt(K, 3)}${K < 3 ? ' — low (rule of thumb ≥ 3: chip packing risk)' : ''}`],
      ['Taylor life (HSS textbook, uncalibrated)', Number.isFinite(tay) ? `${fmt(tay, 4)} min` : 'n/a'],
    ]));
    this.plan = { xMax: r.x[r.x.length - 1] };
  }
  advance(dt) { this.x = Math.min(this.plan.xMax, this.x + (dt === Infinity ? Infinity : (dt / 60) * this.s.V * 1000)); return this.x >= this.plan.xMax; }
  onDone() { toast('Broaching stroke complete', 'ok'); }
  draw() {
    const { g, W, H } = this.ctx();
    if (!this.prof) return;
    const s = this.s;
    const sc = (W - 80) / (this.plan.xMax + s.Lw);
    const wy = H / 2 - 30, wh = 60;
    const wx = 40 + this.plan.xMax * sc * 0.5;
    // workpiece (section)
    g.fillStyle = '#c9ced6'; g.fillRect(wx, wy - wh, s.Lw * sc, wh); g.fillRect(wx, wy + 20, s.Lw * sc, wh);
    // depth achieved = sum of rises of teeth that have passed the far face
    let dep = 0; this.teeth.forEach((r, i) => { if (this.x - i * s.pitch >= s.Lw) dep += r; });
    const depPx = Math.min(18, (dep / Math.max(this.prof.totalRise, 1e-9)) * 18);
    g.fillStyle = '#fff'; g.fillRect(wx, wy - depPx, s.Lw * sc, depPx);
    // broach
    const bx = wx + s.Lw * sc - this.x * sc;
    g.fillStyle = '#5b6b7a'; g.fillRect(bx, wy, (this.teeth.length - 1) * s.pitch * sc + 30, 20);
    g.fillStyle = '#e0a526';
    this.teeth.forEach((r, i) => { const tx = bx + i * s.pitch * sc; const th = 3 + (i < s.nr ? (i / s.nr) * 12 : 15); g.beginPath(); g.moveTo(tx, wy); g.lineTo(tx + 3, wy - th * 0.6); g.lineTo(tx + 6, wy); g.fill(); });
    g.fillStyle = '#111'; g.font = '12px system-ui'; g.fillText(`cut depth ${fmt(dep, 4)} / ${fmt(this.prof.totalRise, 4)} mm (schematic, not to scale)`, 20, H - 20);
    const idx = Math.min(this.prof.x.length - 1, Math.round((this.x / this.plan.xMax) * (this.prof.x.length - 1)));
    this.overlay.textContent = `travel ${fmt(this.x, 4)} mm · F ${fmt(this.prof.F[idx] / 1000, 4)} kN · ${this.prof.engaged[idx]} teeth`;
  }
  report() {
    const s = this.s, r = this.prof;
    return { title: 'Broaching simulation', machine: 'Broaching machine', workpiece: lib.material(s.material).name, tool: `${s.nr} roughing teeth, rz ${s.rz} mm, pitch ${s.pitch} mm`, params: [`V = ${s.V} m/min`], models: ['M-BROACH-01'], results: [['Peak force', `${fmt(r.Fmax / 1000, 4)} kN`], ['Total rise', `${fmt(r.totalRise, 4)} mm`]], charts: [this.cF], data: { headers: ['x_mm', 'F_N', 'teeth'], rows: r.x.map((x, i) => [x, r.F[i], r.engaged[i]]) }, limitations: ['Chip packing and tooth wear progression not coupled to force.'] };
  }
  serialize() { return { s: this.s }; }
  restore(d) { Object.assign(this.s, d.s); this.reset(); }
}
