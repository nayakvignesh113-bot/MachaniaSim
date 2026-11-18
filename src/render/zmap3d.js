// Height-field workpiece mesh (top surface + side walls + bottom) with dirty-region updates.
import { THREE, MAT } from './scene.js';

export class ZMapMesh {
  constructor(zm, { maxCells = 160000 } = {}) {
    this.zm = zm;
    // render decimation (k) keeps vertex count bounded on mobile
    this.k = Math.max(1, Math.ceil(Math.sqrt((zm.nx * zm.ny) / maxCells)));
    this.nx = Math.floor((zm.nx - 1) / this.k) + 1; this.ny = Math.floor((zm.ny - 1) / this.k) + 1;
    const n = this.nx * this.ny;
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) { const v = j * this.nx + i; this.pos[3 * v] = zm.x(i * this.k); this.pos[3 * v + 2] = zm.y(j * this.k); }
    this.top = new THREE.BufferGeometry();
    this.top.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.top.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    this.mat = MAT.work();
    this.group = new THREE.Group();
    this.topMesh = new THREE.Mesh(this.top, this.mat);
    this.group.add(this.topMesh);
    this.sides = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.group.add(this.sides);
    this.full();
  }
  /** Scene mapping: block x → scene x, block y → scene z, height → scene y. */
  full() { this._update(0, this.nx - 1, 0, this.ny - 1); this._index(); this._sides(); }
  refresh() {
    const zm = this.zm;
    if (!zm.dirty) return;
    const d = zm.dirty; zm.dirty = null;
    const k = this.k;
    this._update(Math.max(0, Math.floor(d.i0 / k) - 1), Math.min(this.nx - 1, Math.ceil(d.i1 / k) + 1), Math.max(0, Math.floor(d.j0 / k) - 1), Math.min(this.ny - 1, Math.ceil(d.j1 / k) + 1));
    if (zm.holesChanged) { zm.holesChanged = false; this._index(); }
    if (d.i0 <= 0 || d.j0 <= 0 || d.i1 >= zm.nx - 1 || d.j1 >= zm.ny - 1) this._sides();
  }
  _hz(i, j) { return this.zm.get(Math.min(this.zm.nx - 1, i * this.k), Math.min(this.zm.ny - 1, j * this.k)); }
  _update(i0, i1, j0, j1) {
    const { nx, ny } = this, g = this.zm.g * this.k;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.pos[3 * (j * nx + i) + 1] = this._hz(i, j);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const hl = this._hz(Math.max(0, i - 1), j), hr = this._hz(Math.min(nx - 1, i + 1), j);
      const hd = this._hz(i, Math.max(0, j - 1)), hu = this._hz(i, Math.min(ny - 1, j + 1));
      const nxv = -(hr - hl) / (2 * g), nzv = -(hu - hd) / (2 * g);
      const l = Math.hypot(nxv, 1, nzv);
      const v = 3 * (j * nx + i);
      this.nor[v] = nxv / l; this.nor[v + 1] = 1 / l; this.nor[v + 2] = nzv / l;
    }
    this.top.attributes.position.needsUpdate = true; this.top.attributes.normal.needsUpdate = true;
    this.top.computeBoundingSphere();
  }
  _index() {
    const { nx, ny } = this; const idx = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      // drop cells cut through to the table (through holes / parted regions)
      if (this._hz(i, j) <= 1e-4 && this._hz(i + 1, j) <= 1e-4 && this._hz(i, j + 1) <= 1e-4 && this._hz(i + 1, j + 1) <= 1e-4) continue;
      idx.push(a, c, b, b, c, d);
    }
    this.top.setIndex(idx);
  }
  _sides() {
    const { nx, ny } = this; const pos = [], nor = [], idx = [];
    const wall = (pts, n) => {
      const base = pos.length / 3;
      for (const [x, z, hgt] of pts) { pos.push(x, hgt, z, x, 0, z); nor.push(...n, ...n); }
      for (let k = 0; k < pts.length - 1; k++) { const a = base + 2 * k; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    };
    const X = (i) => this.pos[3 * i], Z = (j) => this.pos[3 * j * nx + 2];
    wall(Array.from({ length: nx }, (_, i) => [X(i), Z(0), this._hz(i, 0)]), [0, 0, -1]);
    wall(Array.from({ length: nx }, (_, i) => [X(i), Z(ny - 1), this._hz(i, ny - 1)]).reverse(), [0, 0, 1]);
    wall(Array.from({ length: ny }, (_, j) => [X(0), Z(j), this._hz(0, j)]).reverse(), [-1, 0, 0]);
    wall(Array.from({ length: ny }, (_, j) => [X(nx - 1), Z(j), this._hz(nx - 1, j)]), [1, 0, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    this.sides.geometry.dispose(); this.sides.geometry = g;
  }
  dispose() { this.top.dispose(); this.sides.geometry.dispose(); }
}
