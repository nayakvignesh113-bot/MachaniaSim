// Project storage. IndexedDB (quota: a large share of free disk) with a localStorage fallback
// (≈ 5 MB per origin) for browsers where IndexedDB is unavailable. Projects saved by v1.1.0 and
// earlier in localStorage are moved into IndexedDB the first time the store is opened.

const DB = 'machinasim', VER = 1, META = 'meta', DATA = 'data';
const LS_INDEX = 'ms.projects', LS_KEY = (n) => `ms.project.${n}`;

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('Transaction aborted')); });

/** IndexedDB backend: metadata and project bodies in separate stores so listing does not load every project. */
export class IdbBackend {
  constructor(idb) { this.idb = idb; this.kind = 'indexeddb'; }
  async open() {
    if (this.db) return this.db;
    const r = this.idb.open(DB, VER);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'name' }); if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA); };
    this.db = await req(r);
    return this.db;
  }
  async list() { const db = await this.open(); return req(db.transaction(META).objectStore(META).getAll()); }
  async get(name) { const db = await this.open(); return req(db.transaction(DATA).objectStore(DATA).get(name)); }
  async put(meta, data) {
    const db = await this.open(), tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).put(meta); tx.objectStore(DATA).put(data, meta.name);
    return done(tx);
  }
  async remove(name) {
    const db = await this.open(), tx = db.transaction([META, DATA], 'readwrite');
    tx.objectStore(META).delete(name); tx.objectStore(DATA).delete(name);
    return done(tx);
  }
}

/** localStorage backend, in the format used up to v1.1.0 (index + one key per project). */
export class LsBackend {
  constructor(ls) { this.ls = ls; this.kind = 'localstorage'; }
  _index() { try { return JSON.parse(this.ls.getItem(LS_INDEX) || '[]'); } catch { return []; } }
  async list() { return this._index(); }
  async get(name) { const j = this.ls.getItem(LS_KEY(name)); return j ? JSON.parse(j) : undefined; }
  async put(meta, data) {
    this.ls.setItem(LS_KEY(meta.name), JSON.stringify(data));
    this.ls.setItem(LS_INDEX, JSON.stringify([meta, ...this._index().filter((p) => p.name !== meta.name)]));
  }
  async remove(name) { this.ls.removeItem(LS_KEY(name)); this.ls.setItem(LS_INDEX, JSON.stringify(this._index().filter((p) => p.name !== name))); }
}

export class ProjectStore {
  /** @param o.idb IDBFactory (default globalThis.indexedDB) ; o.ls Storage (default globalThis.localStorage) */
  constructor(o = {}) {
    this.idb = 'idb' in o ? o.idb : globalThis.indexedDB;
    this.ls = 'ls' in o ? o.ls : globalThis.localStorage;
  }
  async backend() {
    if (this._b) return this._b;
    this._b = (async () => {
      if (this.idb) {
        try { const b = new IdbBackend(this.idb); await b.open(); await this._migrate(b); return b; } catch (e) { console.warn('IndexedDB unavailable, using localStorage:', e); }
      }
      if (this.ls) return new LsBackend(this.ls);
      throw new Error('No browser storage available');
    })();
    return this._b;
  }
  /** Move projects saved in localStorage (v1.1.0 and earlier) into IndexedDB; each is removed from localStorage only after it is stored. */
  async _migrate(b) {
    if (!this.ls) return 0;
    const old = new LsBackend(this.ls), list = await old.list();
    let moved = 0;
    for (const meta of list) {
      const data = await old.get(meta.name).catch(() => undefined);
      if (data === undefined) continue;
      await b.put({ ...meta, size: meta.size ?? JSON.stringify(data).length }, data);
      this.ls.removeItem(LS_KEY(meta.name));
      moved++;
    }
    if (list.length) this.ls.removeItem(LS_INDEX);
    this.migrated = moved;
    return moved;
  }
  async kind() { return (await this.backend()).kind; }
  /** Newest first. */
  async list() { return (await (await this.backend()).list()).sort((a, b) => String(b.saved).localeCompare(String(a.saved))); }
  async get(name) { const d = await (await this.backend()).get(name); if (d === undefined) throw new Error(`Project “${name}” not found`); return d; }
  async put(name, data) {
    const meta = { name, saved: data.saved || new Date().toISOString(), size: JSON.stringify(data).length, pages: Object.keys(data.pages || {}) };
    await (await this.backend()).put(meta, data);
    return meta;
  }
  async remove(name) { return (await this.backend()).remove(name); }
  async duplicate(name, newName = `${name} (copy)`) { const d = structuredClone(await this.get(name)); d.name = newName; d.saved = new Date().toISOString(); return this.put(newName, d); }
  /** Approximate usage and quota in bytes (navigator.storage), when the browser reports them. */
  async estimate() { try { return await globalThis.navigator?.storage?.estimate?.(); } catch { return null; } }
}
