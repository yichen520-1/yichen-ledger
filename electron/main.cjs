// Electron 主进程（Windows / macOS 桌面端）
// 用 CommonJS 是因为 Electron 的主进程默认按 CJS 加载。
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;
const DEV_URL = 'http://localhost:5173';

// 界面是深色的，系统主题也跟着深色走，避免 Windows 上标题栏是亮色
nativeTheme.themeSource = 'dark';

let mainWindow = null;

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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 单实例：再次双击图标时聚焦已有窗口，而不是开第二个
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    // Windows 上设成深色，标题栏才不是刺眼的白色（macOS 由系统控制）
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.yichen.ledger');
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    // macOS 的惯例是关掉窗口后应用仍驻留 Dock
    if (process.platform !== 'darwin') app.quit();
  });
}
