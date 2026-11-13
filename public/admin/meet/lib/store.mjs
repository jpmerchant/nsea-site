// Tiny IndexedDB store: everything the app needs offline lives here.
//   kv:     settings, meet list, sync cursors
//   pkgs:   meet packages by id
//   ops:    every op we know about (server + ours), keyed by op id
//   outbox: our ops not yet accepted by the server
const DB = 'nsea-meetday';
let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('kv');
      d.createObjectStore('pkgs');
      const o = d.createObjectStore('ops', { keyPath: 'id' });
      o.createIndex('meet', 'meet');
      d.createObjectStore('outbox', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await open();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const get = (k) => tx('kv', 'readonly', (s) => req(s.get(k)));
export const set = (k, v) => tx('kv', 'readwrite', (s) => { s.put(v, k); });
export const getPkg = (id) => tx('pkgs', 'readonly', (s) => req(s.get(id)));
export const putPkg = (pkg) => tx('pkgs', 'readwrite', (s) => { s.put(pkg, pkg.id); });
export const delPkg = (id) => tx('pkgs', 'readwrite', (s) => { s.delete(id); });
export const listPkgIds = () => tx('pkgs', 'readonly', (s) => req(s.getAllKeys()));
export const opsFor = (meet) => tx('ops', 'readonly', (s) => req(s.index('meet').getAll(meet)));
export const putOps = (ops) => tx('ops', 'readwrite', (s) => { for (const o of ops) s.put(o); });
export const outbox = () => tx('outbox', 'readonly', (s) => req(s.getAll()));
export const queue = (op) => tx('outbox', 'readwrite', (s) => { s.put(op); });
export const unqueue = (ids) => tx('outbox', 'readwrite', (s) => { for (const id of ids) s.delete(id); });
