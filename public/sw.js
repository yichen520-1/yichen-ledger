/* 忆尘记账的 Service Worker。
 *
 * 目的只有一个：装到手机主屏幕后，**没有网络也能打开**。
 * 这个 App 的数据本来就在本机 IndexedDB 里，唯一需要联网的只是那几个
 * JS/CSS 文件；把它们缓存住之后，整个应用就彻底离线可用了。
 *
 * 策略：
 *   - install 时抓 index.html，把里面引用到的 /assets/*.js、*.css 全部预缓存。
 *     文件名带 hash（index-NDKpvmh6.js），所以不能写死清单，只能现场解析。
 *     这一步很关键：否则「装完马上断网」会白屏，因为第一次加载的 JS
 *     根本没经过 SW。
 *   - 之后走 stale-while-revalidate：有缓存先用缓存（秒开），后台再悄悄更新。
 *   - 导航请求（打开页面）走网络优先，断网回退到缓存的 index.html，
 *     这样既能第一时间拿到新版本，离线也不白屏。
 */

const CACHE = 'yichen-ledger-v1';

/** 从 index.html 里抠出所有需要预缓存的同源资源地址 */
function assetsFromHtml(html, base) {
  const urls = new Set();
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1];
    // 跳过外链、data: 内联、以及 hash 锚点
    if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:') || raw.startsWith('#')) continue;
    try {
      urls.add(new URL(raw, base).toString());
    } catch {
      /* 拼不出绝对地址就跳过 */
    }
  }
  return [...urls];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 先缓存外壳本身
      await cache.addAll(['./', './index.html', './manifest.webmanifest'].map((u) => new URL(u, self.registration.scope).toString()));

      // 再解析 index.html，把构建产物（带 hash 的 js/css）也存下来
      try {
        const indexUrl = new URL('./index.html', self.registration.scope).toString();
        const res = await fetch(indexUrl, { cache: 'no-store' });
        if (res.ok) {
          const html = await res.text();
          const assets = assetsFromHtml(html, indexUrl).filter((u) => u.startsWith(self.registration.scope));
          // 逐个 add，单个失败不影响其它（比如某个图标不在这次构建里）
          await Promise.all(
            assets.map((u) =>
              cache.add(u).catch(() => {
                /* 单个资源失败不阻断安装 */
              }),
            ),
          );
        }
      } catch {
        /* 首次安装时拿不到 index.html 也没关系，运行时会补缓存 */
      }

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只处理自己域名下的 GET；POST/PUT 和第三方请求一律放行
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，断网回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(new URL('./index.html', self.registration.scope).toString(), copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          return (
            (await cache.match(new URL('./index.html', self.registration.scope).toString())) ||
            (await cache.match(new URL('./', self.registration.scope).toString())) ||
            new Response('离线中，且本地还没有缓存。请联网打开一次。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          );
        }),
    );
    return;
  }

  // 其余同源静态资源：先缓存后网络（stale-while-revalidate）
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
