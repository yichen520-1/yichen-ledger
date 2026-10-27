/**
 * 深度流程测试：预算 → 账户 → 编辑账目 → 删除 → 分类管理。
 * 这些路径冒烟脚本没覆盖，容易藏回归。
 * 用法：node scripts/flows.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const URL_BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const errors = [];
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--lang=zh-CN'],
});

try {
  mkdirSync(`${OUT}`, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  // 用新 profile 保证从「首次启动」开始，和真实用户一致
  await page.goto(`${URL_BASE}#/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.networth', { timeout: 10000 });

  // ---------- 1. 新建预算 ----------
  await page.goto(`${URL_BASE}#/budgets`, { waitUntil: 'networkidle2' });
  await sleep(400);
  const newBtn = await page.$$('.page-head button');
  await newBtn[0].click();
  await page.waitForSelector('.sheet', { timeout: 5000 });
  await sleep(560); // 等入场动画结束，动画期间输入框还在屏幕外
  // sheet 里只有「金额」一个 input（分类和周期是 select）
  const inputs = await page.$$('.sheet input');
  await inputs[0].click({ clickCount: 3 });
  await inputs[0].type('1000');
  const sheetBtns = await page.$$('.sheet button');
  await sheetBtns[sheetBtns.length - 1].click();
  await sleep(700);
  const budgetRows = await page.$$eval('.progress-line', (els) => els.length);
  check('新建总预算后出现进度条', budgetRows >= 1, `progress-line=${budgetRows}`);

  // ---------- 2. 超支变色 ----------
  await page.goto(`${URL_BASE}#/add`, { waitUntil: 'networkidle2' });
  await sleep(400);
  for (const k of ['1', '5', '0', '0']) {
    const btns = await page.$$('.keypad button');
    for (const b of btns) {
      if ((await b.evaluate((el) => el.textContent.trim())) === k) { await b.click(); break; }
    }
  }
  const chips = await page.$$('.cat-chip');
  await chips[0].click();
  await sleep(150);
  await page.click('.key-ok');
  await sleep(800);
  await page.goto(`${URL_BASE}#/budgets`, { waitUntil: 'networkidle2' });
  await sleep(500);
  const over = await page.$$eval('.progress-line.over', (els) => els.length);
  check('花超后预算标红', over >= 1, `over=${over}`);
  await page.screenshot({ path: `${OUT}/f-budget-over.png` });

  // ---------- 3. 新建账户 ----------
  await page.goto(`${URL_BASE}#/accounts`, { waitUntil: 'networkidle2' });
  await sleep(400);
  const addBtn = (await page.$$('.page-head button'))[0];
  await addBtn.click();
  await page.waitForSelector('.sheet', { timeout: 5000 });
  await sleep(560); // 等入场动画结束，动画期间输入框还在屏幕外
  const accInputs = await page.$$('.sheet input');
  await accInputs[0].click({ clickCount: 3 });
  await accInputs[0].type('招商银行');
  const accBtns = await page.$$('.sheet button');
  await accBtns[accBtns.length - 1].click();
  await sleep(700);
  const accText = await page.$eval('main', (el) => el.innerText);
  check('新账户出现在列表', accText.includes('招商银行'));
  await page.screenshot({ path: `${OUT}/f-accounts.png` });

  // ---------- 4. 编辑已有账目 ----------
  await page.goto(`${URL_BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(500);
  // 注意：底部 tabbar 是 fixed 的，puppeteer 的原生 click 会做命中测试，
  // 滚到底部的行容易被 tabbar 挡住。这里直接在页面里派发 click，绕开命中测试。
  const clicked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.tx-row')];
    // 账户行没有 chevron，带 svg 的才是账目行
    const txRow = rows.find((el) => el.querySelector('svg'));
    if (!txRow) return false;
    txRow.click();
    return true;
  });
  await sleep(800);
  const hash = await page.evaluate(() => location.hash);
  check('点账目能进编辑页', clicked && hash.startsWith('#/edit/'), `clicked=${clicked} hash=${hash}`);

  const title = await page.$eval('.page-title', (el) => el.textContent);
  check('编辑页标题为「修改记录」', title.includes('修改记录'), title);

  const beforeEdit = await page.$eval('.amount-display', (el) => el.textContent.trim());
  check('编辑页带出原金额', beforeEdit.includes('1500'), beforeEdit);

  // 改成 200 元，然后保存。用「清空」键而不是连点退格（连点会和 React 状态更新赛跑）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.keypad button')].find((el) => el.textContent.trim() === '清空');
    b?.click();
  });
  await sleep(120);
  for (const k of ['2', '0', '0']) {
    await page.evaluate((key) => {
      const b = [...document.querySelectorAll('.keypad button')].find((el) => el.textContent.trim() === key);
      b?.click();
    }, k);
    await sleep(60);
  }
  const afterType = await page.$eval('.amount-display', (el) => el.textContent.trim());
  check('键盘输入生效', afterType.startsWith('200'), afterType);
  const okDisabled = await page.$eval('.key-ok', (el) => el.disabled);
  check('保存按钮可用', !okDisabled, `disabled=${okDisabled}`);

  await page.evaluate(() => document.querySelector('.key-ok')?.click());
  await sleep(900);
  const afterHash = await page.evaluate(() => location.hash);
  const homeText = await page.$eval('main', (el) => el.innerText);
  check('保存后回到总览', afterHash === '#/' || afterHash === '', afterHash);
  check('修改后金额生效', homeText.includes('¥200.00'), homeText.slice(0, 80).replace(/\n/g, ' | '));
  await page.screenshot({ path: `${OUT}/f-after-edit.png` });

  // ---------- 5. 分类管理：新增分类 ----------
  await page.goto(`${URL_BASE}#/categories`, { waitUntil: 'networkidle2' });
  await sleep(400);
  const catAdd = (await page.$$('.page-head button'))[0];
  await catAdd.click();
  await page.waitForSelector('.sheet', { timeout: 5000 });
  await sleep(560); // 等入场动画结束，动画期间输入框还在屏幕外
  const catInputs = await page.$$('.sheet input');
  await catInputs[0].click({ clickCount: 3 });
  await catInputs[0].type('咖啡');
  const catBtns = await page.$$('.sheet button');
  await catBtns[catBtns.length - 1].click();
  await sleep(700);
  const catText = await page.$eval('main', (el) => el.innerText);
  check('新分类出现在列表', catText.includes('咖啡'));
  await page.screenshot({ path: `${OUT}/f-categories.png` });

  // ---------- 6. 数据在刷新后仍然存在 ----------
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(800);
  const afterReload = await page.$eval('main', (el) => el.innerText);
  check('刷新后分类仍在（IndexedDB 持久化）', afterReload.includes('咖啡'));

  // ---------- 7. 深色主题变量 ----------
  const bg = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
  check('主题变量已加载', bg === '#0f1216', bg);
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
if (errors.length) {
  console.log('\n控制台错误：');
  for (const e of errors) console.log(' -', e);
}
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
process.exitCode = failed.length || errors.length ? 1 : 0;
