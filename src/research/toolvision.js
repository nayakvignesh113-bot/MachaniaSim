// ToolVision: classical image analysis of flank wear (M-VIS-01). Pure functions on ImageData-like objects
// {width, height, data: Uint8ClampedArray RGBA}. No trained neural network is shipped (stated in the UI).

export function toGray(img) {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
  return g;
}

/** Otsu threshold of a list of grey values (0–255). Returns {t, eta} (eta = separability 0–1). */
export function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const n = values.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 127, varT = 0;
  const mu = sum / n;
  for (let i = 0; i < 256; i++) varT += hist[i] * (i - mu) ** 2;
  varT /= n;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const between = (wB / n) * (wF / n) * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return { t, eta: varT > 0 ? best / varT : 0 };
}

/**
 * Measure flank wear below a cutting-edge line.
 * @param img ImageData-like
 * @param edge {x1,y1,x2,y2} cutting-edge line in px (user-drawn)
 * @param o {depth: search depth px perpendicular to edge, side: +1|−1 (which side is the flank), umPerPx, umPerPxUnc, samples}
 */
export function measureFlankWear(img, edge, o = {}) {
  const g = toGray(img);
  const W = img.width, H = img.height;
  const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1;
  const L = Math.hypot(dx, dy);
  if (L < 5) throw new Error('Edge line too short');
  const tx = dx / L, ty = dy / L;
  const side = o.side ?? 1;
  const nx = -ty * side, ny = tx * side; // perpendicular toward the flank
  const depth = o.depth ?? 120;
  const S = o.samples ?? Math.min(400, Math.floor(L));
  const at = (x, y) => { const i = Math.round(x), j = Math.round(y); return i < 0 || j < 0 || i >= W || j >= H ? null : g[j * W + i]; };
  // ROI statistics for Otsu
  const roi = [];
  for (let s = 0; s < S; s++) { const u = (s + 0.5) / S * L; for (let d = 0; d < depth; d += 2) { const v = at(edge.x1 + tx * u + nx * d, edge.y1 + ty * u + ny * d); if (v != null) roi.push(v); } }
  if (roi.length < 50) throw new Error('ROI outside image');
  const { t, eta } = otsu(roi);
  const bright = o.wearIsBright ?? true;
  const isWear = (v) => (bright ? v > t : v < t);
  const widths = [];
  let clear = 0;
  for (let s = 0; s < S; s++) {
    const u = (s + 0.5) / S * L;
    let w = 0, gap = 0, ended = false;
    for (let d = 0; d < depth; d++) {
      const v = at(edge.x1 + tx * u + nx * d, edge.y1 + ty * u + ny * d);
      if (v == null) break;
      if (isWear(v)) { w = d + 1; gap = 0; } else if (++gap > 3) { ended = true; break; }
    }
    if (ended) clear++;
    widths.push(w);
  }
  const k = o.umPerPx ?? null;
  const mean = widths.reduce((a, b) => a + b, 0) / widths.length;
  const sd = Math.sqrt(widths.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, widths.length - 1));
  const max = Math.max(...widths);
  // damage heuristics
  const flags = [];
  const n10 = Math.max(3, Math.floor(widths.length * 0.1));
  const endMean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  if (endMean(widths.slice(-n10)) > 1.6 * mean || endMean(widths.slice(0, n10)) > 1.6 * mean) flags.push('Possible notch wear near an end of the edge (depth-of-cut line)');
  for (let i = 2; i < widths.length - 2; i++) if (Math.abs(widths[i] - (widths[i - 2] + widths[i + 2]) / 2) > Math.max(4 * sd, 6)) { flags.push('Abrupt local land-width change — possible edge chipping'); break; }
  const confidence = Math.max(0, Math.min(1, eta)) * (clear / S);
  const res = { threshold: t, separability: eta, confidence, widthsPx: widths, VBpx: mean, VBmaxPx: max, sdPx: sd, flags, samples: S, edgeLengthPx: L };
  if (k) {
    const unc = o.umPerPxUnc ?? 0;
    res.VB = (mean * k) / 1000; res.VBmax = (max * k) / 1000; // mm
    res.area = (widths.reduce((a, b) => a + b, 0) * (L / S) * k * k) / 1e6; // mm²
    // uncertainty: ±1 px edge-location quantisation ⊕ calibration ⊕ standard error of the mean
    const uPx = Math.sqrt(1 + (sd / Math.sqrt(S)) ** 2);
    res.uVB = (Math.sqrt((uPx * k) ** 2 + (mean * unc) ** 2)) / 1000;
  }
  return res;
}

/** Scale calibration from a user-drawn line of known length. */
export function calibrate(px, knownUm, pxUnc = 1) {
  return { umPerPx: knownUm / px, rel: pxUnc / px, umPerPxUnc: (knownUm / px) * (pxUnc / px) };
}

/** Synthetic test image: dark flank with a bright wear land of given width (px) under a horizontal edge at y0. */
export function syntheticWearImage(W, H, y0, landPx, noise = 8, seed = 7) {
  let a = seed;
  const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = j < y0 ? 30 : j < y0 + landPx(i) ? 200 : 70;
    v += (rnd() - 0.5) * 2 * noise;
    const p = 4 * (j * W + i); data[p] = data[p + 1] = data[p + 2] = v; data[p + 3] = 255;
  }
  return { width: W, height: H, data };
}
