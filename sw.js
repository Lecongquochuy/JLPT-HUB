const CACHE_NAME = 'jlpt-hub-pro-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/css/style.css',
  './assets/js/github-sync.js',
  './assets/js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon.svg',
  './data/n5.js',
  './data/n4.js',
  './data/n3.js',
  './data/n2.js',
  './data/n1.js',
  './data/cloud_sync.json'
];

// 1. Install: Nạp sẵn toàn bộ tài nguyên cốt lõi vào bộ nhớ Offline
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 2. Activate: Dọn dẹp các bản cache cũ
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// 3. Fetch:
// - Bỏ qua hoàn toàn các request gọi lên api.github.com (để đồng bộ thời gian thực)
// - Với file dữ liệu (/data/): Ưu tiên Network-First (có mạng là lấy bản mới nhất, mất mạng lấy bản Offline)
// - Với giao diện tĩnh (CSS/JS/Icons): Stale-While-Revalidate (mở tức thì 0ms và tự cập nhật ngầm)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Không cache API GitHub
  if (url.hostname === 'api.github.com' || url.hostname === 'raw.githubusercontent.com') {
    return;
  }

  // Chiến lược Network-First cho các file dữ liệu học tập
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(event.request)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200) {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkRes;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Chiến lược Stale-While-Revalidate cho UI / Assets
  event.respondWith(
    caches.match(event.request).then(cachedRes => {
      const fetchPromise = fetch(event.request)
        .then(networkRes => {
          if (networkRes && networkRes.status === 200 && networkRes.type === 'basic') {
            const clone = networkRes.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkRes;
        })
        .catch(() => cachedRes);

      return cachedRes || fetchPromise;
    })
  );
});
