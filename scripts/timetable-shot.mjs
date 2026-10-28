/**
 * 抓课表在手机与桌面两种宽度下的样子，只出图不做断言。
 * 用法：先 `npm run build && npx vite preview --port 4173`，再 node scripts/timetable-shot.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = '.shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/** 直接往 IndexedDB 里塞一份课表，省得一条条点表单 */
const SEED = `
(async () => {
  const open = () => new Promise((res, rej) => {
    const req = indexedDB.open('yichen-ledger');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await open();
  const tx = db.transaction(['courses', 'settings'], 'readwrite');
  const courses = [
    { name: '高等数学', teacher: '陈立群', location: 'A301', color: '#5aa9f0',
      sessions: [{ weekday: 1, startPeriod: 1, endPeriod: 2, parity: 'all', weekFrom: 1, weekTo: 16 },
                 { weekday: 3, startPeriod: 3, endPeriod: 4, parity: 'all', weekFrom: 1, weekTo: 16 }] },
    { name: '大学物理', teacher: '周敏', location: 'B202', color: '#4cc38a',
      sessions: [{ weekday: 2, startPeriod: 3, endPeriod: 4, parity: 'all', weekFrom: 1, weekTo: 16 }] },
    { name: '线性代数', teacher: '林清和', location: 'A105', color: '#ffb454',
      sessions: [{ weekday: 4, startPeriod: 1, endPeriod: 2, parity: 'odd', weekFrom: 1, weekTo: 15 }] },
    { name: '程序设计', teacher: '何知远', location: '机房 3', color: '#b48cf2',
      sessions: [{ weekday: 3, startPeriod: 6, endPeriod: 8, parity: 'all', weekFrom: 1, weekTo: 16 },
                 { weekday: 5, startPeriod: 1, endPeriod: 2, parity: 'even', weekFrom: 2, weekTo: 16 }] },
    { name: '中国近现代史', teacher: '吴敬之', location: 'C401', color: '#f2645a',
      sessions: [{ weekday: 5, startPeriod: 5, endPeriod: 6, parity: 'all', weekFrom: 1, weekTo: 16 }] },
  ];
  const now = new Date().toISOString();
  courses.forEach((c, i) => {
    tx.objectStore('courses').put({
      id: 'seed-course-' + i, ...c, note: '', createdAt: now, updatedAt: now,
    });
  });
  // 必须把模式也切成日程：App 的模式是全局设置，停在记账模式下
  // 直接开 #/schedule 会被路由 effect 弹回总览。
  tx.objectStore('settings').put({ key: 'ui.mode', value: 'schedule' });
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  db.close();
  return courses.length;
})()
`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.evaluate(() => new Promise((r) => {
    const req = indexedDB.deleteDatabase('yichen-ledger');
    req.onsuccess = req.onerror = req.onblocked = () => r();
  }));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await sleep(1300);
  await page.evaluate(`(${SEED})`);
  // 必须走一次完整加载：模式是 App 启动时从库里读的，只改 hash 不会重读，
  // 会停在记账模式然后被路由 effect 弹回总览。
  await page.goto('about:blank');
  await page.goto(`${BASE}#/schedule?tab=timetable`, { waitUntil: 'networkidle2' });
  await sleep(1600);

  await page.screenshot({ path: `${OUT}/m-timetable.png` });
  console.log('shot  m-timetable.png');

  // 课表设置面板（开学日期 + 节次时间表）
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sched-actions button')].find((x) =>
      x.getAttribute('aria-label')?.includes('设置'),
    );
    b?.click();
  });
  await sleep(900);
  if (await page.$('.sheet')) {
    await page.screenshot({ path: `${OUT}/m-timetable-settings.png` });
    console.log('shot  m-timetable-settings.png');
    await page.evaluate(() => document.querySelector('.sheet-mask')?.click());
    await sleep(500);
  }

  // 加一门课的面板
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sched-actions button')].find((x) => x.textContent.includes('加一门课'));
    b?.click();
  });
  await sleep(900);
  if (await page.$('.sheet')) {
    await page.screenshot({ path: `${OUT}/m-timetable-form.png` });
    console.log('shot  m-timetable-form.png');
    await page.evaluate(() => document.querySelector('.sheet-mask')?.click());
    await sleep(500);
  }

  // 桌面宽度
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await page.goto(`${BASE}#/schedule?tab=timetable`, { waitUntil: 'networkidle2' });
  await sleep(1300);
  await page.screenshot({ path: `${OUT}/d-timetable.png` });
  console.log('shot  d-timetable.png');
} finally {
  await browser.close();
}
