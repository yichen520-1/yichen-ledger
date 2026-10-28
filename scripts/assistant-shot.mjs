/**
 * 抓忆小尘在桌面宽度下的样子（右下角卡片），只出图不做断言。
 * 用法：node scripts/assistant-shot.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
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

  // 记几笔，让回答有内容
  const seed = [
    { amount: '38.5', cat: 0 },
    { amount: '128', cat: 0 },
    { amount: '46', cat: 1 },
  ];
  for (const s of seed) {
    await page.goto(`${BASE}#/add`, { waitUntil: 'networkidle2' });
    await sleep(600);
    for (const ch of s.amount) {
      const btns = await page.$$('.keypad button');
      for (const b of btns) {
        if ((await b.evaluate((el) => el.textContent.trim())) === ch) {
          await b.click();
          break;
        }
      }
    }
    const chips = await page.$$('.cat-chip');
    await chips[s.cat].click();
    await sleep(200);
    await page.click('.key-ok');
    await sleep(800);
  }

  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(900);
  await page.click('.assistant-fab');
  await page.waitForSelector('.assistant-panel');
  await sleep(500);
  await page.screenshot({ path: `${OUT}/d-assistant-open.png` });

  async function ask(text) {
    const before = await page.$$eval('.assistant-row', (els) => els.length);
    await page.click('.assistant-input textarea');
    await page.type('.assistant-input textarea', text);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (n) =>
        document.querySelectorAll('.assistant-row').length >= n + 2 &&
        !document.querySelector('.assistant-bubble.typing'),
      { timeout: 8000 },
      before,
    );
    await sleep(250);
  }

  await ask('这个月花了多少');
  await ask('哪一类花得最多');
  await ask('预算还剩多少');
  await ask('记一笔午饭 25');
  await page.screenshot({ path: `${OUT}/d-assistant-chat.png` });

  // 点确认，看「记好了」的样子
  const apply = await page.$('.assistant-apply');
  if (apply) {
    await apply.click();
    await sleep(900);
  }
  await page.screenshot({ path: `${OUT}/d-assistant-applied.png` });
  console.log('SHOT OK');
} finally {
  await browser.close();
}
