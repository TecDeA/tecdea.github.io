// ════════════════════════════════════════════════════════
//  SERVICE WORKER - TECDEA PORTAL PWA
// ════════════════════════════════════════════════════════

const CACHE_NAME = 'tecdea-portal-v2.9';
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

// Activación: limpiar SOLO las caches propias del portal.
// Las apps alojadas en subcarpetas (p. ej. /tablerokanban/) tienen sus
// propias caches y service workers: borrarlas aquí las dejaba sin soporte
// offline cada vez que el portal se actualizaba.
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activado');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('tecdea-portal-') && name !== CACHE_NAME)
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
// Rutas que pertenecen EXCLUSIVAMENTE al portal. Las apps en subcarpetas
// (p. ej. /tablerokanban/) gestionan sus propios recursos con sus propios
// service workers: si el portal interceptaba esas peticiones (scope '/'),
// cacheaba HTML e iconos ajenos y aparecían avisos de actualización falsos
// y favicons mezclados entre portal y apps.
const PORTAL_PATHS = new Set([
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/browserconfig.xml'
]);
const PORTAL_PREFIXES = ['/img/'];

function esRecursoDelPortal(url) {
  if (url.origin !== self.location.origin) return false;
  return PORTAL_PATHS.has(url.pathname) ||
         PORTAL_PREFIXES.some((p) => url.pathname.startsWith(p));
}

self.addEventListener('fetch', (event) => {
  // Solo interceptar peticiones GET
  if (event.request.method !== 'GET') return;

  // Dejar pasar TODO lo que no sea del portal (apps en subcarpetas incluidas)
  if (!esRecursoDelPortal(new URL(event.request.url))) return;

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

  // ── Manifest: red primero, caché solo si la red falla ──
  // Windows/Chrome leen el campo «version» del manifest al (re)instalar
  // la PWA. Con Cache First el SW entregaba la copia antigua y el sistema
  // registraba siempre la versión vieja (p. ej. «1.0»).
  if (event.request.url.endsWith('manifest.webmanifest')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            event.waitUntil(
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()))
            );
          }
          return response;
        })
        .catch(() => caches.match(event.request))
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
