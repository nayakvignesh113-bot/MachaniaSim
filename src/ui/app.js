// MachinaSim application shell: hash router, header, project save/load, page lifecycle.
import { ProjectStore } from '../core/store.js';
import { h, $, setUnits, settings, toast, download, pickFile } from './dom.js';
import { VERSION } from '../core/version.js';

const ROUTES = [
  { id: 'home', label: 'Dashboard', load: () => import('./pages/home.js').then((m) => m.HomePage) },
  { id: 'lathe', label: 'Lathe', load: () => import('./pages/lathe-v2.js').then((m) => m.LathePageV2) },
  { id: 'drill', label: 'Radial drill', load: () => import('./pages/drill.js').then((m) => m.DrillPage) },
  { id: 'mill', label: 'Milling', load: () => import('./pages/mill.js').then((m) => m.MillPage) },
  { id: 'grind', label: 'Grinding', load: () => import('./pages/grind.js').then((m) => m.GrindPage) },
  { id: 'recip', label: 'Shaping/Slotting', load: () => import('./pages/recip.js').then((m) => m.RecipPage) },
  { id: 'saw', label: 'Sawing', load: () => import('./pages/saw.js').then((m) => m.SawPage) },
  { id: 'broach', label: 'Broaching', load: () => import('./pages/broach.js').then((m) => m.BroachPage) },
  { id: 'research', label: 'Research', load: () => import('./pages/research.js').then((m) => m.ResearchPage) },
  { id: 'vision', label: 'ToolVision', load: () => import('./pages/vision.js').then((m) => m.VisionPage) },
  { id: 'library', label: 'Libraries', load: () => import('./pages/library.js').then((m) => m.LibraryPage) },
  { id: 'models', label: 'Models & V&V', load: () => import('./pages/models.js').then((m) => m.ModelsPage) },
  { id: 'reports', label: 'Reports', load: () => import('./pages/reports.js').then((m) => m.ReportsPage) },
];

export const app = {
  pages: {}, // id → instance
  hosts: {},
  current: null,
  routes: ROUTES,
  async go(id, params) {
    const r = ROUTES.find((x) => x.id === id) || ROUTES[0];
    for (const [k, host] of Object.entries(this.hosts)) { const on = k === r.id; host.hidden = !on; if (!on) this.pages[k]?.hide?.(); }
    document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.id === r.id));
    if (!this.pages[r.id]) {
      const host = h('div', { class: `page page-${r.id}` });
      this.hosts[r.id] = host;
      $('#main').append(host);
      host.append(h('div', { class: 'loading' }, 'Loading…'));
      try {
        const Cls = await r.load();
        host.innerHTML = '';
        this.pages[r.id] = new Cls(host, this);
      } catch (e) {
        console.error(e);
        host.innerHTML = '';
        host.append(h('div', { class: 'error' }, `Failed to load ${r.label}: ${e.message}`));
        return;
      }
    }
    this.hosts[r.id].hidden = false;
    this.current = r.id;
    this.pages[r.id].show?.(params);
    document.title = `${r.label} · MachinaSim`;
  },
  serializeProject(name) {
    const pages = {};
    for (const [k, p] of Object.entries(this.pages)) if (p.serialize) { try { pages[k] = p.serialize(); } catch (e) { console.warn('serialize', k, e); } }
    return { format: 'machinasim-project', version: VERSION, modelVersion: VERSION, name, saved: new Date().toISOString(), units: settings.units, pages };
  },
  async restoreProject(data) {
    if (data?.format !== 'machinasim-project') throw new Error('Not a MachinaSim project file');
    for (const [k, d] of Object.entries(data.pages || {})) {
      if (!this.pages[k]) { await this.go(k); }
      try { this.pages[k].restore?.(d); } catch (e) { console.error(e); toast(`Could not restore ${k}: ${e.message}`, 'error'); }
    }
    toast(`Project “${data.name}” loaded (saved with v${data.version})`, 'ok');
  },
  store: new ProjectStore(),
  /** Saved projects, newest first (async). */
  projects() { return this.store.list(); },
  async saveProject(name) {
    const d = this.serializeProject(name);
    try {
      const meta = await this.store.put(name, d);
      try { await navigator.storage?.persist?.(); } catch {}
      toast(`Saved “${name}” in this browser (${(meta.size / 1e6).toFixed(2)} MB)`, 'ok');
    } catch (e) { toast(`Could not save (${e?.name === 'QuotaExceededError' ? 'browser storage full' : e.message}) — use Export instead`, 'error'); }
    return d;
  },
  async loadProject(name) { return this.restoreProject(await this.store.get(name)); },
  deleteProject(name) { return this.store.remove(name); },
  duplicateProject(name) { return this.store.duplicate(name); },
};

function header() {
  const nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, ROUTES.map((r) => h('a', { href: `#/${r.id}`, 'data-id': r.id }, r.label)));
  const units = h('select', { 'aria-label': 'Unit system', onchange: (e) => setUnits(e.target.value) }, h('option', { value: 'metric' }, 'SI / metric'), h('option', { value: 'imperial' }, 'Imperial'));
  units.value = settings.units;
  const menuBtn = h('button', { class: 'menu-btn', type: 'button', 'aria-label': 'Menu', onclick: () => document.body.classList.toggle('nav-open') }, '☰');
  const save = h('button', { class: 'btn small', type: 'button', onclick: () => { const n = prompt('Project name', app.lastName || 'MachinaSim project'); if (n) { app.lastName = n; app.saveProject(n).then(() => app.pages.home?.show?.()); } } }, 'Save');
  const exp = h('button', { class: 'btn small', type: 'button', onclick: () => { const d = app.serializeProject(app.lastName || 'project'); download(`${(app.lastName || 'project').replace(/\W+/g, '_')}.machinasim.json`, JSON.stringify(d), 'application/json'); } }, 'Export');
  const imp = h('button', { class: 'btn small', type: 'button', onclick: async () => { const f = await pickFile('.json'); if (!f) return; try { await app.restoreProject(JSON.parse(await f.text())); } catch (e) { toast(e.message, 'error'); } } }, 'Import');
  return h('header', { class: 'top' }, menuBtn, h('a', { class: 'brand', href: '#/home' }, h('span', { class: 'logo' }, 'M'), h('span', {}, 'MachinaSim'), h('span', { class: 'ver' }, `v${VERSION}`)), nav, h('div', { class: 'top-right' }, save, exp, imp, units));
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [id, qs] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  document.body.classList.remove('nav-open');
  app.go(id || 'home', params);
}

export function boot() {
  document.body.prepend(header());
  window.addEventListener('hashchange', route);
  window.addEventListener('error', (e) => toast(`Error: ${e.message}`, 'error'));
  window.addEventListener('unhandledrejection', (e) => toast(`Error: ${e.reason?.message || e.reason}`, 'error'));
  route();
  window.machinasim = app;
}
