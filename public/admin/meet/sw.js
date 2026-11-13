// Meet Day service worker: the app shell and readers are cached so the app opens with no signal.
// API calls are never cached here (the app keeps its own data in IndexedDB).
const SHELL = 'meetday-shell-v1';
const LIBS = 'meetday-libs-v1';
const FILES = ['./', 'index.html', 'app.mjs', 'app.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'lib/parse.mjs', 'lib/flags.mjs', 'lib/model.mjs', 'lib/ingest.mjs', 'lib/store.mjs', 'lib/refs.mjs',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('meetday-shell-') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin === location.origin) {
    // Network first for the shell (so updates arrive), cache when offline or the sign-in page intercepts.
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && r.type === 'basic' && !r.redirected) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; }
      return caches.match(e.request, { ignoreSearch: true }).then((m) => m || r);
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('index.html'))));
    return;
  }
  // Readers and fonts from CDNs: cache first.
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.host)) {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(LIBS).then((c) => c.put(e.request, copy)); } return r; })));
  }
});
