/**
 * v0.10.1 专项自检：两个模式的「答非所问」。
 *
 * 这一版全部是修 bug，所以脚本的写法就是「把当初出问题的问法再问一遍」：
 * 用户截图里那句「你好」、把「安排」当成建日程、日程模式里说记账的话…
 * 每条断言都对应一个真实会遇到的问法，不是编出来的边界。
 */
import puppeteer from 'puppeteer-core';

const BASE = process.argv[2] ?? 'http://localhost:4173/';
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

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(900);

  /** 切到某个 App */
  async function switchTo(mode) {
    await page.evaluate((m) => {
      const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
      const idx = m === 'ledger' ? 0 : 1;
      if (tiles[idx]) tiles[idx].click();
    }, mode);
    await sleep(700);
  }

  /** 打开忆小尘并问一句，返回回答文本 */
  async function ask(text) {
    const open = await page.$('.assistant-panel');
    if (!open) {
      await page.click('.assistant-fab');
      await sleep(900);
    }
    await page.evaluate((v) => {
      const el = document.querySelector('.assistant-input textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(180);
    await page.click('.assistant-send');
    await sleep(1400);
    const bubbles = await page.$$eval('.assistant-bubble', (els) => els.map((e) => e.innerText.trim()));
    return bubbles[bubbles.length - 1] ?? '';
  }

  async function closePanel() {
    await page.evaluate(() => {
      const btns = document.querySelectorAll('.assistant-head .btn.icon-btn');
      if (btns[btns.length - 1]) btns[btns.length - 1].click();
    });
    await sleep(500);
  }

  /* ============================================ 1. 用户截图里那一幕：日程模式说「你好」 */
  await switchTo('schedule');
  const hello = await ask('你好');
  check('日程模式「你好」不再是「这周没有日程」', !/这周没有日程|没有日程/.test(hello), hello.replace(/\n/g, ' / ').slice(0, 50));
  check('日程模式「你好」有实际回应', hello.length > 4, hello.replace(/\n/g, ' / ').slice(0, 50));

  const thanks = await ask('谢谢');
  check('日程模式「谢谢」不再是日程清单', !/没有日程|个日程/.test(thanks), thanks.replace(/\n/g, ' / ').slice(0, 40));

  const who = await ask('你是谁');
  check('日程模式「你是谁」能自我介绍', /忆小尘|助手|我是/.test(who), who.replace(/\n/g, ' / ').slice(0, 40));

  const when = await ask('今天几号');
  check('日程模式「今天几号」答日期而不是日程', /\d{4}|\d{1,2}\s*月|\d{1,2}\s*日/.test(when), when.replace(/\n/g, ' / ').slice(0, 40));

  /* ============================================ 2. 「安排」不再被当成建日程 */
  const arrange = await ask('这周有什么安排');
  check('「这周有什么安排」不提议新建日程', !/新建|要不要.*加|加个日程|确认/.test(arrange), arrange.replace(/\n/g, ' / ').slice(0, 60));

  const weekend = await ask('周末有安排吗');
  check('「周末有安排吗」不提议新建日程', !/新建|要不要.*加|加个日程/.test(weekend), weekend.replace(/\n/g, ' / ').slice(0, 60));

  /* ============================================ 3. 跨模式提示 */
  const wrongSide = await ask('记一笔午饭25');
  check('日程模式说记账的话会指向记账那边', /记账|记一笔|另一边|那边/.test(wrongSide), wrongSide.replace(/\n/g, ' / ').slice(0, 60));

  const moneyQ = await ask('这个月花了多少');
  check('日程模式问花销不会被答成日程清单', !/个日程|没有日程/.test(moneyQ), moneyQ.replace(/\n/g, ' / ').slice(0, 50));

  await closePanel();
  await switchTo('ledger');

  /* ============================================ 4. 账本模式：说日程的话指向日程 */
  const schedSide = await ask('这周有什么安排');
  check('账本模式说日程的话会指向日程那边', /日程|另一边|那边|切换/.test(schedSide), schedSide.replace(/\n/g, ' / ').slice(0, 60));

  /* ============================================ 5. 账户余额 */
  const bal = await ask('账户余额');
  check('「账户余额」列出各账户而不是没听懂', !/没太听懂|没完全听懂/.test(bal), bal.replace(/\n/g, ' / ').slice(0, 60));

  const cashBal = await ask('现金还有多少');
  check('「现金还有多少」答得出', /现金|¥/.test(cashBal) && !/没太听懂/.test(cashBal), cashBal.replace(/\n/g, ' / ').slice(0, 60));

  /* ============================================ 6. 记账 + 批量 */
  const rec = await ask('记一笔：午饭12，打车28');
  check('一次说多笔会逐条列明细', /午饭|打车/.test(rec) && /12|28/.test(rec), rec.replace(/\n/g, ' / ').slice(0, 80));
  // 点确认真的写进去
  const applied = await page.evaluate(() => {
    const btn = document.querySelector('.assistant-apply');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('多笔有「全部记下」按钮', applied);
  await sleep(1200);

  /*
   * 批量归类：这里刻意不能只断言 /笔/ —— 兜底文案里就有「记一笔」，
   * 那会让「没听懂」也假通过。要断言的是「它认出了这件事」：
   * 要么给「确认改这 N 笔」，要么说「本来就是 X，不用改」（账目已经归好了）。
   */
  const bulk = await ask('这周打车那几笔都算交通');
  const bulkOk = /确认改这|本来就都是/.test(bulk);
  check('批量归类认得出来（不是「没太听懂」）', bulkOk && !/没太听懂|没完全听懂/.test(bulk), bulk.replace(/\n/g, ' / ').slice(0, 70));
  check('批量归类不出现「改 0 笔」的按钮', !/改这 0 笔|确认改这 \{n\}/.test(bulk), bulk.replace(/\n/g, ' / ').slice(0, 50));

  /* ============================================ 7. 三语不崩 */
  for (const lang of ['en', 'ja']) {
    await page.evaluate(
      (l) =>
        new Promise((r) => {
          const req = indexedDB.open('yichen-ledger');
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('settings', 'readwrite');
            tx.objectStore('settings').put({ key: 'ui.lang', value: l });
            tx.oncomplete = () => {
              db.close();
              r();
            };
          };
        }),
      lang,
    );
    await page.goto('about:blank');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('.app-rail', { timeout: 20000 });
    await sleep(800);
    const t = await ask('hello');
    check(`${lang} 模式闲聊不崩`, t.length > 0, t.replace(/\n/g, ' / ').slice(0, 40));
  }

  // 还原中文
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.open('yichen-ledger');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: 'ui.lang', value: 'zh' });
          tx.oncomplete = () => {
            db.close();
            r();
          };
        };
      }),
  );

  check('没有控制台错误', errors.length === 0, errors.slice(0, 3).join(' / '));

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-rail');
  await page.screenshot({ path: '.shots/v0101-home.png' });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nV0101 CHECK: ${failed.length === 0 ? 'PASS' : 'FAIL'} (${results.length - failed.length} 通过 / ${failed.length} 失败)`);
if (failed.length) process.exitCode = 1;
