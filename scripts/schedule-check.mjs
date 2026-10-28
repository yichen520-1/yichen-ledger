/**
 * 忆尘日程自检：双 App 入口（AppRail）、日程/课表两个标签、月视图、新建日程、
 * 重复规则、搜索、课表网格与加课。
 *
 * 用法：先 `npm run build && npx vite preview --port 4173`，再 node scripts/schedule-check.mjs
 */
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4173/';
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
const page = await browser.newPage();
await page.setViewport({ width: 430, height: 932 });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => new Promise((r) => {
  const req = indexedDB.deleteDatabase('yichen-ledger');
  req.onsuccess = req.onerror = req.onblocked = () => r();
}));
await page.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1400);

/* ---------------------------------------------------------- 1. 双 App 入口 */

const ledgerNav = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-item')].map((n) => n.textContent.trim()),
);
check('默认记账模式导航', ledgerNav.some((s) => s.includes('记一笔')), ledgerNav.join('/'));

// 手机宽度下侧边栏是隐藏的，切 App 点的是底部导航里那一枚图标
const tabApp = await page.evaluate(() => {
  const b = document.querySelector('.tabbar .tab-app');
  if (!b) return null;
  const img = b.querySelector('img.tab-app-icon');
  const r = b.getBoundingClientRect();
  return {
    label: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
    src: img?.getAttribute('src') ?? '',
    w: Math.round(r.width),
    h: Math.round(r.height),
    text: b.textContent.trim(),
  };
});
check('底部导航有「去另一个 App」的图标按钮', tabApp !== null);
check('该按钮只放图标不放文字', tabApp?.text === '', `text="${tabApp?.text}"`);
check('按钮的无障碍名是目标 App 全名', tabApp?.label === '忆尘日程', String(tabApp?.label));
check('按钮里是真的 App 图标', /schedule-badge\.png$/.test(tabApp?.src ?? ''), tabApp?.src);
check('图标按钮尺寸合理', (tabApp?.w ?? 0) >= 26 && (tabApp?.h ?? 0) >= 26, `${tabApp?.w}x${tabApp?.h}`);

// 桌面宽度下侧边栏里的 AppRail 应该是两枚并排图标
await page.setViewport({ width: 1280, height: 900 });
await sleep(400);
const rail = await page.evaluate(() => {
  const tiles = [...document.querySelectorAll('.app-rail .app-tile')];
  return {
    count: tiles.length,
    labels: tiles.map((t) => t.querySelector('.app-tile-label')?.textContent?.trim() ?? ''),
    icons: tiles.map((t) => t.querySelector('.app-tile-icon img')?.getAttribute('src') ?? ''),
    onIndex: tiles.findIndex((t) => t.classList.contains('on')),
    heights: tiles.map((t) => Math.round(t.getBoundingClientRect().height)),
  };
});
check('侧边栏 AppRail 有两枚图标', rail.count === 2, String(rail.count));
check('两枚图标的标签是「忆尘记账 / 忆尘日程」', rail.labels.join('/') === '忆尘记账/忆尘日程', rail.labels.join('/'));
check('两枚图标用的是各自 App 的真实图标', rail.icons.join(',').includes('pwa-192.png') && rail.icons.join(',').includes('schedule-badge.png'), rail.icons.join(','));
check('当前 App 高亮在第一枚', rail.onIndex === 0, String(rail.onIndex));
check('图标方块尺寸一致且不为 0', rail.heights[0] > 40 && rail.heights[0] === rail.heights[1], rail.heights.join('/'));

/* ---------------------------------------------------------- 2. 切到日程 */

await page.setViewport({ width: 430, height: 932 });
await sleep(300);
await page.evaluate(() => document.querySelector('.tabbar .tab-app')?.click());
await sleep(900);

const afterSwitch = await page.evaluate(() => ({
  hash: location.hash,
  title: document.querySelector('.page-title')?.textContent ?? '',
  hasMonth: !!document.querySelector('.sched-month'),
  cells: document.querySelectorAll('.sched-cell').length,
  weekdays: [...document.querySelectorAll('.sched-wd')].map((d) => d.textContent.trim()),
  tabs: [...document.querySelectorAll('.sched-tab')].map((b) => b.textContent.trim()),
  activeTab: document.querySelector('.sched-tab.on')?.textContent?.trim() ?? '',
}));
check('切到日程后路由正确', afterSwitch.hash.startsWith('#/schedule'), afterSwitch.hash);
check('日程页标题', afterSwitch.title === '忆尘日程', afterSwitch.title);
check('日程页有两个标签：日程 / 课表', afterSwitch.tabs.join('/') === '日程/课表', afterSwitch.tabs.join('/'));
check('默认停在「日程」标签', afterSwitch.activeTab === '日程', afterSwitch.activeTab);
check('月视图渲染', afterSwitch.hasMonth);
check('月视图 42 格', afterSwitch.cells === 42, String(afterSwitch.cells));
check('周标题是 一二三四五六日', afterSwitch.weekdays.join('') === '一二三四五六日', afterSwitch.weekdays.join(''));

/* ---------------------------------------------------------- 3. 新建日程 */

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.sched-actions button')].find((x) => x.textContent.includes('新建日程'));
  b?.click();
});
await sleep(800);
await page.waitForSelector('.sheet', { timeout: 5000 });
await sleep(560);
await page.type('.sheet .field input.input', '和设计对稿');
// 时间：React 受控输入必须走原生 setter，直接赋 el.value 不会触发 onChange
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const list = [...document.querySelectorAll('.sheet input[type="time"]')];
  const put = (el, v) => {
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (list[0]) put(list[0], '14:00');
  if (list[1]) put(list[1], '15:30');
});
await sleep(300);
await page.evaluate(() => {
  const c = [...document.querySelectorAll('.sheet .chip')].find((x) => x.textContent.includes('15分钟'));
  c?.click();
});
await sleep(150);
const saveBtn = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.sheet .sheet-actions button')].find((b) => b.textContent.includes('保存')),
);
await saveBtn.asElement().click();
await sleep(1000);

const afterCreate = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('.sched-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
  toast: document.querySelector('.toast')?.textContent ?? '',
}));
check('新建后列表出现日程', afterCreate.rows.some((r) => r.includes('和设计对稿')), afterCreate.rows[0] ?? '(空)');
check('时间显示正确', afterCreate.rows.some((r) => r.includes('14:00') && r.includes('15:30')));

/* ---------------------------------------------------------- 4. 完成勾选 */

await page.evaluate(() => document.querySelector('.sched-check')?.click());
await sleep(500);
check('勾选后标记完成', await page.evaluate(() => !!document.querySelector('.sched-row.done')));

/* ---------------------------------------------------------- 5. 视图切换 */

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.segmented.compact button')].find((x) => x.textContent.trim() === '周');
  b?.click();
});
await sleep(500);
const week = await page.evaluate(() => ({
  cols: document.querySelectorAll('.sched-weekcol').length,
  chips: document.querySelectorAll('.sched-chip').length,
}));
check('周视图 7 列', week.cols === 7, String(week.cols));
check('周视图能看到日程条', week.chips >= 1, String(week.chips));

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.segmented.compact button')].find((x) => x.textContent.trim() === '日');
  b?.click();
});
await sleep(500);
const day = await page.evaluate(() => ({
  head: document.querySelector('.sched-dayhead')?.textContent ?? '',
  rows: document.querySelectorAll('.sched-row').length,
}));
check('日视图有日期标题', day.head.includes('月') && day.head.includes('日'), day.head);

/* ---------------------------------------------------------- 6. 搜索 */

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.sched-actions button')].find((x) => x.getAttribute('aria-label') === '搜索');
  b?.click();
});
await sleep(500);
await page.type('.search-box input', '设计');
await sleep(700);
const search = await page.evaluate(() => ({
  rows: document.querySelectorAll('.search-box .sched-row').length,
  empty: !!document.querySelector('.search-box .empty'),
}));
check('搜索命中', search.rows >= 1, `rows=${search.rows} empty=${search.empty}`);

/* ---------------------------------------------------------- 7. 课表标签 */

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.sched-tab')].find((x) => x.textContent.includes('课表'));
  b?.click();
});
await sleep(900);

const tt = await page.evaluate(() => {
  const grid = document.querySelector('.tt-grid');
  const cells = document.querySelectorAll('.tt-cell');
  const periods = document.querySelectorAll('.tt-period');
  const heads = document.querySelectorAll('.tt-dayhead');
  const card = document.querySelector('.tt-card');
  const scroll = document.querySelector('.tt-scroll');
  return {
    hash: location.hash,
    hasGrid: !!grid,
    cells: cells.length,
    periods: periods.length,
    heads: heads.length,
    periodTexts: [...periods].slice(0, 3).map((p) => p.textContent.replace(/\s+/g, ' ').trim()),
    headTexts: [...heads].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
    rows: grid ? getComputedStyle(grid).gridTemplateRows.split(' ').length : 0,
    scrollW: scroll?.scrollWidth ?? 0,
    clientW: scroll?.clientWidth ?? 0,
    cardOverflow: card ? getComputedStyle(card).overflow : '',
    weekLabel: document.querySelector('.month-label')?.textContent?.trim() ?? '',
    subtitle: document.querySelector('.page-sub')?.textContent?.trim() ?? '',
    empty: !!document.querySelector('.timetable-page .empty'),
  };
});
check('课表标签写进地址栏', tt.hash.includes('tab=timetable'), tt.hash);
check('课表网格渲染', tt.hasGrid);
check('课表格子 = 节次数 × 7', tt.cells === tt.periods * 7, `${tt.cells} = ${tt.periods}×7`);
check('课表有 7 个星期表头', tt.heads === 7, String(tt.heads));
check('星期表头带日期', tt.headTexts[0]?.includes('/'), tt.headTexts.join(' | '));
check('节次列显示「第几节 + 时间」', tt.periodTexts[0]?.includes('08:00'), tt.periodTexts.join(' | '));
check('网格行数 = 表头 + 节次数', tt.rows === tt.periods + 1, `${tt.rows} vs ${tt.periods + 1}`);
check('卡片裁掉溢出（圆角不被网格戳破）', tt.cardOverflow === 'hidden', tt.cardOverflow);
check('窄屏下网格可横向滚动', tt.scrollW >= tt.clientW, `${tt.scrollW}/${tt.clientW}`);
check('顶部显示第几周', /第\s*\d+\s*周/.test(tt.weekLabel) || tt.subtitle.includes('周'), `${tt.weekLabel} / ${tt.subtitle}`);
check('没有课程时显示空状态', tt.empty);

/* ---------------------------------------------------------- 8. 加一门课 */

await page.evaluate(() => {
  const b = [...document.querySelectorAll('.sched-actions button')].find((x) => x.textContent.includes('加一门课'));
  b?.click();
});
await sleep(800);
await page.waitForSelector('.sheet', { timeout: 5000 });
await sleep(560);

const sheetFields = await page.evaluate(() => ({
  title: document.querySelector('.sheet h3')?.textContent?.trim() ?? '',
  inputs: [...document.querySelectorAll('.sheet input.input')].map((i) => i.getAttribute('placeholder') ?? ''),
  selects: document.querySelectorAll('.sheet select').length,
}));
check('新建课程面板打开', sheetFields.title.includes('课程') || sheetFields.title.includes('新建'), sheetFields.title);
check('表单有课程名输入框', sheetFields.inputs.some((p) => p.includes('高等数学') || p.includes('课程')), sheetFields.inputs.join(' | '));

await page.type('.sheet input.input', '高等数学');
await sleep(200);
const courseSave = await page.evaluateHandle(() =>
  [...document.querySelectorAll('.sheet .sheet-actions button')].find((b) => b.textContent.includes('保存')),
);
await courseSave.asElement().click();
await sleep(1000);

const afterCourse = await page.evaluate(() => {
  const blocks = [...document.querySelectorAll('.tt-block')];
  return {
    blocks: blocks.length,
    names: blocks.map((b) => b.querySelector('.tt-name')?.textContent ?? ''),
    rows: [...document.querySelectorAll('.tt-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    gridCol: blocks[0] ? getComputedStyle(blocks[0]).gridColumnStart : '',
    gridRow: blocks[0] ? getComputedStyle(blocks[0]).gridRow : '',
    empty: !!document.querySelector('.timetable-page .empty'),
    toast: document.querySelector('.toast')?.textContent ?? '',
  };
});
check('保存后课块出现在网格里', afterCourse.blocks >= 1, String(afterCourse.blocks));
check('课块名字正确', afterCourse.names.includes('高等数学'), afterCourse.names.join('/'));
check('课块占第 1 列（周一）', afterCourse.gridCol === '2', afterCourse.gridCol);
check('课块跨 2 行（1-2 节）', /^\d+ \/ \d+$/.test(afterCourse.gridRow), afterCourse.gridRow);
check('课程列表里出现这门课', afterCourse.rows.some((r) => r.includes('高等数学')), afterCourse.rows[0] ?? '(空)');
check('有课后空状态消失', !afterCourse.empty);

/* ---------------------------------------------------------- 9. 刷新保持 */

await page.reload({ waitUntil: 'networkidle2' });
await sleep(1400);
const persisted = await page.evaluate(() => ({
  hash: location.hash,
  title: document.querySelector('.page-title')?.textContent ?? '',
  activeTab: document.querySelector('.sched-tab.on')?.textContent?.trim() ?? '',
  blocks: document.querySelectorAll('.tt-block').length,
}));
check('刷新后仍在日程 App', persisted.title === '忆尘日程', `${persisted.hash} ${persisted.title}`);
check('刷新后仍在课表标签', persisted.activeTab === '课表', persisted.activeTab);
check('刷新后课程还在', persisted.blocks >= 1, String(persisted.blocks));

/* ---------------------------------------------------------- 10. 切回记账 */

await page.evaluate(() => document.querySelector('.tabbar .tab-app')?.click());
await sleep(900);
const back = await page.evaluate(() => ({
  hash: location.hash,
  networth: document.querySelector('.networth')?.textContent?.trim() ?? '',
  railOn: (() => {
    const t = [...document.querySelectorAll('.app-rail .app-tile')];
    return t.findIndex((x) => x.classList.contains('on'));
  })(),
}));
check('切回记账模式', back.hash === '#/' && back.networth.length > 0, `${back.hash} ${back.networth}`);
check('侧边栏高亮回到记账', back.railOn === 0, String(back.railOn));

check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\nSCHEDULE CHECK: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);
