// Lightweight canvas line/scatter/bar chart with labelled axes (units), legend, hover readout,
// PNG and CSV export. Optional publication style: Times New Roman, bold labels, no grid, black/white symbols.
import { h, download } from './dom.js';
import { toCSV } from '../research/stats.js';

const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#4b5563'];
const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus'];

function niceTicks(lo, hi, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (lo === hi) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
  const span = hi - lo;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const t0 = Math.floor(lo / step) * step, t1 = Math.ceil(hi / step) * step;
  const out = [];
  for (let t = t0; t <= t1 + step * 0.5; t += step) out.push(+t.toPrecision(12));
  return out;
}
function fmtTick(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(1);
  return String(+v.toPrecision(6));
}

export class Chart {
  /**
   * @param o {title, xLabel, yLabel, height, type:'line'|'scatter'|'bar', publication:boolean, y2Label}
   */
  constructor(o = {}) {
    this.o = { height: 240, type: 'line', ...o };
    this.series = [];
    this.canvas = h('canvas', { class: 'chart-canvas', role: 'img', 'aria-label': o.title || 'chart' });
    this.tip = h('div', { class: 'chart-tip', hidden: true });
    const btnPng = h('button', { class: 'mini', type: 'button', title: 'Export PNG', onclick: () => this.exportPNG() }, 'PNG');
    const btnCsv = h('button', { class: 'mini', type: 'button', title: 'Export data (CSV)', onclick: () => this.exportCSV() }, 'CSV');
    const btnPub = h('button', { class: 'mini', type: 'button', title: 'Toggle publication style', onclick: () => { this.o.publication = !this.o.publication; this.draw(); } }, 'Pub');
    this.el = h('figure', { class: 'chart' }, h('div', { class: 'chart-tools' }, btnPub, btnPng, btnCsv), h('div', { class: 'chart-wrap' }, this.canvas, this.tip));
    this.canvas.addEventListener('mousemove', (e) => this._hover(e));
    this.canvas.addEventListener('mouseleave', () => { this.tip.hidden = true; });
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.el);
  }
  /** series: [{name, x:[], y:[], color?, dash?, marker?, y2?: boolean, points?: boolean}] */
  setData(series, opts = {}) { this.series = series; Object.assign(this.o, opts); this.draw(); }
  destroy() { this._ro.disconnect(); }

  _ranges() {
    let xl = Infinity, xh = -Infinity, yl = Infinity, yh = -Infinity;
    for (const s of this.series) {
      if (s.y2) continue;
      for (let i = 0; i < s.x.length; i++) { const x = s.x[i], y = s.y[i]; if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) continue; xl = Math.min(xl, x); xh = Math.max(xh, x); yl = Math.min(yl, y); yh = Math.max(yh, y); }
    }
    if (this.o.xMin != null) xl = this.o.xMin; if (this.o.xMax != null) xh = this.o.xMax;
    if (this.o.yMin != null) yl = this.o.yMin; if (this.o.yMax != null) yh = this.o.yMax;
    if (this.o.zeroY && yl > 0) yl = 0;
    if (!Number.isFinite(xl)) { xl = 0; xh = 1; } if (!Number.isFinite(yl)) { yl = 0; yh = 1; }
    return { xl, xh, yl, yh };
  }

  draw() {
    const c = this.canvas;
    const W = Math.max(200, this.el.clientWidth || 400), H = this.o.height;
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pub = !!this.o.publication;
    const font = pub ? '"Times New Roman", Times, serif' : 'Inter, system-ui, sans-serif';
    const fg = pub ? '#000' : getComputedStyle(document.documentElement).getPropertyValue('--fg').trim() || '#111';
    const muted = pub ? '#000' : getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#666';
    const gridc = getComputedStyle(document.documentElement).getPropertyValue('--grid').trim() || '#e5e7eb';
    g.fillStyle = pub ? '#fff' : getComputedStyle(document.documentElement).getPropertyValue('--chart-bg').trim() || '#fff';
    g.fillRect(0, 0, W, H);
    const L = 62, R = 14 + (this.series.some((s) => s.y2) ? 52 : 0), T = this.o.title ? 26 : 12, B = 44;
    const pw = W - L - R, ph = H - T - B;
    this._geom = { L, T, pw, ph };
    const { xl, xh, yl, yh } = this._ranges();
    const xt = niceTicks(xl, xh, Math.max(3, Math.floor(pw / 80))), yt = niceTicks(yl, yh, Math.max(3, Math.floor(ph / 45)));
    const x0 = this.o.xMin ?? xt[0], x1 = this.o.xMax ?? xt[xt.length - 1], y0 = this.o.yMin ?? yt[0], y1 = this.o.yMax ?? yt[yt.length - 1];
    this._scale = { x0, x1, y0, y1 };
    const X = (x) => L + ((x - x0) / (x1 - x0 || 1)) * pw, Y = (y) => T + ph - ((y - y0) / (y1 - y0 || 1)) * ph;
    // grid & axes
    g.lineWidth = 1;
    g.font = `${pub ? 'bold 13px' : '11px'} ${font}`;
    g.fillStyle = muted; g.strokeStyle = gridc;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const t of xt) { if (t < x0 - 1e-12 || t > x1 + 1e-12) continue; const x = X(t); if (!pub) { g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke(); } g.fillText(fmtTick(t), x, T + ph + 5); g.strokeStyle = fg; g.beginPath(); g.moveTo(x, T + ph); g.lineTo(x, T + ph + 4); g.stroke(); g.strokeStyle = gridc; }
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const t of yt) { if (t < y0 - 1e-12 || t > y1 + 1e-12) continue; const y = Y(t); if (!pub) { g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); } g.fillText(fmtTick(t), L - 7, y); g.strokeStyle = fg; g.beginPath(); g.moveTo(L - 4, y); g.lineTo(L, y); g.stroke(); g.strokeStyle = gridc; }
    g.strokeStyle = fg; g.lineWidth = pub ? 1.5 : 1;
    g.strokeRect(L, T, pw, ph); // closed box; ticks only bottom/left
    g.fillStyle = fg;
    g.font = `bold ${pub ? 14 : 12}px ${font}`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    if (this.o.xLabel) g.fillText(this.o.xLabel, L + pw / 2, H - 4);
    if (this.o.title) { g.textBaseline = 'top'; g.fillText(this.o.title, L + pw / 2, 4); }
    if (this.o.yLabel) { g.save(); g.translate(14, T + ph / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText(this.o.yLabel, 0, 0); g.restore(); }
    // y2
    let Y2 = null;
    const s2 = this.series.filter((s) => s.y2);
    if (s2.length) {
      let a = Infinity, b = -Infinity; for (const s of s2) for (const v of s.y) if (Number.isFinite(v)) { a = Math.min(a, v); b = Math.max(b, v); }
      const t2 = niceTicks(a, b, 5); const lo = t2[0], hi = t2[t2.length - 1];
      Y2 = (y) => T + ph - ((y - lo) / (hi - lo || 1)) * ph;
      g.font = `${pub ? 'bold 13px' : '11px'} ${font}`; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = muted;
      for (const t of t2) g.fillText(fmtTick(t), L + pw + 6, Y2(t));
      if (this.o.y2Label) { g.save(); g.translate(W - 10, T + ph / 2); g.rotate(Math.PI / 2); g.font = `bold 12px ${font}`; g.textAlign = 'center'; g.fillStyle = fg; g.fillText(this.o.y2Label, 0, 0); g.restore(); }
    }
    // series
    g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
    this.series.forEach((s, si) => {
      const col = pub ? '#000' : s.color || PALETTE[si % PALETTE.length];
      const YY = s.y2 ? Y2 : Y;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = s.width || (pub ? 1.5 : 1.8);
      g.setLineDash(s.dash || (pub && si > 0 ? [[6, 3], [2, 3], [8, 3, 2, 3]][(si - 1) % 3] : []));
      if (this.o.type === 'bar') {
        const n = s.x.length, bw = Math.max(2, (pw / Math.max(n, 1)) * 0.7 / this.series.length);
        for (let i = 0; i < n; i++) { const x = X(s.x[i]) - (bw * this.series.length) / 2 + si * bw; const y = YY(s.y[i]); g.fillRect(x, Math.min(y, YY(0)), bw, Math.abs(YY(0) - y)); }
        return;
      }
      if (!s.points && this.o.type !== 'scatter') {
        g.beginPath(); let pen = false;
        const step = Math.max(1, Math.floor(s.x.length / (pw * 2)));
        for (let i = 0; i < s.x.length; i += step) {
          const x = s.x[i], y = s.y[i];
          if (x == null || y == null || !Number.isFinite(y)) { pen = false; continue; }
          if (!pen) { g.moveTo(X(x), YY(y)); pen = true; } else g.lineTo(X(x), YY(y));
        }
        g.stroke();
      }
      g.setLineDash([]);
      if (s.points || this.o.type === 'scatter' || (pub && s.x.length <= 60)) {
        const mk = s.marker || MARKERS[si % MARKERS.length];
        const every = Math.max(1, Math.floor(s.x.length / 40));
        for (let i = 0; i < s.x.length; i += this.o.type === 'scatter' || s.points ? 1 : every) { if (Number.isFinite(s.y[i])) marker(g, mk, X(s.x[i]), YY(s.y[i]), pub ? 4 : 3.5, pub); }
      }
    });
    g.restore();
    // legend
    const named = this.series.filter((s) => s.name);
    if (named.length > 1 || (named.length === 1 && this.o.legend)) {
      g.font = `${pub ? 'bold 14px' : '11px'} ${font}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      let lx = L + 8, ly = T + 10;
      for (const [si, s] of this.series.entries()) {
        if (!s.name) continue;
        const col = pub ? '#000' : s.color || PALETTE[si % PALETTE.length];
        const w = g.measureText(s.name).width + 30;
        if (lx + w > L + pw) { lx = L + 8; ly += 16; }
        g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2; g.setLineDash(s.dash || (pub && si > 0 ? [[6, 3], [2, 3], [8, 3, 2, 3]][(si - 1) % 3] : []));
        g.beginPath(); g.moveTo(lx, ly); g.lineTo(lx + 18, ly); g.stroke(); g.setLineDash([]);
        if (pub || s.points || this.o.type === 'scatter') marker(g, s.marker || MARKERS[si % MARKERS.length], lx + 9, ly, 3.5, pub);
        g.fillStyle = fg; g.fillText(s.name, lx + 22, ly);
        lx += w + 8;
      }
    }
    (this.o.annotations || []).forEach((a) => {
      g.strokeStyle = a.color || '#9ca3af'; g.setLineDash([4, 4]); g.lineWidth = 1;
      if (a.y != null) { g.beginPath(); g.moveTo(L, Y(a.y)); g.lineTo(L + pw, Y(a.y)); g.stroke(); }
      if (a.x != null) { g.beginPath(); g.moveTo(X(a.x), T); g.lineTo(X(a.x), T + ph); g.stroke(); }
      if (a.point) { g.setLineDash([]); g.fillStyle = a.color || '#111'; marker(g, 'diamond', X(a.point[0]), Y(a.point[1]), 6, false); }
      g.setLineDash([]);
      if (a.label) { g.fillStyle = a.color || muted; g.font = `11px ${font}`; g.textAlign = 'left'; g.fillText(a.label, a.x != null ? X(a.x) + 4 : L + 6, a.y != null ? Y(a.y) - 7 : a.point ? Y(a.point[1]) - 10 : T + 10); }
    });
  }

  _hover(e) {
    if (!this._scale || !this.series.length) return;
    const r = this.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const { L, pw } = this._geom; const { x0, x1 } = this._scale;
    if (px < L || px > L + pw) { this.tip.hidden = true; return; }
    const xv = x0 + ((px - L) / pw) * (x1 - x0);
    const lines = [];
    for (const s of this.series) {
      if (!s.x.length) continue;
      let best = 0, bd = Infinity;
      const step = Math.max(1, Math.floor(s.x.length / 2000));
      for (let i = 0; i < s.x.length; i += step) { const d = Math.abs(s.x[i] - xv); if (d < bd) { bd = d; best = i; } }
      lines.push(`${s.name || 'y'}: ${fmtTick(s.y[best])} @ ${fmtTick(s.x[best])}`);
    }
    this.tip.textContent = lines.join('\n');
    this.tip.hidden = false;
    this.tip.style.left = `${Math.min(px + 12, r.width - 180)}px`;
    this.tip.style.top = `8px`;
  }

  exportPNG() {
    const was = this.o.publication; // export as currently styled
    this.draw();
    this.canvas.toBlob((b) => download(`${(this.o.title || 'chart').replace(/\W+/g, '_')}.png`, b, 'image/png'));
    this.o.publication = was;
  }
  exportCSV() {
    const headers = [], cols = [];
    this.series.forEach((s, i) => { headers.push(`${this.o.xLabel || 'x'} [${s.name || i}]`, `${s.y2 ? this.o.y2Label : this.o.yLabel || 'y'} [${s.name || i}]`); cols.push(s.x, s.y); });
    const n = Math.max(0, ...cols.map((c) => c.length));
    const rows = Array.from({ length: n }, (_, i) => cols.map((c) => c[i] ?? ''));
    download(`${(this.o.title || 'chart').replace(/\W+/g, '_')}.csv`, toCSV(headers, rows), 'text/csv');
  }
  toDataURL() { this.draw(); return this.canvas.toDataURL('image/png'); }
}

function marker(g, type, x, y, r, hollow) {
  g.beginPath();
  if (type === 'square') g.rect(x - r, y - r, 2 * r, 2 * r);
  else if (type === 'triangle') { g.moveTo(x, y - r * 1.2); g.lineTo(x + r, y + r * 0.8); g.lineTo(x - r, y + r * 0.8); g.closePath(); }
  else if (type === 'diamond') { g.moveTo(x, y - r * 1.3); g.lineTo(x + r, y); g.lineTo(x, y + r * 1.3); g.lineTo(x - r, y); g.closePath(); }
  else if (type === 'cross') { g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke(); return; }
  else if (type === 'plus') { g.moveTo(x - r, y); g.lineTo(x + r, y); g.moveTo(x, y - r); g.lineTo(x, y + r); g.stroke(); return; }
  else g.arc(x, y, r, 0, 2 * Math.PI);
  if (hollow) { const f = g.fillStyle; g.fillStyle = '#fff'; g.fill(); g.fillStyle = f; g.stroke(); } else g.fill();
}

/** Heat-map of a 2-D scalar field with a colour bar. field: Float64Array (nx*ny), row-major j*nx+i. */
export function drawField(canvas, field, nx, ny, { min, max, label = '°C', title = '', wmm, hmm } = {}) {
  const W = canvas.clientWidth || 320, H = canvas.clientHeight || 240;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  let lo = min ?? Infinity, hi = max ?? -Infinity;
  if (min == null || max == null) for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi - lo < 1e-9) hi = lo + 1;
  const L = 40, T = 22, cb = 50, pw = W - L - cb - 10, ph = H - T - 30;
  const cw = pw / nx, ch = ph / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { g.fillStyle = turbo((field[j * nx + i] - lo) / (hi - lo)); g.fillRect(L + i * cw, T + j * ch, cw + 0.6, ch + 0.6); }
  g.strokeStyle = '#111'; g.strokeRect(L, T, pw, ph);
  g.fillStyle = '#111'; g.font = 'bold 12px system-ui'; g.textAlign = 'center'; g.fillText(title, L + pw / 2, 14);
  g.font = '11px system-ui';
  if (wmm) { g.fillText(`x (along rake face) 0 → ${wmm} mm`, L + pw / 2, T + ph + 16); }
  if (hmm) { g.save(); g.translate(14, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText(`depth into tool 0 → ${hmm} mm`, 0, 0); g.restore(); }
  for (let k = 0; k <= 50; k++) { g.fillStyle = turbo(1 - k / 50); g.fillRect(W - cb + 4, T + (k / 51) * ph, 14, ph / 50 + 1); }
  g.fillStyle = '#111'; g.textAlign = 'left';
  g.fillText(`${hi.toFixed(0)} ${label}`, W - cb + 20, T + 6); g.fillText(`${lo.toFixed(0)}`, W - cb + 20, T + ph);
}

export function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = Math.round(255 * Math.min(1, Math.max(0, 0.1357 + t * (4.5974 - t * (42.3277 - t * (130.5887 - t * (150.5666 - t * 58.1375)))))));
  const gg = Math.round(255 * Math.min(1, Math.max(0, 0.0914 + t * (2.1856 + t * (4.8052 - t * (14.0195 - t * (4.2109 + t * 2.7747)))))));
  const b = Math.round(255 * Math.min(1, Math.max(0, 0.1067 + t * (12.5925 - t * (60.1097 - t * (109.0745 - t * (88.5066 - t * 26.8183)))))));
  return `rgb(${r},${gg},${b})`;
}
