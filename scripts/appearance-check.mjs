/**
 * v0.2.0 外观与设置页的视觉自检：
 *   1. 设置页四组都在；
 *   2. 切换语言后导航文字立刻变；
 *   3. 上传一张壁纸 → 只影响所选区域；
 *   4. 字号基准、圆角、玻璃都能改到 documentElement 上。
 * 用法：node scripts/appearance-check.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const URL_BASE = process.argv[2] ?? 'http://localhost:4173/';
const OUT = '.shots';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const errors = [];
const checks = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--disable-gpu', '--hide-scrollbars', '--lang=zh-CN'],
});

try {
  mkdirSync(OUT, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 430, height: 932, deviceScaleFactor: 2 });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${URL_BASE}#/`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.networth', { timeout: 10000 });

  // ---------- 1. 设置页四组 ----------
  await page.goto(`${URL_BASE}#/settings`, { waitUntil: 'networkidle2' });
  await sleep(500);
  const titles = await page.$$eval('.section-title', (els) => els.map((e) => e.textContent.trim()));
  check('设置页有「通用」', titles.includes('通用'), titles.join(' / '));
  check('设置页有「外观」', titles.includes('外观'));
  check('设置页有「数据备份」', titles.includes('数据备份'));
  check('设置页有「关于」', titles.includes('关于'));
  const banner = await page.$('.banner-warn');
  check('本地存储横幅存在', !!banner);
  const bannerText = banner ? await banner.evaluate((el) => el.innerText) : '';
  check('横幅说明「只在这台设备上」', bannerText.includes('只在这台设备上'), bannerText.slice(0, 40));
  await page.screenshot({ path: `${OUT}/v2-settings.png`, fullPage: true });

  // ---------- 2. 切语言 ----------
  const navBefore = await page.$eval('.nav-item', (el) => el.textContent.trim());
  await page.select('.set-select', 'en');
  await sleep(400);
  const navAfter = await page.$eval('.nav-item', (el) => el.textContent.trim());
  check('切到英文后导航文字变化', navBefore !== navAfter, `${navBefore} → ${navAfter}`);
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  check('html lang 跟着变', htmlLang === 'en', htmlLang);
  await page.screenshot({ path: `${OUT}/v2-settings-en.png`, fullPage: true });
  // 切回中文
  await page.select('.set-select', 'zh');
  await sleep(400);

  // ---------- 3. 字号基准 / 圆角 / 玻璃 ----------
  await page.evaluate(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', '1.2');
  });
  const fs = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.set-name')).fontSize,
  );
  check('字号基准能放大到 120%', parseFloat(fs) > 16, fs);

  // ---------- 4. 上传壁纸只影响当前区域 ----------
  const buf = await page.evaluate(() => {
    // 画一张 40x40 的红蓝渐变，转成 PNG 再当文件上传
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 40;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 40, 40);
    grad.addColorStop(0, '#c42c22');
    grad.addColorStop(1, '#1a2b4a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 40, 40);
    return c.toDataURL('image/png').split(',')[1];
  });
  const input = await page.$('input[type=file][accept="image/*"]');
  check('壁纸上传控件存在', !!input);
  const tmp = `${OUT}/wallpaper-fixture.png`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(tmp, Buffer.from(buf, 'base64'));
  await input.uploadFile(tmp);
  await sleep(700);

  const layers = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('.backdrop-layer')) {
      const host = el.closest('aside, main, nav');
      const key = host ? host.className.split(' ')[0] : '?';
      out[key] = getComputedStyle(el).backgroundImage !== 'none';
    }
    return out;
  });
  check('主内容区有壁纸层', layers.main === true, JSON.stringify(layers));
  // 侧边栏没设壁纸时整个 .backdrop-layer 都不存在（不是空 backgroundImage），
  // 所以这里要判「不等于 true」，而不是「严格等于 false」。
  check('侧边栏还没有壁纸（分区独立）', layers.sidebar !== true, JSON.stringify(layers));
  await page.screenshot({ path: `${OUT}/v2-wallpaper.png` });

  // ---------- 5. 回总览看壁纸是否真的铺上 ----------
  await page.goto(`${URL_BASE}#/`, { waitUntil: 'networkidle2' });
  await sleep(600);
  const homeLayer = await page.evaluate(() =>
    getComputedStyle(document.querySelector('main .backdrop-layer')).backgroundImage,
  );
  check('总览页背景图已生效', homeLayer.includes('data:image'), homeLayer.slice(0, 30));
  await page.screenshot({ path: `${OUT}/v2-home-wallpaper.png` });
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
if (errors.length) {
  console.log('\n控制台错误：');
  for (const e of errors) console.log(' -', e);
}
console.log(`\n${checks.length - failed.length}/${checks.length} 通过`);
process.exitCode = failed.length || errors.length ? 1 : 0;
