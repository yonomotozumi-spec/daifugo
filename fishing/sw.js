/**
 * オフラインで遊ぶための Service Worker。
 * 遊ぶのに必要なファイルは全部先に取り込んでおく（数十 KB しかない）。
 * 中身を更新したときは CACHE の版を上げること。
 */

const CACHE = 'fishing-v8';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/style.css',
  './src/ui.js',
  './src/engine.js',
  './src/scene.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // 1 つ落とせても残りは入れたいので、個別に取りに行く
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** ページ遷移はネット優先（更新をすぐ拾う）、それ以外はキャッシュ優先（速い）。 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./'))),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) {
        // 裏で新しいものを取り込んでおく
        fetch(request)
          .then((res) => res.ok && caches.open(CACHE).then((cache) => cache.put(request, res)))
          .catch(() => {});
        return hit;
      }
      return fetch(request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      });
    }),
  );
});
