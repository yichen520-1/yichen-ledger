/**
 * 无头验证 Electron 主进程：加载打包后的 dist/index.html，
 * 等页面渲染后检查 #root 里有内容、有没有报错，然后截图退出。
 * 用法：node_modules\electron\dist\electron.exe scripts\electron-check.cjs
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

app.disableHardwareAcceleration();

const errors = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 430,
    height: 932,
    show: false,
    webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false },
  });

  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`[did-fail-load] ${code} ${desc} ${url}`);
  });

  const file = path.join(__dirname, '..', 'dist', 'index.html');
  await win.loadFile(file);
  // 给 Dexie 打开数据库 + React 首帧留点时间
  await new Promise((r) => setTimeout(r, 2500));

  const info = await win.webContents.executeJavaScript(`(() => {
    const root = document.getElementById('root');
    return {
      hash: location.hash,
      url: location.protocol,
      htmlLength: root ? root.innerHTML.length : 0,
      hasNetworth: !!document.querySelector('.networth'),
      networth: document.querySelector('.networth')?.textContent ?? null,
      title: document.title,
      bodyText: (document.body.innerText || '').slice(0, 160),
    };
  })()`);

  console.log('PROTOCOL =', info.url);
  console.log('HASH     =', info.hash);
  console.log('TITLE    =', info.title);
  console.log('ROOT LEN =', info.htmlLength);
  console.log('NETWORTH =', info.hasNetworth, info.networth);
  console.log('BODY     =', JSON.stringify(info.bodyText));

  const img = await win.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', '.shots', 'electron-desktop.png'), img.toPNG());
  console.log('SHOT OK');

  const ok = info.hasNetworth && info.htmlLength > 500 && errors.length === 0;
  if (errors.length) {
    console.log('ERRORS:');
    for (const e of errors) console.log(' -', e);
  }
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  app.exit(ok ? 0 : 1);
});
