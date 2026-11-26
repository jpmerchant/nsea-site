// Meet Day for families: the app shell is cached so it opens with no signal (the family's data is kept in the page's
// own storage). Phone alerts: a push carries no data; this fetches the family's latest alerts and shows them.
const SHELL = 'meetday-family-v1';
const FILES = ['./', 'index.html', 'family.mjs', 'family.css', 'icon.svg', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('meetday-family-v') && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin === location.origin && u.pathname.startsWith('/meetday/')) {
    e.respondWith(fetch(e.request).then((r) => {
      if (r.ok && r.type === 'basic' && !r.redirected) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((m) => m || caches.match('index.html'))));
  } else if (/fonts\.(googleapis|gstatic)\.com/.test(u.host)) {
    e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; })));
  }
});

async function key() { const r = await caches.open('meetday-family-key').then((c) => c.match('/meetday/__key')); return r ? r.text() : null; }
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    const k = await key();
    let alerts = [];
    try { const r = await fetch('/api/meetday/family/alerts', { headers: { 'x-family-key': k || '' }, cache: 'no-store' }); if (r.ok) alerts = (await r.json()).alerts || []; } catch { /* offline */ }
    const shown = new Set((await self.registration.getNotifications()).map((n) => n.tag));
    const seenC = await caches.open('meetday-family-key');
    const seenR = await seenC.match('/meetday/__seen');
    const seen = new Set(seenR ? JSON.parse(await seenR.text()) : []);
    const fresh = alerts.filter((a) => !seen.has(a.key) && !shown.has(a.key)).reverse();
    if (!fresh.length) fresh.push({ key: 'update', title: 'NSEA Meet Day', body: 'New update for your swimmer.' });
    for (const a of fresh.slice(-4)) {
      await self.registration.showNotification(a.title, { body: a.body || '', tag: a.key, icon: '/meetday/icon-192.png', badge: '/meetday/icon-192.png', data: { url: '/meetday/#/today' } });
      seen.add(a.key);
    }
    await seenC.put('/meetday/__seen', new Response(JSON.stringify([...seen].slice(-200))));
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = list.find((x) => new URL(x.url).pathname.startsWith('/meetday/'));
    if (c) { await c.focus(); return; }
    await self.clients.openWindow('/meetday/#/today');
  })());
});
