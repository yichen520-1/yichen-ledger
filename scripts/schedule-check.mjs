// 忆尘日程自检：模式切换、月视图、新建日程、重复规则、搜索、跨模式导航
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4173/';
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
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN', '--window-size=430,932'],
});
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => new Promise((r) => {
  const req = indexedDB.deleteDatabase('yichen-ledger');
  req.onsuccess = req.onerror = req.onblocked = () => r();
}));
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1200);

// 1. 默认是记账模式，侧边栏有「记一笔」
const ledgerNav = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()),
);
check('默认记账模式导航', ledgerNav.some((s) => s.includes('记一笔')), ledgerNav.join('/'));
check('侧边栏有模式切换钮', (await page.$('.mode-switch')) !== null);

// 2. 切到日程模式（手机宽度下侧边栏是隐藏的，点的是底部导航里的紧凑版）
async function clickMode(index) {
  await page.evaluate((i) => {
    const groups = [...document.querySelectorAll('.mode-switch')].filter((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    groups[0]?.querySelectorAll('.mode-switch-track button')[i]?.click();
  }, index);
}
await clickMode(1);
await sleep(700);
const afterSwitch = await page.evaluate(() => ({
  hash: location.hash,
  title: document.querySelector('.page-title')?.textContent ?? '',
  nav: [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()),
  hasMonth: !!document.querySelector('.sched-month'),
  cells: document.querySelectorAll('.sched-cell').length,
  weekdays: [...document.querySelectorAll('.sched-wd')].map((d) => d.textContent.trim()),
}));
check('切到日程后路由正确', afterSwitch.hash === '#/schedule', afterSwitch.hash);
check('日程页标题', afterSwitch.title === '忆尘日程', afterSwitch.title);
check('导航换成日程导航', afterSwitch.nav.some((s) => s.includes('日程')) && !afterSwitch.nav.some((s) => s.includes('记一笔')), afterSwitch.nav.join('/'));
check('月视图渲染', afterSwitch.hasMonth);
check('月视图 42 格', afterSwitch.cells === 42, String(afterSwitch.cells));
check('周标题是 一二三四五六日', afterSwitch.weekdays.join('') === '一二三四五六日', afterSwitch.weekdays.join(''));

// 3. 新建一条日程
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.page-actions button')].find((x) => x.textContent.includes('新建日程'));
  b?.click();
});
await sleep(700);
await page.waitForSelector('.sheet', { timeout: 5000 });
await sleep(560);
await page.type('.sheet .field input.input', '和设计对稿');
// 时间：React 受控输入必须走原生 setter，直接赋 el.value 不会触发 onChange
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const list = [...document.querySelectorAll('.sheet input[type="time"]')];
  const put = (el, v) => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (list[0]) put(list[0], '14:00');
  if (list[1]) put(list[1], '15:30');
});
await sleep(300);
// 提醒：提前 15 分钟
await page.evaluate(() => {
  const c = [...document.querySelectorAll('.sheet .chip')].find((x) => x.textContent.includes('15分钟'));
  c?.click();
});
await sleep(150);
const saveBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.sheet .sheet-actions button')].find((b) => b.textContent.includes('保存')),
);
await saveBtn.asElement().click();
await sleep(900);

const afterCreate = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.sched-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  toast: document.querySelector('.toast')?.textContent ?? '',
}));
check('新建后列表出现日程', afterCreate.rows.some((r) => r.includes('和设计对稿')), afterCreate.rows[0] ?? '(空)');
check('时间显示正确', afterCreate.rows.some((r) => r.includes('14:00') && r.includes('15:30')));

// 4. 完成勾选
await page.evaluate(() => document.querySelector('.sched-check')?.click());
await sleep(500);
const doneState = await page.evaluate(() => ({
  done: !!document.querySelector('.sched-row.done'),
}));
check('勾选后标记完成', doneState.done);

// 5. 周视图 / 日视图切换
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.segmented.compact button')].find((x) => x.textContent.trim() === '周');
  b?.click();
});
await sleep(500);
const week = await page.evaluate(() => ({
  cols: document.querySelectorAll('.sched-weekcol').length,
  chips: document.querySelectorAll('.sched-chip').length,
}));
check('周视图 7 列', week.cols === 7, String(week.cols));
check('周视图能看到日程条', week.chips >= 1, String(week.chips));

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.segmented.compact button')].find((x) => x.textContent.trim() === '日');
  b?.click();
});
await sleep(500);
const day = await page.evaluate(() => ({
  head: document.querySelector('.sched-dayhead')?.textContent ?? '',
  rows: document.querySelectorAll('.sched-row').length,
}));
check('日视图有日期标题', day.head.includes('月') && day.head.includes('日'), day.head);

// 6. 搜索
await page.evaluate(() => {
  const b = [...document.querySelectorAll('.page-actions button')].find((x) => x.getAttribute('aria-label') === '搜索');
  b?.click();
});
await sleep(500);
await page.type('.search-box input', '设计');
await sleep(700);
const search = await page.evaluate(() => ({
  rows: document.querySelectorAll('.search-box .sched-row').length,
  empty: !!document.querySelector('.search-box .empty'),
}));
check('搜索命中', search.rows >= 1, `rows=${search.rows} empty=${search.empty}`);

// 7. 切回记账模式
await clickMode(0);
await sleep(700);
const back = await page.evaluate(() => ({
  hash: location.hash,
  networth: document.querySelector('.networth')?.textContent?.trim() ?? '',
}));
check('切回记账模式', back.hash === '#/' && back.networth.length > 0, `${back.hash} ${back.networth}`);

// 8. 刷新后模式保持
await clickMode(1);
await sleep(600);
await page.reload({ waitUntil: 'networkidle2' });
await sleep(1200);
const persisted = await page.evaluate(() => ({
  hash: location.hash,
  title: document.querySelector('.page-title')?.textContent ?? '',
}));
check('刷新后仍是日程模式', persisted.title === '忆尘日程', `${persisted.hash} ${persisted.title}`);

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\nSCHEDULE CHECK: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);
