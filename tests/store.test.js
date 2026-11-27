// Project storage: localStorage fallback and migration of v1.1.0 localStorage projects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectStore, LsBackend } from '../src/core/store.js';

class FakeStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
const proj = (name, saved) => ({ format: 'machinasim-project', name, saved, version: '1.1.0', pages: { lathe: { D: 50 } } });

test('localStorage fallback: put, list newest first, get, duplicate, remove', async () => {
  const s = new ProjectStore({ idb: null, ls: new FakeStorage() });
  assert.equal(await s.kind(), 'localstorage');
  await s.put('a', proj('a', '2026-01-01T00:00:00Z'));
  await s.put('b', proj('b', '2026-02-01T00:00:00Z'));
  assert.deepEqual((await s.list()).map((p) => p.name), ['b', 'a']);
  assert.equal((await s.get('a')).pages.lathe.D, 50);
  await s.duplicate('a');
  assert.equal((await s.get('a (copy)')).name, 'a (copy)');
  await s.remove('a');
  await assert.rejects(() => s.get('a'), /not found/);
  assert.equal((await s.list()).length, 2);
});

test('migration moves every v1.1.0 localStorage project and clears the old keys', async () => {
  const ls = new FakeStorage();
  const old = new LsBackend(ls);
  await old.put({ name: 'p1', saved: '2026-03-01T00:00:00Z', pages: ['lathe'] }, proj('p1', '2026-03-01T00:00:00Z'));
  await old.put({ name: 'p2', saved: '2026-04-01T00:00:00Z', pages: ['lathe'] }, proj('p2', '2026-04-01T00:00:00Z'));
  ls.setItem('ms.units', 'metric');
  const mem = new Map();
  const target = { list: async () => [...mem.values()].map((x) => x.meta), get: async (n) => mem.get(n)?.data, put: async (meta, data) => { mem.set(meta.name, { meta, data }); }, remove: async (n) => { mem.delete(n); } };
  const s = new ProjectStore({ idb: null, ls });
  const moved = await s._migrate(target);
  assert.equal(moved, 2);
  assert.equal(mem.get('p2').data.name, 'p2');
  assert.ok(mem.get('p1').meta.size > 0);
  assert.equal(ls.getItem('ms.project.p1'), null);
  assert.equal(ls.getItem('ms.projects'), null);
  assert.equal(ls.getItem('ms.units'), 'metric', 'unrelated settings are kept');
});

test('a project that fails to store is left in localStorage', async () => {
  const ls = new FakeStorage();
  await new LsBackend(ls).put({ name: 'keep', saved: '2026-01-01' }, proj('keep', '2026-01-01'));
  const s = new ProjectStore({ idb: null, ls });
  await assert.rejects(() => s._migrate({ put: async () => { throw new Error('quota'); } }));
  assert.ok(ls.getItem('ms.project.keep'));
});
