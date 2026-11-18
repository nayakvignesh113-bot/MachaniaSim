// Research workspace: experimental data, model comparison, calibration (with independent validation),
// DOE (full factorial / Taguchi), ANOVA, RSM, multi-objective optimisation, Monte-Carlo uncertainty.
import { h, numField, selectField, panel, tabs, q, kv, toast, table, pickFile, download, statusBadge } from '../dom.js';
import { Chart } from '../chart.js';
import { lib, materialSelect } from '../common.js';
import { materialParams } from '../../core/materials.js';
import { defaultTaylor } from '../../core/tools.js';
import { fmt } from '../../core/units.js';
import { parseCSV, toCSV, errorMetrics, fitKienzle, fitTaylor, fitExtendedTaylor, fitScale, fullFactorial, taguchiDesign, anovaMainEffects, fitRSM, paretoFront, geneticAlgorithm, rng, interp, snRatio } from '../../research/stats.js';
import { turningNominal, theoreticalRoughness } from '../../physics/turning.js';
import { taylorLife } from '../../physics/wear.js';
import { cuttingTemperature } from '../../physics/thermal.js';
import { DEG } from '../../core/units.js';

async function readTable(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.mini.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load XLSX reader')); document.head.append(s); });
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return parseCSV(window.XLSX.utils.sheet_to_csv(ws));
  }
  return parseCSV(await file.text());
}

export class ResearchPage {
  constructor(root, app) {
    this.app = app;
    this.s = { material: 'en8', toolId: 'cnmg-0408-carb', data: null, map: {}, role: 'random', calFrac: 0.6, seed: 1 };
    this.root = root;
    const t = tabs([
      { id: 'exp', label: 'Experiments & validation', content: this._expTab() },
      { id: 'series', label: 'Time-series comparison', content: this._seriesTab() },
      { id: 'doe', label: 'DOE · ANOVA · RSM', content: this._doeTab() },
      { id: 'opt', label: 'Optimisation', content: this._optTab() },
      { id: 'unc', label: 'Uncertainty', content: this._uncTab() },
    ]);
    root.append(h('div', { class: 'content' }, h('h1', {}, 'Research workspace'), h('p', { class: 'lead' }, 'Calibration data and validation data are kept separate: coefficients fitted on the calibration subset are evaluated only on the independent validation subset.'), t.el));
  }
  get mat() { return materialParams(lib.material(this.s.material)); }
  get tool() { return lib.tool(this.s.toolId); }

  // ---------------- experiments ----------------
  _expTab() {
    const s = this.s;
    this.dataInfo = h('div'); this.mapEl = h('div'); this.cmpEl = h('div');
    this.cScatter = new Chart({ title: 'Predicted vs measured', xLabel: 'Measured', yLabel: 'Predicted', type: 'scatter', height: 300 });
    const load = h('button', { class: 'btn primary', type: 'button', onclick: async () => { const f = await pickFile('.csv,.txt,.xlsx,.xls'); if (!f) return; try { s.data = await readTable(f); s.fileName = f.name; this._afterLoad(); } catch (e) { toast(e.message, 'error'); } } }, 'Import CSV / TXT / XLSX');
    const demo = h('button', { class: 'btn', type: 'button', onclick: () => this._template() }, 'Download template');
    return h('div', {}, h('div', { class: 'two' },
      h('div', {}, h('div', { class: 'box' }, h('div', { class: 'row' }, load, demo), this.dataInfo), h('div', { class: 'box' }, h('h3', {}, 'Model & column mapping'), materialSelect(s, () => this._compare()),
        selectField(s, 'toolId', lib.tools().filter((t) => t.kind === 'turning' && t.subtype === 'general').map((t) => ({ value: t.id, label: t.name })), { label: 'Tool geometry for predictions', onChange: () => this._compare() }), this.mapEl)),
      h('div', {}, h('div', { class: 'box' }, this.cScatter.el, this.cmpEl))));
  }
  _template() {
    // headers only: MachinaSim never ships invented measurement data
    download('machinasim_turning_template.csv', toCSV(['V_m_min', 'f_mm_rev', 'ap_mm', 'D_mm', 'Fc_N', 'Ff_N', 'Fp_N', 'Ra_um', 'T_life_min', 'role (cal|val)'], []) + '\n', 'text/csv');
  }
  _afterLoad() {
    const d = this.s.data;
    if (!d.rows.length) { toast('No data rows found', 'error'); return; }
    const guess = (re) => d.headers.find((x) => re.test(x)) || '';
    const roleCol = guess(/role|set|split/i);
    if (roleCol) this.s.role = 'column';
    this.s.map = { V: guess(/^v(c)?\b|speed/i), f: guess(/^f\b|feed/i), ap: guess(/^ap|depth/i), D: guess(/^d\b|^d_|diam/i), Fc: guess(/fc|cutting.?force|^fz?_?t/i), Ff: guess(/ff|feed.?force/i), Fp: guess(/fp|passive|radial/i), Ra: guess(/^ra/i), T: guess(/^t\b|life/i), role: guess(/role|set|split/i) };
    this.dataInfo.replaceChildren(h('div', { class: 'muted' }, `${this.s.fileName}: ${d.rows.length} rows, ${d.headers.length} columns`), h('div', { class: 'scroll' }, table(d.headers, d.rows.slice(0, 50).map((r) => d.headers.map((k) => r[k])))));
    const opts = [{ value: '', label: '— not available —' }, ...d.headers.map((x) => ({ value: x, label: x }))];
    const m = this.s.map;
    const sel = (k, label) => selectField(m, k, opts, { label, onChange: () => this._compare() });
    this.mapEl.replaceChildren(h('div', { class: 'grid2' }, sel('V', 'Cutting speed V (m/min)'), sel('f', 'Feed f (mm/rev)'), sel('ap', 'Depth ap (mm)'), sel('D', 'Diameter D (mm, optional)'), sel('Fc', 'Measured Fc (N)'), sel('Ff', 'Measured Ff (N)'), sel('Fp', 'Measured Fp (N)'), sel('Ra', 'Measured Ra (µm)'), sel('T', 'Measured tool life T (min)'), sel('role', 'Role column (cal / val)')),
      selectField(this.s, 'role', [{ value: 'random', label: 'Random split (seeded)' }, { value: 'column', label: 'Use role column' }, { value: 'all', label: 'No split (comparison only)' }], { label: 'Calibration / validation split', onChange: () => this._compare() }),
      numField(this.s, 'calFrac', { label: 'Calibration fraction (random split)', unit: '–', min: 0.2, max: 0.9, onChange: () => this._compare() }));
    this._compare();
  }
  _rows() {
    const d = this.s.data, m = this.s.map;
    const num = (r, k) => (m[k] && Number.isFinite(r[m[k]]) ? r[m[k]] : null);
    const R = rng(this.s.seed);
    return d.rows.map((r) => {
      let role = 'all';
      if (this.s.role === 'random') role = R() < this.s.calFrac ? 'cal' : 'val';
      else if (this.s.role === 'column' && m.role) role = /^c/i.test(String(r[m.role])) ? 'cal' : 'val';
      return { V: num(r, 'V'), f: num(r, 'f'), ap: num(r, 'ap'), D: num(r, 'D') ?? 50, Fc: num(r, 'Fc'), Ff: num(r, 'Ff'), Fp: num(r, 'Fp'), Ra: num(r, 'Ra'), T: num(r, 'T'), role };
    }).filter((r) => r.V && r.f && r.ap);
  }
  _compare(matOverride) {
    if (!this.s.data) return;
    const rows = this._rows();
    const tool = this.tool, mat = matOverride || this.mat;
    const pred = (r) => turningNominal({ mat, tool, V: r.V, f: r.f, ap: r.ap, D: r.D });
    const out = [];
    const series = [];
    for (const [k, color] of [['Fc', '#dc2626'], ['Ff', '#2563eb'], ['Fp', '#059669']]) {
      const ok = rows.filter((r) => r[k] != null);
      if (!ok.length) continue;
      const p = ok.map((r) => Math.abs(pred(r)[k]));
      const y = ok.map((r) => r[k]);
      const valIdx = ok.map((r, i) => (r.role !== 'cal' ? i : -1)).filter((i) => i >= 0);
      const mAll = errorMetrics(y, p);
      const mVal = valIdx.length ? errorMetrics(valIdx.map((i) => y[i]), valIdx.map((i) => p[i])) : null;
      out.push([k, ok.length, fmt(mAll.MAE, 4), fmt(mAll.RMSE, 4), fmt(mAll.MAPE, 3) + ' %', fmt(mAll.R2, 3), mVal ? `${fmt(mVal.RMSE, 4)} / ${fmt(mVal.MAPE, 3)} % (n=${mVal.n})` : '—']);
      series.push({ name: k, x: y, y: p, color, points: true });
    }
    if (rows.some((r) => r.Ra != null)) {
      const ok = rows.filter((r) => r.Ra != null);
      const p = ok.map((r) => theoreticalRoughness(r.f, tool.rn, tool.kr, tool.krMinor).Ra), y = ok.map((r) => r.Ra);
      const m = errorMetrics(y, p);
      out.push(['Ra (theoretical vs measured)', ok.length, fmt(m.MAE, 4), fmt(m.RMSE, 4), fmt(m.MAPE, 3) + ' %', fmt(m.R2, 3), 'theory is a lower bound']);
    }
    const all = series.flatMap((s) => [...s.x, ...s.y]);
    const lo = Math.min(...all, 0), hi = Math.max(...all, 1) * 1.06;
    series.push({ name: '1 : 1', x: [lo, hi], y: [lo, hi], color: '#9ca3af', dash: [4, 4] });
    this.cScatter.setData(series, { xMin: lo, xMax: hi, yMin: lo, yMax: hi });
    // calibration
    const cal = rows.filter((r) => r.role !== 'val' && r.Fc != null);
    const calBox = h('div');
    if (cal.length >= 2) {
      const kr = (tool.kr ?? 90) * DEG;
      try {
        const fitRows = cal.map((r) => ({ h: r.f * Math.sin(kr), b: r.ap / Math.sin(kr), Fc: r.Fc / (1 - 0.015 * ((tool.rake ?? 0) - (this.mat.rake0 ?? 6))) }));
        const k = fitKienzle(fitRows);
        let muFit = null;
        const withFf = cal.filter((r) => r.Ff != null);
        if (withFf.length) { const ratio = withFf.reduce((sum, r) => sum + Math.hypot(r.Ff, r.Fp ?? 0) / r.Fc, 0) / withFf.length; muFit = Math.tan(Math.atan(ratio) + (tool.rake ?? 0) * DEG); }
        const calMat = { ...this.mat, kc11: k.kc11, mc: k.mc, mu: muFit ?? this.mat.mu };
        const val = rows.filter((r) => r.role === 'val' && r.Fc != null);
        const mv = val.length ? errorMetrics(val.map((r) => r.Fc), val.map((r) => turningNominal({ mat: calMat, tool, V: r.V, f: r.f, ap: r.ap, D: r.D }).Fc)) : null;
        calBox.append(h('h3', {}, 'Kienzle calibration (calibration subset only) ', statusBadge('calibrated')), kv([['kc1.1', `${fmt(k.kc11, 5)} N/mm² (library ${this.mat.kc11})`], ['mc', `${fmt(k.mc, 4)} (library ${this.mat.mc})`], ['fit R² (log-log)', fmt(k.R2, 4)], ['n calibration rows', String(k.n)], ['friction μ from (Ff,Fp)/Fc', muFit != null ? fmt(muFit, 3) : 'needs Ff'], ['Independent validation (Fc)', mv ? `RMSE ${fmt(mv.RMSE, 4)} N, MAPE ${fmt(mv.MAPE, 3)} %, R² ${fmt(mv.R2, 3)} (n=${mv.n})` : 'no validation rows']]),
          h('button', { class: 'btn', type: 'button', onclick: () => this._saveCalibrated(k, muFit, mv) }, 'Save as calibrated custom material'));
      } catch (e) { calBox.append(h('div', { class: 'warn' }, e.message)); }
    }
    const lifeRows = rows.filter((r) => r.T != null && r.role !== 'val');
    if (lifeRows.length >= 2) {
      try {
        const tf = fitTaylor(lifeRows);
        let ext = null; try { ext = lifeRows.length >= 4 ? fitExtendedTaylor(lifeRows) : null; } catch { ext = null; }
        calBox.append(h('h3', {}, 'Taylor calibration'), kv([['n', fmt(tf.n, 4)], ['C', `${fmt(tf.C, 5)} m/min`], ['R²', fmt(tf.R2, 4)], ['Extended (m, p)', ext ? `n ${fmt(ext.n, 4)}, C ${fmt(ext.C, 5)}, m ${fmt(ext.m, 4)}, p ${fmt(ext.p, 4)}, R² ${fmt(ext.R2, 4)}` : 'needs ≥ 4 rows with varied f, ap']]));
        this._lastTaylor = ext || tf;
      } catch (e) { calBox.append(h('div', { class: 'warn' }, e.message)); }
    }
    this.cmpEl.replaceChildren(h('h3', {}, `Model comparison — ${lib.material(this.s.material).name}, ${tool.name}`), table(['Quantity', 'n', 'MAE', 'RMSE', 'MAPE', 'R²', 'Validation subset RMSE / MAPE'], out), h('div', { class: 'note' }, 'Predictions use the closed-form turning model (M-TURN-01) with the library coefficients and their stated status.'), calBox);
  }
  _saveCalibrated(k, mu, mv) {
    const base = lib.material(this.s.material);
    const id = `${base.id}-cal-${Date.now().toString(36)}`;
    const src = `Calibrated in MachinaSim from ${this.s.fileName} on ${new Date().toISOString().slice(0, 10)}${mv ? `; validation RMSE ${fmt(mv.RMSE, 4)} N` : ''}`;
    const m = structuredClone(base);
    m.id = id; m.name = `${base.name} (calibrated)`;
    m.kienzle = { kc11: { value: +k.kc11.toFixed(2), unit: 'N/mm²', status: 'calibrated', source: src }, mc: { value: +k.mc.toFixed(4), unit: '-', status: 'calibrated', source: src } };
    if (mu != null) m.frictionMu = { value: +mu.toFixed(3), unit: '-', status: 'calibrated', source: src };
    lib.customMaterials.push(m); lib.save();
    toast(`Saved “${m.name}” — available in every workspace material list (reload a workspace’s list to see it).`, 'ok');
  }

  // ---------------- time-series ----------------
  _seriesTab() {
    const st = { src: 'lathe.Fc', tcol: '', ycol: '', shift: 0 };
    this.ts = st;
    this.tsInfo = h('div'); this.tsMap = h('div');
    this.cTS = new Chart({ title: 'Measured vs simulated', xLabel: 'Time (s)', yLabel: 'Signal' });
    const load = h('button', { class: 'btn primary', type: 'button', onclick: async () => { const f = await pickFile('.csv,.txt,.xlsx'); if (!f) return; try { st.data = await readTable(f); this._tsMapUI(); } catch (e) { toast(e.message, 'error'); } } }, 'Import measured signal');
    return h('div', { class: 'two' }, h('div', { class: 'box' }, h('p', { class: 'muted' }, 'Compare a measured time series (dynamometer, thermocouple, power meter) with the simulated history of an open workspace. The simulated signal is interpolated at the measured time stamps.'), load,
      selectField(st, 'src', [['lathe.Fc', 'Lathe Fc'], ['lathe.Ff', 'Lathe Ff'], ['lathe.Fp', 'Lathe Fp'], ['lathe.P', 'Lathe power'], ['lathe.Tint', 'Lathe interface T'], ['lathe.VB', 'Lathe VB'], ['drill.thrust', 'Drill thrust'], ['drill.torque', 'Drill torque'], ['mill.Fx', 'Mill Fx (mean/rev)'], ['mill.Fy', 'Mill Fy'], ['mill.P', 'Mill power']].map(([v, l]) => ({ value: v, label: l })), { label: 'Simulated signal', onChange: () => this._tsCompare() }),
      numField(st, 'shift', { label: 'Time shift applied to measurement', unit: 's', onChange: () => this._tsCompare() }), this.tsMap), h('div', { class: 'box' }, this.cTS.el, this.tsInfo));
  }
  _tsMapUI() {
    const st = this.ts, d = st.data;
    st.tcol = d.headers[0]; st.ycol = d.headers[1] || d.headers[0];
    const opts = d.headers.map((x) => ({ value: x, label: x }));
    this.tsMap.replaceChildren(selectField(st, 'tcol', opts, { label: 'Time column (s)', onChange: () => this._tsCompare() }), selectField(st, 'ycol', opts, { label: 'Value column', onChange: () => this._tsCompare() }));
    this._tsCompare();
  }
  _tsCompare() {
    const st = this.ts; if (!st.data) return;
    const [page, key] = st.src.split('.');
    const p = this.app.pages[page];
    if (!p) { this.tsInfo.replaceChildren(h('div', { class: 'warn' }, `Open the ${page} workspace and run a simulation first.`)); return; }
    const H = p.sim.hist;
    const xs = H.t, ys = H[key].map((v) => (v == null ? NaN : v));
    const mt = st.data.rows.map((r) => r[st.tcol] + st.shift), my = st.data.rows.map((r) => r[st.ycol]);
    const ok = mt.map((t, i) => (Number.isFinite(t) && Number.isFinite(my[i]) && t >= xs[0] && t <= xs[xs.length - 1] ? i : -1)).filter((i) => i >= 0);
    const pred = ok.map((i) => interp(xs, ys, mt[i]));
    const m = ok.length ? errorMetrics(ok.map((i) => my[i]), pred) : null;
    this.cTS.setData([{ name: 'measured', x: mt, y: my, color: '#111827', points: mt.length < 300 }, { name: 'simulated', x: xs, y: ys, color: '#dc2626' }]);
    this.tsInfo.replaceChildren(m ? kv([['Overlapping samples', String(m.n)], ['MAE', fmt(m.MAE, 4)], ['RMSE', fmt(m.RMSE, 4)], ['MAPE', `${fmt(m.MAPE, 3)} %`], ['R²', fmt(m.R2, 4)], ['Bias (sim − meas)', fmt(m.bias, 4)], ['Best scale factor k (meas ≈ k·sim)', fmt(fitScale(ok.map((i) => my[i]), pred), 4)]]) : h('div', { class: 'warn' }, 'No overlapping time range.'));
  }

  // ---------------- DOE ----------------
  _doeTab() {
    const d = { design: 'full', V: [100, 150, 200], f: [0.1, 0.2, 0.3], ap: [0.5, 1.5, 2.5], response: 'Fc', D: 50 };
    this.doe = d;
    this.doeOut = h('div');
    this.cME = new Chart({ title: 'Main effects', xLabel: 'Level index (1 = low, 3 = high)', yLabel: 'Mean response' });
    const lvl = (k, label, unit) => h('div', { class: 'grid3' }, [0, 1, 2].map((i) => numField(d[k], i, { label: `${label} L${i + 1}`, unit })));
    return h('div', { class: 'two' }, h('div', { class: 'box' },
      h('p', { class: 'muted' }, 'Virtual experiments with the turning model for the material and tool selected in “Experiments & validation”. Responses: Fc, power, MRR, theoretical Ra, Taylor life, rake-face temperature.'),
      selectField(d, 'design', [{ value: 'full', label: 'Full factorial 3³ (27 runs)' }, { value: 'L9', label: 'Taguchi L9 (9 runs)' }], { label: 'Design' }),
      lvl('V', 'V', 'm/min'), lvl('f', 'f', 'mm/rev'), lvl('ap', 'ap', 'mm'), numField(d, 'D', { label: 'Workpiece Ø', unit: 'mm' }),
      selectField(d, 'response', ['Fc', 'P', 'MRR', 'Ra', 'T', 'Temp'].map((x) => ({ value: x, label: x })), { label: 'Response for ANOVA / RSM' }),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'button', onclick: () => this._runDOE() }, 'Run design'), h('button', { class: 'btn', type: 'button', onclick: () => this._doeRuns && download('doe_runs.csv', toCSV(Object.keys(this._doeRuns[0]), this._doeRuns), 'text/csv') }, 'Export runs CSV'))),
      h('div', { class: 'box' }, this.cME.el, this.doeOut));
  }
  _evalTurning(V, f, ap, D) {
    const mat = this.mat, tool = this.tool;
    const r = turningNominal({ mat, tool, V, f, ap, D });
    const tay = defaultTaylor(tool.material, lib.material(this.s.material));
    const th = cuttingTemperature({ mat, Fc: r.Fc, Fth: Math.hypot(r.Ff, r.Fp), gamma: tool.rake ?? 0, V, h: r.h, b: r.b });
    return { Fc: r.Fc, P: r.power, MRR: r.mrr / 1000, Ra: theoreticalRoughness(f, tool.rn, tool.kr, tool.krMinor).Ra, T: taylorLife(V, f, ap, this._lastTaylor || tay), Temp: th ? th.TrakeMax : NaN };
  }
  _runDOE() {
    const d = this.doe;
    const factors = [{ name: 'V', levels: d.V.map(Number) }, { name: 'f', levels: d.f.map(Number) }, { name: 'ap', levels: d.ap.map(Number) }];
    let runs;
    try { runs = d.design === 'full' ? fullFactorial(factors) : taguchiDesign(factors, 'L9'); } catch (e) { toast(e.message, 'error'); return; }
    runs = runs.map((r) => ({ ...r, ...this._evalTurning(r.V, r.f, r.ap, d.D) }));
    this._doeRuns = runs;
    const resp = d.response;
    if (runs.some((r) => !Number.isFinite(r[resp]))) { toast(`Response ${resp} is not available for all runs (missing model constants)`, 'warn'); }
    const an = anovaMainEffects(runs, ['V', 'f', 'ap'], resp);
    const coded = (v, lv) => (2 * (v - lv[0])) / (lv[2] - lv[0]) - 1;
    let rsm = null; try { rsm = fitRSM(runs.map((r) => [coded(r.V, factors[0].levels), coded(r.f, factors[1].levels), coded(r.ap, factors[2].levels)]), runs.map((r) => r[resp])); } catch (e) { rsm = null; }
    this.cME.setData(an.rows.map((row) => ({ name: row.factor, x: [1, 2, 3].slice(0, row.levels.length), y: row.levels.sort((a, b) => a.level - b.level).map((l) => l.mean), points: true })), { yLabel: `Mean ${resp}` });
    const sn = d.design === 'L9' ? runs.map((r) => snRatio([r[resp]], resp === 'MRR' || resp === 'T' ? 'larger' : 'smaller')) : null;
    this.doeOut.replaceChildren(
      h('h3', {}, `ANOVA (main effects) — ${resp}`), table(['Source', 'SS', 'dof', 'MS', 'F', '% contribution'], [...an.rows.map((r) => [r.factor, fmt(r.SS, 4), r.dof, fmt(r.MS, 4), fmt(r.F, 4), fmt(r.contribution, 3)]), ['Residual', fmt(an.error.SS, 4), an.error.dof, fmt(an.error.MS, 4), '', fmt(an.error.contribution, 3)]]),
      h('div', { class: 'note' }, 'Deterministic virtual experiments: the residual is model non-additivity (interactions/curvature), not experimental error — F-ratios are descriptive only.'),
      rsm ? h('div', {}, h('h3', {}, 'Second-order response surface (coded −1…+1)'), table(['Term', 'Coefficient'], rsm.names.map((n, i) => [n.replace(/x1/g, 'V').replace(/x2/g, 'f').replace(/x3/g, 'ap'), fmt(rsm.beta[i], 5)])), kv([['R²', fmt(rsm.R2, 5)]])) : h('div'),
      h('h3', {}, 'Runs'), h('div', { class: 'scroll' }, table(['V', 'f', 'ap', 'Fc N', 'P kW', 'MRR cm³/min', 'Ra µm', 'T min', 'T_rake °C', ...(sn ? ['S/N dB'] : [])], runs.map((r, i) => [r.V, r.f, r.ap, fmt(r.Fc, 4), fmt(r.P, 3), fmt(r.MRR, 4), fmt(r.Ra, 3), fmt(r.T, 3), fmt(r.Temp, 4), ...(sn ? [fmt(sn[i], 4)] : [])]))));
  }

  // ---------------- optimisation ----------------
  _optTab() {
    const o = { obj: 'cost', Vmin: 60, Vmax: 350, fmin: 0.05, fmax: 0.5, apmin: 0.5, apmax: 4, D: 50, Fmax: 3000, Pmax: 7.5, Ramax: 3.2, Tmin: 10, Tempmax: null, volume: 50, machineRate: 1.0, toolCost: 6, changeTime: 2, edges: 1 };
    this.opt = o;
    this.optOut = h('div');
    this.cPar = new Chart({ title: 'Pareto front: productivity vs tool life (feasible designs)', xLabel: 'MRR (cm³/min)', yLabel: 'Tool life T (min)', type: 'scatter', height: 300 });
    return h('div', { class: 'two' }, h('div', { class: 'box' },
      selectField(o, 'obj', [{ value: 'cost', label: 'Minimise cost per part (machining + tool)' }, { value: 'time', label: 'Minimise machining time (max MRR)' }, { value: 'life', label: 'Maximise tool life' }, { value: 'energy', label: 'Minimise cutting energy per part' }, { value: 'ra', label: 'Minimise theoretical Ra' }], { label: 'Objective' }),
      h('div', { class: 'subhead' }, 'Bounds (never exceeded)'),
      h('div', { class: 'grid2' }, numField(o, 'Vmin', { label: 'V min', unit: 'm/min' }), numField(o, 'Vmax', { label: 'V max', unit: 'm/min' }), numField(o, 'fmin', { label: 'f min', unit: 'mm/rev' }), numField(o, 'fmax', { label: 'f max', unit: 'mm/rev' }), numField(o, 'apmin', { label: 'ap min', unit: 'mm' }), numField(o, 'apmax', { label: 'ap max', unit: 'mm' })),
      h('div', { class: 'subhead' }, 'Constraints'),
      h('div', { class: 'grid2' }, numField(o, 'Fmax', { label: 'Max Fc', unit: 'N' }), numField(o, 'Pmax', { label: 'Max power', unit: 'kW' }), numField(o, 'Ramax', { label: 'Max Ra', unit: 'µm' }), numField(o, 'Tmin', { label: 'Min tool life', unit: 'min' }), numField(o, 'Tempmax', { label: 'Max rake T (optional)', unit: '°C', allowEmpty: true, help: 'Reduced-order estimate (upper bound); leave empty to ignore' }), numField(o, 'D', { label: 'Workpiece Ø', unit: 'mm' })),
      h('div', { class: 'subhead' }, 'Economics (user values)'),
      h('div', { class: 'grid2' }, numField(o, 'volume', { label: 'Volume to remove', unit: 'cm³' }), numField(o, 'machineRate', { label: 'Machine + labour rate', unit: 'cost/min' }), numField(o, 'toolCost', { label: 'Cost per cutting edge', unit: 'cost' }), numField(o, 'changeTime', { label: 'Tool change time', unit: 'min' })),
      h('button', { class: 'btn primary', type: 'button', onclick: () => this._optimise() }, 'Optimise (GA)')),
      h('div', { class: 'box' }, this.optOut, this.cPar.el));
  }
  _optimise() {
    const o = this.opt;
    const tay = this._lastTaylor || defaultTaylor(this.tool.material, lib.material(this.s.material));
    if (!tay) { toast('Tool life constants are needed (calibrate Taylor first or choose a tool material with defaults).', 'error'); return; }
    const ev = (x) => {
      const [V, f, ap] = x;
      const r = this._evalTurning(V, f, ap, o.D);
      const viol = Math.max(0, r.Fc / o.Fmax - 1) + Math.max(0, r.P / o.Pmax - 1) + Math.max(0, r.Ra / o.Ramax - 1) + Math.max(0, o.Tmin / r.T - 1) + (o.Tempmax && Number.isFinite(r.Temp) ? Math.max(0, r.Temp / o.Tempmax - 1) : 0);
      const tm = o.volume / r.MRR; // min
      const edgesUsed = tm / r.T;
      const cost = tm * o.machineRate + edgesUsed * (o.toolCost + o.changeTime * o.machineRate);
      const energy = r.P * tm * 60; // kJ
      return { ...r, V, f, ap, tm, cost, energy, viol };
    };
    const obj = (e) => ({ cost: e.cost, time: e.tm, life: -e.T, energy: e.energy, ra: e.Ra })[o.obj];
    const f = (x) => { const e = ev(x); return e.viol > 0 ? 1e9 * (1 + e.viol) : obj(e); };
    const res = geneticAlgorithm(f, [[o.Vmin, o.Vmax], [o.fmin, o.fmax], [o.apmin, o.apmax]], { pop: 60, gens: 80, seed: 7 });
    const best = ev(res.best.x);
    // Pareto sampling
    const R = rng(3); const pts = [];
    for (let k = 0; k < 1500; k++) { const x = [o.Vmin + R() * (o.Vmax - o.Vmin), o.fmin + R() * (o.fmax - o.fmin), o.apmin + R() * (o.apmax - o.apmin)]; const e = ev(x); if (e.viol === 0) pts.push({ ...e, negMRR: -e.MRR, negT: -e.T }); }
    const front = paretoFront(pts, ['negMRR', 'negT']).sort((a, b) => a.MRR - b.MRR);
    this.cPar.setData([{ name: 'feasible', x: pts.map((p) => p.MRR), y: pts.map((p) => p.T), color: '#cbd5e1', points: true }, { name: 'Pareto front', x: front.map((p) => p.MRR), y: front.map((p) => p.T), color: '#dc2626', points: true }, { name: 'GA optimum', x: [best.MRR], y: [best.T], color: '#111827', points: true, marker: 'diamond' }]);
    this.optOut.replaceChildren(...(best.viol > 0 ? [h('div', { class: 'warn' }, 'No feasible solution satisfies all constraints within the bounds.')] : []),
      h('h3', {}, 'Optimum'), kv([['V', `${fmt(best.V, 4)} m/min`], ['f', `${fmt(best.f, 4)} mm/rev`], ['ap', `${fmt(best.ap, 4)} mm`], ['Fc', `${fmt(best.Fc, 4)} N`], ['Power', `${fmt(best.P, 3)} kW`], ['MRR', `${fmt(best.MRR, 4)} cm³/min`], ['Ra (theoretical)', `${fmt(best.Ra, 3)} µm`], ['Tool life', `${fmt(best.T, 4)} min`], ['Machining time', `${fmt(best.tm, 4)} min`], ['Cost per part', fmt(best.cost, 4)], ['Constraint violation', best.viol > 0 ? fmt(best.viol, 3) : 'none']]),
      h('div', { class: 'note' }, `Taylor constants: ${tay.status || 'calibrated'}${tay.source ? ' — ' + tay.source.split('(')[0] : ''}. Optimum is only as good as the model constants. ${pts.length} random feasible designs; ${front.length} non-dominated.`));
  }

  // ---------------- uncertainty ----------------
  _uncTab() {
    const u = { V: 150, f: 0.2, ap: 2, D: 50, ukc: 10, umc: 0.03, umu: 0.15, n: 3000 };
    this.unc = u; this.uncOut = h('div');
    this.cHist = new Chart({ title: 'Monte-Carlo distribution of Fc', xLabel: 'Fc (N)', yLabel: 'Count', type: 'bar' });
    return h('div', { class: 'two' }, h('div', { class: 'box' }, h('p', { class: 'muted' }, 'Propagates coefficient uncertainty (normal distributions) through the turning model.'),
      h('div', { class: 'grid2' }, numField(u, 'V', { label: 'V', unit: 'm/min' }), numField(u, 'f', { label: 'f', unit: 'mm/rev' }), numField(u, 'ap', { label: 'ap', unit: 'mm' }), numField(u, 'D', { label: 'D', unit: 'mm' }), numField(u, 'ukc', { label: 'σ(kc1.1)', unit: '%' }), numField(u, 'umc', { label: 'σ(mc)', unit: 'abs' }), numField(u, 'umu', { label: 'σ(μ)', unit: 'abs' }), numField(u, 'n', { label: 'Samples', unit: '–', step: 1, min: 100, max: 50000 })),
      h('button', { class: 'btn primary', type: 'button', onclick: () => this._mc() }, 'Run Monte Carlo')), h('div', { class: 'box' }, this.cHist.el, this.uncOut));
  }
  _mc() {
    const u = this.unc, base = this.mat, tool = this.tool, R = rng(11);
    const g = () => { let a = 0, b = 0; while (a === 0) a = R(); while (b === 0) b = R(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
    const F = [], P = [];
    for (let k = 0; k < u.n; k++) {
      const mat = { ...base, kc11: base.kc11 * (1 + (u.ukc / 100) * g()), mc: Math.max(0.01, base.mc + u.umc * g()), mu: Math.max(0.05, base.mu + u.umu * g()) };
      const r = turningNominal({ mat, tool, V: u.V, f: u.f, ap: u.ap, D: u.D });
      F.push(r.Fc); P.push(Math.hypot(r.Ff, r.Fp));
    }
    const st = (a) => { const s = [...a].sort((x, y) => x - y); const m = a.reduce((p, c) => p + c, 0) / a.length; const sd = Math.sqrt(a.reduce((p, c) => p + (c - m) ** 2, 0) / (a.length - 1)); return { m, sd, lo: s[Math.floor(0.025 * s.length)], hi: s[Math.floor(0.975 * s.length)] }; };
    const sf = st(F), sp = st(P);
    const nb = 30, lo = Math.min(...F), hi = Math.max(...F), w = (hi - lo) / nb || 1;
    const cnt = new Array(nb).fill(0); F.forEach((v) => cnt[Math.min(nb - 1, Math.floor((v - lo) / w))]++);
    this.cHist.setData([{ name: 'Fc', x: cnt.map((_, i) => lo + (i + 0.5) * w), y: cnt, color: '#2563eb' }]);
    this.uncOut.replaceChildren(kv([['Fc mean ± σ', `${fmt(sf.m, 4)} ± ${fmt(sf.sd, 3)} N`], ['Fc 95 % interval', `${fmt(sf.lo, 4)} – ${fmt(sf.hi, 4)} N`], ['Thrust (Ff,Fp) mean ± σ', `${fmt(sp.m, 4)} ± ${fmt(sp.sd, 3)} N`], ['Thrust 95 % interval', `${fmt(sp.lo, 4)} – ${fmt(sp.hi, 4)} N`]]));
  }
  serialize() { return { s: { material: this.s.material, toolId: this.s.toolId }, doe: this.doe, opt: this.opt, unc: this.unc }; }
  restore(d) { Object.assign(this.s, d.s || {}); Object.assign(this.doe, d.doe || {}); Object.assign(this.opt, d.opt || {}); Object.assign(this.unc, d.unc || {}); }
}
