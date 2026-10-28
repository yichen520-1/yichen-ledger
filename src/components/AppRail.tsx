import { useI18n } from '../i18n';
import type { AppMode } from '../state/ModeContext';

/**
 * 双 App 的入口
 * ------------------------------------------------------------------
 * v0.7.0 之前，「记账 / 日程」是一个两段式胶囊开关（.mode-switch），
 * 用户觉得那不像两个 App，更像一个筛选器。
 *
 * v0.7.0 改成并排两枚小图标；v0.7.1 又改了一次 —— 并排两枚只有图标和一行
 * 小字，看起来像两个「按钮」，不像两个「应用」。现在改成**上下两行**，
 * 每一行是一整块：图标 + 名称 + 标语，和原来侧边栏顶部那块品牌区长得一样。
 * 也就是说，侧边栏顶部不再单独放一份「忆尘记账 + 标语」——
 * 那两个 App 块本身就是顶部。
 *
 * 为什么不做成「应用抽屉」再加一层展开：
 *   目前只有两个 App，上下两块一眼就看全了；
 *   多一层展开等于多点一次，反而更麻烦。将来真的到四五个的时候再抽。
 */

const APPS: Array<{
  mode: AppMode;
  icon: string;
  nameKey: 'mode.ledgerApp' | 'mode.scheduleApp';
  taglineKey: 'app.tagline' | 'schedule.tagline';
}> = [
  { mode: 'ledger', icon: './pwa-192.png', nameKey: 'mode.ledgerApp', taglineKey: 'app.tagline' },
  { mode: 'schedule', icon: './schedule-badge.png', nameKey: 'mode.scheduleApp', taglineKey: 'schedule.tagline' },
];

/** 桌面端：侧边栏顶上那两块 App */
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
            <span className="app-tile-text">
              <strong className="app-tile-name">{t(app.nameKey)}</strong>
              <span className="app-tile-label">{t(app.taglineKey)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * 移动端：底部导航条里的那一枚。
 *
 * 手机上放不下两块并排（底部导航已经有 5 个格子），所以这里只显示
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
      aria-label={t(app.nameKey)}
      title={t(app.nameKey)}
    >
      <img className="tab-app-icon" src={app.icon} alt="" draggable={false} />
    </button>
  );
}
