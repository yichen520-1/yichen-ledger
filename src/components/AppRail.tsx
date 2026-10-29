import { useI18n } from '../i18n';
import type { AppMode } from '../state/ModeContext';

/**
 * 侧边栏顶部的品牌区 + 双 App 入口
 * ------------------------------------------------------------------
 * 品牌结构是两层：
 *
 *   忆笺               ← 总和名，记账 + 日程 + 忆小尘 全归它管
 *     忆笺 · 记账        ← 子 App
 *     忆笺 · 日程        ← 子 App
 *
 * 为什么加这块品牌区（v0.7.3）：
 *   v0.7.1 把侧边栏顶部直接让给了两个 App 块，没有品牌区。结果「忆笺」
 *   这两个字只在两个 App 名的开头各出现一次，读起来像两个平行的产品，
 *   而不是同一个产品里的两块。加回一块品牌区，两层关系才立得住。
 *
 * 为什么品牌区只是「图标 + 名字 + 一句标语」不放导航：
 *   它不承担任何跳转。点它没有任何事发生 —— 所以它不是按钮，
 *   不用 button 标签，也不给 hover 反馈。它是一枚抬头。
 *
 * 为什么标语三句各不相同：
 *   忆笺一句（所记所行，皆有归处），记账一句（所记皆来路，所忆皆无尘），
 *   日程一句（所行皆有期，所至皆有时）。同一句在侧边栏里紧挨着出现两次
 *   会像重复渲染，所以忆笺单独用新起的一句。
 */

const APPS: Array<{
  mode: AppMode;
  icon: string;
  nameKey: 'mode.ledgerApp' | 'mode.scheduleApp';
  taglineKey: 'mode.ledgerTagline' | 'schedule.tagline';
}> = [
  { mode: 'ledger', icon: './pwa-192.png', nameKey: 'mode.ledgerApp', taglineKey: 'mode.ledgerTagline' },
  { mode: 'schedule', icon: './schedule-badge.png', nameKey: 'mode.scheduleApp', taglineKey: 'schedule.tagline' },
];

/** 品牌区：忆笺 + 标语。不可点，纯抬头。 */
function BrandHeader() {
  const { t } = useI18n();
  return (
    <div className="rail-brand">
      <span className="brand-mark" aria-hidden="true">
        忆
      </span>
      <span className="rail-brand-text">
        <strong className="rail-brand-name">{t('app.name')}</strong>
        <span className="rail-brand-label">{t('app.tagline')}</span>
      </span>
    </div>
  );
}

/** 桌面端：侧边栏顶上那块品牌区 + 两块 App */
export function AppRail({ mode, onSwitch }: { mode: AppMode; onSwitch: (m: AppMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="app-rail">
      <BrandHeader />
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
