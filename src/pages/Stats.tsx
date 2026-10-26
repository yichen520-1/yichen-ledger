import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
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

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 'YYYY-MM-DD' 的星期几（0=周日）。用本地时间构造，避免 new Date('2024-03-01') 被当成 UTC 而偏差一天 */
function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export default function Stats() {
  const { categories, transactions } = useLedger();
  const [month, setMonth] = useState(currentMonthKey());

  const totals = useMemo(() => monthTotals(transactions, month), [transactions, month]);
  const byCategory = useMemo(() => expenseByCategory(transactions, month), [transactions, month]);
  const trend = useMemo(() => monthlyTrend(transactions, month, 6), [transactions, month]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const maxTrend = Math.max(1, ...trend.map((t) => Math.max(t.expense, t.income)));
  const maxCat = Math.max(1, ...byCategory.map((c) => c.amount));

  const days = useMemo(() => {
    const n = daysInMonth(month);
    return Array.from({ length: n }, (_, i) => {
      const key = `${month}-${(i + 1).toString().padStart(2, '0')}`;
      return { key, day: i + 1, amount: dailyExpense(transactions, key) };
    });
  }, [month, transactions]);
  const maxDay = Math.max(1, ...days.map((d) => d.amount));
  const avg = totals.expense / daysInMonth(month);

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
          <h1 className="page-title">统计</h1>
          <div className="page-sub">看清钱花在哪里</div>
        </div>
        <div className="month-nav">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="上个月">
            <ChevronLeft size={16} />
          </button>
          <div className="label">{month.replace('-', '/')}</div>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            aria-label="下个月"
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
            <div className="muted">本月支出</div>
            <div style={{ fontSize: 24, fontWeight: 700 }} className="mono">
              {formatCents(totals.expense)}
            </div>
          </div>
          <div className="grow">
            <div className="muted">本月收入</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }} className="mono">
              {formatCents(totals.income)}
            </div>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 12 }}>
          日均支出 {formatCents(Math.round(avg))}
          {byCategory.length > 0 ? ` · 最大一笔分类是 ${catMap.get(byCategory[0].categoryId ?? '')?.name ?? '未分类'}` : ''}
        </div>
      </section>

      <div className="section-title">近 6 个月趋势</div>
      <section className="card">
        <svg className="chart" viewBox="0 0 320 150" preserveAspectRatio="none" role="img" aria-label="近六个月收支趋势">
          {[0, 1, 2, 3].map((i) => {
            const y = 10 + (i * 100) / 3;
            return (
              <line key={i} x1="0" x2="320" y1={y} y2={y} stroke="var(--line)" strokeWidth="0.6" strokeDasharray="2 3" />
            );
          })}
          {trend.map((t, i) => {
            const w = 320 / trend.length;
            const bw = Math.min(16, w / 3);
            const hExp = (t.expense / maxTrend) * 100;
            const hInc = (t.income / maxTrend) * 100;
            return (
              <g key={t.month}>
                <rect x={i * w + w / 2 - bw - 2} y={110 - hExp} width={bw} height={Math.max(1, hExp)} rx="3" fill="#ef8a4b" />
                <rect x={i * w + w / 2 + 2} y={110 - hInc} width={bw} height={Math.max(1, hInc)} rx="3" fill="#4cc38a" opacity="0.85" />
                <text x={i * w + w / 2} y={127} textAnchor="middle">
                  {Number(t.month.slice(5))}月
                </text>
                <text x={i * w + w / 2} y={142} textAnchor="middle" style={{ fontSize: 9 }}>
                  {formatCentsCompact(t.expense)}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="heat-legend">
          <span>
            <i style={{ background: '#ef8a4b' }} /> 支出
          </span>
          <span>
            <i style={{ background: '#4cc38a' }} /> 收入
          </span>
        </div>
      </section>

      <div className="section-title">分类排行</div>
      <section className="card">
        {byCategory.length === 0 ? (
          <div className="empty" style={{ padding: '22px 0' }}>
            本月还没有支出记录
          </div>
        ) : (
          byCategory.map((row) => {
            const cat = catMap.get(row.categoryId ?? '');
            return (
              <div className="bar-row" key={row.categoryId ?? 'none'}>
                <div className="bar-label">
                  {cat?.icon ?? '🏷️'} {cat?.name ?? '未分类'}
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

      <div className="section-title">日历视图</div>
      <section className="card">
        <div className="heatmap" style={{ marginBottom: 6 }}>
          {WEEK.map((w) => (
            <div key={w} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
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
              title={d.amount > 0 ? `${d.key} 支出 ${formatCents(d.amount)}` : `${d.key} 无支出`}
            >
              {d.day}
            </div>
          ))}
        </div>
        <div className="heat-legend">
          <span>少</span>
          {['rgba(239,138,75,0.22)', 'rgba(239,138,75,0.45)', 'rgba(239,138,75,0.72)', '#ef8a4b'].map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          <span>多</span>
        </div>
      </section>

      <div className="section-title">支出最高的几天</div>
      <section className="card">
        {days
          .filter((d) => d.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 5)
          .map((d) => (
            <div className="row" key={d.key} style={{ padding: '7px 0', borderBottom: '1px solid var(--line-soft)' }}>
              <span className="grow">
                {Number(d.key.slice(5, 7))}/{d.day} · 周{WEEK[weekdayOf(d.key)]}
              </span>
              <span className="mono" style={{ fontWeight: 600 }}>
                {formatCents(d.amount)}
              </span>
            </div>
          ))}
        {days.every((d) => d.amount === 0) ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            这个月还没有支出
          </div>
        ) : null}
      </section>
    </>
  );
}
