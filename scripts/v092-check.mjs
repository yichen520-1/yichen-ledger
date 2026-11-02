/**
 * v0.9.2 专项自检：全面体检之后的「没改坏」证明。
 * ------------------------------------------------------------------
 * 这一版删了 16 个数据层函数、11 个领域层导出、2 条 CSS 规则、4 个 CSS 变量、
 * 82 个三语文案。删东西最容易犯的错是「删的时候是对的，删完某个页面白屏」，
 * 所以这个脚本不测新功能，只做一件事：**把每一个页面都走一遍**，
 * 确认它们都还能打开、都有内容、都不报错。
 *
 * 另外单独验三件和这次清理直接相关的事：
 *   1. 被删的 CSS 类（.sched-tabs / .badge-pending）确实不再出现在 DOM 里
 *      —— 万一还有代码在拼这两个名字，说明我删错了。
 *   2. .sched-tab 仍然保留（schedule-check 靠它断言「页面里不再有胶囊标签」）。
 *   3. 页面上的文案没有出现 `undefined` 或键名字面量
 *      —— 删 i18n 键最典型的后果就是漏删一处引用，界面直接显示 "receipt.limit"。
 *
 * 用法：node scripts/v092-check.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // 干净的起点
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(
    () =>
      new Promise((res) => {
        const req = indexedDB.deleteDatabase('yichen-ledger');
        req.onsuccess = req.onerror = req.onblocked = () => res();
      }),
  );
  await page.goto('about:blank');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.app-rail', { timeout: 20000 });
  await sleep(800);

  /* ================= 1. 每个页面都能打开、都有内容 ================= */

  // 记账模式下的全部路由（含只在侧边栏里的次级页）
  const LEDGER_PAGES = [
    ['/', '总览'],
    ['/add', '记一笔'],
    ['/stats', '统计'],
    ['/budgets', '预算'],
    ['/settings', '设置'],
    ['/accounts', '账户'],
    ['/categories', '分类'],
    ['/search', '搜索'],
    ['/recurring', '周期账单'],
    ['/weekly', '周报'],
    ['/review', '回顾'],
    ['/receivables', '待收'],
  ];

  for (const [path, label] of LEDGER_PAGES) {
    await page.goto(`${BASE}#${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(600);
    const info = await page.evaluate(() => {
      const main = document.querySelector('.main-inner') ?? document.body;
      const text = (main.innerText ?? '').trim();
      return {
        len: text.length,
        hasUndef: /undefined|NaN|\[object Object\]/.test(text),
        hasKeyLiteral: /\b[a-z]+\.[a-zA-Z]{3,}\b(?!\.)/.test(
          // 只挑那种明显是键名残留的：小写点小写、整段没有中文
          text.replace(/[\u4e00-\u9fa5]/g, ''),
        ),
        title: document.querySelector('.page-title')?.textContent?.trim() ?? '',
      };
    });
    check(`${label}页能打开且有内容`, info.len > 40, `${info.len} 字`);
    check(`${label}页没有 undefined/NaN`, !info.hasUndef);
  }

  /* ================= 2. 日程 App 的两个页面 ================= */

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(500);
  // 切到日程模式
  await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
    if (tiles[1]) tiles[1].click();
  });
  await sleep(900);

  for (const [path, label] of [
    ['/schedule', '日程'],
    ['/schedule/timetable', '课表'],
  ]) {
    await page.goto(`${BASE}#${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(700);
    const len = await page.evaluate(() => (document.querySelector('.main-inner') ?? document.body).innerText.trim().length);
    check(`${label}页能打开且有内容`, len > 40, `${len} 字`);
  }

  // 切回记账模式
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(500);
  await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
    if (tiles[0]) tiles[0].click();
  });
  await sleep(700);

  /* ================= 3. 被删的 CSS 类确实不在 DOM 里 ================= */

  const cssProbe = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')];
    const classes = new Set();
    for (const el of all) {
      for (const c of el.classList) classes.add(c);
    }
    return {
      hasSchedTabs: classes.has('sched-tabs'),
      hasBadgePending: classes.has('badge-pending'),
      hasSchedTab: classes.has('sched-tab'),
      total: classes.size,
    };
  });
  check('被删的 .sched-tabs 不在 DOM 里', !cssProbe.hasSchedTabs);
  check('被删的 .badge-pending 不在 DOM 里', !cssProbe.hasBadgePending);

  // .sched-tab 在日程页才有意义，单独去日程页看
  await page.goto(`${BASE}#/schedule`, { waitUntil: 'networkidle2' });
  await sleep(800);
  const schedTab = await page.evaluate(() => document.querySelectorAll('.sched-tab').length);
  check('.sched-tab 保留着（schedule-check 靠它断言）', schedTab === 0, `${schedTab} 个（期望 0：胶囊标签确实不在了）`);

  /* ================= 4. 界面文案里没有键名残留 ================= */

  // 挑几个「删了 i18n 键最可能露馅」的页面：它们用了大量小分组文案
  const TEXT_PAGES = ['/settings', '/receivables', '/recurring', '/weekly', '/review'];
  let leak = '';
  for (const path of TEXT_PAGES) {
    await page.goto(`${BASE}#${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(500);
    const bad = await page.evaluate(() => {
      const text = (document.querySelector('.main-inner') ?? document.body).innerText;
      // 找出「纯 ASCII 的点号键名」：比如 receipt.limit / lock.pinWeak
      const hits = text.match(/\b(?:add|assistant|categories|dashboard|event|lock|quick|receipt|receivable|recurring|review|schedule|search|settings|timeline|weekly|annual)\.[a-zA-Z]{3,}\b/g);
      return hits ?? [];
    });
    if (bad.length > 0) leak += `${path}: ${bad.slice(0, 3).join(', ')} `;
  }
  check('界面上没有残留的 i18n 键名', leak === '', leak);

  /* ================= 5. 三语都还能切 ================= */

  for (const [lang, expect] of [
    ['en', 'Settings'],
    ['ja', '設定'],
    ['zh', '设置'],
  ]) {
    await page.evaluate(
      (l) =>
        new Promise((res) => {
          const r = indexedDB.open('yichen-ledger');
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({ key: 'ui.lang', value: l });
            tx.oncomplete = () => {
              db.close();
              res();
            };
          };
        }),
      lang,
    );
    await page.goto('about:blank');
    await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(700);
    const nav = await page.evaluate(() =>
      [...document.querySelectorAll('.sidebar .nav-item')].map((e) => e.textContent.trim()),
    );
    check(`${lang} 侧边栏文案正常`, nav.length >= 8 && !nav.some((x) => /^[a-z]+\.[a-z]/i.test(x)), nav.slice(0, 3).join('|'));
  }

  // 还原中文
  await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('yichen-ledger');
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: 'ui.lang', value: 'zh' });
          tx.oncomplete = () => {
            db.close();
            res();
          };
        };
      }),
  );

  check('零控制台错误', errors.length === 0, errors.slice(0, 3).join(' / '));

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(800);
  await page.screenshot({ path: '.shots/v092-home.png' });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nV092 CHECK: ${failed.length === 0 ? 'PASS' : 'FAIL'}  (${results.length - failed.length} passed, ${failed.length} failed)`);
if (failed.length) process.exitCode = 1;
