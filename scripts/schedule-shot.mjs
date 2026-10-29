/**
 * 抓日程月视图在手机宽度下的样子，只出图不做断言。
 * 用法：先 `npm run build && npx vite preview --port 4173`，再 node scripts/schedule-shot.mjs
 */
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4173/';
const OUT = '.shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/** 直接往 IndexedDB 里塞几条日程，省得一条条点表单 */
const SEED = `
(async () => {
  const open = () => new Promise((res, rej) => {
    const req = indexedDB.open('yichen-ledger');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const db = await open();
  const tx = db.transaction(['events', 'settings'], 'readwrite');
  const now = new Date();
  const key = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  const shift = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return key(d); };
  const items = [
    { title: '和设计对一版改版稿', startTime: '10:00', endTime: '11:30', color: '#5aa9f0', tag: '工作', location: '线上', day: 0 },
    { title: '牙医复诊', startTime: '14:30', endTime: '15:10', color: '#f2645a', tag: '健康', location: '口腔医院', day: 1 },
    { title: '给爸妈打电话', startTime: '20:00', endTime: '20:30', color: '#4cc38a', tag: '家人', location: '', day: 2 },
    { title: '交房租', startTime: '09:00', endTime: '09:15', color: '#ffb454', tag: '生活', location: '', day: 3 },
    { title: '读完《树上的男爵》', startTime: '21:00', endTime: '22:00', color: '#8a7cd6', tag: '阅读', location: '', day: 5 },
    { title: '周末爬山', startTime: '07:30', endTime: '12:00', color: '#3aa7a0', tag: '运动', location: '香山', day: 6 },
    { title: '周会', startTime: '11:00', endTime: '12:00', color: '#5aa9f0', tag: '工作', location: '会议室 A', day: 8 },
    { title: '体检', startTime: '08:00', endTime: '10:00', color: '#f2645a', tag: '健康', location: '体检中心', day: 10 },
  ];
  items.forEach((it, i) => {
    tx.objectStore('events').put({
      id: 'seed-event-' + i,
      title: it.title,
      notes: '',
      location: it.location,
      date: shift(it.day),
      startTime: it.startTime,
      endTime: it.endTime,
      allDay: false,
      color: it.color,
      tag: it.tag,
      recurrence: { freq: 'none', interval: 1, weekdays: [], until: null },
      reminders: [],
      done: false,
      doneDates: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  });
  // 必须把模式也切成日程：App 的模式是全局设置，停在记账模式下
  // 直接开 #/schedule 会被路由 effect 弹回总览。
  tx.objectStore('settings').put({ key: 'ui.mode', value: 'schedule' });
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  db.close();
  return items.length;
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
  const n = await page.evaluate(`(${SEED})`);
  console.log('seeded', n);
  await page.goto('about:blank');
  await page.goto(`${BASE}#/schedule`, { waitUntil: 'networkidle2' });
  await sleep(1600);
  await page.screenshot({ path: `${OUT}/m-schedule-month.png` });
  console.log('shot  m-schedule-month.png');

  // 桌面宽度
  await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await page.goto(`${BASE}#/schedule`, { waitUntil: 'networkidle2' });
  await sleep(1300);
  await page.screenshot({ path: `${OUT}/d-schedule-month.png` });
  console.log('shot  d-schedule-month.png');
} finally {
  await browser.close();
}
