// Radial drilling machine and knee-type milling machines (vertical / horizontal) with Z-map workpieces.
// Block coordinates (x, y, z=height) map to scene (x, y_scene = height, z_scene = y).
import { THREE, Viewport, MAT, box, cyl, forceArrow } from './scene.js';
import { ZMapMesh } from './zmap3d.js';
import { RADIAL_DRILL, radialIK } from '../sim/drill-sim.js';

export class RadialDrill3D {
  constructor(host) {
    this.vp = new Viewport(host, { target: [0, 200, 0], camPos: [700, 650, 900] });
    const S = this.vp.scene, m = RADIAL_DRILL;
    const cast = MAT.casting(), dark = MAT.castingDark(), steel = MAT.steel(), black = MAT.dark();
    S.add(box(1500, 120, 700, dark, 150, -260, 30)); // base
    S.add(box(500, 200, 400, cast, 60, -100, 30)); // box table
    this.col = new THREE.Group(); this.col.position.set(m.col.x, 0, m.col.y); S.add(this.col);
    const c1 = cyl(70, 1400, cast, 40); c1.position.y = 500; this.col.add(c1);
    const c2 = cyl(85, 180, dark, 40); c2.position.y = -110; this.col.add(c2);
    this.arm = new THREE.Group(); this.col.add(this.arm);
    this.arm.add(box(1150, 110, 140, cast, 560, 0, 0));
    this.arm.add(cyl(95, 160, cast, 40));
    this.screw = cyl(16, 1300, steel, 16); this.screw.position.set(0, 300, -110); this.col.add(this.screw);
    this.head = new THREE.Group(); this.arm.add(this.head);
    this.head.add(box(220, 300, 260, cast, 0, -40, 0));
    this.head.add(box(90, 90, 40, black, 0, 40, 145));
    for (let k = 0; k < 3; k++) { const s = cyl(5, 120, steel, 8); s.rotation.z = Math.PI / 2; s.rotation.y = (k * 2 * Math.PI) / 3; s.position.set(0, -60, 160); this.head.add(s); }
    this.quill = cyl(28, 260, steel, 24); this.quill.position.y = -210; this.head.add(this.quill);
    this.drill = new THREE.Group(); this.head.add(this.drill);
    this.blockGroup = new THREE.Group(); S.add(this.blockGroup);
    this.arrow = forceArrow(0x2563eb); S.add(this.arrow);
    const grid = new THREE.GridHelper(4000, 40, 0xcfd6de, 0xdde3e9); grid.position.y = -320; S.add(grid);
    this.angle = 0; this.rpm = 0; this.target = null; this.cur = null;
    this.vp.onFrame = () => this._frame();
    this._t = performance.now();
  }
  dispose() { this.vp.dispose(); this.mesh?.dispose(); }
  setBlock(zm) {
    this.blockGroup.clear(); this.mesh?.dispose();
    this.zm = zm; this.mesh = new ZMapMesh(zm);
    this.blockGroup.add(this.mesh.group);
    // clamps
    const black = MAT.dark();
    this.blockGroup.add(box(30, 20, 120, black, -20, zm.H0 * 0.5, zm.Dp / 2));
    this.blockGroup.add(box(30, 20, 120, black, zm.W + 20, zm.H0 * 0.5, zm.Dp / 2));
    this.blockGroup.position.set(0, 0, 0);
    this.vp.setView([zm.W / 2 + 420, 520, zm.Dp / 2 + 620], [zm.W / 2 - 120, 180, zm.Dp / 2]);
  }
  setTool(tool) {
    this.tool = tool; this.drill.clear();
    const Rd = tool.D / 2, L = tool.length ?? 120;
    const pa = tool.pointAngle ?? 118;
    const tipLen = pa >= 179 ? 0.5 : Rd / Math.tan((pa / 2) * Math.PI / 180);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(Rd, tipLen, 32), MAT.steel()); tip.rotation.x = Math.PI; tip.position.y = tipLen / 2; this.drill.add(tip);
    const body = cyl(Rd * 0.98, L - tipLen, MAT.steel(), 24); body.position.y = tipLen + (L - tipLen) / 2; this.drill.add(body);
    const wire = cyl(Rd, L - tipLen, new THREE.MeshStandardMaterial({ color: 0x6b7280, wireframe: true }), 6); wire.position.y = body.position.y; this.drill.add(wire);
    this.toolLen = L;
  }
  /** Drill tip position in block coordinates. */
  setToolPos(x, y, z) {
    const ik = radialIK(x, y);
    this.cur = { x, y, z, ik };
    const armY = Math.max(this.zm ? this.zm.H0 : 50, 50) + 30 + this.toolLen + 330;
    this.arm.position.y = armY;
    this.arm.rotation.y = -ik.theta;
    this.head.position.x = ik.rho;
    // quill extension so the drill tip reaches z
    const tipY = z; // scene y of tip
    const quillBottom = tipY + this.toolLen;
    this.drill.position.y = quillBottom - armY;
    this.quill.position.y = (quillBottom - armY) / 2 - 40;
    this.quill.scale.y = Math.max(0.2, (armY - quillBottom + 40) / 260);
  }
  setForces(s) {
    if (!s?.cutting || !this.cur) { this.arrow.visible = false; return; }
    this.arrow.update(new THREE.Vector3(this.cur.x, this.cur.z, this.cur.y), new THREE.Vector3(0, -s.thrust, 0), 0.06);
  }
  setRpm(N) { this.rpm = N; }
  _frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._t) / 1000); this._t = now;
    this.angle += Math.min(this.rpm / 60, 1) * dt * 2 * Math.PI;
    this.drill.rotation.y = -this.angle;
    this.mesh?.refresh();
  }
}

export class Mill3D {
  constructor(host, { horizontal = false } = {}) {
    this.horizontal = horizontal;
    this.vp = new Viewport(host, { target: [0, 300, 0], camPos: [650, 650, 900] });
    const S = this.vp.scene;
    const cast = MAT.casting(), dark = MAT.castingDark(), steel = MAT.steel(), black = MAT.dark();
    this.SP = { x: 0, y: 420, z: 0 }; // spindle nose (vertical) / arbor axis (horizontal) reference
    S.add(box(520, 1500, 560, cast, 0, 250, -520)); // column
    S.add(box(700, 120, 800, dark, 0, -560, -250)); // base
    this.knee = new THREE.Group(); S.add(this.knee);
    this.knee.add(box(460, 320, 520, cast, 0, -200, -170));
    this.saddle = new THREE.Group(); this.knee.add(this.saddle);
    this.saddle.add(box(420, 80, 420, dark, 0, 0, 0));
    this.table = new THREE.Group(); this.saddle.add(this.table);
    this.table.add(box(1100, 60, 300, cast, 0, 70, 0));
    for (let k = -1; k <= 1; k++) this.table.add(box(1100, 4, 18, black, 0, 100, k * 80));
    this.work = new THREE.Group(); this.table.add(this.work); // block origin placed on the table
    if (!horizontal) {
      this.headG = new THREE.Group(); S.add(this.headG);
      this.headG.add(box(300, 380, 360, cast, 0, this.SP.y + 330, -200));
      this.headG.add(box(220, 280, 220, dark, 0, this.SP.y + 300, 0));
      const hc = cyl(60, 60, black, 32); hc.position.set(0, this.SP.y + 140, 0); this.headG.add(hc);
      this.spindle = new THREE.Group(); this.spindle.position.set(this.SP.x, this.SP.y, this.SP.z); S.add(this.spindle);
      const nose = cyl(32, 90, steel, 24); nose.position.y = 45 + 75; this.spindle.add(nose);
    } else {
      this.overarm = box(260, 180, 1100, cast, 0, this.SP.y + 330, -40); S.add(this.overarm);
      this.arbor = cyl(14, 900, steel, 16); this.arbor.rotation.x = Math.PI / 2; this.arbor.position.set(0, this.SP.y, -100); S.add(this.arbor);
      S.add(box(120, 380, 80, dark, 0, this.SP.y + 140, 380));
      this.spindle = new THREE.Group(); this.spindle.position.set(this.SP.x, this.SP.y, 0); S.add(this.spindle);
    }
    this.arrows = { x: forceArrow(0x2563eb), y: forceArrow(0x059669), z: forceArrow(0xdc2626) };
    Object.values(this.arrows).forEach((a) => S.add(a));
    const grid = new THREE.GridHelper(4000, 40, 0xcfd6de, 0xdde3e9); grid.position.y = -620; S.add(grid);
    this.angle = 0; this.rpm = 0;
    this.vp.onFrame = () => this._frame();
    this._t = performance.now();
  }
  dispose() { this.vp.dispose(); this.mesh?.dispose(); }
  setBlock(zm) {
    this.work.clear(); this.mesh?.dispose();
    this.zm = zm; this.mesh = new ZMapMesh(zm);
    const g = this.mesh.group;
    this.work.add(g);
    // vise
    const black = MAT.dark(), steel = MAT.steel();
    this.work.add(box(zm.W * 0.6, 50, 40, steel, zm.W / 2, -25 + 10, -22));
    this.work.add(box(zm.W * 0.6, 50, 40, steel, zm.W / 2, -25 + 10, zm.Dp + 22));
    this.work.add(box(zm.W * 0.7, 30, zm.Dp + 120, black, zm.W / 2, -30, zm.Dp / 2));
    this.vp.setView([300, this.SP.y + 200, 460], [0, this.SP.y - 40, 0]);
  }
  setTool(tool) {
    this.tool = tool; this.spindle.children.slice(this.horizontal ? 0 : 1).forEach((c) => this.spindle.remove(c));
    this.cutter = new THREE.Group(); this.spindle.add(this.cutter);
    const R = tool.D / 2;
    const steel = MAT.steel(), carb = MAT.carbide();
    if (tool.horizontal) {
      const w = tool.width;
      const c = cyl(R, w, tool.material === 'hss' ? steel : carb, 48); c.rotation.x = Math.PI / 2; c.position.z = w / 2; this.cutter.add(c);
      for (let k = 0; k < tool.z; k++) { const t = box(4, 6, w + 0.5, MAT.dark()); const a = (2 * Math.PI * k) / tool.z; t.position.set(R * Math.cos(a), R * Math.sin(a), w / 2); t.rotation.z = a; this.cutter.add(t); }
      return;
    }
    const fl = tool.flute ?? 25, L = tool.length ?? 70;
    if (tool.subtype === 'face') {
      const body = cyl(R * 0.92, 40, MAT.castingDark(), 48); body.position.y = 20 + 2; this.cutter.add(body);
      for (let k = 0; k < tool.z; k++) { const a = (2 * Math.PI * k) / tool.z; const ins = box(10, 8, 12, carb); ins.position.set(R * Math.cos(a) * 0.96, 4, R * Math.sin(a) * 0.96); ins.rotation.y = -a; this.cutter.add(ins); }
      const arb = cyl(20, 60, steel, 24); arb.position.y = 70; this.cutter.add(arb);
      return;
    }
    const mat = tool.material === 'hss' ? steel : carb;
    const flute = cyl(R, fl, mat, 24); flute.position.y = fl / 2; this.cutter.add(flute);
    const wire = cyl(R * 1.01, fl, new THREE.MeshStandardMaterial({ color: 0x404650, wireframe: true }), tool.z * 2); wire.position.y = fl / 2; this.cutter.add(wire);
    const shank = cyl(R, L - fl, steel, 24); shank.position.y = fl + (L - fl) / 2; this.cutter.add(shank);
    if (tool.subtype === 'ball') { const b = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 12, 0, 2 * Math.PI, Math.PI / 2, Math.PI / 2), mat); b.position.y = R; this.cutter.add(b); flute.position.y = R + (fl - R) / 2; flute.scale.y = (fl - R) / fl; }
    this.toolLen = L;
    this.holder = cyl(R + 12, 60, MAT.dark(), 24); this.holder.position.y = L + 30; this.cutter.add(this.holder);
  }
  /** Tool position in block coordinates (vertical: tip centre; horizontal: axis x,z and y0). Table moves, tool fixed. */
  setToolPos(x, y, z, y0) {
    this.cur = { x, y, z };
    // place work so that block point (x, y, z) coincides with the spindle reference point
    const T = this.table, S = this.saddle, K = this.knee;
    if (!this.horizontal) {
      T.position.x = -x;
      S.position.z = -y;
      K.position.y = this.SP.y - z - 100 - 0; // table top at knee y + 100
      this.work.position.set(0, 100 - 0, 0);
      this.work.position.x = 0; this.work.position.z = 0;
    } else {
      T.position.x = -x;
      S.position.z = -(y0 ?? 0);
      K.position.y = this.SP.y - z - 100;
      this.work.position.set(0, 100, 0);
    }
  }
  setForces(s) {
    if (!s?.cutting || !this.cur) { Object.values(this.arrows).forEach((a) => (a.visible = false)); return; }
    const o = new THREE.Vector3(this.SP.x, this.SP.y, this.horizontal ? (this.tool.width || 20) / 2 : 0);
    const k = 0.15;
    this.arrows.x.update(o, new THREE.Vector3(s.Fx || 0, 0, 0), k);
    this.arrows.y.update(o, new THREE.Vector3(0, 0, s.Fy || 0), k);
    this.arrows.z.update(o, new THREE.Vector3(0, s.Fz || 0, 0), k);
  }
  setRpm(N) { this.rpm = N; }
  _frame() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._t) / 1000); this._t = now;
    this.angle += Math.min(this.rpm / 60, 1) * dt * 2 * Math.PI;
    if (this.cutter) { if (this.horizontal) this.cutter.rotation.z = this.angle; else this.cutter.rotation.y = -this.angle; }
    this.mesh?.refresh();
  }
}
