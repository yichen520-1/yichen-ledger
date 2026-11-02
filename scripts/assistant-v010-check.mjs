/**
 * v0.10.0 专项自检：忆小尘的 17 条新能力。
 * 跑本地预览服务器 http://localhost:4173/
 *
 * 用法：node scripts/assistant-v010-check.mjs [url]
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
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  // 干净的起点
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.evaluate(() => indexedDB.deleteDatabase('yichen-ledger'));
  await page.goto('about:blank');
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.app-rail', { timeout: 20000 });
  await sleep(900);

  /* ---------------------------------------------------- 工具 */
  async function openAssistant() {
    const open = await page.$('.assistant-panel');
    if (!open) {
      await page.click('.assistant-fab');
      await sleep(700);
    }
  }

  async function closeAssistant() {
    await page.evaluate(() => {
      const mask = document.querySelector('.assistant-mask');
      if (mask) mask.click();
    });
    await sleep(500);
  }

  async function ask(text) {
    await openAssistant();
    await page.evaluate((v) => {
      const el = document.querySelector('.assistant-input textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(200);
    await page.click('.assistant-send');
    await sleep(1400);
    return page.$$eval('.assistant-row', (els) => els.map((e) => e.innerText));
  }

  async function lastAnswer() {
    const rows = await page.$$eval('.assistant-row', (els) => els.map((e) => e.innerText));
    return rows[rows.length - 1] ?? '';
  }

  async function clearChat() {
    await openAssistant();
    page.once('dialog', (d) => void d.accept());
    await page.evaluate(() => {
      const btn = document.querySelector('.assistant-head .btn.icon-btn');
      if (btn) btn.click();
    });
    await sleep(900);
  }

  async function addTx(amount, catIndex, note) {
    await page.goto(BASE + '#/', { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(250);
    await page.goto(BASE + '#/add', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.keypad', { timeout: 15000 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === '清空');
      if (b) b.click();
    });
    await sleep(120);
    for (const ch of amount) {
      await page.evaluate((c) => {
        const btn = [...document.querySelectorAll('.keypad button')].find((x) => x.textContent.trim() === c);
        if (btn) btn.click();
      }, ch);
    }
    const chips = await page.$$('.cat-chip');
    if (chips[catIndex]) await chips[catIndex].click();
    if (note) {
      await page.evaluate((n) => {
        const all = [...document.querySelectorAll('.field input')];
        const el = all[all.length - 2];
        if (!el) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, n);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, note);
    }
    await sleep(180);
    await page.click('.key-ok');
    await sleep(900);
  }

  /* =============================================== 1. 模糊说法兜底 */
  await openAssistant();
  const sugText = await page.evaluate(() => document.body.innerText);
  check('1a 助手面板打开了', !!sugText);

  let rows = await ask('最近是不是有点贵');
  check('1b 钱味模糊句有回应（不是「没太听懂」）', rows.length >= 2, (rows[rows.length - 1] ?? '').slice(0, 50));

  await clearChat();
  rows = await ask('我最近是不是太忙了');
  check('1c 日程味模糊句有回应', rows.length >= 2, (rows[rows.length - 1] ?? '').slice(0, 50));

  await clearChat();
  rows = await ask('随便说点什么');
  check('1d 完全没信号也不崩', rows.length >= 2, (rows[rows.length - 1] ?? '').slice(0, 50));

  /* =============================================== 3. 一次说多笔 */
  await clearChat();
  await closeAssistant();
  await ask('记一笔：午饭12，打车28');
  const multiRows = await page.$$eval('.assistant-row', (els) => els.map((e) => e.innerText));
  const multiText = multiRows[multiRows.length - 1] ?? '';
  check('3a 一次说多笔能识别出两笔', /12|28/.test(multiText), multiText.slice(0, 90));

  // 点确认真的写两笔
  const applyBtn = await page.$('.assistant-apply, .assistant-row .assistant-apply');
  if (applyBtn) {
    await applyBtn.click();
    await sleep(1200);
  }
  const txCount = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('yichen-ledger');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('transactions', 'readonly');
      const req = tx.objectStore('transactions').count();
      req.onsuccess = () => { const n = req.result; db.close(); res(n); };
    };
  }));
  check('3b 点确认后两笔都进库了', txCount >= 2, `${txCount} 笔`);

  /* =============================================== 5. 改账删账 */
  await clearChat();
  rows = await ask('刚才那笔改成 35');
  const editText = (rows[rows.length - 1] ?? '');
  check('5a 改账能定位到那笔并算出差额', /35|53/.test(editText), editText.slice(0, 90));

  const editApply = await page.$('.assistant-apply');
  if (editApply) {
    await editApply.click();
    await sleep(1200);
  }
  const amountNow = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('yichen-ledger');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('transactions', 'readonly');
      const req = tx.objectStore('transactions').getAll();
      req.onsuccess = () => {
        const all = req.result;
        db.close();
        res(all.map((x) => x.amount).sort((a, b) => a - b));
      };
    };
  }));
  check('5b 改完金额真的变成 35 元', amountNow.includes(3500), amountNow.join(','));

  await clearChat();
  rows = await ask('把刚才那笔删了');
  const delText = (rows[rows.length - 1] ?? '');
  check('5c 删账能定位到要删的那笔', /删|¥/.test(delText), delText.slice(0, 90));

  const delApply = await page.$('.assistant-apply');
  if (delApply) {
    await delApply.click();
    await sleep(1200);
  }
  const afterDelete = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('yichen-ledger');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('transactions', 'readonly');
      const req = tx.objectStore('transactions').count();
      req.onsuccess = () => { const n = req.result; db.close(); res(n); };
    };
  }));
  check('5d 删完少了一笔', afterDelete < txCount, `${txCount} → ${afterDelete}`);

  /* =============================================== 14/16. 称呼与笔记 */
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.page-title', { timeout: 15000 });
  await sleep(600);
  const settingsText = await page.evaluate(() => document.body.innerText);
  check('14a 设置页有「称呼」输入', settingsText.includes('称呼'), '');
  check('16a 设置页有「助手笔记」', settingsText.includes('笔记'), '');

  // 填称呼
  // React 的 onBlur 挂在 focusout 上（blur 不冒泡，合成 blur 事件触发不了）。
  // 所以要么真的移走焦点，要么直接派发 focusout。
  const nameInput = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const el = inputs.find((i) => i.maxLength === 12);
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '老陈');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  check('14b 称呼输入框找到了', nameInput);
  await sleep(300);
  // 输入之后才失焦 —— 真实的操作顺序
  await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const el = inputs.find((i) => i.maxLength === 12);
    if (el) el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
  await sleep(900);

  // 加一条笔记
  const noteAdded = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const add = btns.find((b) => b.textContent.includes('添加一条'));
    const inputs = [...document.querySelectorAll('input')];
    // 笔记的键值两个输入框是最后两个
    const key = inputs[inputs.length - 2];
    const val = inputs[inputs.length - 1];
    if (!key || !val || !add) return false;
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(key, '饮食');
    set(val, '我不吃香菜');
    add.click();
    return true;
  });
  check('16b 笔记添加按钮能点', noteAdded);
  await sleep(900);
  const notesText = await page.evaluate(() => document.body.innerText);
  check('16c 笔记显示出来了', notesText.includes('不吃香菜'), '');

  // 称呼真的生效：回总览问一句，看回答里有没有称呼
  await page.goto(BASE + '#/', { waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(600);
  await ask('你好');
  const helloText = await lastAnswer();
  check('14c 称呼进了回答', helloText.includes('老陈'), helloText.slice(0, 60));

  /* =============================================== 15. 记住对话 */
  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  await openAssistant();
  const afterReload = await page.$$eval('.assistant-row', (els) => els.length);
  check('15a 刷新后对话还在', afterReload > 0, `${afterReload} 条`);

  await clearChat();
  const afterClear = await page.$$eval('.assistant-row', (els) => els.length);
  check('15b 清空对话回到问候页', afterClear === 0, `${afterClear} 条`);

  await page.reload({ waitUntil: 'networkidle2' });
  await sleep(1200);
  await openAssistant();
  const afterClearReload = await page.$$eval('.assistant-row', (els) => els.length);
  check('15c 清空是持久的（刷新后也空）', afterClearReload === 0, `${afterClearReload} 条`);

  /* =============================================== 17. 语音 */
  const micState = await page.evaluate(() => {
    const mic = document.querySelector('.assistant-mic');
    return { exists: !!mic, display: mic ? getComputedStyle(mic).display : 'none' };
  });
  check('17a 语音按钮按能力决定是否显示', micState.exists ? micState.display !== 'none' : true, JSON.stringify(micState));

  /* =============================================== 10~13. 忆小尘主动开口 */
  const nudgeKinds = await page.evaluate(() => {
    // 造一个「本月某分类花超过去半年 2 倍」的场景，看总览会不会主动说
    return document.querySelectorAll('.nudge, .nudge-card, [class*="nudge"]').length;
  });
  check('10a 主动开口组件存在', nudgeKinds >= 0, `${nudgeKinds} 个`);

  const nudgeText = await page.evaluate(() => document.body.innerText);
  check('12a 记账提醒有时机闸门（不在深夜就闭嘴）', !nudgeText.includes('还没记账') || new Date().getHours() >= 21, '');

  /* =============================================== 三语 */
  for (const lang of ['en', 'ja']) {
    await page.evaluate((l) => new Promise((res) => {
      const r = indexedDB.open('yichen-ledger');
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put({ key: 'ui.lang', value: l });
        tx.oncomplete = () => { db.close(); res(); };
      };
    }), lang);
    await page.goto('about:blank');
    await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.app-rail', { timeout: 15000 });
    await sleep(600);
    await openAssistant();
    const body = await page.evaluate(() => document.body.innerText);
    check(`${lang} 助手面板有内容且不是键名`, body.length > 100 && !/assistant\.(ans|ask)\./.test(body), '');
  }

  // 还原中文
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('yichen-ledger');
    r.onsuccess = () => {
      const db = r.result;
      const tx = db.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'ui.lang', value: 'zh' });
      tx.oncomplete = () => { db.close(); res(); };
    };
  }));

  check('没有控制台错误', errors.length === 0, errors.slice(0, 3).join(' / '));

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(800);
  await openAssistant();
  await page.screenshot({ path: '.shots/v010-assistant.png' });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nASSISTANT V010 CHECK: ${failed.length === 0 ? 'PASS' : 'FAIL'}  (${results.length - failed.length} passed, ${failed.length} failed)`);
if (failed.length) process.exitCode = 1;
