/**
 * v0.8.0 跨模块专项自检（正式脚本版）
 *
 * 和 .tmp-brand 里那份的区别：这份跟着仓库走，CI 和以后改代码都能跑。
 * 覆盖：账目搜索筛选、周期账单、待确认入账、总览时间轴、周报、快捷记账、
 * 日程→周期账单、忆小尘跨模块问答。
 *
 * 用法：node scripts/crossmod-check.mjs [url]
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
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // 受控 input 必须用 native setter，直接赋 .value 不触发 onChange
  async function setInput(selector, value) {
    await page.evaluate(
      (sel, v) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error('no element ' + sel);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      selector,
      value,
    );
    await sleep(150);
  }

  // 干净起点
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('yichen-ledger');
        req.onsuccess = req.onerror = req.onblocked = () => r();
      }),
  );
  await page.goto('about:blank');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.app-rail', { timeout: 20000 });
  await sleep(800);

  /* ---------------------------------------------- 1. 周报空态 */
  await page.goto(`${BASE}#/weekly`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  check('周报页标题', (await page.$eval('.page-title', (e) => e.textContent.trim())) === '周报');
  check('空账本时周报显示空态', (await page.$('.empty')) !== null);
  const nav = await page.$$eval('.sidebar .nav-item', (els) => els.map((e) => e.textContent.trim()));
  check('侧边栏有周报入口', nav.includes('周报'), nav.join('|'));
  check('侧边栏有搜索入口', nav.includes('搜索'), nav.join('|'));
  check('侧边栏有周期账单入口', nav.includes('周期账单'), nav.join('|'));

  /* ---------------------------------------------- 2. 记三笔账 */
  async function addTx(amount, catIndex, note) {
    await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(300);
    await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.keypad', { timeout: 15000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === '清空');
      if (b) b.click();
    });
    await sleep(150);
    for (const ch of amount) {
      await page.evaluate((c) => {
        const btn = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === c);
        if (btn) btn.click();
      }, ch);
    }
    const chips = await page.$$('.cat-chip');
    await chips[catIndex].click();
    if (note) {
      await page.evaluate((n) => {
        const all = [...document.querySelectorAll('.field input')];
        const el = all[all.length - 2];
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, n);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, note);
    }
    await sleep(200);
    await page.click('.key-ok');
    await sleep(900);
  }

  await addTx('120', 0, '午饭');
  await addTx('80', 1, '打车');
  await addTx('3500', 2, '买衣服');

  /* ---------------------------------------------- 3. 周报有数据 */
  await page.goto(`${BASE}#/weekly`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.weekly-hero', { timeout: 15000 });
  const hero = await page.$eval('.weekly-hero', (e) => e.innerText);
  check('周报合计 = 3700 元', hero.includes('3,700.00'), hero.replace(/\n/g, ' / '));
  const facts = await page.$$eval('.weekly-fact', (els) => els.map((e) => e.innerText));
  check('周报有事实条目', facts.length > 0, String(facts.length));
  check('有「花得最多」那条', facts.some((f) => f.includes('花得最多')));
  check('有日程那条', facts.some((f) => f.includes('日程')));
  const navBtns = await page.$$('.month-nav button');
  check('有翻周按钮', navBtns.length >= 2, String(navBtns.length));
  await page.click('.month-nav button:first-child');
  await sleep(500);
  const prevEmpty = (await page.$('.empty')) !== null;
  check('翻到上一周内容变了', prevEmpty);
  await page.click('.month-nav button:last-child');
  await sleep(500);
  check('翻回本周又有数据', (await page.$('.weekly-hero')) !== null);

  /* ---------------------------------------------- 4. 搜索筛选 */
  await page.goto(`${BASE}#/search`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.search-bar', { timeout: 15000 });
  await sleep(500);
  check('搜索页有搜索框', (await page.$('.search-bar input')) !== null);
  await setInput('.search-bar input', '午饭');
  await sleep(500);
  const hit1 = await page.$$eval('.tx-row', (els) => els.length);
  check('搜「午饭」命中 1 笔', hit1 === 1, String(hit1));
  await setInput('.search-bar input', '3500');
  await sleep(500);
  const hit2 = await page.$$eval('.tx-row', (els) => els.length);
  check('搜金额「3500」命中 1 笔', hit2 === 1, String(hit2));
  await setInput('.search-bar input', '不存在的词');
  await sleep(500);
  const hit3 = await page.$$eval('.tx-row', (els) => els.length);
  check('搜不存在的词命中 0 笔', hit3 === 0, String(hit3));
  await setInput('.search-bar input', '');
  await sleep(400);
  const total = await page.$$eval('.tx-row', (els) => els.length);
  check('清空后回到全部 3 笔', total === 3, String(total));

  /* ---------------------------------------------- 5. 周期账单 */
  await page.goto(`${BASE}#/recurring`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(500);
  check('周期账单空态', (await page.$('.empty')) !== null);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.page-actions button, .page-head button')].find((b) =>
      /新建|添加/.test(b.textContent),
    );
    if (btn) btn.click();
  });
  await sleep(700);
  check('新建规则弹层打开了', (await page.$('.sheet')) !== null);
  await page.evaluate(() => {
    const setV = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const name = document.querySelector('.sheet .field input');
    if (name) setV(name, '房租');
    const amount = [...document.querySelectorAll('.sheet .field input')].find((i) => i.inputMode === 'decimal');
    if (amount) setV(amount, '3500');
  });
  await sleep(250);
  // 分类是必填的（不选会报「请选择分类」），这里选第一个
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll('.sheet select')].find((x) => x.value === '');
    if (sel) {
      sel.value = sel.options[1].value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(250);
  // 开始日期设成两个月前，保证有逾期账单
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('.sheet input[type="date"]')][0];
    if (el) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2026-09-01');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(200);
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('.sheet button')].find((b) => /保存|确定/.test(b.textContent.trim()));
    if (save) save.click();
  });
  await sleep(900);
  const billText = await page.evaluate(() => document.body.innerText);
  check('周期账单页出现「房租」', billText.includes('房租'));
  check('显示每月固定支出合计', billText.includes('每月固定支出'));

  /* ---------------------------------------------- 6. 总览待确认 */
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.pending-card', { timeout: 15000 });
  await sleep(400);
  const pendingBefore = await page.$$eval('.pending-item', (els) => els.length);
  check('总览顶部有待确认卡片', pendingBefore > 0, String(pendingBefore));
  await page.click('.pending-item .mini-btn.primary');
  await sleep(1000);
  const pendingAfter = await page.$$eval('.pending-item', (els) => els.length);
  check('确认后待确认少一条', pendingAfter === pendingBefore - 1, `${pendingBefore} → ${pendingAfter}`);
  const txCount = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('yichen-ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res) => {
      const q = db.transaction('transactions', 'readonly').objectStore('transactions').count();
      q.onsuccess = () => res(q.result);
    });
  });
  check('确认后账目多了一笔', txCount === 4, String(txCount));

  /* ---------------------------------------------- 7. 时间轴 */
  const tlDays = await page.$$eval('.tl-day', (els) => els.length);
  check('总览有时间轴', tlDays > 0, String(tlDays));
  const tlItems = await page.$$eval('.tl-item', (els) => els.length);
  check('时间轴有条目', tlItems > 0, String(tlItems));
  check('时间轴里有账目', (await page.$$('.tl-item.tx')).length > 0);
  check('时间轴有「再看往前一些」', (await page.$$eval('.timeline ~ *, .mini-btn', (els) => els.some((e) => /往前/.test(e.textContent)))));

  /* ---------------------------------------------- 8. 快捷记账 */
  await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.keypad', { timeout: 15000 });
  await sleep(600);
  const chips = await page.$$eval('.quick-chip', (els) => els.map((e) => e.innerText));
  check('记账页有快捷入口', chips.length > 0, String(chips.length));
  const beforeAmt = await page.$eval('.amount-display', (e) => e.innerText);
  await page.click('.quick-chip');
  await sleep(400);
  const afterAmt = await page.$eval('.amount-display', (e) => e.innerText);
  check('点快捷入口填上了金额', afterAmt !== beforeAmt, `${beforeAmt} -> ${afterAmt}`);
  // 快捷条不该把键盘顶出屏幕
  const okVisible = await page.evaluate(() => {
    const ok = document.querySelector('.key-ok');
    if (!ok) return false;
    const r = ok.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= 0;
  });
  check('快捷条出现后「确定」键仍在屏幕内', okVisible);

  /* ---------------------------------------------- 9. 日程 → 周期账单 */
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.app-rail .app-tile', { timeout: 20000 });
  await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
    if (tiles[1]) tiles[1].click();
  });
  await sleep(1200);
  await page.goto(`${BASE}#/schedule`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.sched-actions', { timeout: 20000 });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.sched-actions button')].find((b) => b.className.includes('primary'));
    if (btn) btn.click();
  });
  await sleep(700);
  check('日程弹层打开了', (await page.$('.sheet')) !== null);
  await setInput('.sheet .field input.input', '还信用卡');
  await sleep(200);
  await page.evaluate(() => {
    const save = [...document.querySelectorAll('.sheet button')].find((b) => /保存|确定/.test(b.textContent.trim()));
    if (save) save.click();
  });
  await sleep(1000);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sched-open')];
    if (rows[0]) rows[0].click();
  });
  await sleep(800);
  const stripText = await page.evaluate(() => document.querySelector('.sheet .remind-strip')?.innerText ?? '');
  check('日程弹层里有「从日程生成周期账单」', stripText.includes('从日程生成周期账单'), stripText.replace(/\n/g, ' '));
  await page.evaluate(() => {
    const strip = document.querySelector('.sheet .remind-strip');
    const btn = strip ? strip.querySelector('button') : null;
    if (btn) btn.click();
  });
  await sleep(900);
  const toast = await page.evaluate(() => document.querySelector('.toast')?.innerText ?? '');
  check('生成后提示成功', toast.includes('周期账单'), toast);

  await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
    if (tiles[0]) tiles[0].click();
  });
  await sleep(1000);
  await page.goto(`${BASE}#/recurring`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(500);
  check('周期账单页出现从日程生成的那条', (await page.evaluate(() => document.body.innerText)).includes('还信用卡'));

  /* ---------------------------------------------- 10. 忆小尘跨模块 */
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.assistant-fab', { timeout: 15000 });
  await page.click('.assistant-fab');
  await sleep(800);
  const sugs = await page.$$eval('.assistant-sug', (els) => els.map((e) => e.textContent.trim()));
  check('有「花了几次」的提问建议', sugs.includes('这个月看电影花了几次'), sugs.join('|'));
  check('有「这一周怎么样」的提问建议', sugs.includes('这一周怎么样'));
  check('有「下周有几场活动」的提问建议', sugs.includes('下周有几场活动'));
  check('有「接下来要付哪些账单」的提问建议', sugs.includes('接下来要付哪些账单'));

  async function ask(text) {
    await page.evaluate((v) => {
      const el = document.querySelector('.assistant-input textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(200);
    await page.click('.assistant-send');
    await sleep(1600);
    const bubbles = await page.$$eval('.assistant-bubble', (els) => els.map((e) => e.innerText));
    return bubbles[bubbles.length - 1] ?? '';
  }

  const a1 = await ask('这个月花了几笔');
  check('忆小尘回答了笔数清单', a1.includes('笔'), a1.replace(/\n/g, ' / ').slice(0, 80));
  const a2 = await ask('接下来要付哪些账单');
  check('忆小尘回答了账单问题', /账单|固定/.test(a2), a2.replace(/\n/g, ' / ').slice(0, 80));
  const a3 = await ask('下周有几场活动');
  check('忆小尘回答了日程预估', /日程|预估|大概/.test(a3), a3.replace(/\n/g, ' / ').slice(0, 80));
  const a4 = await ask('这一周怎么样');
  check('忆小尘回答了周报', /周|支出|花/.test(a4), a4.replace(/\n/g, ' / ').slice(0, 80));

  /* ---------------------------------------------- 11. 三语 */
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
    await page.goto(`${BASE}#/weekly`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.page-title', { timeout: 15000 });
    const title = await page.$eval('.page-title', (e) => e.textContent.trim());
    check(`${lang} 周报页标题已翻译`, title.length > 0 && title !== 'weekly.title', title);
  }
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

  await page.goto(`${BASE}#/weekly`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.weekly-hero');
  await page.screenshot({ path: '.shots/crossmod-weekly.png' });
} finally {
  await browser.close();
}

console.log(`\nCROSSMOD CHECK: ${fail === 0 ? 'PASS' : 'FAIL'}  (${pass} passed, ${fail} failed)`);
if (fail > 0) process.exitCode = 1;
