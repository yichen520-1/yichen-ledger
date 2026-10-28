/**
 * 云端聊天自检
 * ------------------------------------------------------------------
 * 本地规则能接住「你好」，但真正的开放对话要靠模型。这条链路没法在
 * 单元测试里验（它要真发 HTTP），所以起一个假的 OpenAI 兼容服务，
 * 让界面真的走一遍「填了 Key → 走云端 → 带上下文 → 出错退回本地」。
 *
 * 用法：node scripts/cloud-chat-check.mjs
 */
import { createServer } from 'node:http';
import puppeteer from 'puppeteer-core';

const APP = 'http://localhost:4173/';
const MOCK_PORT = 4180;
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

/** 假模型：把收到的消息数原样回出来，好验证上下文确实带上了 */
let lastCall = null;
let mode = 'ok';

const mock = createServer((req, res) => {
  console.log(`  · mock ${req.method} ${req.url}`);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      /* 忽略 */
    }
    lastCall = parsed;

    if (mode === 'error') {
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'mock failure' } }));
      return;
    }

    const msgs = parsed.messages ?? [];
    const userTurns = msgs.filter((m) => m.role === 'user');
    const lastUser = userTurns[userTurns.length - 1]?.content ?? '';
    const hasContext = msgs.some((m) => m.role === 'system' && String(m.content).includes('账本'));

    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: `[云端] 收到「${lastUser}」｜上下文 ${hasContext ? '有' : '无'}｜轮次 ${userTurns.length}`,
            },
          },
        ],
      }),
    );
  });
});

await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
console.log(`mock listening on http://127.0.0.1:${MOCK_PORT}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(APP, { waitUntil: 'networkidle2' });
  await page.evaluate(
    () =>
      new Promise((r) => {
        const req = indexedDB.deleteDatabase('yichen-ledger');
        req.onsuccess = req.onerror = req.onblocked = () => r();
      }),
  );
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await sleep(1200);

  // 直接往 IndexedDB 里塞一份指向假服务的配置，省得在界面上点
  await page.evaluate(
    (port) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('yichen-ledger');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({
            key: 'ai.config',
            value: { provider: 'custom', baseUrl: `http://127.0.0.1:${port}`, apiKey: 'sk-test', model: 'mock-model' },
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    MOCK_PORT,
  );
  await page.goto(APP, { waitUntil: 'networkidle2' });
  await sleep(1200);

  await page.click('.assistant-fab');
  await page.waitForSelector('.assistant-panel', { timeout: 5000 });
  await sleep(500);

  const badge = await page.$eval('.assistant-badge', (el) => el.textContent.trim());
  check('填了 Key 徽章变云端', badge.includes('云端'), badge);

  async function ask(text, timeout = 12000) {
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
      { timeout },
      before,
    );
    await sleep(250);
    const rows = await page.$$eval('.assistant-row', (els) => els.map((e) => e.textContent.trim()));
    return rows[rows.length - 1];
  }

  // ---------- 1. 闲聊走云端 ----------
  const hi = await ask('你好');
  check('闲聊走云端', hi.includes('[云端]'), hi);
  check('云端拿到了账本上下文', hi.includes('上下文 有'), hi);

  // ---------- 2. 开放问题走云端 ----------
  const open = await ask('你觉得我该不该开始存钱');
  check('开放问题交给云端', open.includes('[云端]') && open.includes('该不该'), open);

  // ---------- 3. 上下文带上了前几轮 ----------
  // 发第三次，这时候前两轮应该作为 history 一起带过去
  const third = await ask('那你说说我该怎么记账');
  const history = lastCall.messages.filter((m) => m.role === 'user').map((m) => String(m.content));
  check('第三次请求带上了前两轮', history.length >= 3, `带了 ${history.length} 条 user`);
  check('历史里能找到第一句「你好」', history.some((h) => h.includes('你好')), history.join(' / '));
  check(
    '历史里能找到第二句',
    history.some((h) => h.includes('存钱')),
    history.join(' / '),
  );
  check('第三句本身也在请求里', third.includes('[云端]') && third.includes('记账'), third);
  const sys = lastCall.messages.find((m) => m.role === 'system');
  check('系统提示说明了身份', String(sys?.content).includes('忆小尘'), String(sys?.content).slice(0, 40));

  // ---------- 4. 账本数字仍然本地算，不交给模型 ----------
  const spend = await ask('这个月花了多少');
  check('数据问题仍本地算', !spend.includes('[云端]'), spend);

  // ---------- 5. 云端挂了要退回本地 ----------
  mode = 'error';
  const broke = await ask('随便说点什么');
  check('云端出错时说明原因', broke.includes('云端没答上来'), broke.slice(0, 60));
  check('云端出错不吞掉本地结果', broke.length > 20, broke.slice(0, 60));

  // ---------- 6. 云端挂了，闲聊照样有话说 ----------
  const hiFail = await ask('你好');
  check('云端挂了打招呼仍有人接', !hiFail.includes('没太听懂'), hiFail);
  check('闲聊失败时不叠技术报错', !hiFail.includes('云端没答上来'), hiFail);

  check('全程没有页面异常', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  mock.close();
}

console.log(`\nCLOUD CHAT: ${fail === 0 ? 'PASS' : 'FAIL'}  (${pass} passed, ${fail} failed)`);
process.exit(fail === 0 ? 0 : 1);
