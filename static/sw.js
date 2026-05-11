/* SuperRank — Service Worker (Sprint 13) */

const CACHE_NAME = 'superrank-v1';
const STATIC_ASSETS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/offline.html',
];

// Instala e pré-cacheia os assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Remove caches antigos ao ativar nova versão
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: Network-first para API, Cache-first para estáticos
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requisições de API: sempre network; em caso de falha, não retorna cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sem conexão' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Assets estáticos e navegação: cache-first, fallback para network, depois offline
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request)
        .then(response => {
          // Armazena respostas GET bem-sucedidas no cache
          if (event.request.method === 'GET' && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Fallback para offline.html em navegação
          if (event.request.mode === 'navigate') {
            return caches.match('/static/offline.html');
          }
        });
    })
  );
});
