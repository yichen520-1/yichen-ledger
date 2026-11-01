// Electron 主进程（Windows / macOS 桌面端）
// 用 CommonJS 是因为 Electron 的主进程默认按 CJS 加载。
const {
  app,
  BrowserWindow,
  shell,
  Menu,
  nativeTheme,
  Tray,
  globalShortcut,
  Notification,
  nativeImage,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

// 界面是深色的，系统主题也跟着深色走，避免 Windows 上标题栏是亮色
nativeTheme.themeSource = 'dark';

/**
 * 全局快捷键：Ctrl+Shift+A（macOS 上是 Cmd+Shift+A）随时「记一笔」。
 *
 * 为什么选这一组：A 就是 add，好记；Ctrl+Shift+A 在 Chrome/Edge 里是
 * 「标签页搜索」，独立应用里不冲突；macOS 的 Cmd+Shift+A 是访达的「应用程序」
 * 文件夹，但应用内注册的全局快捷键优先于系统快捷键。
 * 注册失败（被别的软件占了）只记一条日志 —— 这个功能不可用，应用照常跑。
 */
const QUICK_ADD_ACCELERATOR = 'CommandOrControl+Shift+A';

let mainWindow = null;
let tray = null;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: '#0f1216',
    // 窗口标题是「忆笺」——总和名，不跟当前在哪个子 App 里变。
    // 任务栏和 Alt+Tab 上看到的应该是整个产品，不是其中一个模块。
    title: '忆笺',
    autoHideMenuBar: true,
    // macOS 上把红绿灯按钮嵌进内容区，视觉上和网页版头部更贴合
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // 应用本身不需要 Node 能力，关掉更安全
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // 外部链接用系统浏览器打开，不在应用内导航
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  /**
   * 点窗口的关闭按钮 = 收进托盘，而不是退出。
   *
   * 托盘常驻如果「关掉窗口就没了」，那托盘图标只是窗口的一个影子，没有意义。
   * 所以这里拦下 close，改成 hide；真正的退出走托盘右键菜单的「退出」。
   *
   * 代价是第一次遇到「点 X 后窗口消失了但程序还在」的人会以为崩了，
   * 所以第一次隐藏时弹一条系统通知说明一次（见 maybeExplainTray）。
   */
  mainWindow.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    mainWindow.hide();
    maybeExplainTray();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** 第一次收进托盘时，说一次「我还在」 */
function maybeExplainTray() {
  try {
    const flag = path.join(app.getPath('userData'), 'tray-explained');
    if (fs.existsSync(flag)) return;
    fs.writeFileSync(flag, new Date().toISOString(), 'utf8');
    if (Notification.isSupported()) {
      new Notification({
        title: '忆笺还在运行',
        body: '窗口已收进托盘。右键托盘图标可以打开或退出；按 Ctrl+Shift+A 随时记一笔。',
        silent: true,
      }).show();
    }
  } catch {
    /* 通知发不出来不影响主流程 */
  }
}

/**
 * 托盘菜单里的「今日速览」。
 *
 * 数据在渲染进程的 IndexedDB 里，主进程碰不到，所以让渲染进程跑一小段
 * 原生 indexedDB 查询把今天的收支算出来。只读，不改任何东西。
 *
 * 为什么不为此加一条 IPC 通道：为了显示一行字就在主进程和页面之间开一个
 * 双向入口，收益不值这个风险。executeJavaScript 只读一次，用完就结束。
 */
async function readTodaySummary() {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  try {
    return await mainWindow.webContents.executeJavaScript(`(async () => {
      const open = () => new Promise((res, rej) => {
        const req = indexedDB.open('yichen-ledger');
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      try {
        const db = await open();
        if (!db.objectStoreNames.contains('transactions')) { db.close(); return null; }
        const all = await new Promise((res, rej) => {
          const tx = db.transaction('transactions', 'readonly');
          const req = tx.objectStore('transactions').getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        });
        db.close();
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        let expense = 0;
        let income = 0;
        let count = 0;
        for (const t of all) {
          if (t.date !== key) continue;
          // 待收的支出和冲平的收入不进统计，和网页里那套口径保持一致
          if (t.receivable || t.receivableId) continue;
          if (t.type === 'expense') { expense += t.amount; count += 1; }
          else if (t.type === 'income') { income += t.amount; count += 1; }
        }
        return { expense, income, count };
      } catch {
        return null;
      }
    })()`);
  } catch {
    return null;
  }
}

function yuan(cents) {
  return (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

async function refreshTrayTip() {
  if (!tray) return;
  const s = await readTodaySummary();
  if (!s) {
    tray.setToolTip('忆笺');
    return;
  }
  if (s.count === 0) {
    tray.setToolTip('忆笺 · 今天还没有记录');
    return;
  }
  const income = s.income > 0 ? ` · 收入 ¥${yuan(s.income)}` : '';
  tray.setToolTip(`忆笺 · 今天 支出 ¥${yuan(s.expense)}${income} · ${s.count} 笔`);
}

/** 把窗口叫出来并跳到某个路由 */
function showWindow(hash) {
  if (!mainWindow) createWindow();
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (hash) {
    // HashRouter：改 hash 不会重新加载页面，比 loadFile 再传 hash 快得多，
    // 也不会把当前正在填的表单清空。
    mainWindow.webContents
      .executeJavaScript(`window.location.hash = ${JSON.stringify(hash)}`)
      .catch(() => {});
  }
}

function buildTray() {
  const iconPath = path.join(
    __dirname,
    '..',
    'build',
    process.platform === 'win32' ? 'icon.ico' : 'icon-256.png',
  );
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('忆笺');

  const menu = Menu.buildFromTemplate([
    { label: '打开忆笺', click: () => showWindow('#/') },
    { label: '记一笔', accelerator: QUICK_ADD_ACCELERATOR, click: () => showWindow('#/add') },
    { type: 'separator' },
    {
      label: '今日速览',
      click: async () => {
        const s = await readTodaySummary();
        if (!s) return;
        const body =
          s.count === 0
            ? '今天还没有记录。'
            : `支出 ¥${yuan(s.expense)}${s.income > 0 ? `，收入 ¥${yuan(s.income)}` : ''}，共 ${s.count} 笔。`;
        if (Notification.isSupported()) {
          new Notification({ title: '忆笺 · 今日', body, silent: true }).show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow('#/'));
  void refreshTrayTip();
}

// 单实例：再次双击图标时聚焦已有窗口，而不是开第二个
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Windows 上设成深色，标题栏才不是刺眼的白色（macOS 由系统控制）
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.yichen.ledger');
    }
    createWindow();

    /**
     * 托盘只在 Windows / macOS 上建。
     * Linux 的 Tray 依赖 libappindicator，缺了会直接崩；Linux 产物是给 CI
     * 出的 AppImage，宁可不显示托盘，也不要一启动就崩。
     */
    if (process.platform === 'win32' || process.platform === 'darwin') {
      try {
        buildTray();
      } catch (err) {
        // 托盘建不起来不影响主窗口
        console.warn('[tray] 创建失败：', err && err.message);
      }
    }

    // 全局快捷键：注册失败（被占用）只提示一句，不影响使用
    const ok = globalShortcut.register(QUICK_ADD_ACCELERATOR, () => showWindow('#/add'));
    if (!ok) console.warn('[shortcut] Ctrl+Shift+A 注册失败，可能被其他程序占用');

    // 每分钟刷新一次托盘提示里的「今日」。间隔不再缩短：
    // 这个数字只是抬头看一眼用的，秒级更新只会白烧 CPU。
    setInterval(() => void refreshTrayTip(), 60_000);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    // 有托盘时窗口只是隐藏，不会走到这里；
    // macOS 的惯例是关掉窗口后应用仍驻留 Dock
    if (process.platform !== 'darwin') app.quit();
  });
}
