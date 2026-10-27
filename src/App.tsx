import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BarChart3, LayoutDashboard, Plus, Settings2, Target, Wallet } from 'lucide-react';
import { LedgerProvider, useLedger } from './state/LedgerContext';
import { ToastProvider } from './components/Toast';
import Dashboard from './pages/Dashboard';
import Add from './pages/Add';
import Stats from './pages/Stats';
import Budgets from './pages/Budgets';
import SettingsPage from './pages/SettingsPage';
import Accounts from './pages/Accounts';
import Categories from './pages/Categories';

const NAV = [
  { to: '/', label: '总览', icon: LayoutDashboard, end: true },
  { to: '/stats', label: '统计', icon: BarChart3, end: false },
  { to: '/budgets', label: '预算', icon: Target, end: false },
  { to: '/settings', label: '我的', icon: Settings2, end: false },
];

/** 底部 tab（移动端）：中间是凸起的「记一笔」 */
function Shell() {
  const { ready, error } = useLedger();
  const location = useLocation();
  const isAdd = location.pathname.startsWith('/add') || location.pathname.startsWith('/edit');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">忆</div>
          <div className="brand-text">
            <strong>忆尘记账</strong>
            <span>数据只存在你自己的设备上</span>
          </div>
        </div>
        <NavLink to="/add" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Plus size={17} />
          记一笔
        </NavLink>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <item.icon size={17} />
            {item.label}
          </NavLink>
        ))}
        <NavLink to="/accounts" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <Wallet size={17} />
          账户
        </NavLink>
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ padding: '0 12px', fontSize: 11.5 }}>
          v{__APP_VERSION__} · 本地优先
        </div>
      </aside>

      <main className="main">
        <div className="main-inner">
          {error ? <div className="alert">数据库打开失败：{error}</div> : null}
          {!ready ? (
            <div className="empty">正在准备账本…</div>
          ) : (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/add" element={<Add />} />
              <Route path="/edit/:id" element={<Add />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </div>
      </main>

      {!isAdd ? (
        <nav className="tabbar">
          <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <LayoutDashboard size={20} />
            总览
          </NavLink>
          <NavLink to="/stats" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <BarChart3 size={20} />
            统计
          </NavLink>
          <NavLink to="/add" className="tab tab-add" aria-label="记一笔">
            <span className="plus">+</span>
          </NavLink>
          <NavLink to="/budgets" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Target size={20} />
            预算
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            <Settings2 size={20} />
            我的
          </NavLink>
        </nav>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <LedgerProvider>
        <Shell />
      </LedgerProvider>
    </ToastProvider>
  );
}
