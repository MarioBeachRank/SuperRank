/* SuperRank — Service Worker */

// Bump do CACHE_NAME faz o 'activate' limpar caches antigos (ex.: o v1
// cache-first que servia app.js/index.html velhos no celular).
const CACHE_NAME = 'superrank-v2';
const OFFLINE_URL = '/static/offline.html';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.add(OFFLINE_URL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: API sempre network; HTML/JS/CSS e navegação NETWORK-FIRST
// (sempre a versão nova quando online), cache só como fallback offline.
// Antes era cache-first, o que servia uma versão antiga indefinidamente.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

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

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (event.request.method === 'GET' && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(cached =>
          cached || (event.request.mode === 'navigate' ? caches.match(OFFLINE_URL) : undefined)
        )
      )
  );
});
