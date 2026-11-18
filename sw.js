/* Keeps DPMS working with no network. Change VERSION whenever a listed file changes. */
const VERSION = 'dpms-v6.0.0';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/engine.js', 'js/catalog.js', 'js/app.js',
  'fonts/bricolage.woff2', 'fonts/bricolage-naira.woff2', 'fonts/instrument.woff2',
  'icons/icon.svg', 'icons/adire.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'update') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(caches.match('index.html').then(hit => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
});
