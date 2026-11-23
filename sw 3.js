// Mergy Monsters offline support.
// The game is cached on first visit, so it opens and plays with no internet.
const CACHE = 'tilt-monsters-v13';
const ASSETS = ['/', '/index.html', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/icon-maskable-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET') return;            // score uploads go straight to the network
  if (url.pathname.startsWith('/api/')) return; // the leaderboard is always live (the game caches it itself)

  // Pages: try the network first so updates arrive, fall back to the cached game when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put('/index.html', copy)); return res;
    }).catch(() => caches.match('/index.html')));
    return;
  }

  // Everything else (icons, fonts): cache first, refresh in the background.
  e.respondWith(caches.match(req).then(cached => {
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque') && (url.origin === location.origin || url.host.includes('fonts.g'))) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
