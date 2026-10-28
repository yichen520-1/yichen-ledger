import { useI18n } from '../i18n';
import type { AppMode } from '../state/ModeContext';

/**
 * 双 App 的入口
 * ------------------------------------------------------------------
 * v0.7.0 之前，「记账 / 日程」是一个两段式胶囊开关（.mode-switch）。
 * 用户觉得那不像两个 App，更像一个筛选器 —— 于是改成现在这样：
 * 侧边栏品牌下面并排放两枚**图标**，像手机桌面上的两个应用，
 * 点哪个就进哪个。图标用的是各自 App 的真实图标，不是线性图标。
 *
 * 为什么不做成「应用抽屉」再加一层展开：
 *   目前只有两个 App，一排两个图标一眼就看全了；
 *   多一层展开等于多点一次，反而更麻烦。将来真的到四五个的时候再抽。
 */

const APPS: Array<{ mode: AppMode; icon: string; labelKey: 'mode.ledgerApp' | 'mode.scheduleApp'; nameKey: 'mode.ledger' | 'mode.schedule' }> = [
  { mode: 'ledger', icon: './pwa-192.png', labelKey: 'mode.ledgerApp', nameKey: 'mode.ledger' },
  { mode: 'schedule', icon: './schedule-badge.png', labelKey: 'mode.scheduleApp', nameKey: 'mode.schedule' },
];

/** 桌面端：侧边栏里那一排 App 图标 */
export function AppRail({ mode, onSwitch }: { mode: AppMode; onSwitch: (m: AppMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="app-rail">
      {APPS.map((app) => {
        const on = app.mode === mode;
        return (
          <button
            key={app.mode}
            className={`app-tile${on ? ' on' : ''}`}
            onClick={() => {
              if (!on) onSwitch(app.mode);
            }}
            aria-current={on ? 'page' : undefined}
            aria-label={t(app.nameKey)}
            title={t(app.nameKey)}
          >
            <span className="app-tile-icon">
              <img src={app.icon} alt="" draggable={false} />
            </span>
            <span className="app-tile-label">{t(app.labelKey)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 移动端：底部导航条里的那一枚。
 *
 * 手机上放不下两枚并排（底部导航已经有 5 个格子），所以这里只显示
 * **另一个 App** 的图标 —— 点它就去那边。图标本身就是「去哪儿」，
 * 比一个写着「切换功能」的胶囊直白。
 *
 * 只放图标不放文字：记账模式下底部已经有 5 个格子，再加一个带文字的
 * 就要挤到 10px 字号还换行；而 App 图标本身已经足够表意。
 */
export function AppSwitchButton({ mode, onSwitch }: { mode: AppMode; onSwitch: (m: AppMode) => void }) {
  const { t } = useI18n();
  const next: AppMode = mode === 'ledger' ? 'schedule' : 'ledger';
  const app = APPS.find((a) => a.mode === next)!;
  return (
    <button
      className="tab tab-app"
      onClick={() => onSwitch(next)}
      aria-label={t(app.labelKey)}
      title={t(app.labelKey)}
    >
      <img className="tab-app-icon" src={app.icon} alt="" draggable={false} />
    </button>
  );
}
