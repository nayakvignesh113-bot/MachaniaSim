// Shared Three.js viewport: renderer, camera, orbit controls, lights, resize, render-on-demand loop.
import * as THREE from 'three';
import { OrbitControls } from '../../vendor/OrbitControls.js';

export { THREE };

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

export class Viewport {
  constructor(host, { target = [0, 0, 0], camPos = [400, 300, 500], far = 20000 } = {}) {
    this.host = host;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    host.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef1f5);
    this.camera = new THREE.PerspectiveCamera(35, 1, 1, far);
    this.camera.position.set(...camPos);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(...target);
    this.controls.enableDamping = true;
    this.controls.update();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.6));
    const d1 = new THREE.DirectionalLight(0xffffff, 1.8); d1.position.set(600, 900, 700); this.scene.add(d1);
    const d2 = new THREE.DirectionalLight(0xffffff, 0.6); d2.position.set(-700, 400, -500); this.scene.add(d2);
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.renderer.localClippingEnabled = true;
    this.onFrame = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(host);
    this.resize();
    this._running = true;
    this._loop = () => {
      if (!this._running) return;
      this._raf = requestAnimationFrame(this._loop);
      this.onFrame?.();
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this._loop();
  }
  pause() { this._running = false; cancelAnimationFrame(this._raf); }
  resume() { if (!this._running) { this._running = true; this.resize(); this._loop(); } }
  resize() {
    const w = this.host.clientWidth || 400, h = this.host.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  setView(pos, target) { this.camera.position.set(...pos); this.controls.target.set(...target); this.controls.update(); }
  snapshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
  dispose() {
    this._running = false; cancelAnimationFrame(this._raf); this._ro.disconnect();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose?.()); });
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}

export const MAT = {
  casting: () => new THREE.MeshStandardMaterial({ color: 0x5b7083, metalness: 0.2, roughness: 0.65 }),
  castingDark: () => new THREE.MeshStandardMaterial({ color: 0x3e4c5a, metalness: 0.25, roughness: 0.6 }),
  steel: () => new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.7, roughness: 0.32 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.4, roughness: 0.5 }),
  accent: () => new THREE.MeshStandardMaterial({ color: 0xe0a526, metalness: 0.3, roughness: 0.45 }),
  work: () => new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.65, roughness: 0.28, side: THREE.DoubleSide }),
  carbide: () => new THREE.MeshStandardMaterial({ color: 0x8a6f3a, metalness: 0.5, roughness: 0.35 }),
  red: () => new THREE.MeshStandardMaterial({ color: 0xc23b22, metalness: 0.2, roughness: 0.5 }),
};

export function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); return m;
}
export function cyl(r, len, mat, seg = 32, r2 = r) {
  return new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
}

/** Arrow representing a force: origin, vector (N), scale mm/N, colour, label. */
export function forceArrow(color) {
  const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 10, color, 6, 4);
  a.line.material.linewidth = 2;
  a.update = (origin, vec, scale) => {
    const L = vec.length() * scale;
    a.visible = L > 0.5;
    if (!a.visible) return;
    a.position.copy(origin);
    a.setDirection(vec.clone().normalize());
    a.setLength(L, Math.min(12, L * 0.3), Math.min(7, L * 0.18));
  };
  return a;
}
