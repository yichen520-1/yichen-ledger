import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles.css';

// 用 HashRouter 而不是 BrowserRouter：
// Electron 用 file:// 加载、Capacitor 用 capacitor://localhost 加载，
// 两者都不支持服务端 history 回退，hash 路由在四个平台上行为一致。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);

// 只有跑在真正的网页服务器上（开发服务器 / GitHub Pages）才注册 Service Worker。
//
// 三种情况必须跳过：
//   Electron      → file://，没有合法的 SW 作用域
//   Capacitor     → capacitor://localhost 或 https://localhost（Android 7+ 用后者），
//                   壳里的资源随 App 更新，缓存反而会让人看到旧代码
//   本地直接开文件 → file://
//
// 判断方式：主机名是 localhost/127.0.0.1 但端口不是开发服务器时也可能是 Capacitor。
// Capacitor 的 webview 里会注入 window.Capacitor 全局对象，用它来排除最可靠。
const isCapacitor = typeof (window as { Capacitor?: unknown }).Capacitor !== 'undefined';
const canUseServiceWorker =
  'serviceWorker' in navigator &&
  !isCapacitor &&
  (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');

if (canUseServiceWorker) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 注册失败不影响使用：没有 SW 只是不能离线打开，账本照样能记
    });
  });
}
