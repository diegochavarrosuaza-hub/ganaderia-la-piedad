// Service worker — deja la app disponible sin internet.
// Al cambiar cualquier archivo de la app, sube la versión para que se actualice.
const CACHE = 'la-piedad-v7';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/print.js',
  './js/db.js',
  './js/ui.js',
  './js/util.js',
  './js/charts.js',
  './js/logic.js',
  './js/forms.js',
  './js/fichas.js',
  './js/seed-data.js',
  './js/views/dashboard.js',
  './js/views/vacas.js',
  './js/views/terneros.js',
  './js/views/reproduccion.js',
  './js/views/pesajes.js',
  './js/views/eventos.js',
  './js/views/respaldo.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir actualizaciones), caché si no hay internet
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copia));
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then(r => r || caches.match('./index.html')))
  );
});
