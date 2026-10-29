import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  CalendarDays,
  CalendarRange,
  Grid3x3,
  LayoutDashboard,
  Plus,
  Repeat,
  Search,
  Settings2,
  Target,
  Wallet,
} from 'lucide-react';
import { AppRail, AppSwitchButton } from './components/AppRail';
import { LedgerProvider, useLedger } from './state/LedgerContext';
import { AppearanceProvider } from './state/AppearanceContext';
import { ModeProvider, useMode, type AppMode } from './state/ModeContext';
import { I18nProvider, useI18n, type DictKey } from './i18n';
import { ToastProvider } from './components/Toast';
import { Backdrop, Ambient } from './components/Backdrop';
import { AssistantProvider } from './state/AssistantContext';
import { AssistantHost, useAssistantUi } from './components/AssistantHost';
import { AssistantFab, useFabPosition } from './components/AssistantFab';
import { db } from './db';
import Dashboard from './pages/Dashboard';
import Add from './pages/Add';
import Stats from './pages/Stats';
import Budgets from './pages/Budgets';
import SettingsPage from './pages/SettingsPage';
import Accounts from './pages/Accounts';
import Categories from './pages/Categories';
import SearchPage from './pages/SearchPage';
import Weekly from './pages/Weekly';
import Recurring from './pages/Recurring';
import { ScheduleShell } from './pages/schedule/ScheduleShell';

/** 导航项：标签在渲染时用 t() 取，这样切语言不需要重建数组 */
const NAV: Array<{ to: string; label: DictKey; icon: typeof LayoutDashboard; end: boolean }> = [
  { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/stats', label: 'nav.stats', icon: BarChart3, end: false },
  { to: '/budgets', label: 'nav.budgets', icon: Target, end: false },
  { to: '/settings', label: 'nav.settings', icon: Settings2, end: false },
];

/**
 * 侧边栏「记账」模式下多出来的两项
 * ------------------------------------------------------------------
 * 搜索和周期账单不放进底部导航条：手机上那一条已经有 5 格 + 1 个 App 切换，
 * 再塞就挤成一排图标了。它们是「想找的时候才去」的页面，放侧边栏正合适。
 */
const EXTRA: Array<{ to: string; label: DictKey; icon: typeof Search }> = [
  { to: '/search', label: 'nav.search', icon: Search },
  { to: '/recurring', label: 'nav.recurring', icon: Repeat },
  { to: '/weekly', label: 'nav.weekly', icon: CalendarRange },
];

/** 日程模式下的导航只有两项，直接在 JSX 里写，不走 NAV 数组 */

/**
 * 页面切换动画的 key
 * ------------------------------------------------------------------
 * 记账页（/add、/edit/:id）不参与左右推入，它是从底部盖上来的一层。
 * 其它页面按「导航顺序」判断是从左边来还是右边来，做出 iOS 那种方向感。
 */
const ORDER = [
  '/',
  '/stats',
  '/budgets',
  '/settings',
  '/accounts',
  '/categories',
  '/search',
  '/recurring',
  '/weekly',
  '/weekly',
  '/schedule',
  '/schedule/timetable',
];

function Shell() {
  const { ready, error } = useLedger();
  const { t } = useI18n();
  const { mode, setMode, loading: modeLoading } = useMode();
  const { open: assistantOpen, show: showAssistant } = useAssistantUi();
  // 忆小尘入口的位置（可拖动、吸附到左右边），存在 IndexedDB 里
  const { pos: fabPos, save: saveFabPos } = useFabPosition();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdd = location.pathname.startsWith('/add') || location.pathname.startsWith('/edit');
  const isSchedule = mode === 'schedule';

  /**
   * 忆小尘的入口放在哪几页
   * ------------------------------------------------------------------
   * 只放三页：总览、统计（管钱），日程（管时间）。
   * 不放记账页——那里正在填表单，右下角再飘一个按钮会挡住数字键盘；
   * 也不放设置页，那里没有「问一句」的场景。
   */
  const showFab =
    ready && (location.pathname === '/' || location.pathname === '/stats' || location.pathname === '/schedule');

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
   *
   * 注意 modeLoading：模式是从 IndexedDB 异步读出来的，第一帧一律是 'ledger'。
   * 不加这道闸，直接打开 #/schedule?tab=timetable（刷新、从通知点回来）时，
   * 会被这个 effect 立刻改写成 #/，然后模式读完再跳一次 /schedule ——
   * 结果标签页丢了、课表回到日程。等模式读完再对齐就没有这一跳。
   */
  useEffect(() => {
    if (modeLoading) return;
    if (isSchedule && !location.pathname.startsWith('/schedule') && !location.pathname.startsWith('/settings')) {
      navigate('/schedule', { replace: true });
    } else if (!isSchedule && location.pathname.startsWith('/schedule')) {
      navigate('/', { replace: true });
    }
  }, [isSchedule, modeLoading, location.pathname, navigate]);

  function switchMode(next: AppMode) {
    setMode(next);
    navigate(next === 'schedule' ? '/schedule' : '/', { replace: true });
  }

  return (
    <div className={`shell${isSchedule ? ' mode-schedule' : ''}`}>
      <Ambient />
      <aside className="sidebar has-backdrop">
        <Backdrop region="sidebar" />
        <div className="sidebar-inner">
          <AppRail mode={mode} onSwitch={switchMode} />

          {isSchedule ? (
            <>
              {/* 课表是 /schedule 的子路径，所以「日程」这一项必须 end，否则两项会一起亮 */}
              <NavLink to="/schedule" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
                <CalendarDays size={17} />
                {t('nav.schedule')}
              </NavLink>
              <NavLink
                to="/schedule/timetable"
                className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              >
                <Grid3x3 size={17} />
                {t('nav.timetable')}
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
              {EXTRA.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <item.icon size={17} />
                  {t(item.label)}
                </NavLink>
              ))}
            </>
          )}

          <div style={{ flex: 1 }} />

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
                <Route path="/search" element={<SearchPage />} />
                <Route path="/recurring" element={<Recurring />} />
                <Route path="/weekly" element={<Weekly />} />
                <Route path="/schedule" element={<ScheduleShell />} />
                <Route path="/schedule/timetable" element={<ScheduleShell />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}
        </div>
      </main>

      {/* 面板开着时把入口藏掉：面板是玻璃，按钮会在底下透出来 */}
      {showFab && !assistantOpen ? (
        <AssistantFab
          pos={fabPos}
          onOpen={showAssistant}
          onDrop={(side, y) => saveFabPos({ side, y })}
        />
      ) : null}

      {!isAdd ? (
        <nav className="tabbar has-backdrop">
          <Backdrop region="tabbar" />
          <div className="tabbar-inner">
            {isSchedule ? (
              <>
                <NavLink to="/schedule" end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
                  <CalendarDays size={20} />
                  {t('nav.schedule')}
                </NavLink>
                <NavLink
                  to="/schedule/timetable"
                  className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
                >
                  <Grid3x3 size={20} />
                  {t('nav.timetable')}
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
            {/* 手机上只剩一枚「去另一个 App」的图标 —— 见 components/AppRail.tsx */}
            <AppSwitchButton mode={mode} onSwitch={switchMode} />
          </div>
        </nav>
      ) : null}
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
              <AssistantProvider>
                <AssistantHost>
                  <Shell />
                </AssistantHost>
              </AssistantProvider>
            </ModeProvider>
          </LedgerProvider>
        </ToastProvider>
      </AppearanceProvider>
    </I18nProvider>
  );
}
