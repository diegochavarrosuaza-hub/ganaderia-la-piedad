// Service worker — deja la app disponible sin internet.
// Al cambiar cualquier archivo de la app, sube la versión para que se actualice.
const CACHE = 'la-piedad-v21';
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/print.js',
  './js/sync.js',
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
  './js/views/toros.js',
  './js/views/terneros.js',
  './js/views/reproduccion.js',
  './js/views/sanidad.js',
  './js/views/pesajes.js',
  './js/views/eventos.js',
  './js/views/respaldo.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// Al instalar, bajar cada archivo DE LA RED (cache: 'reload'), nunca de la
// caché del navegador: si no, una actualización puede quedar con mezcla de
// versiones (unos archivos nuevos y otros viejos) y dejar la app inconsistente.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(ARCHIVOS.map(url =>
        fetch(new Request(url, { cache: 'reload' }))
          .then(resp => { if (resp && resp.ok) return c.put(url, resp); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Caché primero (arranque instantáneo, ideal para señal mala en el campo) y
// refresco en segundo plano. Solo se cachean respuestas buenas (200/OK) del
// mismo origen: así un error 500/404 pasajero del servidor NUNCA sobrescribe
// en caché la versión buena de un archivo.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cacheado => {
      const red = fetch(e.request)
        .then(resp => {
          if (resp && resp.ok && resp.status === 200 &&
              (resp.type === 'basic' || resp.type === 'default')) {
            const copia = resp.clone();
            caches.open(CACHE).then(c => c.put(e.request, copia));
          }
          return resp;
        })
        .catch(() => cacheado || caches.match('./index.html'));
      return cacheado || red;
    })
  );
});
