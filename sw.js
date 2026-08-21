// ════════════════════════════════════════════════════════
//  SERVICE WORKER - TECDEA PORTAL PWA
// ════════════════════════════════════════════════════════

const CACHE_NAME = 'tecdea-portal-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/tecdea-portal.html',
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

// Estrategia: Cache First, fallback a Network
self.addEventListener('fetch', (event) => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  // No cachear peticiones a Firebase (API)
  if (event.request.url.includes('firebaseio.com') || 
      event.request.url.includes('googleapis.com')) {
    return;
  }

  // No cachear peticiones a extensiones no soportadas
  if (event.request.url.match(/\.(mp4|webm|ogg|mp3|wav)$/)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          // Devolver del cache y actualizar en background
          fetchAndCache(event.request);
          return cachedResponse;
        }

        // No está en cache → ir a la red
        return fetchAndCache(event.request);
      })
      .catch(() => {
        // Si falla todo, devolver página offline si es navegación
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
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
