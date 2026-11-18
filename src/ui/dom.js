// Minimal DOM helpers and form builders (no framework).
import { toDisplay, fromDisplay, unitLabel, fmt } from '../core/units.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const settings = { units: 'metric', listeners: new Set() };
export function onUnits(fn) { settings.listeners.add(fn); return () => settings.listeners.delete(fn); }
export function setUnits(u) { settings.units = u; try { localStorage.setItem('ms.units', u); } catch {} settings.listeners.forEach((f) => f(u)); }
try { const u = localStorage.getItem('ms.units'); if (u) settings.units = u; } catch {}

/** Display a value of quantity q in the active unit system. */
export function q(value, quantity, sig = 4) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  if (!quantity) return fmt(value, sig);
  return `${fmt(toDisplay(value, quantity, settings.units), sig)} ${unitLabel(quantity, settings.units)}`;
}

let uid = 0;
/**
 * Numeric input bound to an object property in INTERNAL units.
 * opts: {label, unit (static label) | quantity (unit-system aware), min, max, step, help, status, onChange}
 */
export function numField(obj, key, opts = {}) {
  const id = `f${++uid}`;
  const qn = opts.quantity;
  const toD = (v) => (qn ? toDisplay(v, qn, settings.units) : v);
  const fromD = (v) => (qn ? fromDisplay(v, qn, settings.units) : v);
  const input = h('input', { id, type: 'number', step: opts.step ?? 'any', inputmode: 'decimal' });
  const unitEl = h('span', { class: 'unit' }, qn ? unitLabel(qn, settings.units) : opts.unit || '');
  const msg = h('div', { class: 'field-msg' });
  const sync = () => { const v = obj[key]; input.value = v == null || Number.isNaN(v) ? '' : +toD(v).toPrecision(8); unitEl.textContent = qn ? unitLabel(qn, settings.units) : opts.unit || ''; };
  sync();
  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '' && opts.allowEmpty) { obj[key] = null; msg.textContent = ''; opts.onChange?.(null); return; }
    const v = fromD(Number(raw));
    if (!Number.isFinite(v)) { msg.textContent = 'Enter a number'; input.classList.add('bad'); return; }
    if (opts.min != null && v < opts.min) { msg.textContent = `Minimum ${opts.min}`; input.classList.add('bad'); return; }
    if (opts.max != null && v > opts.max) { msg.textContent = `Maximum ${opts.max}`; input.classList.add('bad'); return; }
    input.classList.remove('bad'); msg.textContent = '';
    obj[key] = v; opts.onChange?.(v);
  });
  if (qn) onUnits(sync);
  const wrap = h('div', { class: 'field' },
    h('label', { for: id }, opts.label, opts.status ? h('span', { class: `badge st-${opts.status}`, title: opts.statusTitle || opts.status }, opts.status) : null),
    h('div', { class: 'inrow' }, input, unitEl), opts.help ? h('div', { class: 'help' }, opts.help) : null, msg);
  wrap.sync = sync;
  return wrap;
}

export function selectField(obj, key, options, opts = {}) {
  const id = `f${++uid}`;
  const sel = h('select', { id }, options.map((o) => h('option', { value: o.value }, o.label)));
  sel.value = obj[key];
  sel.addEventListener('change', () => { obj[key] = sel.value; opts.onChange?.(sel.value); });
  const wrap = h('div', { class: 'field' }, h('label', { for: id }, opts.label), sel, opts.help ? h('div', { class: 'help' }, opts.help) : null);
  wrap.setOptions = (opts2) => { sel.innerHTML = ''; opts2.forEach((o) => sel.append(h('option', { value: o.value }, o.label))); sel.value = obj[key]; if (sel.value !== obj[key] && opts2.length) { obj[key] = opts2[0].value; sel.value = obj[key]; } };
  wrap.sel = sel;
  return wrap;
}

export function checkField(obj, key, label, onChange) {
  const id = `f${++uid}`;
  const cb = h('input', { id, type: 'checkbox' });
  cb.checked = !!obj[key];
  cb.addEventListener('change', () => { obj[key] = cb.checked; onChange?.(cb.checked); });
  return h('div', { class: 'field check' }, cb, h('label', { for: id }, label));
}

export function panel(title, ...children) {
  const body = h('div', { class: 'panel-body' }, ...children);
  const head = h('button', { class: 'panel-head', type: 'button', 'aria-expanded': 'true' }, title);
  const p = h('section', { class: 'panel' }, head, body);
  head.addEventListener('click', () => { const c = p.classList.toggle('collapsed'); head.setAttribute('aria-expanded', String(!c)); });
  p.body = body;
  return p;
}

export function tabs(defs, { onChange } = {}) {
  const bar = h('div', { class: 'tabbar', role: 'tablist' });
  const host = h('div', { class: 'tabhost' });
  const pages = {};
  let active = null;
  const show = (id) => {
    active = id;
    for (const [k, v] of Object.entries(pages)) { v.btn.classList.toggle('on', k === id); v.btn.setAttribute('aria-selected', String(k === id)); v.el.hidden = k !== id; }
    onChange?.(id);
  };
  for (const d of defs) {
    const btn = h('button', { class: 'tab', type: 'button', role: 'tab', onclick: () => show(d.id) }, d.label);
    const el = h('div', { class: 'tabpage', role: 'tabpanel' }, d.content);
    pages[d.id] = { btn, el };
    bar.append(btn); host.append(el);
  }
  show(defs[0].id);
  return { el: h('div', { class: 'tabs' }, bar, host), show, get active() { return active; }, pages };
}

export function table(headers, rows, opts = {}) {
  return h('table', { class: `tbl ${opts.class || ''}` },
    h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))),
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.flatMap(([k, v, title]) => [h('dt', { title: title || '' }, k), h('dd', {}, v)]));
}

export function toast(msg, level = 'info') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = h('div', { class: `toast ${level}`, role: 'status' }, msg);
  host.append(t);
  setTimeout(() => t.classList.add('out'), 3800);
  setTimeout(() => t.remove(), 4400);
}

export function download(name, data, mime = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept) {
  return new Promise((res) => {
    const i = h('input', { type: 'file', accept });
    i.addEventListener('change', () => res(i.files[0] || null));
    i.click();
  });
}

export function statusBadge(status) {
  return h('span', { class: `badge st-${status}`, title: STATUS_TEXT[status] || status }, status);
}
export const STATUS_TEXT = {
  published: 'Value from an identified published source for this grade',
  analogous: 'Published value for a closely related grade',
  typical: 'Handbook typical value — verify for your stock',
  estimated: 'Engineering estimate — calibrate before relying on it',
  calibrated: 'Fitted from your experimental data',
  measured: 'Entered from measurement',
  textbook: 'Textbook representative value — uncalibrated',
};
