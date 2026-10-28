/**
 * 忆小尘自检：入口出现的位置、问一句账、云端降级、待确认记账、日程模式。
 * 用法：node scripts/assistant-check.mjs [url]
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = '.shots';
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
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN', '--window-size=430,932'],
});

try {
  mkdirSync(OUT, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  // 干净起点
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('yichen-ledger');
        req.onsuccess = req.onerror = req.onblocked = () => r();
      }),
  );
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(1200);

  // ---------- 1. 入口只出现在该出现的页面 ----------
  const onHome = await page.$('.assistant-fab');
  check('总览页有忆小尘入口', onHome !== null);

  await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
  await sleep(500);
  check('记账页不显示入口（不挡数字键盘）', (await page.$('.assistant-fab')) === null);

  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle2' });
  await sleep(500);
  check('设置页不显示入口', (await page.$('.assistant-fab')) === null);

  // 先记两笔，后面才好问
  await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
  await sleep(600);
  async function addTx(amount) {
    for (const ch of amount) {
      const btns = await page.$$('.keypad button');
      for (const b of btns) {
        const label = await b.evaluate((el) => el.textContent.trim());
        if (label === ch) {
          await b.click();
          break;
        }
      }
    }
    const chips = await page.$$('.cat-chip');
    await chips[0].click();
    await sleep(200);
    await page.click('.key-ok');
    await sleep(900);
  }
  await addTx('125');
  await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
  await sleep(600);
  await addTx('350');
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(700);

  // ---------- 2. 打开面板 ----------
  await page.click('.assistant-fab');
  await page.waitForSelector('.assistant-panel', { timeout: 5000 });
  await sleep(500);
  check('面板能打开', (await page.$('.assistant-panel')) !== null);
  const badge = await page.$eval('.assistant-badge', (el) => el.textContent.trim());
  check('没填 Key 时标「本地规则」', badge.includes('本地'), badge);
  const sugs = await page.$$eval('.assistant-sug', (els) => els.map((e) => e.textContent.trim()));
  check('有可点的示例问法', sugs.length >= 3, sugs.join(' / '));
  await page.screenshot({ path: `${OUT}/assistant-open.png` });

  // ---------- 3. 问「这个月花了多少」 ----------
  async function ask(text) {
    const before = await page.$$eval('.assistant-row', (els) => els.length);
    await page.click('.assistant-input textarea');
    await page.type('.assistant-input textarea', text);
    await page.keyboard.press('Enter');
    // 等新的助手气泡出现（busy 点消失）
    await page.waitForFunction(
      (n) => {
        const rows = document.querySelectorAll('.assistant-row');
        if (rows.length < n + 2) return false;
        return document.querySelectorAll('.assistant-bubble.typing').length === 0;
      },
      { timeout: 8000 },
      before,
    );
    await sleep(200);
    return page.$$eval('.assistant-row', (els) => els.map((e) => e.textContent.trim()));
  }

  const afterSpend = await ask('这个月花了多少');
  const spendReply = afterSpend[afterSpend.length - 1];
  check('能答「这个月花了多少」', spendReply.includes('¥475.00') || spendReply.includes('475.00'), spendReply);
  check('回答里带笔数', /2\s*笔/.test(spendReply), spendReply);

  const afterCat = await ask('哪一类花得最多');
  const catReply = afterCat[afterCat.length - 1];
  check('能答「哪一类花得最多」', catReply.includes('餐饮'), catReply);

  const afterWorth = await ask('我现在有多少钱');
  const worthReply = afterWorth[afterWorth.length - 1];
  check('能答净资产', worthReply.includes('净资产') && worthReply.includes('¥'), worthReply);
  await page.screenshot({ path: `${OUT}/assistant-chat.png` });

  // ---------- 4. 记一笔：要用户点确认才落库 ----------
  const before = await page.$$eval('.assistant-row', (els) => els.length);
  await page.click('.assistant-input textarea');
  await page.type('.assistant-input textarea', '记一笔午饭 25');
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.assistant-row').length >= n + 2 && !document.querySelector('.assistant-bubble.typing'),
    { timeout: 8000 },
    before,
  );
  await sleep(300);
  const applyBtn = await page.$('.assistant-apply');
  check('记账指令给出「就这样记」按钮', applyBtn !== null);
  const txBefore = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('yichen-ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res) => {
      const t = db.transaction('transactions', 'readonly').objectStore('transactions').count();
      t.onsuccess = () => res(t.result);
    });
  });
  if (applyBtn) await applyBtn.click();
  await sleep(900);
  const txAfter = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('yichen-ledger');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return new Promise((res) => {
      const t = db.transaction('transactions', 'readonly').objectStore('transactions').count();
      t.onsuccess = () => res(t.result);
    });
  });
  check('点确认后才真正写库', txAfter === txBefore + 1, `${txBefore} → ${txAfter}`);
  const doneText = await page.$$eval('.assistant-row', (els) => els[els.length - 1].textContent.trim());
  check('确认后气泡变成「记好了」', doneText.includes('记好') || doneText.includes('记下'), doneText);

  // 关掉面板
  await page.evaluate(() => document.querySelector('.assistant-head .btn.icon-btn:last-child')?.click());
  await sleep(500);
  check('面板能收起', (await page.$('.assistant-panel')) === null);

  // 新记的这笔应该出现在总览
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(800);
  const net = await page.$eval('.networth', (el) => el.textContent.trim());
  check('总览净资产已更新', net.includes('500.00'), net);

  // ---------- 5. 日程模式 ----------
  await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.mode-switch')].filter((g) => {
      const r = g.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    groups[0]?.querySelectorAll('.mode-switch-track button')[1]?.click();
  });
  await sleep(900);
  const schedFab = await page.$('.assistant-fab');
  check('日程页有忆小尘入口', schedFab !== null);
  if (schedFab) await schedFab.click();
  await page.waitForSelector('.assistant-panel', { timeout: 5000 });
  await sleep(400);
  const title = await page.$eval('.assistant-id strong', (el) => el.textContent.trim());
  check('日程模式下叫「忆小尘 · 程」', title.includes('程'), title);

  // 切模式不丢对话，这是有意的；点「重新开始」才回到空白问候页
  const keptRows = await page.$$eval('.assistant-row', (els) => els.length);
  check('切模式后对话还在', keptRows > 0, `${keptRows} 条`);
  await page.evaluate(() => document.querySelector('.assistant-head .btn.icon-btn')?.click());
  await sleep(400);
  const schedSugs = await page.$$eval('.assistant-sug', (els) => els.map((e) => e.textContent.trim()));
  check('日程模式给的是日程示例', schedSugs.some((s) => s.includes('日程') || s.includes('空')), schedSugs.join(' / '));

  const afterSched = await ask('这周有几个日程');
  const schedReply = afterSched[afterSched.length - 1];
  check('能答日程数量', schedReply.includes('0') || schedReply.includes('没有'), schedReply);
  await page.screenshot({ path: `${OUT}/assistant-schedule.png` });

  check('全程没有控制台错误', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nASSISTANT CHECK: ${fail === 0 ? 'PASS' : 'FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
