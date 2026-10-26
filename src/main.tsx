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
