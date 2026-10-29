/**
 * 忆笺 · 侧边栏自检：三语下品牌区与两块 App 的排版。
 *
 * 为什么单独有这个脚本（v0.7.3）：
 *   侧边栏宽度是固定的 232px，而三句标语长短差很多 —— 中文一行放得下，
 *   英文和日文放不下。v0.7.3 刚做完时就是日文标语把整列顶到 253px，
 *   文字直接压在主内容区上。根因是 flex 子项默认 min-width: auto，
 *   外面不写 min-width: 0，里面的 text-overflow: ellipsis 就永远不生效。
 *   这条只靠中文界面是看不出来的，所以这里把三种语言都量一遍。
 *
 * 用法：先 `npm run build && npx vite preview --port 4173`，再 node scripts/rail-check.mjs
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
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

/** 写 settings 里的 ui.lang，然后重开页面让它生效 */
async function setLang(lang) {
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.evaluate(
    (l) =>
      new Promise((res) => {
        const req = indexedDB.open('yichen-ledger');
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put({ key: 'ui.lang', value: l });
          tx.oncomplete = () => {
            db.close();
            res();
          };
        };
      }),
    lang,
  );
  await page.goto('about:blank');
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.sidebar .rail-brand', { timeout: 20000 });
  await sleep(400);
}

/** 量侧边栏里每一块的实际宽度和右边界 */
async function measure() {
  return page.evaluate(() => {
    const sb = document.querySelector('.sidebar');
    const sbRect = sb.getBoundingClientRect();
    const read = (el) => {
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        right: Math.round(r.right),
        h: Math.round(r.height),
        // scrollWidth > clientWidth 说明文字被截了
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    };
    const brand = document.querySelector('.sidebar .rail-brand');
    const brandLabel = brand.querySelector('.rail-brand-label');
    const tiles = [...document.querySelectorAll('.sidebar .app-tile')];
    return {
      sidebar: { right: Math.round(sbRect.right), w: Math.round(sbRect.width) },
      docOverflow: document.documentElement.scrollWidth > window.innerWidth,
      brand: { ...read(brand), name: brand.querySelector('.rail-brand-name')?.textContent?.trim() ?? '' },
      brandLabel: { ...read(brandLabel), text: brandLabel.textContent.trim() },
      tiles: tiles.map((t) => {
        const labelEl = t.querySelector('.app-tile-label');
        return {
          ...read(t),
          name: t.querySelector('.app-tile-name')?.textContent?.trim() ?? '',
          label: { ...read(labelEl), text: labelEl.textContent.trim() },
        };
      }),
    };
  });
}

await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });
await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => new Promise((r) => {
  const req = indexedDB.deleteDatabase('yichen-ledger');
  req.onsuccess = req.onerror = req.onblocked = () => r();
}));
await sleep(300);

const EXPECT = {
  zh: { brand: '忆笺', tagline: '所记所行，皆有归处' },
  en: { brand: 'Yijian', tagline: '' },
  ja: { brand: '憶箋', tagline: '' },
};

for (const lang of ['zh', 'en', 'ja']) {
  await setLang(lang);
  const m = await measure();

  check(`[${lang}] 侧边栏宽 232`, m.sidebar.w === 232, String(m.sidebar.w));
  check(`[${lang}] 品牌区没有顶出侧边栏`, m.brand.right <= m.sidebar.right + 1, `${m.brand.right} <= ${m.sidebar.right}`);
  check(`[${lang}] 两块 App 没有顶出侧边栏`, m.tiles.every((t) => t.right <= m.sidebar.right + 1), m.tiles.map((t) => t.right).join('/'));
  check(`[${lang}] 页面没有横向滚动`, m.docOverflow === false, String(m.docOverflow));
  check(`[${lang}] 品牌区名字`, m.brand.name === EXPECT[lang].brand, m.brand.name);
  if (EXPECT[lang].tagline) {
    check(`[${lang}] 品牌区标语`, m.brandLabel.text === EXPECT[lang].tagline, m.brandLabel.text);
  }
  check(`[${lang}] 品牌区标语没被截断`, m.brandLabel.clipped === false, `sw/cw 截断=${m.brandLabel.clipped}`);
  check(
    `[${lang}] 两块标语都没被截断`,
    m.tiles.every((t) => t.label.clipped === false),
    m.tiles.map((t) => `${t.label.text.slice(0, 12)}=${t.label.clipped}`).join(' | '),
  );
  check(`[${lang}] 两块是上下排的`, m.tiles.length === 2 && m.tiles[1].right === m.tiles[0].right, m.tiles.map((t) => t.right).join('/'));
  check(`[${lang}] 两块高度一致`, m.tiles[0].h === m.tiles[1].h, m.tiles.map((t) => t.h).join('/'));
}

/* 手机宽度：侧边栏应该是隐藏的，不该有横向滚动 */
await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
for (const lang of ['zh', 'en', 'ja']) {
  await setLang(lang);
  const m = await page.evaluate(() => ({
    sidebar: getComputedStyle(document.querySelector('.sidebar')).display,
    docOverflow: document.documentElement.scrollWidth > window.innerWidth,
    tabbar: document.querySelectorAll('.tabbar .tab').length,
  }));
  check(`[${lang}] 手机上侧边栏隐藏`, m.sidebar === 'none', m.sidebar);
  check(`[${lang}] 手机上无横向滚动`, m.docOverflow === false, String(m.docOverflow));
  check(`[${lang}] 底部导航格子还在`, m.tabbar >= 5, String(m.tabbar));
}

/* 收尾：把语言还原成中文，免得影响后面跑的其它自检 */
await page.setViewport({ width: 1280, height: 860 });
await setLang('zh');
check('语言已还原成中文', (await measure()).brand.name === '忆笺');
check('无控制台错误', errors.length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
console.log(`\nRAIL CHECK: ${fail === 0 ? 'PASS' : 'FAIL'} (${pass} 通过 / ${fail} 失败)`);
process.exit(fail === 0 ? 0 : 1);
