import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n } from '../i18n';
import { currentYear, topDayOfYear, yearExpenseByCategory, yearStats } from '../domain/annual';
import { formatCents, formatCentsCompact } from '../domain/model';

/**
 * 年度视图
 * ------------------------------------------------------------------
 * 为什么单独一块而不是塞进统计页的月视图：
 *   月视图回答「这个月花了多少」，年视图回答「我这一年是不是真的变了」。
 *   两个问题的答案不一样，混在一屏里只会互相干扰。
 *
 * 为什么把「同比」放在最上面：
 *   环比会被春节、年终奖、开学这些季节性因素搅乱 —— 二月比一月少花一半
 *   可能只是过年不在外面吃饭。同比把季节抵消掉了，是唯一能看出
 *   「我是不是真的变了」的对比。
 */

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

type Tone = 'up' | 'down' | 'flat' | 'none';

export default function StatsAnnual() {
  const { transactions, categories } = useLedger();
  const { t } = useI18n();
  const [year, setYear] = useState(currentYear());
  const thisYear = currentYear();

  const stats = useMemo(() => yearStats(transactions, year), [transactions, year]);
  const byCat = useMemo(() => yearExpenseByCategory(transactions, year), [transactions, year]);
  const topDay = useMemo(() => topDayOfYear(transactions, year), [transactions, year]);
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const maxMonth = Math.max(1, ...stats.months.map((m) => Math.max(m.expense, m.income)));
  const maxExpenseMonth = Math.max(1, ...stats.months.map((m) => m.expense));
  const maxCat = Math.max(1, ...byCat.map((c) => c.amount));

  const changeOf = (change: number | null): { text: string; tone: Tone } => {
    if (change === null) return { text: t('annual.noBase'), tone: 'none' };
    if (Math.abs(change) < 0.005) return { text: t('annual.flat'), tone: 'flat' };
    const pct = `${(Math.abs(change) * 100).toFixed(0)}%`;
    return change > 0
      ? { text: t('annual.up', { pct }), tone: 'up' }
      : { text: t('annual.down', { pct }), tone: 'down' };
  };

  const yoyE = changeOf(stats.yoyExpense);
  const yoyI = changeOf(stats.yoyIncome);

  const heatColor = (amount: number): string => {
    if (amount <= 0) return 'var(--bg-elev-2)';
    const ratio = amount / maxExpenseMonth;
    if (ratio > 0.75) return '#ef8a4b';
    if (ratio > 0.5) return 'rgba(239, 138, 75, 0.72)';
    if (ratio > 0.25) return 'rgba(239, 138, 75, 0.45)';
    return 'rgba(239, 138, 75, 0.22)';
  };

  return (
    <>
      <div className="month-nav" style={{ marginBottom: 14 }}>
        <button onClick={() => setYear((y) => String(Number(y) - 1))} aria-label={t('annual.prevYear')}>
          <ChevronLeft size={16} />
        </button>
        <div className="label mono">{t('annual.yearLabel', { year: String(year) })}</div>
        <button
          onClick={() => setYear((y) => String(Number(y) + 1))}
          aria-label={t('annual.nextYear')}
          disabled={Number(year) >= Number(thisYear)}
          style={{ opacity: Number(year) >= Number(thisYear) ? 0.4 : 1 }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {stats.count === 0 ? (
        <section className="card">
          <div className="empty">{t('annual.empty')}</div>
        </section>
      ) : (
        <>
          <section className="card">
            <div className="row" style={{ gap: 18 }}>
              <div className="grow">
                <div className="muted">{t('annual.totalExpense')}</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700 }}>
                  {formatCents(stats.expense)}
                </div>
                <div className={`annual-delta ${yoyE.tone}`}>{yoyE.text}</div>
              </div>
              <div className="grow">
                <div className="muted">{t('annual.totalIncome')}</div>
                <div className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--green)' }}>
                  {formatCents(stats.income)}
                </div>
                <div className={`annual-delta ${yoyI.tone}`}>{yoyI.text}</div>
              </div>
            </div>
            <div className="annual-facts">
              <div>
                <span className="k">{t('annual.net')}</span>
                <span className="v">{formatCents(stats.net)}</span>
              </div>
              <div>
                <span className="k">{t('annual.avgMonth')}</span>
                <span className="v">{formatCents(stats.avgExpense)}</span>
              </div>
              <div>
                <span className="k">{t('annual.activeMonths')}</span>
                <span className="v">{String(stats.activeMonths)}</span>
              </div>
            </div>
            <div className="muted annual-hint">{t('annual.yoyHint')}</div>
          </section>

          <div className="section-title">{t('annual.chartTitle')}</div>
          <section className="card">
            <svg
              className="chart"
              viewBox="0 0 320 110"
              preserveAspectRatio="none"
              role="img"
              aria-label={t('annual.chartAria')}
            >
              {[0, 1, 2, 3].map((i) => {
                const y = 6 + (i * 100) / 3;
                return (
                  <line
                    key={i}
                    x1="0"
                    x2="320"
                    y1={y}
                    y2={y}
                    stroke="var(--line)"
                    strokeWidth="0.6"
                    strokeDasharray="2 3"
                  />
                );
              })}
              {stats.months.map((point, i) => {
                const w = 320 / 12;
                const bw = Math.min(9, w / 3);
                const hExp = (point.expense / maxMonth) * 100;
                const hInc = (point.income / maxMonth) * 100;
                return (
                  <g key={point.month}>
                    <rect
                      x={i * w + w / 2 - bw - 1}
                      y={106 - hExp}
                      width={bw}
                      height={Math.max(1, hExp)}
                      rx="2"
                      fill="#ef8a4b"
                    />
                    <rect
                      x={i * w + w / 2 + 1}
                      y={106 - hInc}
                      width={bw}
                      height={Math.max(1, hInc)}
                      rx="2"
                      fill="#4cc38a"
                      opacity="0.85"
                    />
                  </g>
                );
              })}
            </svg>
            <div className="chart-axis" style={{ gridTemplateColumns: 'repeat(12, 1fr)' }}>
              {stats.months.map((point) => (
                <div key={point.month}>
                  <div className="m">{Number(point.month.slice(5))}</div>
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

          <div className="section-title">{t('annual.heatTitle')}</div>
          <section className="card">
            <div className="annual-months">
              {MONTHS.map((m) => {
                const key = `${year}-${String(m).padStart(2, '0')}`;
                const point = stats.months[m - 1];
                return (
                  <div
                    key={key}
                    className={`annual-month${point.expense > 0 ? '' : ' quiet'}`}
                    style={{ background: heatColor(point.expense) }}
                    title={`${key} ${formatCents(point.expense)}`}
                  >
                    <span>{t('annual.monthShort', { m: String(m) })}</span>
                  </div>
                );
              })}
            </div>
            {topDay ? (
              <div className="muted" style={{ marginTop: 12 }}>
                {t('review.topDay', {
                  date: `${Number(topDay.date.slice(5, 7))}/${Number(topDay.date.slice(8, 10))}`,
                  amount: formatCents(topDay.amount),
                })}
              </div>
            ) : null}
          </section>

          <div className="section-title">{t('annual.rankTitle')}</div>
          <section className="card">
            {byCat.length === 0 ? (
              <div className="empty" style={{ padding: '22px 0' }}>
                {t('stats.noExpenseAtAll')}
              </div>
            ) : (
              byCat.slice(0, 12).map((row) => {
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
                    <div className="bar-pct">{String(row.months)}</div>
                  </div>
                );
              })
            )}
          </section>
        </>
      )}
    </>
  );
}

