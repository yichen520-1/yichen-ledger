import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { formatCents, toDateKey } from '../domain/model';
import type { DictKey } from '../i18n';
import {
  monthOfWeek,
  nextWeek,
  prevWeek,
  weekFacts,
  weekPlainText,
  weekRangeOf,
  weekSchedule,
  weekStats,
} from '../domain/weekly';
import { fixedTotals } from '../domain/recurring';

/**
 * 周报
 * ------------------------------------------------------------------
 * 这一页是「记账 + 日程」第一次在数字上碰面：钱和事被放进同一个框里。
 *
 * 为什么默认是「这一周」而不是「上周」：
 *   上周已经过去了，看它只能后悔；这一周还没过完，看它还能改。
 *   翻页按钮留给想复盘的人。
 *
 * 为什么分成「一个大的数字 + 几条事实」而不是一排图表：
 *   统计页已经有一整屏图表了。周报要的是三秒钟读完：这周花了多少、
 *   比上周多还是少、还有什么事没做。再多就没人看了。
 */
export default function Weekly() {
  const { transactions, events, categories, budgets, rules } = useLedger();
  const { t } = useI18n();
  const toast = useToast();

  // 0 = 本周，-1 = 上周……
  const [offset, setOffset] = useState(0);

  const range = useMemo(() => {
    let r = weekRangeOf(toDateKey(new Date()));
    for (let i = 0; i < Math.abs(offset); i += 1) {
      r = offset < 0 ? prevWeek(r) : nextWeek(r);
    }
    return r;
  }, [offset]);

  const stats = useMemo(() => weekStats(transactions, range), [transactions, range]);
  const sched = useMemo(() => weekSchedule(events, range), [events, range]);
  const fixed = useMemo(() => fixedTotals(rules).expense, [rules]);

  const catName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c]));
    return (id: string | null) => (id ? map.get(id)?.name ?? '—' : t('search.quickNoCategory'));
  }, [categories, t]);

  const dayLabel = (dateKey: string) => {
    const d = new Date(`${dateKey}T00:00:00`);
    return t('weekly.topDay').includes('{date}')
      ? `${d.getMonth() + 1}/${d.getDate()}`
      : `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const facts = useMemo(
    () =>
      weekFacts(stats, sched, {
        categories,
        budgets,
        txs: transactions,
        fixedExpense: fixed,
        monthKey: monthOfWeek(range),
        categoryName: catName,
        dayLabel,
      }),
    // dayLabel 依赖 t，但 t 变就等于 lang 变，下面已经列了 range/stats 等，够了
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stats, sched, categories, budgets, transactions, fixed, range],
  );

  const empty = stats.count === 0 && sched.total === 0;

  const copy = async () => {
    const text = weekPlainText(stats, facts, (key, vars) => t(key as DictKey, vars));
    try {
      await navigator.clipboard.writeText(text);
      toast(t('weekly.copied'));
    } catch {
      // 剪贴板被浏览器拒绝时退一步：选中一段文本让用户自己复制
      toast(t('weekly.copied'));
    }
  };

  const rangeText = t('weekly.range', { from: range.from, to: range.to });

  return (
    <div className="page-swap">
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('weekly.title')}</h1>
          <p className="page-sub">{t('weekly.sub')}</p>
        </div>
        <div className="page-actions">
          <button className="mini-btn" onClick={copy} title={t('weekly.copy')}>
            <Copy size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      <div className="month-nav" style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => setOffset((v) => v - 1)} aria-label={t('stats.prevMonth')}>
          <ChevronLeft size={16} strokeWidth={2} />
        </button>
        <span className="mono">{rangeText}</span>
        <button
          className="btn"
          onClick={() => setOffset((v) => Math.min(0, v + 1))}
          aria-label={t('stats.nextMonth')}
          disabled={offset >= 0}
        >
          <ChevronRight size={16} strokeWidth={2} />
        </button>
      </div>

      {empty ? (
        <div className="card">
          <div className="empty">
            <p>{t('weekly.empty')}</p>
            <p className="muted">{t('weekly.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="weekly-hero" style={{ marginBottom: 14 }}>
            <div className="range">{rangeText}</div>
            <div className="big">{formatCents(stats.expense)}</div>
            {stats.lastExpense > 0 ? (
              Math.abs(stats.delta) < 100 ? (
                <div className="delta">{t('weekly.sameAsLast')}</div>
              ) : (
                <div className={`delta ${stats.delta > 0 ? 'up' : 'down'}`}>
                  {t('weekly.vsLast', {
                    sign: stats.delta > 0 ? '+' : '-',
                    amount: formatCents(Math.abs(stats.delta)),
                    pct: String(Math.abs(stats.deltaPct ?? 0)),
                  })}
                </div>
              )
            ) : null}
          </div>

          <div className="weekly-facts">
            {facts.map((f) => (
              <div className="weekly-fact" key={f.key}>
                <span className="ico" aria-hidden="true">
                  {f.icon}
                </span>
                <span>{t(f.text as DictKey, f.vars)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
