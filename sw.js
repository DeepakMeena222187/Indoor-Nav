'use strict';
const CACHE = 'waypoint-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/app.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/routing-engine.js',
  '/gps-worker.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a).catch(() => {}))))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never cache: API calls, fonts, credentials, admin panel
  if (
    e.request.url.includes('firestore.googleapis.com') ||
    e.request.url.includes('identitytoolkit.googleapis.com') ||
    e.request.url.includes('fonts.googleapis') ||
    e.request.url.includes('fonts.gstatic') ||
    e.request.url.includes('config.js') ||
    e.request.url.includes('admin.html')
  ) return;

  e.respondWith(
    fetch(e.request)
      .then(r => {
        const clone = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
