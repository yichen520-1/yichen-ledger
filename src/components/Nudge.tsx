import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n } from '../i18n';
import { toDateKey } from '../domain/model';
import { pickNudge, lastRecordDate, NUDGE_LAST_KEY } from '../domain/nudge';
/** 用户说过「以后别提醒」就不再显示（每次挂载读一次） */
export function nudgeDisabled(): boolean {
  try {
    return localStorage.getItem('nudge.off') === '1';
  } catch {
    return false;
  }
}


/**
 * 忆小尘主动开口
 * ------------------------------------------------------------------
 * 分寸感是这个组件唯一的设计目标：
 *
 *   - 只在打开 App 时判断一次，不轮询、不推送；
 *   - 一天最多说一条（记住上次说话的日期）；
 *   - 没有值得说的事就完全不出现 —— 不硬凑「今天也要加油哦」。
 *
 * 返回 null 是这个组件最常见、也最理想的结果。
 * 一个记账 App 里，助手安静才说明一切正常。
 */
export function Nudge() {
  const { transactions, rules, categories, budgets } = useLedger();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => nudgeDisabled());

  const today = toDateKey(new Date());

  const nudge = useMemo(() => {
    // 今天已经说过一条就不再说了
    try {
      if (localStorage.getItem(NUDGE_LAST_KEY) === today) return null;
    } catch {
      /* localStorage 不可用时照常判断，只是没法「一天一条」 */
    }
    return pickNudge({
      today,
      transactions,
      rules,
      categories,
      budgets,
      // 记账提醒要挑时机：晚上九点之后才说，早上不打扰
      hour: new Date().getHours(),
      lastRecordDate: lastRecordDate(transactions),
    });
  }, [today, transactions, rules, categories, budgets]);

  if (!nudge || dismissed) return null;

  const markSpoken = () => {
    try {
      localStorage.setItem(NUDGE_LAST_KEY, today);
    } catch {
      /* ignore */
    }
  };

  const close = () => {
    markSpoken();
    setDismissed(true);
  };

  const never = () => {
    try {
      localStorage.setItem('nudge.off', '1');
    } catch {
      /* ignore */
    }
    markSpoken();
    setDismissed(true);
  };

  return (
    <div className="nudge">
      <span className="avatar" aria-hidden="true">
        <Sparkles size={13} />
      </span>
      <div className="body">{t(nudge.text as never, nudge.vars)}</div>
      <div className="acts">
        {/* 月度回顾和异常消费都值得点进去看一眼，其余的就只说一句话 */}
        {nudge.kind === 'monthlyReview' ? (
          <Link className="mini-btn" to="/review" onClick={close}>
            {t('nudge.see')}
          </Link>
        ) : nudge.kind === 'abnormal' ? (
          <Link className="mini-btn" to="/stats" onClick={close}>
            {t('nudge.see')}
          </Link>
        ) : nudge.kind === 'billDue' ? (
          <Link className="mini-btn" to="/recurring" onClick={close}>
            {t('nudge.see')}
          </Link>
        ) : null}
        <button className="mini-btn" onClick={close}>
          {t('nudge.dismiss')}
        </button>
        <button className="nudge-x" onClick={never} aria-label={t('nudge.never')} title={t('nudge.never')}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
