// Sawing workspace: horizontal / vertical band saw and power hacksaw.
import { h, numField, selectField, panel, q, kv, toast } from '../dom.js';
import { Chart } from '../chart.js';
import { ProcPage } from '../procpage.js';
import { lib, materialSelect, materialSummary, modelNote } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { kienzleKc, thrustRatio } from '../../physics/cutting.js';
import { fmt } from '../../core/units.js';

export class SawPage extends ProcPage {
  constructor(root) {
    super(root, { note: 'Tooth-engagement sawing model (M-SAW-01): feed per tooth fz = vf·P/vs, engaged teeth n = Lc/P, Fc = n·kc(fz)·fz·kerf. For round bar the contact length Lc = 2√(y(D − y)) changes through the cut. Blade wear needs user-calibrated life data (no defaults shipped).' });
    this.s = { machine: 'hband', material: 'mild-steel', section: 'round', D: 60, Hs: 50, T: 40, tpi: 6, kerf: 1.3, vs: 60, vf: 40, strokes: 90, strokeLen: 150, rake: 0, lifeArea: 0 };
    const s = this.s;
    this.matSum = h('div');
    this.side.append(
      panel('Machine & stock', selectField(s, 'machine', [{ value: 'hband', label: 'Horizontal band saw' }, { value: 'vband', label: 'Vertical band saw' }, { value: 'hack', label: 'Power hacksaw (cuts on forward stroke)' }], { label: 'Machine', onChange: () => this.reset() }),
        materialSelect(s, () => { this.matSum.replaceChildren(materialSummary(lib.material(s.material))); this.reset(); }), this.matSum,
        selectField(s, 'section', [{ value: 'round', label: 'Round bar' }, { value: 'rect', label: 'Rectangular bar / plate' }], { label: 'Section', onChange: () => this.reset() }),
        h('div', { class: 'grid3' }, numField(s, 'D', { label: 'Bar Ø', unit: 'mm', min: 2, onChange: () => this.reset() }), numField(s, 'Hs', { label: 'Rect. height', unit: 'mm', min: 1, onChange: () => this.reset() }), numField(s, 'T', { label: 'Rect. thickness (Lc)', unit: 'mm', min: 1, onChange: () => this.reset() }))),
      panel('Blade & feeds', h('div', { class: 'grid2' },
        numField(s, 'tpi', { label: 'Teeth per inch', unit: 'TPI', min: 1, max: 32, onChange: () => this.reset() }), numField(s, 'kerf', { label: 'Kerf width', unit: 'mm', min: 0.3, onChange: () => this.reset() }),
        numField(s, 'vs', { label: 'Band speed vs', unit: 'm/min', min: 5, onChange: () => this.reset() }), numField(s, 'vf', { label: 'Down-feed rate vf', unit: 'mm/min', min: 0.5, onChange: () => this.reset() }),
        numField(s, 'strokes', { label: 'Hacksaw strokes/min', unit: '1/min', min: 10, onChange: () => this.reset() }), numField(s, 'strokeLen', { label: 'Hacksaw stroke', unit: 'mm', min: 50, onChange: () => this.reset() }),
        numField(s, 'rake', { label: 'Tooth rake', unit: '°', min: -10, max: 20, onChange: () => this.reset() }), numField(s, 'lifeArea', { label: 'Blade life (cut area, user data; 0 = n/a)', unit: 'cm²', min: 0, onChange: () => this.reset() }))),
      modelNote(['M-SAW-01', 'M-CUT-01']));
    this.res = h('div');
    this.cF = new Chart({ title: 'Cutting force through the section', xLabel: 'Cut depth y (mm)', yLabel: 'Force (N)' });
    this.cN = new Chart({ title: 'Engaged teeth & contact length', xLabel: 'Cut depth y (mm)', yLabel: 'Engaged teeth', y2Label: 'Contact length (mm)' });
    this.setTabs([{ id: 'r', label: 'Results', content: this.res }, { id: 'g', label: 'Graphs', content: h('div', {}, this.cF.el, this.cN.el) }]);
    this.matSum.replaceChildren(materialSummary(lib.material(s.material)));
    this.reset();
  }
  get mat() { return materialParams(lib.material(this.s.material)); }
  resetState() { this.y = 0; }
  height() { return this.s.section === 'round' ? this.s.D : this.s.Hs; }
  Lc(y) { const s = this.s; return s.section === 'round' ? 2 * Math.sqrt(Math.max(0, y * (s.D - y))) : s.T; }
  compute(plan) {
    if (plan) this.resetState();
    const s = this.s, m = this.mat;
    const P = 25.4 / s.tpi;
    // hacksaw: effective blade speed on the forward stroke; feed per stroke spread over the stroke's teeth
    const vsEff = s.machine === 'hack' ? (2 * s.strokeLen * s.strokes) / 1000 : s.vs; // m/min average (forward + return)
    const cutFrac = s.machine === 'hack' ? 0.5 : 1;
    const fz = (s.vf * P) / (vsEff * cutFrac * 1000);
    const kc = kienzleKc(m.kc11, m.mc, fz);
    const Hh = this.height();
    const ys = [], F = [], Ff = [], n = [], Lcs = [];
    for (let k = 0; k <= 200; k++) { const y = (k / 200) * Hh; const L = this.Lc(y); const ne = L / P; const fc = ne * kc * fz * s.kerf; ys.push(y); F.push(fc); Ff.push(fc * thrustRatio(m.mu, s.rake)); n.push(ne); Lcs.push(L); }
    this.prof = { ys, F, Ff, n, Lcs, fz, P, kc, vsEff };
    const area = s.section === 'round' ? (Math.PI * s.D * s.D) / 4 : s.Hs * s.T;
    const time = Hh / s.vf;
    const Fmax = Math.max(...F);
    const pw = (Fmax * vsEff * cutFrac) / 60000;
    this.cF.setData([{ name: 'Fc (cutting)', x: ys, y: F, color: '#dc2626' }, { name: 'Feed (thrust) force', x: ys, y: Ff, color: '#2563eb' }], { zeroY: true });
    this.cN.setData([{ name: 'teeth', x: ys, y: n, color: '#111' }, { name: 'Lc', x: ys, y: Lcs, y2: true, color: '#059669' }], { zeroY: true });
    const rows = [['Tooth pitch P', `${fmt(P, 4)} mm`], ['Feed per tooth fz', `${fmt(fz * 1000, 4)} µm`], ['kc at fz (extrapolated if < 0.05 mm)', `${fmt(kc, 4)} N/mm²`], ['Peak cutting force', q(Fmax, 'force')], ['Peak power', q(pw, 'power')], ['Cut area', `${fmt(area / 100, 4)} cm²`], ['Cutting time', `${fmt(time, 4)} min`], ['MRR (avg)', q((area * s.kerf) / time, 'mrr')]];
    if (fz < 0.002) rows.push(['⚠', 'Feed per tooth below ~2 µm: rubbing/glazing likely; Kienzle strongly extrapolated.']);
    if (P * 3 > Hh) rows.push(['⚠', 'Fewer than 3 teeth engaged over parts of the section: tooth stripping risk (common rule of thumb: ≥ 3 teeth in cut).']);
    rows.push(['Blade life', s.lifeArea > 0 ? `${fmt((100 * area) / 100 / s.lifeArea, 3)} % of user-defined life per cut` : 'not available (enter calibrated life)']);
    this.res.replaceChildren(kv(rows));
    this.plan = { time };
  }
  advance(dt) {
    const s = this.s;
    this.y = Math.min(this.height(), this.y + (dt === Infinity ? Infinity : (dt / 60) * s.vf));
    return this.y >= this.height();
  }
  onDone() { toast('Cut complete', 'ok'); }
  draw() {
    const { g, W, H } = this.ctx();
    const s = this.s, Hh = this.height();
    const sc = Math.min((W - 80) / (s.section === 'round' ? s.D : s.T * 3 + 40), (H - 80) / Hh);
    const cx = W / 2, top = 40;
    g.fillStyle = '#c9ced6';
    if (s.section === 'round') { g.beginPath(); g.arc(cx, top + (s.D / 2) * sc, (s.D / 2) * sc, 0, 2 * Math.PI); g.fill(); g.strokeStyle = '#555'; g.stroke(); }
    else { g.fillRect(cx - (s.T / 2) * sc * 3, top, s.T * sc * 3, Hh * sc); }
    // kerf (end view: blade enters from the top)
    const ky = top + this.y * sc;
    g.fillStyle = '#fff'; g.fillRect(cx - Math.max(2, (s.kerf / 2) * sc), top - 4, Math.max(4, s.kerf * sc), this.y * sc + 4);
    g.fillStyle = '#e0a526'; g.fillRect(cx - Math.max(2, (s.kerf / 2) * sc), ky - 6, Math.max(4, s.kerf * sc), 8);
    g.fillStyle = '#111'; g.font = '12px system-ui'; g.fillText(`kerf depth ${fmt(this.y, 4)} / ${fmt(Hh, 4)} mm (end view)`, 20, H - 20);
    const L = this.Lc(this.y);
    this.overlay.textContent = `contact length ${fmt(L, 4)} mm · teeth engaged ${fmt(L / (25.4 / s.tpi), 3)}`;
  }
  report() {
    const s = this.s, p = this.prof;
    return { title: 'Sawing simulation', machine: s.machine, workpiece: `${lib.material(s.material).name} ${s.section}`, tool: `${s.tpi} TPI blade, kerf ${s.kerf} mm`, params: [`vs ${s.vs} m/min, vf ${s.vf} mm/min`], models: ['M-SAW-01'], results: [['Peak Fc', q(Math.max(...p.F), 'force')], ['fz', `${fmt(p.fz * 1000, 4)} µm`], ['Cut time', `${fmt(this.plan.time, 4)} min`]], charts: [this.cF, this.cN], data: { headers: ['y_mm', 'Fc_N', 'Ff_N', 'teeth', 'Lc_mm'], rows: p.ys.map((y, i) => [y, p.F[i], p.Ff[i], p.n[i], p.Lcs[i]]) }, limitations: ['Uniform tooth load; set pattern and blade deflection ignored.'] };
  }
  serialize() { return { s: this.s }; }
  restore(d) { Object.assign(this.s, d.s); this.reset(); }
}
