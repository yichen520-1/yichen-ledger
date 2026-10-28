import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Plus,
  Settings2,
  Target,
  Wallet,
} from 'lucide-react';
import { LedgerProvider, useLedger } from './state/LedgerContext';
import { AppearanceProvider } from './state/AppearanceContext';
import { ModeProvider, useMode, type AppMode } from './state/ModeContext';
import { I18nProvider, useI18n, type DictKey } from './i18n';
import { ToastProvider } from './components/Toast';
import { Backdrop } from './components/Backdrop';
import { db } from './db';
import Dashboard from './pages/Dashboard';
import Add from './pages/Add';
import Stats from './pages/Stats';
import Budgets from './pages/Budgets';
import SettingsPage from './pages/SettingsPage';
import Accounts from './pages/Accounts';
import Categories from './pages/Categories';
import Schedule from './pages/Schedule';

/** 导航项：标签在渲染时用 t() 取，这样切语言不需要重建数组 */
const NAV: Array<{ to: string; label: DictKey; icon: typeof LayoutDashboard; end: boolean }> = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/stats', label: 'nav.stats', icon: BarChart3, end: false },
  { to: '/budgets', label: 'nav.budgets', icon: Target, end: false },
  { to: '/settings', label: 'nav.settings', icon: Settings2, end: false },
];

/** 日程模式下的导航只有两项，直接在 JSX 里写，不走 NAV 数组 */

/**
 * 页面切换动画的 key
 * ------------------------------------------------------------------
 * 记账页（/add、/edit/:id）不参与左右推入，它是从底部盖上来的一层。
 * 其它页面按「导航顺序」判断是从左边来还是右边来，做出 iOS 那种方向感。
 */
const ORDER = ['/', '/stats', '/budgets', '/settings', '/accounts', '/categories', '/schedule'];

function Shell() {
  const { ready, error } = useLedger();
  const { t } = useI18n();
  const { mode, setMode } = useMode();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdd = location.pathname.startsWith('/add') || location.pathname.startsWith('/edit');
  const isSchedule = mode === 'schedule';

  // 判断方向：新页面在导航顺序里更靠后 → 从右推入（forward），否则从左（back）
  const index = ORDER.indexOf(location.pathname);
  const prevIndex = useRef(index < 0 ? 0 : index);
  const [dir, setDir] = useState<'forward' | 'back'>('forward');
  useEffect(() => {
    const cur = index < 0 ? prevIndex.current : index;
    setDir(cur < prevIndex.current ? 'back' : 'forward');
    prevIndex.current = cur;
  }, [index]);

  /**
   * 启动页
   * ------------------------------------------------------------------
   * 只在「账本第一次准备好」时跳一次：
   *   - 用 ref 挡住第二次，否则用户手动切回总览又会被弹回设置里那一页；
   *   - 只在设置里选了非总览时才跳，保持默认行为不变。
   */
  const startupDone = useRef(false);
  useEffect(() => {
    if (!ready || startupDone.current) return;
    startupDone.current = true;
    const MAP: Record<string, string> = { dashboard: '/', stats: '/stats', budgets: '/budgets' };
    db.settings
      .get('ui.startup')
      .then((row) => {
        if (typeof row?.value !== 'string') return;
        const target = MAP[row.value];
        if (target && target !== '/') navigate(target, { replace: true });
      })
      .catch(() => undefined);
  }, [ready, navigate]);

  /**
   * 切模式时把落点对齐
   * ------------------------------------------------------------------
   * 切到日程模式而当前还停在记账的某一页时，直接跳 /schedule；
   * 切回记账而停在 /schedule 时跳回总览。否则会出现「在日程模式下看着统计页」这种怪状态。
   */
  useEffect(() => {
    if (isSchedule && !location.pathname.startsWith('/schedule') && !location.pathname.startsWith('/settings')) {
      navigate('/schedule', { replace: true });
    } else if (!isSchedule && location.pathname.startsWith('/schedule')) {
      navigate('/', { replace: true });
    }
  }, [isSchedule, location.pathname, navigate]);

  function switchMode(next: AppMode) {
    setMode(next);
    navigate(next === 'schedule' ? '/schedule' : '/', { replace: true });
  }

  return (
    <div className={`shell${isSchedule ? ' mode-schedule' : ''}`}>
      <aside className="sidebar has-backdrop">
        <Backdrop region="sidebar" />
        <div className="sidebar-inner">
          <div className="brand">
            <div className="brand-mark">忆</div>
            <div className="brand-text">
              <strong>{t('app.name')}</strong>
              <span>{t('app.tagline')}</span>
            </div>
          </div>

          {isSchedule ? (
            <>
              <NavLink to="/schedule" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <CalendarDays size={17} />
                {t('nav.schedule')}
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Settings2 size={17} />
                {t('nav.settings')}
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/add" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <Plus size={17} />
                {t('nav.add')}
              </NavLink>
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <item.icon size={17} />
                  {t(item.label)}
                </NavLink>
              ))}
              <NavLink
                to="/accounts"
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Wallet size={17} />
                {t('nav.accounts')}
              </NavLink>
            </>
          )}

          <div style={{ flex: 1 }} />

          <ModeSwitch mode={mode} onSwitch={switchMode} />

          <div className="muted sidebar-version">
            v{__APP_VERSION__} · {t('app.localFirst')}
          </div>
        </div>
      </aside>

      <main className="main has-backdrop">
        <Backdrop region="main" />
        <div className="main-inner" key={location.pathname}>
          {error ? <div className="alert">{t('common.dbError', { msg: error })}</div> : null}
          {!ready ? (
            <div className="empty">{t('common.preparing')}</div>
          ) : (
            <div className={`page-swap ${isAdd ? 'page-swap-up' : dir === 'back' ? 'page-swap-back' : 'page-swap-forward'}`}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/add" element={<Add />} />
                <Route path="/edit/:id" element={<Add />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/schedule" element={<Schedule />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}
        </div>
      </main>

      {!isAdd ? (
        <nav className="tabbar has-backdrop">
          <Backdrop region="tabbar" />
          <div className="tabbar-inner">
            {isSchedule ? (
              <>
                <NavLink to="/schedule" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <CalendarDays size={20} />
                  {t('nav.schedule')}
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <Settings2 size={20} />
                  {t('nav.settings')}
                </NavLink>
              </>
            ) : (
              <>
                <NavLink to="/" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <LayoutDashboard size={20} />
                  {t('nav.dashboard')}
                </NavLink>
                <NavLink to="/stats" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <BarChart3 size={20} />
                  {t('nav.stats')}
                </NavLink>
                <NavLink to="/add" className="tab tab-add" aria-label={t('nav.add')}>
                  <span className="plus">+</span>
                </NavLink>
                <NavLink to="/budgets" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <Target size={20} />
                  {t('nav.budgets')}
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <Settings2 size={20} />
                  {t('nav.settings')}
                </NavLink>
              </>
            )}
            <ModeSwitch mode={mode} onSwitch={switchMode} compact />
          </div>
        </nav>
      ) : null}
    </div>
  );
}

/**
 * 功能切换钮
 * ------------------------------------------------------------------
 * 桌面上放在侧边栏底部，移动端放在底部导航条最右边（compact 版本只留图标）。
 * 用两段式胶囊而不是下拉：只有两个功能，点一下就切完，不用先展开再选。
 */
function ModeSwitch({
  mode,
  onSwitch,
  compact = false,
}: {
  mode: AppMode;
  onSwitch: (m: AppMode) => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={`mode-switch${compact ? ' compact' : ''}`} title={t('mode.switchHint')}>
      {!compact ? <div className="mode-switch-label">{t('mode.switchHint')}</div> : null}
      <div className="mode-switch-track">
        <button
          className={mode === 'ledger' ? 'on' : ''}
          onClick={() => onSwitch('ledger')}
          aria-label={t('mode.ledger')}
        >
          <Wallet size={compact ? 16 : 14} />
          {compact ? null : t('mode.ledger')}
        </button>
        <button
          className={mode === 'schedule' ? 'on' : ''}
          onClick={() => onSwitch('schedule')}
          aria-label={t('mode.schedule')}
        >
          <CalendarDays size={compact ? 16 : 14} />
          {compact ? null : t('mode.schedule')}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppearanceProvider>
        <ToastProvider>
          <LedgerProvider>
            <ModeProvider>
              <Shell />
            </ModeProvider>
          </LedgerProvider>
        </ToastProvider>
      </AppearanceProvider>
    </I18nProvider>
  );
}
