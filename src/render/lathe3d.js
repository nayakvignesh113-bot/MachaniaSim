// 3-D centre lathe: machine model, live workpiece mesh from the axisymmetric geometry engine,
// tool mesh extruded from the actual tool outline, kinematic chain (saddle → cross-slide → compound → tool post).
// Scene mapping: spindle axis = +X (chuck face at x = 0), up = +Y, radial tool direction (toward operator) = +Z.
import { THREE, Viewport, MAT, box, cyl, forceArrow } from './scene.js';

const HC = 260; // centre height above bed datum, mm
const NTH = 72; // circumferential segments

export class Lathe3D {
  constructor(host) {
    this.vp = new Viewport(host, { target: [80, HC - 40, 0], camPos: [330, HC + 430, 980] });
    this.root = new THREE.Group(); this.vp.scene.add(this.root);
    this._buildMachine();
    this.spin = new THREE.Group(); this.spin.position.set(0, HC, 0); this.root.add(this.spin);
    this.workMat = MAT.work();
    this.workMesh = null;
    this.angle = 0; this.rpm = 0;
    this.arrows = { Fc: forceArrow(0xdc2626), Ff: forceArrow(0x2563eb), Fp: forceArrow(0x059669) };
    Object.values(this.arrows).forEach((a) => this.vp.scene.add(a));
    this.forceScale = 0.08;
    this.vp.onFrame = () => this._frame();
    this._last = performance.now();
  }
  dispose() { this.vp.dispose(); }

  _buildMachine() {
    const R = this.root;
    const cast = MAT.casting(), dark = MAT.castingDark(), steel = MAT.steel(), black = MAT.dark();
    // bed with ways
    R.add(box(1500, 90, 300, cast, 300, 45, -40));
    R.add(box(1500, 22, 34, steel, 300, 101, 60)); R.add(box(1500, 22, 34, steel, 300, 101, -140));
    // legs / stand
    R.add(box(260, 380, 320, dark, -280, -190, -40)); R.add(box(220, 380, 320, dark, 920, -190, -40));
    R.add(box(1500, 20, 360, black, 300, -10, -40)); // chip tray
    // headstock
    R.add(box(330, 300, 300, cast, -245, 250, -40));
    R.add(box(80, 70, 6, black, -245, 340, 112)); // speed plate
    for (let k = 0; k < 3; k++) { const kn = cyl(10, 30, black, 16); kn.rotation.x = Math.PI / 2; kn.position.set(-320 + k * 75, 200, 125); R.add(kn); }
    // spindle nose + chuck (rotating group added later)
    this.chuck = new THREE.Group(); this.chuck.position.set(0, HC, 0); R.add(this.chuck);
    const body = cyl(85, 70, steel, 48); body.rotation.z = Math.PI / 2; body.position.x = -45; this.chuck.add(body);
    const back = cyl(60, 30, dark, 32); back.rotation.z = Math.PI / 2; back.position.x = -90; this.chuck.add(back);
    this.jaws = [];
    for (let k = 0; k < 3; k++) { const j = new THREE.Group(); const jb = box(30, 26, 22, black, 12, 0, 0); j.add(jb); j.rotation.x = (k * 2 * Math.PI) / 3; this.chuck.add(j); this.jaws.push(jb); }
    // tailstock
    this.tail = new THREE.Group(); R.add(this.tail);
    this.tail.add(box(180, 120, 240, cast, 90, 172, -40));
    const tb = cyl(55, 170, cast, 32); tb.rotation.z = Math.PI / 2; tb.position.set(85, HC, 0); this.tail.add(tb);
    this.quill = cyl(28, 160, steel, 24); this.quill.rotation.z = Math.PI / 2; this.quill.position.set(-20, HC, 0); this.tail.add(this.quill);
    const hw = cyl(45, 10, black, 24); hw.rotation.z = Math.PI / 2; hw.position.set(185, HC, 0); this.tail.add(hw);
    this.centre = cyl(0.1, 30, steel, 16, 14); this.centre.rotation.z = Math.PI / 2; this.centre.position.set(-115, HC, 0); this.tail.add(this.centre);
    // lead screw & feed rod along the front of the bed
    this.lead = cyl(14, 1400, steel, 16); this.lead.rotation.z = Math.PI / 2; this.lead.position.set(300, 60, 150); R.add(this.lead);
    const rod = cyl(9, 1400, steel, 12); rod.rotation.z = Math.PI / 2; rod.position.set(300, 30, 150); R.add(rod);
    // apron gearbox
    R.add(box(200, 160, 120, dark, -360, 120, 160));
    // carriage chain
    this.saddle = new THREE.Group(); R.add(this.saddle);
    this.saddle.add(box(240, 34, 360, cast, 0, 128, -40));
    this.saddle.add(box(180, 160, 30, dark, 0, 50, 155)); // apron
    const hand = cyl(40, 8, black, 24); hand.rotation.x = Math.PI / 2; hand.position.set(-50, 60, 175); this.saddle.add(hand);
    this.cross = new THREE.Group(); this.saddle.add(this.cross);
    this.cross.add(box(170, 34, 260, cast, 0, 162, 0));
    this.compound = new THREE.Group(); this.cross.add(this.compound);
    this.compound.add(box(110, 30, 150, cast, 0, 194, 0));
    this.post = new THREE.Group(); this.compound.add(this.post);
    this.post.add(box(80, 50, 80, black, 0, 229, 95));
    this.toolGroup = new THREE.Group(); this.root.add(this.toolGroup);
    // drill (held in tailstock quill)
    this.drillGroup = new THREE.Group(); this.root.add(this.drillGroup);
    // floor grid
    const grid = new THREE.GridHelper(4000, 40, 0xcfd6de, 0xdde3e9); grid.position.y = -380; this.vp.scene.add(grid);
  }

  /** Workpiece geometry → mesh (rebuild when wp.version changes). */
  setWorkpiece(wp) { this.wp = wp; this._wpv = -1; this.updateWorkpiece(true); }
  updateWorkpiece(force = false) {
    const wp = this.wp;
    if (!wp || (!force && wp.version === this._wpv)) return;
    this._wpv = wp.version;
    const geo = buildLatheGeometry(wp);
    if (this.workMesh) { this.workMesh.geometry.dispose(); this.workMesh.geometry = geo; }
    else { this.workMesh = new THREE.Mesh(geo, this.workMat); this.spin.add(this.workMesh); }
    // jaws clamp on the first 25 mm
    const Rc = wp.R[Math.min(wp.n - 1, wp.idx(10))] || wp.D0 / 2;
    this.jaws.forEach((j) => { j.position.set(12, Rc + 13, 0); });
    this._placeTail();
  }

  setSupport(s) { this.support = s; this._placeTail(); }
  _placeTail() {
    if (!this.wp) return;
    const L = this.wp.endZ();
    const engaged = this.support === 'centres' || this.support === 'chuck-centre';
    if (this.drilling) return;
    this.tail.position.x = engaged ? L + 115 : L + 380;
    this.centre.visible = engaged;
  }

  /** Tool outline → extruded insert + shank. */
  setTool(tool, outline) {
    this.drilling = tool.kind === 'drill';
    this.toolGroup.clear(); this.drillGroup.clear();
    if (this.drilling) {
      const L = tool.length ?? 120, Rd = tool.D / 2;
      const tipLen = Rd / Math.tan(((tool.pointAngle ?? 118) / 2) * Math.PI / 180);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(Rd, tipLen, 32), MAT.steel()); tip.rotation.z = Math.PI / 2; tip.position.x = tipLen / 2; this.drillGroup.add(tip);
      const fl = cyl(Rd * 0.98, L - tipLen, MAT.steel(), 24); fl.rotation.z = Math.PI / 2; fl.position.x = tipLen + (L - tipLen) / 2; this.drillGroup.add(fl);
      const helix = cyl(Rd * 1.0, L - tipLen, new THREE.MeshStandardMaterial({ color: 0x7b8794, wireframe: true }), 8); helix.rotation.z = Math.PI / 2; helix.position.x = tipLen + (L - tipLen) / 2; this.drillGroup.add(helix);
      this.drillGroup.position.y = HC;
      this.toolLen = L;
      return;
    }
    const shape = new THREE.Shape();
    const pts = outline.points;
    const step = Math.max(1, Math.floor(pts.length / 600));
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = step; i < pts.length; i += step) shape.lineTo(pts[i][0], pts[i][1]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 4.8, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // shape y → scene +z, extrude → −y
    const ins = new THREE.Mesh(geo, tool.material === 'hss' ? MAT.steel() : MAT.carbide());
    ins.position.y = 0;
    this.toolGroup.add(ins);
    const internal = outline.internal;
    if (tool.subtype === 'boring') {
      const bar = cyl((tool.barDia ?? 16) / 2, 220, MAT.dark(), 24); bar.rotation.z = Math.PI / 2; bar.position.set(outline.zmax + 110, -6, -6); this.toolGroup.add(bar);
    } else {
      const sh = box(20, 20, 120, MAT.dark(), (outline.zmin + outline.zmax) / 2 + 2, -12, outline.rmax + 58);
      this.toolGroup.add(sh);
    }
    this.toolGroup.userData.internal = internal;
  }

  /** Tool reference position in lathe coordinates (z along the axis, r radial). */
  setToolPos(z, r) {
    if (this.drilling) {
      this.drillGroup.position.set(z, HC, 0);
      this.tail.position.x = z + this.toolLen + 120;
      this.quill.position.x = -20; this.centre.visible = false;
      this.saddle.position.x = Math.max(z + 260, 250);
      return;
    }
    this.toolGroup.position.set(z, HC, r);
    // carriage follows tool (post offset)
    this.saddle.position.x = z;
    this.cross.position.z = r;
    this.compound.position.z = 0;
  }

  setForces(s) {
    if (!s || !s.cutting) { Object.values(this.arrows).forEach((a) => (a.visible = false)); return; }
    const o = this.drilling ? this.drillGroup.position.clone() : this.toolGroup.position.clone().add(new THREE.Vector3(0, 0, 0));
    const k = this.forceScale;
    if (this.drilling) {
      this.arrows.Ff.update(o, new THREE.Vector3(s.thrust || 0, 0, 0), k);
      this.arrows.Fc.visible = false; this.arrows.Fp.visible = false;
      return;
    }
    this.arrows.Fc.update(o, new THREE.Vector3(0, -(s.Fc || 0), 0), k);
    this.arrows.Ff.update(o, new THREE.Vector3(s.Ff || 0, 0, 0), k);
    this.arrows.Fp.update(o, new THREE.Vector3(0, 0, s.Fp || 0), k);
  }
  setRpm(N) { this.rpm = N; }
  setSection(on) {
    this.workMat.clippingPlanes = on ? [this.vp.clipPlane] : [];
    this.workMat.needsUpdate = true;
  }
  _frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    // displayed rotation is slowed (≤ 1 rev/s) to avoid stroboscopic aliasing; physics uses the true N.
    const vis = this.rpm > 0 ? Math.min(this.rpm / 60, 1) : 0;
    this.angle += vis * dt * 2 * Math.PI;
    this.spin.rotation.x = -this.angle; this.chuck.rotation.x = -this.angle;
    this.lead.rotation.x = -this.angle * 0.3;
    if (this.drilling) this.drillGroup.rotation.x = 0;
    this.updateWorkpiece();
  }
  viewPreset(name) {
    const L = this.wp ? this.wp.L : 200;
    if (name === 'top') this.vp.setView([L / 2, HC + 700, 1], [L / 2, HC, 0]);
    else if (name === 'front') this.vp.setView([L / 2, HC, 650], [L / 2, HC, 0]);
    else if (name === 'tool') { const p = this.toolGroup.position; this.vp.setView([p.x + 60, p.y + 70, p.z + 120], [p.x, p.y, p.z]); }
    else this.vp.setView([L / 2 + 250, HC + 430, 980], [L / 2 - 40, HC - 40, 0]);
  }
}

/** Build a BufferGeometry of the workpiece of revolution (outer + bore + faces), helical in thread zones. */
export function buildLatheGeometry(wp) {
  const pos = [], nor = [], idx = [];
  const ring = (z, r, nz, nr, th) => { pos.push(z, r * Math.cos(th), r * Math.sin(th)); nor.push(nz, nr * Math.cos(th), nr * Math.sin(th)); };
  const strip = (a, b, outward) => {
    const dz = b[0] - a[0], dr = b[1] - a[1];
    const L = Math.hypot(dz, dr); if (L < 1e-9) return;
    // outward normal of the segment in (z, r): for outer profile traversed +z → (−dr, dz)/L
    let nz = -dr / L, nr = dz / L;
    if (!outward) { nz = -nz; nr = -nr; }
    const base = pos.length / 3;
    for (let k = 0; k <= NTH; k++) { const th = (2 * Math.PI * k) / NTH; ring(a[0], a[1], nz, nr, th); ring(b[0], b[1], nz, nr, th); }
    for (let k = 0; k < NTH; k++) { const i = base + 2 * k; if (outward) idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); else idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
  };
  const zEnd = wp.endZ();
  const threads = wp.threads.filter((t) => t.z2 > 0);
  const inThread = (z) => threads.find((t) => z > t.z1 && z < t.z2);
  // outer profile (skip thread zones)
  const prof = wp.renderProfile(wp.R).filter((p) => p[0] <= zEnd + 1e-9);
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    if (inThread((a[0] + b[0]) / 2)) continue;
    if (a[1] <= 1e-6 && b[1] <= 1e-6) continue;
    strip(a, b, true);
  }
  // thread zones: helical surface r(z, θ) = R(u), u = z + P·θ/2π wrapped into the zone
  for (const t of threads) {
    const nz = Math.max(20, Math.ceil(((t.z2 - t.z1) / t.pitch) * 24));
    const base = pos.length / 3;
    const rAt = (z, th) => {
      let u = z + (t.pitch * th) / (2 * Math.PI);
      if (u > t.z2) u -= t.pitch * Math.ceil((u - t.z2) / t.pitch);
      return wp.outerAt(Math.min(Math.max(u, t.z1), t.z2)) ?? 0;
    };
    for (let i = 0; i <= nz; i++) {
      const z = t.z1 + ((t.z2 - t.z1) * i) / nz;
      for (let k = 0; k <= NTH; k++) { const th = (2 * Math.PI * k) / NTH; const r = rAt(z, th); pos.push(z, r * Math.cos(th), r * Math.sin(th)); nor.push(0, Math.cos(th), Math.sin(th)); }
    }
    for (let i = 0; i < nz; i++) for (let k = 0; k < NTH; k++) { const a = base + i * (NTH + 1) + k, b = a + NTH + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  // end face at zEnd (annulus between bore and outer)
  const Re = wp.outerAt(zEnd) ?? 0, Ri = wp.innerAt(zEnd) ?? 0;
  if (Re > Ri) strip([zEnd, Re], [zEnd, Ri], true);
  // bore
  const bore = wp.renderProfile(wp.Ri).filter((p) => p[0] <= zEnd + 1e-9);
  for (let i = 0; i < bore.length - 1; i++) { const a = bore[i], b = bore[i + 1]; if (a[1] <= 1e-6 && b[1] <= 1e-6) continue; strip(a, b, false); }
  // chuck-side face
  const R0 = wp.R[0], Ri0 = wp.Ri[0];
  if (R0 > Ri0) strip([0, Ri0], [0, R0], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  if (threads.length) g.computeVertexNormals();
  return g;
}
