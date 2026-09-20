// ════════════════════════════════════════════════════════
//  SERVICE WORKER - TECDEA PORTAL PWA
// ════════════════════════════════════════════════════════

const CACHE_NAME = 'tecdea-portal-v50';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/img/favicon.ico'
];

// Archivos a cachear en la instalación
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Cacheando archivos estáticos');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Error durante la instalación:', err))
  );
});

// Activación: limpiar caches antiguos
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activado');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Eliminando cache antiguo:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Estrategia:
//  · Navegaciones (HTML): Network First — el PWA recibe SIEMPRE la
//    versión publicada mientras haya red; la caché solo entra si la
//    red falla. Antes (Cache First) el móvil quedaba pegado a la copia
//    antigua de index.html y las correcciones «no llegaban».
//  · Resto de GETs: Cache First + refresco en segundo plano
//    GARANTIZADO con event.waitUntil (antes el SW podía morir antes
//    de actualizar la caché, sobre todo en móvil).
self.addEventListener('fetch', (event) => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  // No cachear peticiones a Firebase (API)
  if (event.request.url.includes('firebaseio.com') || 
      event.request.url.includes('firebasedatabase.app') ||
      event.request.url.includes('googleapis.com')) {
    return;
  }

  // No cachear peticiones a extensiones no soportadas
  if (event.request.url.match(/\.(mp4|webm|ogg|mp3|wav)$/)) {
    return;
  }

  // ── Navegaciones (HTML): red primero, caché solo si la red falla ──
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            // Copia fresca a la caché (clave canónica) para poder
            // abrir la app aunque luego no haya conexión.
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', response.clone()))
            );
          }
          return response;
        })
        .catch(() => caches.match('/index.html')
          .then((r) => r || caches.match(event.request)))
    );
    return;
  }

  // ── Resto de GETs: caché primero + refresco GARANTIZADO ──
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        const refresh = fetchAndCache(event.request);
        event.waitUntil(refresh);
        return cachedResponse || refresh;
      })
      .catch(() => {
        // Si falla todo (las navegaciones ya se gestionaron arriba)
        return new Response('Offline', { status: 503, statusText: 'Sin conexión' });
      })
  );
});

// Función auxiliar: fetch y cache
async function fetchAndCache(request) {
  try {
    const response = await fetch(request);
    
    // Solo cache respuestas exitosas
    if (response.ok && response.status === 200) {
      const responseClone = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(request, responseClone);
      });
    }
    
    return response;
  } catch (error) {
    // Si falla el fetch, intentar devolver del cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw error;
  }
}

// Manejar mensajes desde la app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});
