/**
 * 验证 Web 版（PWA）真的能装、能离线用。
 *
 * 检查项：
 *   1. manifest 能被解析，图标尺寸对得上，display 是 standalone
 *   2. Service Worker 注册成功并进入 activated
 *   3. 缓存里真的有 index.html 和 JS/CSS
 *   4. **断网后刷新页面仍然能打开并显示账本**（这是 PWA 的关键）
 *
 * 用法：先 `npm run build && npx vite preview --port 4173`，再 node scripts/pwa-check.mjs
 */

import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fails = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) fails.push(name);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.networth', { timeout: 15000 });

  // ---- 1. manifest ----
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    return { href: link.href, json: await res.json() };
  });
  check('manifest 存在且可解析', !!manifest, manifest?.href ?? '');
  if (manifest) {
    const j = manifest.json;
    check('manifest display 是 standalone', j.display === 'standalone', j.display);
    check('manifest name 是中文应用名', j.name === '忆笺', j.name);
    const sizes = (j.icons ?? []).map((i) => i.sizes);
    check('manifest 含 192 与 512 图标', sizes.includes('192x192') && sizes.includes('512x512'), sizes.join(','));
    check('manifest 有 maskable 图标', (j.icons ?? []).some((i) => i.purpose === 'maskable'));
  }

  // ---- 2. 图标真的能下载 ----
  for (const f of ['pwa-192.png', 'pwa-512.png', 'pwa-512-maskable.png', 'apple-touch-icon.png']) {
    const ok = await page.evaluate(async (file) => {
      const res = await fetch('./' + file);
      return res.ok && (await res.blob()).size > 1000;
    }, f);
    check(`图标可访问 ${f}`, ok);
  }

  // ---- 3. Service Worker 注册并激活 ----
  const swState = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const reg = await navigator.serviceWorker.getRegistration('./');
    if (!reg) {
      // 首次访问时注册是异步的，用 ready 等一下
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((r) => setTimeout(() => r(null), 8000)),
      ]);
      return ready?.active?.state ?? 'none';
    }
    return reg.active?.state ?? 'installing';
  });
  check('Service Worker 已激活', swState === 'activated', String(swState));

  // ---- 4. 缓存里真的有东西 ----
  const cacheKeys = await page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) {
      const cache = await caches.open(n);
      out[n] = (await cache.keys()).map((r) => new URL(r.url).pathname);
    }
    return out;
  });
  const allCached = Object.values(cacheKeys).flat();
  check('缓存了 index.html', allCached.some((p) => p.endsWith('/') || p.endsWith('index.html')), JSON.stringify(allCached));
  check('缓存了 JS 产物', allCached.some((p) => p.includes('/assets/') && p.endsWith('.js')));

  // ---- 5. 关键：断网后还能打开 ----
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineOk = await page
    .waitForSelector('.networth', { timeout: 12000 })
    .then(() => true)
    .catch(() => false);
  const offlineTitle = await page.title();
  const offlineBody = await page.evaluate(() => document.body.innerText.slice(0, 80));
  check('断网后页面仍能打开', offlineOk, `title=${offlineTitle} body=${JSON.stringify(offlineBody)}`);

  await page.screenshot({ path: '.shots/pwa-offline.png' });
  await page.setOfflineMode(false);

  // 断网时 console 里会有 fetch 失败的报错，那是预期内的，不算缺陷
  const realErrors = errors.filter((e) => !/Failed to fetch|net::ERR_INTERNET_DISCONNECTED|NetworkError/i.test(e));
  check('没有意外的控制台错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));

  console.log('');
  console.log(fails.length === 0 ? 'PWA CHECK: PASS' : `PWA CHECK: ${fails.length} FAILED → ${fails.join(', ')}`);
  process.exitCode = fails.length === 0 ? 0 : 1;
} finally {
  await browser.close();
}
