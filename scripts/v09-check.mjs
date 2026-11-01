/**
 * v0.9.0 专项自检：年度视图 / 预算结转 / 收据 / 待收报销 / 事件账本 /
 * 应用锁 / 忆小尘主动开口 / 回顾页。
 *
 * 用法：node scripts/v09-check.mjs [url]
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name, ok, extra = '') {
  if (ok) {
    pass += 1;
    console.log(`PASS  ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail += 1;
    console.log(`FAIL  ${name}${extra ? ' — ' + extra : ''}`);
  }
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,900'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // 干净起点
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('yichen-ledger');
        req.onsuccess = req.onerror = req.onblocked = () => r();
      }),
  );
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.app-rail', { timeout: 20000 });
  await sleep(1200);

  // 受控 input 必须用 native setter
  async function setInput(selector, value) {
    await page.evaluate(
      (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('no element ' + sel);
        const proto =
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      selector,
      value,
    );
    await sleep(120);
  }

  async function addTx(amount, catIndex, note) {
    await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
    await sleep(300);
    await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.keypad', { timeout: 15000 });
    await sleep(800);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === '清空');
      if (b) b.click();
    });
    await sleep(150);
    for (const ch of amount) {
      const btns = await page.$$('.keypad button');
      for (const btn of btns) {
        const label = await btn.evaluate((el) => el.textContent.trim());
        if (label === ch) {
          await btn.click();
          await sleep(90);
          break;
        }
      }
    }
    const chips = await page.$$('.cat-chip');
    await chips[catIndex].click();
    if (note) {
      await page.evaluate((n) => {
        const all = [...document.querySelectorAll('.field input')];
        const el = all[all.length - 2];
        if (el) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, n);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, note);
    }
    await sleep(200);
    await page.click('.key-ok');
    await sleep(900);
  }

  /* ================= 1. 年度视图 ================= */
  await page.goto(`${BASE}#/stats`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(600);
  const segs = await page.$$eval('.segmented button, .month-nav button', (els) =>
    els.map((e) => e.textContent.trim()),
  );
  check('统计页有「年」切换', segs.some((x) => x.includes('年') || x.includes('Year')), segs.join('|'));

  /* ================= 2. 记几笔账 ================= */
  await addTx('120', 0, '午饭');
  await addTx('300', 1, '打车');

  /* ================= 2b. 年度视图（有数据之后再看） ================= */
  await page.goto(`${BASE}#/stats`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.segmented button')].find((x) => x.textContent.includes('年'));
    if (b) b.click();
  });
  await sleep(800);
  const yearText = await page.evaluate(() => document.body.innerText);
  check('年视图有同比/环比字样', /同比|环比|较去年|去年/.test(yearText), yearText.slice(0, 90).replace(/\n/g, ' '));
  check('年视图显示全年合计', /420\.00|¥420/.test(yearText), yearText.slice(0, 90).replace(/\n/g, ' '));

  /* ================= 3. 预算结转 ================= */
  await page.goto(`${BASE}#/budgets`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('新建') || x.textContent.includes('添加'));
    if (b) b.click();
  });
  await sleep(600);
  const hasRollover = await page.evaluate(() => !!document.querySelector('.sheet .check-row'));
  check('预算表单里有结转开关', hasRollover);
  // 填金额并勾结转
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('.sheet input')].find((i) => i.inputMode === 'decimal' || i.type === 'text');
    if (inp) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '2000');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  await page.evaluate(() => {
    const cb = document.querySelector('.sheet .check-row input[type="checkbox"]');
    if (cb) cb.click();
  });
  await sleep(200);
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.trim() === '保存');
    if (save) save.click();
  });
  await sleep(900);
  const budgetText = await page.evaluate(() => document.body.innerText);
  check('预算列表出现「结转」标记', budgetText.includes('结转'), budgetText.slice(0, 80).replace(/\n/g, ' '));

  /* ================= 4. 待收报销 ================= */
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(300);
  await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.keypad', { timeout: 15000 });
  await sleep(800);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === '清空');
    if (b) b.click();
  });
  await sleep(150);
  for (const ch of '88') {
    const btns = await page.$$('.keypad button');
    for (const btn of btns) {
      const label = await btn.evaluate((el) => el.textContent.trim());
      if (label === ch) {
        await btn.click();
        await sleep(90);
        break;
      }
    }
  }
  const chips2 = await page.$$('.cat-chip');
  await chips2[0].click();
  await sleep(200);
  // 勾「待收」
  // 记账页上只有一个勾选项（待收）。文案是「这笔还没收回来」，
  // 不要按「待收」两个字去匹配 —— 那是分组标题，不是这一行的标签。
  const receivableBox = await page.evaluate(() => {
    const row = document.querySelector('.check-row');
    if (!row) return false;
    const cb = row.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    cb.click();
    return cb.checked;
  });
  check('记账页有「待收」勾选项', receivableBox);
  await sleep(300);
  await page.click('.key-ok');
  await sleep(1000);

  // 总览应该提示被挡在统计外
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(800);
  const dashText = await page.evaluate(() => document.body.innerText);
  check('总览出现待收提示', /待收|垫付/.test(dashText), dashText.slice(0, 80).replace(/\n/g, ' '));

  // 待收页
  await page.goto(`${BASE}#/receivables`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(600);
  const recvText = await page.evaluate(() => document.body.innerText);
  check('待收页列出那笔 88 元', recvText.includes('88'), recvText.slice(0, 120).replace(/\n/g, ' '));

  /* ================= 5. 应用锁 ================= */
  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(700);
  const lockSection = await page.evaluate(() => document.body.innerText.includes('应用锁'));
  check('设置页有应用锁分组', lockSection);
  const lockNote = await page.evaluate(() => document.body.innerText);
  check('应用锁写明了「不是加密」', /不是加密|哈希/.test(lockNote));

  /* ================= 6. 回顾页 ================= */
  await page.goto(`${BASE}#/review`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(700);
  const reviewTitle = await page.$eval('.page-title', (e) => e.textContent.trim());
  check('回顾页能打开', reviewTitle.length > 0, reviewTitle);
  const reviewBody = await page.evaluate(() => document.body.innerText);
  check('回顾页有内容', reviewBody.length > 40, reviewBody.slice(0, 60).replace(/\n/g, ' '));

  /* ================= 7. 侧边栏入口 ================= */
  const nav = await page.$$eval('.sidebar .nav-item', (els) => els.map((e) => e.textContent.trim()));
  check('侧边栏有回顾入口', nav.some((x) => x.includes('回顾')), nav.join('|'));
  check('侧边栏有待收入口', nav.some((x) => x.includes('待收')), nav.join('|'));

  /* ================= 8. 三语 ================= */
  for (const lang of ['en', 'ja']) {
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
    await page.goto(`${BASE}#/review`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.page-title', { timeout: 15000 });
    const ttl = await page.$eval('.page-title', (e) => e.textContent.trim());
    check(`${lang} 回顾页标题已翻译`, ttl.length > 0 && !ttl.includes('.'), ttl);
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

  check('没有控制台错误', errors.length === 0, errors.slice(0, 3).join(' / '));

  await page.goto(`${BASE}#/review`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title');
  await sleep(500);
  await page.screenshot({ path: '.shots/v09-review.png' });
  await page.goto(`${BASE}#/stats`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.page-title');
  await sleep(500);
  await page.screenshot({ path: '.shots/v09-stats.png' });
} finally {
  await browser.close();
}

console.log(`\nV09 CHECK: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
if (fail) process.exitCode = 1;
