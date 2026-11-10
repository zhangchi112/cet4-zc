/**
 * 离线缓存。
 * 词库是静态文件，所以策略很简单：装好之后全部走缓存，网络只用于更新版本。
 * 改了词库或页面后，把 VERSION 加一，用户下次打开就会拿到新内容。
 */
const VERSION = "cet4-v3";

const SHELL = [
  "./",
  "index.html",
  "assets/style.css",
  "assets/app.js",
  "assets/search.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "data/index.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await Promise.allSettled(SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))));

      // 首屏索引里列出了所有分片的字母，照着把 26 个释义分片也缓存下来
      try {
        const res = await fetch("data/index.json", { cache: "reload" });
        const meta = (await res.json()).meta || {};
        const letters = meta.letters || [];
        await Promise.allSettled(
          letters.map((l) => cache.add(new Request(`data/d/${l}.json`, { cache: "reload" })))
        );
      } catch {
        /* 离线安装时拿不到就等联网后再补 */
      }

      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;

      try {
        const res = await fetch(request);
        if (res.ok && res.type === "basic") {
          const cache = await caches.open(VERSION);
          cache.put(request, res.clone());
        }
        return res;
      } catch (err) {
        if (request.mode === "navigate") {
          const fallback = await caches.match("index.html");
          if (fallback) return fallback;
        }
        throw err;
      }
    })()
  );
});
