/**
 * 冒烟脚本：用真实 Chrome 打开打包后的页面，走一遍「记账 → 看统计 → 备份」，
 * 顺便抓控制台错误，并给每个页面截图。
 * 用法：node scripts/smoke.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import puppeteer from 'puppeteer-core';

const URL_BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const errors = [];

function shot(page, name) {
  return page.screenshot({ path: `${OUT}/${name}.png` });
}

async function goto(page, hash) {
  await page.goto(`${URL_BASE}#${hash}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 300));
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--lang=zh-CN'],
});

try {
  mkdirSync(dirname(`${OUT}/x.png`), { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });

  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  // 1. 首屏：应已从「正在准备账本」切到真正的总览
  await goto(page, '/');
  await page.waitForSelector('.networth', { timeout: 10000 });
  console.log('OK 首页已渲染，净资产 =', await page.$eval('.networth', (el) => el.textContent));
  await shot(page, 'm-01-home');

  // 2. 记一笔：输入 38.50，选餐饮，保存
  await goto(page, '/add');
  await page.waitForSelector('.keypad', { timeout: 5000 });
  for (const k of ['3', '8', '.', '5', '0']) {
    const btns = await page.$$('.keypad button');
    for (const b of btns) {
      const t = await b.evaluate((el) => el.textContent.trim());
      if (t === k) {
        await b.click();
        break;
      }
    }
  }
  const shown = await page.$eval('.amount-display', (el) => el.textContent.trim());
  console.log('OK 金额输入 =', shown);
  // 没选分类时「完成」按钮应当是禁用的
  console.log('OK 未选分类时按钮禁用 =', await page.$eval('.key-ok', (el) => el.disabled));
  await shot(page, 'm-02-add');

  // 选第一个分类（餐饮）
  const chips = await page.$$('.cat-chip');
  await chips[0].click();
  await new Promise((r) => setTimeout(r, 200));
  console.log('OK 选完分类后按钮可用 =', !(await page.$eval('.key-ok', (el) => el.disabled)));
  await shot(page, 'm-02b-add-filled');

  await page.click('.key-ok');
  await new Promise((r) => setTimeout(r, 900));
  const path = await page.evaluate(() => location.hash);
  console.log('OK 保存后跳转 =', path);

  // 3. 回首页确认那笔账在列表里
  await goto(page, '/');
  const rows = await page.$$eval('.tx-row', (els) => els.length);
  const net = await page.$eval('.networth', (el) => el.textContent.trim());
  console.log('OK 首页记录条数 =', rows, '净资产 =', net);
  await shot(page, 'm-03-home-with-tx');

  // 4. 统计
  await goto(page, '/stats');
  await page.waitForSelector('.heatmap', { timeout: 5000 });
  await shot(page, 'm-04-stats');

  // 5. 预算
  await goto(page, '/budgets');
  await shot(page, 'm-05-budgets');

  // 6. 我的
  await goto(page, '/settings');
  await shot(page, 'm-06-settings');

  // 7. 账户 / 分类
  await goto(page, '/accounts');
  await shot(page, 'm-07-accounts');
  await goto(page, '/categories');
  await shot(page, 'm-08-categories');

  // 8. 桌面宽度，确认侧边栏布局
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await goto(page, '/');
  await shot(page, 'd-01-home');
  await goto(page, '/add');
  await shot(page, 'd-02-add');
  await goto(page, '/stats');
  await shot(page, 'd-03-stats');
} finally {
  await browser.close();
}

if (errors.length) {
  console.log('\n控制台错误：');
  for (const e of errors) console.log(' -', e);
  process.exitCode = 1;
} else {
  console.log('\n没有控制台错误。');
}
