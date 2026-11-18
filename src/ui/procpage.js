// Base layout for the mechanics-level process workspaces (grinding, shaping/slotting, sawing, broaching):
// inputs on the left, a 2-D animated schematic with progressive material removal in the centre, results right.
import { h, panel, tabs, toast } from './dom.js';

export class ProcPage {
  constructor(root, { title, note }) {
    this.root = root;
    this.side = h('div', { class: 'side' });
    this.canvas = h('canvas', { class: 'anim', style: { height: '100%', minHeight: '320px' } });
    this.overlay = h('div', { class: 'vp-overlay' });
    this.btnRun = h('button', { type: 'button', class: 'btn primary', onclick: () => this.start() }, '▶ Run');
    this.btnPause = h('button', { type: 'button', class: 'btn', onclick: () => { this.paused = !this.paused; this.btnPause.textContent = this.paused ? 'Resume' : 'Pause'; } }, 'Pause');
    this.btnFinish = h('button', { type: 'button', class: 'btn', onclick: () => this.finish() }, 'Finish');
    this.btnReset = h('button', { type: 'button', class: 'btn danger', onclick: () => this.reset() }, 'Reset');
    this.speedSel = h('select', { 'aria-label': 'Animation speed' }, [['1', '1× real time'], ['10', '10×'], ['100', '100×'], ['1000', '1000×']].map(([v, l]) => h('option', { value: v }, l)));
    this.speedSel.value = '10';
    const bar = h('div', { class: 'runbar' }, this.btnRun, this.btnPause, this.btnFinish, this.btnReset, this.speedSel);
    this.centre = h('div', { class: 'centre' }, h('div', { class: 'vp-wrap', style: { background: '#fff' } }, this.canvas, this.overlay), bar, note ? h('div', { class: 'note box' }, note) : null);
    this.resultsHost = h('div', { class: 'results' });
    root.append(h('div', { class: 'workspace' }, this.side, this.centre, this.resultsHost));
    this.t = 0; this.running = false; this.paused = false;
    this._ro = new ResizeObserver(() => this.draw());
    this._ro.observe(this.canvas);
  }
  setTabs(defs, onChange) { this.tabs = tabs(defs, { onChange }); this.resultsHost.replaceChildren(this.tabs.el); }
  ctx() {
    const c = this.canvas, W = c.clientWidth || 600, H = c.clientHeight || 320, dpr = window.devicePixelRatio || 1;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    return { g, W, H };
  }
  /** Subclasses: compute() → plan; advance(dtSim) → bool done; draw(). */
  start() {
    if (this.running) return toast('Already running', 'warn');
    try { this.compute(true); } catch (e) { toast(e.message, 'error'); return; }
    this.running = true; this.paused = false; this.btnPause.textContent = 'Pause';
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!this.paused) { const done = this.advance(dt * Number(this.speedSel.value)); this.draw(); if (done) { this.running = false; this.onDone?.(); return; } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  finish() { if (!this.running) return; this.running = false; this.advance(Infinity); this.draw(); this.onDone?.(); }
  reset() { this.running = false; this.t = 0; this.resetState?.(); this.compute(false); this.draw(); }
  show() {} hide() {}
}
