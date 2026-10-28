/**
 * 闲聊自检：确认「你好」这类话有人接，而不是一律「没太听懂」。
 * 用法：node scripts/chat-check.mjs [url]
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

  // 先记两笔，好验证「闲聊不抢账本问题」
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
    await sleep(150);
    await page.click('.key-ok');
    await sleep(800);
  }
  await addTx('125');
  await page.goto(`${BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(700);

  await page.click('.assistant-fab');
  await page.waitForSelector('.assistant-panel', { timeout: 5000 });
  await sleep(400);

  // 没填 Key 的时候徽章必须是「本地」，否则用户会以为自己在用云端
  const badge = await page.$eval('.assistant-badge', (el) => el.textContent.trim());
  check('没填 Key 时徽章显示本地', !/云端/.test(badge), badge);

  async function ask(text) {
    const before = await page.$$eval('.assistant-row', (els) => els.length);
    await page.click('.assistant-input textarea');
    await page.type('.assistant-input textarea', text);
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (n) => {
        const rows = document.querySelectorAll('.assistant-row');
        if (rows.length < n + 2) return false;
        return document.querySelectorAll('.assistant-bubble.typing').length === 0;
      },
      { timeout: 10000 },
      before,
    );
    await sleep(250);
    const rows = await page.$$eval('.assistant-row', (els) => els.map((e) => e.textContent.trim()));
    return rows[rows.length - 1];
  }

  // ---------- 1. 打招呼 ----------
  const hi = await ask('你好');
  check('「你好」有人接', !hi.includes('没太听懂') && hi.length > 4, hi);
  check('「你好」回得自然', /在呢|你好|哈|嗨|今天/.test(hi), hi);

  // ---------- 2. 问你是谁 ----------
  const who = await ask('你是谁');
  check('「你是谁」能介绍自己', who.includes('忆小尘'), who);

  // ---------- 3. 问能做什么 ----------
  const cap = await ask('你能做什么');
  check('「你能做什么」给出能力清单', /查账|记账|日程|闲聊/.test(cap), cap.slice(0, 60));

  // ---------- 4. 道谢 / 道别 ----------
  const thx = await ask('谢谢');
  check('「谢谢」有回应', thx.length > 2 && !thx.includes('没太听懂'), thx);

  // ---------- 5. 算术 ----------
  const math = await ask('12+30等于多少');
  check('算术题算得对', math.includes('42'), math);

  // ---------- 6. 问时间 ----------
  const clock = await ask('现在几点了');
  check('能报时', /\d{2}:\d{2}/.test(clock), clock);

  // ---------- 7. 问日期 ----------
  const date = await ask('今天几号');
  check('能报日期', /\d{4}-\d{2}-\d{2}/.test(date), date);

  // ---------- 8. 说心情 ----------
  const mood = await ask('今天好累');
  check('说心情有人接', mood.length > 6 && !mood.includes('没太听懂'), mood.slice(0, 50));
  check('「累」不会被答成「难过」', mood.includes('歇'), mood);

  const sad = await ask('我很难过');
  check('「难过」有对应的安慰', sad.length > 6 && !sad.includes('没太听懂'), sad.slice(0, 50));

  // ---------- 8b. 应答 / 邀请聊天 ----------
  const ack = await ask('嗯');
  check('「嗯」不被当成听不懂', !ack.includes('没太听懂'), ack);

  const invite = await ask('随便聊聊');
  check('「随便聊聊」不往回推记账', !invite.includes('没太听懂'), invite);

  await page.screenshot({ path: `${OUT}/chat-smalltalk.png` });

  // ---------- 9. 闲聊层不能抢走账本问题 ----------
  const spend = await ask('这个月花了多少');
  check('账本问题仍走数据', spend.includes('125') || spend.includes('1.25'), spend);

  const cat = await ask('哪一类花得最多');
  check('分类问题仍走数据', cat.includes('餐饮'), cat);

  // ---------- 10. 追问 ----------
  const follow = await ask('那上个月呢');
  check('追问能被理解', !follow.includes('没太听懂'), follow);
  check('追问答的是上个月', follow.includes('上月') || follow.includes('没有'), follow);

  // ---------- 11. 真正听不懂的话给出引导 ----------
  const weird = await ask('把冰箱搬到楼上去');
  check('听不懂时给引导而不是装懂', weird.includes('可以问我') || weird.includes('没太听懂'), weird.slice(0, 60));

  // ---------- 12. 记一笔仍然要确认 ----------
  const beforeTx = await page.evaluate(async () => {
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
  const rec = await ask('记一笔午饭 25');
  check('记账指令仍给确认按钮', (await page.$('.assistant-apply')) !== null, rec);
  const afterTx = await page.evaluate(async () => {
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
  check('确认前不写库', afterTx === beforeTx, `${beforeTx} → ${afterTx}`);

  await page.screenshot({ path: `${OUT}/chat-final.png` });
  check('全程没有控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\nCHAT CHECK: ${fail === 0 ? 'PASS' : 'FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
