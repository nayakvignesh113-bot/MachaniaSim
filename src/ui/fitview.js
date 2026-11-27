// Display of a calibration fit: parameter estimates with 95 % confidence intervals and a residual plot.
import { h, table } from './dom.js';
import { Chart } from './chart.js';
import { outliers } from '../research/stats.js';

const f = (v, d = 4) => (Number.isFinite(v) ? String(+v.toPrecision(d)) : '—');

/**
 * @param fit    result of a stats.js fitter (with .ci, .dof, .residuals, .residualLabel)
 * @param params [[key, label, unit, digits?], …]
 * @param title  residual chart title
 */
export function fitView(fit, params, title = 'Residuals') {
  const rows = params.map(([k, label, unit, d = 5]) => {
    const c = fit.ci?.[k];
    return [label, `${f(fit[k], d)}${unit ? ` ${unit}` : ''}`, c ? `${f(c[0], d)} … ${f(c[1], d)}` : 'n/a (no degrees of freedom)'];
  });
  const note = fit.dof > 0
    ? `95 % confidence intervals from the least-squares covariance with Student-t (${fit.dof} degrees of freedom)${fit.ciMethod ? `; ${fit.ciMethod} for parameters that are nonlinear functions of the regression coefficients` : ''}. Intervals of parameters fitted on a log scale are asymmetric. They describe scatter within this data set only, not bias from model form or from conditions outside the tested range.`
    : 'With as many data points as fitted parameters the fit is exact and has no uncertainty estimate: add repeats or more levels.';
  const out = [table(['Parameter', 'Estimate', '95 % CI'], rows), h('div', { class: 'note' }, note)];
  if (fit.residuals?.length) {
    const ch = new Chart({ title, xLabel: fit.residualLabel?.x || 'x', yLabel: fit.residualLabel?.y || 'Residual', type: 'scatter', height: 200 });
    const xs = fit.residuals.map((r) => r.x), lo = Math.min(...xs), hi = Math.max(...xs);
    ch.setData([{ name: 'measured − fitted', x: xs, y: fit.residuals.map((r) => r.res), points: true }, { name: 'zero', x: [lo, hi], y: [0, 0], color: '#9ca3af', dash: [4, 4] }]);
    out.push(ch.el);
    const big = outliers(fit).map((i) => fit.residuals[i]);
    if (big.length) out.push(h('div', { class: 'warn' }, `${big.length} point(s) lie beyond 2.5 standard errors of the fit (at ${fit.residualLabel?.x?.split(' ')[0] || 'x'} = ${big.map((r) => f(r.x, 4)).join(', ')}): check these runs for measurement or recording errors. Do not delete them only because they are flagged.`));
  }
  return h('div', { class: 'fitview' }, ...out);
}
