/* 通用项目管理工作台 · Service Worker
 * 作用：把主程序缓存到本地，使应用断网也能打开，并满足 PWA 安装条件。
 * 注意：只缓存同源的 GET 请求；AI 代理等跨域/POST 请求照常走网络。
 */
const CACHE = 'pm-workbench-v2';
const ASSETS = [
  './',
  './index.html',
  './%E9%80%9A%E7%94%A8%E9%A1%B9%E7%9B%AE%E7%AE%A1%E7%90%86%E5%B7%A5%E4%BD%9C%E5%8F%B0.html'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(async (c) => {
        // 逐个缓存，单个失败不影响整体安装
        for (const url of ASSETS) {
          try { await c.add(url); }
          catch (err) { console.warn('SW 缓存失败(已跳过):', url, err); }
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request))
  );
});
