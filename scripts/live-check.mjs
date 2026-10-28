/**
 * 线上网页版端到端验证：直接打 GitHub Pages 的真实地址，
 * 记一笔账、切几个页面，确认线上那份就是能用的。
 *
 * 用法：node scripts/live-check.mjs
 */
import puppeteer from 'puppeteer-core';

const BASE = 'https://yichen520-1.github.io/yichen-ledger/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(ok, label, extra = '') {
  results.push({ ok, label, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  const loadMs = Date.now() - t0;

  check(await page.title() === '忆笺记账', '标题正确', await page.title());
  check(loadMs < 20000, '首屏加载时间合理', `${loadMs}ms`);

  await page.waitForSelector('.networth', { timeout: 20000 });
  const net = await page.$eval('.networth .v, .networth', (el) => el.textContent.trim());
  check(net.includes('¥0.00'), '初始净资产为 0', net);

  // 记一笔 66.66 元
  await page.goto(BASE + '#/add', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.keypad', { timeout: 20000 });

  for (const ch of ['6', '6', '.', '6', '6']) {
    const btns = await page.$$('.keypad button');
    for (const b of btns) {
      const t = await b.evaluate((el) => el.textContent.trim());
      if (t === ch) { await b.evaluate((el) => el.click()); break; }
    }
    await sleep(80);
  }
  await sleep(200);

  const amountText = await page.$eval('.amount-display', (el) => el.textContent.trim());
  check(amountText.includes('66.66'), '键盘输入 66.66', amountText);

  const okDisabledBefore = await page.$eval('.key-ok', (el) => el.disabled);
  check(okDisabledBefore === true, '未选分类时保存按钮禁用');

  const chip = (await page.$$('.cat-chip'))[0];
  await chip.evaluate((el) => el.click());
  await sleep(300);

  const okDisabledAfter = await page.$eval('.key-ok', (el) => el.disabled);
  check(okDisabledAfter === false, '选完分类后保存按钮可用');

  await page.$eval('.key-ok', (el) => el.click());
  await sleep(1200);

  const hash = await page.evaluate(() => location.hash);
  check(hash === '#/' || hash === '', '保存后回到总览', hash);

  await page.waitForSelector('.tx-row', { timeout: 20000 });
  const bodyText = await page.evaluate(() => document.body.innerText);
  check(bodyText.includes('-¥66.66'), '净资产变成 -¥66.66');

  // 切几个页面看看有没有崩
  for (const [route, sel] of [['#/stats', '.card'], ['#/budgets', '.card'], ['#/settings', '.card'], ['#/accounts', '.card']]) {
    await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 60000 });
    const ok = await page.$(sel);
    check(!!ok, `页面 ${route} 正常渲染`);
  }

  // PWA 元信息
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  const manifest = await page.$eval('link[rel="manifest"]', (el) => el.href).catch(() => null);
  check(!!manifest, 'manifest 链接存在', manifest || '');

  // Service Worker 是在页面加载完之后才注册的，刚 goto 完就问会拿到
  // 「registration 有、active 还没有」，多等一会儿再判，别把正常安装当失败。
  const sw = await page.evaluate(async () => {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 15000));
    const ready = await Promise.race([navigator.serviceWorker.ready, timeout]);
    if (ready && ready.active) return ready.active.state;
    const r = await navigator.serviceWorker.getRegistration();
    return r ? (r.active ? r.active.state : r.installing ? 'installing' : 'no-active') : 'none';
  });
  check(
    sw === 'activated' || sw === 'activating' || sw === 'installing',
    'Service Worker 已注册',
    sw,
  );

  check(errors.length === 0, '没有控制台错误', errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: '.shots/pages-live.png', fullPage: false });
  console.log('\nSHOT: .shots/pages-live.png');
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f.label + (f.extra ? '  ' + f.extra : '')));
  process.exit(1);
}
console.log('LIVE CHECK: PASS');
