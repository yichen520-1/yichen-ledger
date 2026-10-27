import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n } from '../i18n';
import {
  currentMonthKey,
  dailyExpense,
  daysInMonth,
  expenseByCategory,
  formatCents,
  formatCentsCompact,
  monthTotals,
  monthlyTrend,
  shiftMonth,
} from '../domain/model';

/** 'YYYY-MM-DD' 的星期几（0=周日）。用本地时间构造，避免 new Date('2024-03-01') 被当成 UTC 而偏差一天 */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export default function Stats() {
  const { categories, transactions } = useLedger();
  const { t, dict } = useI18n();
  const [month, setMonth] = useState(currentMonthKey());

  const totals = useMemo(() => monthTotals(transactions, month), [transactions, month]);
  const byCategory = useMemo(() => expenseByCategory(transactions, month), [transactions, month]);
  const trend = useMemo(() => monthlyTrend(transactions, month, 6), [transactions, month]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const maxTrend = Math.max(1, ...trend.map((point) => Math.max(point.expense, point.income)));
  const maxCat = Math.max(1, ...byCategory.map((c) => c.amount));

  const days = useMemo(() => {
    const n = daysInMonth(month);
    return Array.from({ length: n }, (_, i) => {
      const key = `${month}-${(i + 1).toString().padStart(2, '0')}`;
      return { key, day: i + 1, amount: dailyExpense(transactions, key) };
    });
  }, [month, transactions]);
  const maxDay = Math.max(1, ...days.map((d) => d.amount));
  // 当月的「日均」要按已经过去的天数算，否则月初会显得花得很少
  const elapsedDays = month === currentMonthKey() ? new Date().getDate() : daysInMonth(month);
  const avg = totals.expense / Math.max(1, elapsedDays);

  // 每一天的支出占最大值的比例 -> 用 5 档色阶
  const heatColor = (amount: number): string => {
    if (amount <= 0) return 'var(--bg-elev-2)';
    const ratio = amount / maxDay;
    if (ratio > 0.75) return '#ef8a4b';
    if (ratio > 0.5) return 'rgba(239, 138, 75, 0.72)';
    if (ratio > 0.25) return 'rgba(239, 138, 75, 0.45)';
    return 'rgba(239, 138, 75, 0.22)';
  };

  const firstWeekday = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay();

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('stats.title')}</h1>
          <div className="page-sub">{t('stats.sub')}</div>
        </div>
        <div className="month-nav">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t('stats.prevMonth')}>
            <ChevronLeft size={16} />
          </button>
          <div className="label">{t('stats.monthLabel', { m: Number(month.slice(5)) })}</div>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label={t('stats.nextMonth')}
            disabled={month >= currentMonthKey()}
            style={{ opacity: month >= currentMonthKey() ? 0.4 : 1 }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <section className="card">
        <div className="row" style={{ gap: 18 }}>
          <div className="grow">
            <div className="muted">{t('stats.monthExpense')}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }} className="mono">
              {formatCents(totals.expense)}
            </div>
          </div>
          <div className="grow">
            <div className="muted">{t('stats.monthIncome')}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }} className="mono">
              {formatCents(totals.income)}
            </div>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 12 }}>
          {t('stats.avg', { amount: formatCents(Math.round(avg)) })}
          {byCategory.length > 0
            ? ` · ${t('stats.largest', {
                name: catMap.get(byCategory[0].categoryId ?? '')?.name ?? t('common.uncategorized'),
              })}`
            : ''}
        </div>
      </section>

      <div className="section-title">{t('stats.trend')}</div>
      <section className="card">
        {/*
          柱子用 SVG 画（preserveAspectRatio="none" 才能随宽度自由拉伸），
          但文字不能放在里面 —— 非等比缩放会把字压扁或拉宽。
          所以月份和金额改成下面的 HTML 行来排版。
        */}
        <svg className="chart" viewBox="0 0 320 110" preserveAspectRatio="none" role="img" aria-label={t('stats.chartAria')}>
          {[0, 1, 2, 3].map((i) => {
            const y = 6 + (i * 100) / 3;
            return (
              <line key={i} x1="0" x2="320" y1={y} y2={y} stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 3" />
            );
          })}
          {trend.map((point, i) => {
            const w = 320 / trend.length;
            const bw = Math.min(16, w / 3);
            const hExp = (point.expense / maxTrend) * 100;
            const hInc = (point.income / maxTrend) * 100;
            return (
              <g key={point.month}>
                <rect x={i * w + w / 2 - bw - 2} y={106 - hExp} width={bw} height={Math.max(1, hExp)} rx="3" fill="#ef8a4b" />
                <rect x={i * w + w / 2 + 2} y={106 - hInc} width={bw} height={Math.max(1, hInc)} rx="3" fill="#4cc38a" opacity="0.85" />
              </g>
            );
          })}
        </svg>
        <div className="chart-axis" style={{ gridTemplateColumns: `repeat(${trend.length}, 1fr)` }}>
          {trend.map((point) => (
            <div key={point.month}>
              <div className="m">{t('stats.monthLabel', { m: Number(point.month.slice(5)) })}</div>
              <div className="v">{point.expense > 0 ? formatCentsCompact(point.expense) : '—'}</div>
            </div>
          ))}
        </div>
        <div className="heat-legend">
          <span>
            <i style={{ background: '#ef8a4b' }} /> {t('stats.legendExpense')}
          </span>
          <span>
            <i style={{ background: '#4cc38a' }} /> {t('stats.legendIncome')}
          </span>
        </div>
      </section>

      <div className="section-title">{t('stats.categoryRank')}</div>
      <section className="card">
        {byCategory.length === 0 ? (
          <div className="empty" style={{ padding: '22px 0' }}>
            {t('stats.noExpenseMonth')}
          </div>
        ) : (
          byCategory.map((row) => {
            const cat = catMap.get(row.categoryId ?? '');
            return (
              <div className="bar-row" key={row.categoryId ?? 'none'}>
                <div className="bar-label">
                  {cat?.icon ?? '🏷️'} {cat?.name ?? t('common.uncategorized')}
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.max(2, (row.amount / maxCat) * 100)}%`,
                      background: cat?.color ?? '#8d8d8d',
                    }}
                  />
                </div>
                <div className="bar-value">{formatCents(row.amount)}</div>
                <div className="bar-pct">
                  {totals.expense > 0 ? ((row.amount / totals.expense) * 100).toFixed(0) : 0}%
                </div>
              </div>
            );
          })
        )}
      </section>

      <div className="section-title">{t('stats.calendar')}</div>
      <section className="card">
        <div className="heatmap" style={{ marginBottom: 6 }}>
          {dict.weekShort.map((w, i) => (
            <div key={`w-${i}`} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
              {w}
            </div>
          ))}
          {Array.from({ length: firstWeekday }).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((d) => (
            <div
              key={d.key}
              className="heat-cell"
              style={{ background: heatColor(d.amount) }}
              title={
                d.amount > 0
                  ? `${d.key} ${t('dashboard.dayExpense', { amount: formatCents(d.amount) })}`
                  : d.key
              }
            >
              {d.day}
            </div>
          ))}
        </div>
        <div className="heat-legend">
          <span>{t('stats.less')}</span>
          {['rgba(239,138,75,0.22)', 'rgba(239,138,75,0.45)', 'rgba(239,138,75,0.72)', '#ef8a4b'].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          <span>{t('stats.more')}</span>
        </div>
      </section>

      <div className="section-title">{t('stats.topDays')}</div>
      <section className="card">
        {days
          .filter((d) => d.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5)
          .map((d) => (
            <div className="row" key={d.key} style={{ padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <span className="grow">
                {Number(d.key.slice(5, 7))}/{d.day} ·{' '}
                {t('stats.weekday', { day: dict.weekShort[weekdayOf(d.key)] })}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatCents(d.amount)}
              </span>
            </div>
          ))}
        {days.every((d) => d.amount === 0) ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            {t('stats.noExpenseAtAll')}
          </div>
        ) : null}
      </section>
    </>
  );
}
