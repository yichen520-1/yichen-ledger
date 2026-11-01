/**
 * v0.9.1 专项自检：手机端到底能不能进得去、出得来。
 * ------------------------------------------------------------------
 * 这一版修的是两个用户报上来的问题：
 *   1. 手机上点「+」进记账页之后退不出去（整条底部导航在记账页不渲染）；
 *   2. 搜索 / 周期账单 / 周报 / 回顾 / 待收这五页手机上根本进不去
 *      （它们只在侧边栏里，而手机没有侧边栏）。
 *
 * 跑法：node scripts/v091-check.mjs [url]
 * 默认 http://localhost:4173/，需要先 npx vite preview --port 4173。
 */
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:4173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  /* ============================== 手机 ============================== */
  const m = await browser.newPage();
  await m.setViewport({ width: 430, height: 932, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mErrors = [];
  m.on('console', (x) => x.type() === 'error' && mErrors.push(x.text()));
  m.on('pageerror', (e) => mErrors.push(String(e)));

  await m.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await m.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('yichen-ledger'); q.onsuccess = q.onerror = q.onblocked = () => r(); }));
  await m.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await m.waitForSelector('.tabbar', { timeout: 20000 });
  await sleep(900);

  /* --- 底部导航第 5 格是「更多」 --- */
  const tabs = await m.$$eval('.tabbar .tab', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
  check('手机底部导航第 5 格是「更多」', tabs.includes('更多'), tabs.join('|'));

  /* --- 点「更多」能开抽屉 --- */
  await m.evaluate(() => {
    const b = [...document.querySelectorAll('.tabbar .tab')].find((x) => x.textContent.trim() === '更多');
    if (b) b.click();
  });
  await sleep(500);
  const moreItems = await m.$$eval('.more-item', (els) => els.map((e) => e.textContent.trim()));
  check('「更多」抽屉打开了', moreItems.length > 0, moreItems.join('|'));
  check('抽屉里有搜索', moreItems.includes('搜索'), moreItems.join('|'));
  check('抽屉里有周期账单', moreItems.includes('周期账单'), moreItems.join('|'));
  check('抽屉里有周报', moreItems.includes('周报'), moreItems.join('|'));
  check('抽屉里有回顾', moreItems.includes('回顾'), moreItems.join('|'));
  check('抽屉里有待收', moreItems.includes('待收'), moreItems.join('|'));
  check('抽屉里有账户', moreItems.includes('账户'), moreItems.join('|'));
  check('抽屉里有分类', moreItems.includes('分类'), moreItems.join('|'));
  check('抽屉里有设置', moreItems.includes('设置'), moreItems.join('|'));

  /* --- 从抽屉点进搜索，能到 --- */
  await m.evaluate(() => {
    const a = [...document.querySelectorAll('.more-item')].find((x) => x.textContent.trim() === '搜索');
    if (a) a.click();
  });
  await sleep(800);
  check('从抽屉能进搜索页', m.url().includes('#/search'), m.url().split('#')[1] ?? '');
  check('进页后抽屉自动收起', !(await m.$('.more-sheet')));

  /* --- 手机上「进不去的那五页」现在都能到 --- */
  const reach = [];
  for (const [label, route] of [
    ['搜索', '#/search'],
    ['周期账单', '#/recurring'],
    ['周报', '#/weekly'],
    ['回顾', '#/review'],
    ['待收', '#/receivables'],
  ]) {
    await m.goto(BASE, { waitUntil: 'networkidle2' });
    await m.waitForSelector('.tabbar');
    await sleep(400);
    await m.evaluate(() => {
      const b = [...document.querySelectorAll('.tabbar .tab')].find((x) => x.textContent.trim() === '更多');
      if (b) b.click();
    });
    await sleep(350);
    const ok = await m.evaluate((want) => {
      const a = [...document.querySelectorAll('.more-item')].find((x) => x.textContent.trim() === want);
      if (!a) return false;
      a.click();
      return true;
    }, label);
    await sleep(700);
    reach.push(`${label}:${ok && m.url().includes(route)}`);
  }
  check('手机能进搜索/周期账单/周报/回顾/待收', reach.every((x) => x.endsWith('true')), reach.join(' '));

  /* --- 每个页面都有返回按钮，且点了能回去 --- */
  // 只列「次级页面」：从某个入口钻进去、底部导航上没有的那几页。
  // 统计/预算/设置本身就在底部导航上，随时能切走，不需要返回按钮。
  const pages = [
    ['记一笔', '#/add'],
    ['账户', '#/accounts'],
    ['分类', '#/categories'],
    ['搜索', '#/search'],
    ['周期账单', '#/recurring'],
    ['周报', '#/weekly'],
    ['回顾', '#/review'],
    ['待收', '#/receivables'],
  ];
  const backReport = [];
  for (const [name, route] of pages) {
    // 先到总览，再进去，这样 history 里有一条可回退的记录
    await m.goto(BASE, { waitUntil: 'networkidle2' });
    await m.waitForSelector('.tabbar');
    await sleep(350);
    await m.goto(BASE + route, { waitUntil: 'networkidle2' });
    await sleep(700);
    const has = !!(await m.$('.back-btn'));
    if (!has) {
      backReport.push(`${name}:无按钮`);
      continue;
    }
    await m.click('.back-btn');
    await sleep(700);
    const back = m.url().endsWith('#/') || m.url().endsWith('/#/') || !m.url().includes('#/');
    backReport.push(`${name}:${back ? 'ok' : '留在' + (m.url().split('#')[1] ?? '')}`);
  }
  check('每个次级页面都有返回按钮', backReport.every((x) => !x.includes('无按钮')), backReport.filter((x) => x.includes('无按钮')).join(' '));
  check('点返回都能回到总览', backReport.every((x) => x.endsWith(':ok')), backReport.join(' '));

  /* --- 记账页：手机上也能退出（这是用户报的那个 bug） --- */
  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('.tabbar');
  await sleep(400);
  // 底部导航上的入口是中间那个「+」，不是写着「记一笔」的文字格
  await m.click('.tab-add');
  await sleep(900);
  check('记账页有返回按钮（用户报的 bug）', !!(await m.$('.back-btn')));
  await m.click('.back-btn');
  await sleep(800);
  check('从记账页能退回总览', !m.url().includes('#/add'), m.url().split('#')[1] ?? '(空)');

  /* --- 直接打开记账页（没有历史）时，返回也要能走 --- */
  await m.goto(BASE + '#/add', { waitUntil: 'networkidle2' });
  await sleep(800);
  const directBack = !!(await m.$('.back-btn'));
  if (directBack) {
    await m.click('.back-btn');
    await sleep(800);
  }
  check('直接打开记账页也能退出', directBack && !m.url().includes('#/add'), m.url().split('#')[1] ?? '(空)');

  check('手机端没有控制台错误', mErrors.length === 0, mErrors.slice(0, 3).join(' / '));

  await m.goto(BASE, { waitUntil: 'networkidle2' });
  await m.waitForSelector('.tabbar');
  await sleep(500);
  await m.evaluate(() => {
    const b = [...document.querySelectorAll('.tabbar .tab')].find((x) => x.textContent.trim() === '更多');
    if (b) b.click();
  });
  await sleep(400);
  await m.screenshot({ path: '.shots/v091-more.png' });

  /* ============================== 桌面 ============================== */
  const d = await browser.newPage();
  await d.setViewport({ width: 1280, height: 900 });
  const dErrors = [];
  d.on('console', (x) => x.type() === 'error' && dErrors.push(x.text()));
  d.on('pageerror', (e) => dErrors.push(String(e)));
  await d.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await d.waitForSelector('.sidebar', { timeout: 20000 });
  await sleep(700);

  // 桌面端整条底部导航是 display:none，所以不能按 DOM 内容断言 ——
  // 要看的是「侧边栏在、底栏不可见、抽屉弹不出来」这三件事。
  const tabbarVisible = await d.evaluate(() => {
    const el = document.querySelector('.tabbar');
    if (!el) return false;
    return getComputedStyle(el).display !== 'none';
  });
  check('桌面端底部导航是隐藏的', tabbarVisible === false, String(tabbarVisible));

  const sideNav = await d.$$eval('.sidebar .nav-item', (els) => els.map((e) => e.textContent.trim()));
  check('桌面端侧边栏仍齐全', ['搜索', '周期账单', '周报', '回顾', '待收', '设置'].every((x) => sideNav.includes(x)), sideNav.join('|'));

  // 桌面端就算强行点「更多」也不该弹出（CSS 里 @media min-width:900px 把它藏了）
  const moreShown = await d.evaluate(() => {
    const b = [...document.querySelectorAll('.tabbar .tab')].find((x) => x.textContent.trim() === '更多');
    if (b) b.click();
    const sheet = document.querySelector('.more-sheet');
    return sheet ? getComputedStyle(sheet).display !== 'none' : false;
  });
  check('桌面端弹不出「更多」抽屉', moreShown === false, String(moreShown));

  await d.goto(BASE + '#/search', { waitUntil: 'networkidle2' });
  await sleep(600);
  check('桌面端搜索页也有返回按钮', !!(await d.$('.back-btn')));
  await d.click('.back-btn');
  await sleep(700);
  check('桌面端点返回回到总览', !d.url().includes('#/search'), d.url().split('#')[1] ?? '(空)');

  await d.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(600);
  await d.evaluate(() => {
    const b = [...document.querySelectorAll('.sidebar .nav-item')].find((x) => x.textContent.trim() === '设置');
    if (b) b.click();
  });
  await sleep(700);
  check('桌面端从侧边栏能进设置页', d.url().includes('#/settings'), d.url().split('#')[1] ?? '(空)');

  check('桌面端没有控制台错误', dErrors.length === 0, dErrors.slice(0, 3).join(' / '));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nV091 CHECK: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length} passed, ${failed.length} failed)`);
if (failed.length) process.exitCode = 1;
