// ToolVision: calibrated image measurement of flank wear (classical image processing, M-VIS-01).
import { h, numField, selectField, panel, kv, toast, table, pickFile, download, statusBadge } from '../dom.js';
import { Chart } from '../chart.js';
import { measureFlankWear, calibrate } from '../../research/toolvision.js';
import { fmt } from '../../core/units.js';

export class VisionPage {
  constructor(root) {
    this.s = { mode: 'edge', knownUm: 1000, pxUnc: 1, depth: 150, side: 1, bright: 'bright', time: 0 };
    this.cal = null; this.edge = null; this.scaleLine = null; this.result = null; this.series = [];
    this.canvas = h('canvas');
    this.stage = h('div', { class: 'vision-stage' }, this.canvas);
    this.info = h('div'); this.resEl = h('div'); this.prog = h('div');
    this.cVB = new Chart({ title: 'Measured wear progression', xLabel: 'Cutting time (min)', yLabel: 'VB (mm)' });
    const s = this.s;
    const modeSel = selectField(s, 'mode', [{ value: 'scale', label: '1. Draw scale line (known length)' }, { value: 'edge', label: '2. Draw cutting-edge line' }], { label: 'Drawing mode' });
    this.video = h('video', { autoplay: true, playsinline: true, muted: true, style: { width: '100%', display: 'none', borderRadius: '6px' } });
    root.append(h('div', { class: 'content' },
      h('h1', {}, 'ToolVision ', statusBadge('estimated')),
      h('p', { class: 'lead' }, 'Flank-wear measurement from calibrated microscope or optical images (ISO 3685 VB definition). Classical image processing — Otsu segmentation of the wear land below a user-drawn cutting edge. No trained neural network is shipped; physical dimensions are only reported after scale calibration.'),
      h('div', { class: 'two' },
        h('div', {},
          h('div', { class: 'box' }, h('div', { class: 'row' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => this._open() }, 'Open image'),
            h('button', { class: 'btn', type: 'button', onclick: () => this._camera() }, 'USB microscope / camera'),
            h('button', { class: 'btn', type: 'button', onclick: () => this._grab() }, 'Capture frame'),
            h('button', { class: 'btn', type: 'button', onclick: () => this._exportPNG() }, 'Export annotated PNG')), this.video),
          this.stage, this.info),
        h('div', {},
          panel('Calibration & measurement', modeSel,
            h('div', { class: 'grid2' }, numField(s, 'knownUm', { label: 'Scale line length', unit: 'µm', min: 1 }), numField(s, 'pxUnc', { label: 'Line-end uncertainty', unit: 'px', min: 0 }),
              numField(s, 'depth', { label: 'Search depth below edge', unit: 'px', min: 10 }), selectField(s, 'side', [{ value: 1, label: 'Flank on left-hand side of the drawn line' }, { value: -1, label: 'Flank on right-hand side' }], { label: 'Flank side' })),
            selectField(s, 'bright', [{ value: 'bright', label: 'Wear land brighter than flank (typical)' }, { value: 'dark', label: 'Wear land darker' }], { label: 'Contrast' }),
            h('button', { class: 'btn primary', type: 'button', onclick: () => this._measure() }, 'Measure wear')),
          h('div', { class: 'box' }, this.resEl),
          panel('Wear progression', h('div', { class: 'grid2' }, numField(s, 'time', { label: 'Cutting time of this image', unit: 'min', min: 0 })),
            h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => this._add() }, 'Add measurement'), h('button', { class: 'btn', type: 'button', onclick: () => this._csv() }, 'Export CSV')), this.cVB.el, this.prog)))));
    this._bind();
    this.info.append(h('p', { class: 'muted' }, 'Open an image, select “Draw scale line” and drag along a feature of known length (e.g. stage micrometer), then select “Draw cutting-edge line” and drag along the unworn cutting edge.'));
  }
  async _open() {
    const f = await pickFile('image/*'); if (!f) return;
    const img = new Image(); img.onload = () => this._setImage(img); img.onerror = () => toast('Could not read image', 'error'); img.src = URL.createObjectURL(f);
  }
  async _camera() {
    try { const st = await navigator.mediaDevices.getUserMedia({ video: true }); this.video.srcObject = st; this.video.style.display = 'block'; toast('Camera live — press “Capture frame”', 'ok'); }
    catch (e) { toast(`Camera unavailable: ${e.message}`, 'error'); }
  }
  _grab() {
    const v = this.video; if (!v.videoWidth) return toast('No live camera', 'warn');
    const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
    const img = new Image(); img.onload = () => this._setImage(img); img.src = c.toDataURL();
  }
  _setImage(img) {
    this.img = img; this.edge = null; this.scaleLine = null; this.result = null; this.cal = null;
    const maxW = 1400, k = Math.min(1, maxW / img.width);
    this.canvas.width = Math.round(img.width * k); this.canvas.height = Math.round(img.height * k);
    this.k = k;
    const g = this.canvas.getContext('2d'); g.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    this.imgData = g.getImageData(0, 0, this.canvas.width, this.canvas.height);
    this._draw(); this._results();
  }
  _bind() {
    let start = null;
    const pos = (e) => { const r = this.canvas.getBoundingClientRect(); const p = e.touches ? e.touches[0] : e; return { x: ((p.clientX - r.left) * this.canvas.width) / r.width, y: ((p.clientY - r.top) * this.canvas.height) / r.height }; };
    const down = (e) => { if (!this.imgData) return; e.preventDefault(); start = pos(e); };
    const move = (e) => { if (!start) return; const p = pos(e); const line = { x1: start.x, y1: start.y, x2: p.x, y2: p.y }; if (this.s.mode === 'scale') this.scaleLine = line; else this.edge = line; this._draw(); };
    const up = () => { if (!start) return; start = null; if (this.s.mode === 'scale' && this.scaleLine) { const L = Math.hypot(this.scaleLine.x2 - this.scaleLine.x1, this.scaleLine.y2 - this.scaleLine.y1); if (L > 5) { this.cal = calibrate(L / this.k, this.s.knownUm, this.s.pxUnc); toast(`Calibrated: ${fmt(this.cal.umPerPx, 4)} µm/px (original image pixels)`, 'ok'); } } this._results(); };
    this.canvas.addEventListener('mousedown', down); this.canvas.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    this.canvas.addEventListener('touchstart', down, { passive: false }); this.canvas.addEventListener('touchmove', move); this.canvas.addEventListener('touchend', up);
  }
  _draw() {
    if (!this.imgData) return;
    const g = this.canvas.getContext('2d');
    g.putImageData(this.imgData, 0, 0);
    const line = (l, col, w = 2) => { if (!l) return; g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(l.x1, l.y1); g.lineTo(l.x2, l.y2); g.stroke(); };
    line(this.scaleLine, '#22c55e', 3); line(this.edge, '#3b82f6', 2);
    const r = this.result;
    if (r && this.edge) {
      const e = this.edge, L = Math.hypot(e.x2 - e.x1, e.y2 - e.y1), tx = (e.x2 - e.x1) / L, ty = (e.y2 - e.y1) / L, nx = -ty * this.s.side, ny = tx * this.s.side;
      g.strokeStyle = 'rgba(239,68,68,.9)'; g.lineWidth = 1.5; g.beginPath();
      r.widthsPx.forEach((w, i) => { const u = ((i + 0.5) / r.samples) * L; const x = e.x1 + tx * u + nx * w, y = e.y1 + ty * u + ny * w; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
      const iMax = r.widthsPx.indexOf(r.VBmaxPx); const u = ((iMax + 0.5) / r.samples) * L;
      g.fillStyle = '#f59e0b'; g.beginPath(); g.arc(e.x1 + tx * u + nx * r.VBmaxPx, e.y1 + ty * u + ny * r.VBmaxPx, 5, 0, 2 * Math.PI); g.fill();
    }
  }
  _measure() {
    if (!this.imgData || !this.edge) return toast('Open an image and draw the cutting-edge line first', 'warn');
    try {
      const um = this.cal ? this.cal.umPerPx / this.k : null; // per displayed pixel
      this.result = measureFlankWear(this.imgData, this.edge, { depth: this.s.depth, side: Number(this.s.side), umPerPx: um, umPerPxUnc: this.cal ? this.cal.umPerPxUnc / this.k : 0, wearIsBright: this.s.bright === 'bright' });
      this._draw(); this._results();
    } catch (e) { toast(e.message, 'error'); }
  }
  _results() {
    const r = this.result;
    const rows = [['Scale calibration', this.cal ? `${fmt(this.cal.umPerPx, 4)} µm/px ± ${fmt(this.cal.rel * 100, 3)} %` : 'NOT CALIBRATED — dimensions shown in pixels only']];
    if (r) {
      rows.push(['Otsu threshold', `${r.threshold} (grey level)`], ['Class separability η', fmt(r.separability, 3)], ['Confidence (η × clear-boundary fraction)', fmt(r.confidence, 3)]);
      if (r.VB != null) rows.push(['VB (mean land width)', `${fmt(r.VB, 4)} mm ± ${fmt(r.uVB, 2)} mm`], ['VBmax', `${fmt(r.VBmax, 4)} mm`], ['Wear land area', `${fmt(r.area, 4)} mm²`]);
      else rows.push(['VB (mean)', `${fmt(r.VBpx, 4)} px`], ['VBmax', `${fmt(r.VBmaxPx, 4)} px`]);
      r.flags.forEach((f) => rows.push(['Damage indication', f]));
      if (r.confidence < 0.5) rows.push(['⚠', 'Low confidence: improve lighting/contrast or adjust search depth; verify manually.']);
    }
    this.resEl.replaceChildren(h('h3', {}, 'Measurement'), kv(rows), h('div', { class: 'note' }, 'Uncertainty combines ±1 px edge quantisation, the standard error of the land-width profile and the scale-calibration uncertainty. Crater wear requires 3-D profilometry and is not measured from a single 2-D image.'));
  }
  _add() {
    const r = this.result;
    if (!r || r.VB == null) return toast('A calibrated measurement is required', 'warn');
    this.series.push({ t: this.s.time, VB: r.VB, VBmax: r.VBmax, u: r.uVB, conf: r.confidence });
    this.series.sort((a, b) => a.t - b.t);
    this.cVB.setData([{ name: 'VB', x: this.series.map((p) => p.t), y: this.series.map((p) => p.VB), points: true, color: '#111827' }, { name: 'VBmax', x: this.series.map((p) => p.t), y: this.series.map((p) => p.VBmax), points: true, color: '#dc2626' }], { annotations: [{ y: 0.3, label: 'ISO 3685 VB = 0.3 mm' }] });
    this.prog.replaceChildren(table(['t (min)', 'VB (mm)', 'VBmax (mm)', 'u(VB)', 'confidence'], this.series.map((p) => [p.t, fmt(p.VB, 4), fmt(p.VBmax, 4), fmt(p.u, 2), fmt(p.conf, 2)])));
  }
  _csv() { download('toolvision_wear.csv', ['t_min,VB_mm,VBmax_mm,u_VB_mm,confidence', ...this.series.map((p) => [p.t, p.VB, p.VBmax, p.u, p.conf].join(','))].join('\n'), 'text/csv'); }
  _exportPNG() { if (!this.imgData) return; this.canvas.toBlob((b) => download('toolvision_annotated.png', b, 'image/png')); }
  report() {
    return { title: 'ToolVision wear measurement', machine: '—', workpiece: '—', tool: '—', params: [this.cal ? `Calibration ${fmt(this.cal.umPerPx, 4)} µm/px` : 'Uncalibrated'], models: ['M-VIS-01'], results: this.series.map((p) => [`t = ${p.t} min`, `VB ${fmt(p.VB, 4)} mm, VBmax ${fmt(p.VBmax, 4)} mm`]), charts: [this.cVB], images: this.imgData ? [this.canvas.toDataURL('image/png')] : [], data: { headers: ['t_min', 'VB_mm', 'VBmax_mm', 'u_mm', 'confidence'], rows: this.series.map((p) => [p.t, p.VB, p.VBmax, p.u, p.conf]) }, limitations: ['Classical segmentation; requires good contrast and a correctly drawn edge.'] };
  }
  serialize() { return { s: this.s, series: this.series }; }
  restore(d) { Object.assign(this.s, d.s || {}); this.series = d.series || []; if (this.series.length) { const last = this.series.pop(); this.series.push(last); } }
}
