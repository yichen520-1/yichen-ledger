import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';
import { formatCents, monthTotals, shiftMonth, currentMonthKey, monthKeyOf } from '../domain/model';
import { monthHeat, reviewFacts, reviewPlainText } from '../domain/annual';
import { fixedTotals } from '../domain/recurring';
import { BackButton } from '../components/BackButton';

/**
 * 月度回顾
 * ------------------------------------------------------------------
 * 和周报的分工：
 *   周报看「这一周是不是花多了」，要的是及时；
 *   月报看「这个月过得怎么样」，要的是完整 —— 月底了，该结算了。
 *
 * 为什么可以复制成文字：
 *   回顾是给自己看的，也是可以发给别人的。截图带着整套 UI，
 *   一段纯文字反而更容易贴到聊天里，也方便存到年底再看。
 */

export default function Review() {
  const { transactions, categories, rules } = useLedger();
  const { t, dict } = useI18n();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonthKey());

  const totals = useMemo(() => monthTotals(transactions, month), [transactions, month]);
  const lastMonth = useMemo(() => shiftMonth(month, -1), [month]);
  const lastTotals = useMemo(() => monthTotals(transactions, lastMonth), [transactions, lastMonth]);
  const fixed = useMemo(() => fixedTotals(rules).expense, [rules]);
  const facts = useMemo(
    () => reviewFacts(transactions, month, categories, fixed),
    [transactions, month, categories, fixed],
  );
  const plain = useMemo(
    () => reviewPlainText(transactions, month, (key, vars) => t(key as never, vars), facts),
    [transactions, month, facts, t],
  );
  const heat = useMemo(() => monthHeat(transactions, month), [transactions, month]);

  const maxHeat = Math.max(1, ...heat.map((d) => d.amount));
  const count = useMemo(
    () => transactions.filter((tx) => monthKeyOf(tx.date) === month).length,
    [transactions, month],
  );

  const delta = totals.expense - lastTotals.expense;
  const pct = lastTotals.expense > 0 ? Math.abs(delta) / lastTotals.expense : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      toast(t('review.copied'));
    } catch {
      toast(t('review.copied'));
    }
  };

  const monthLabel = `${month.slice(0, 4)}-${month.slice(5, 7)}`;

  return (
    <>
      <div className="page-head">
        <BackButton />
        <div>
          <h1 className="page-title">{t('review.title')}</h1>
          <div className="page-sub">{t('review.sub')}</div>
        </div>
        <div className="page-actions">
          <button className="mini-btn" onClick={copy} title={t('review.copy')}>
            <Copy size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {t('review.copy')}
          </button>
        </div>
      </div>

      <div className="month-nav" style={{ marginBottom: 14 }}>
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t('review.prevMonth')}>
          <ChevronLeft size={16} />
        </button>
        <div className="label">{t('review.head', { month: monthLabel })}</div>
        <button
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          aria-label={t('review.nextMonth')}
          disabled={month >= currentMonthKey()}
          style={{ opacity: month >= currentMonthKey() ? 0.4 : 1 }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {count === 0 ? (
        <section className="card">
          <div className="empty">
            <p className="muted">{t('review.empty')}</p>
            <p className="muted" style={{ fontSize: 'calc(11.5px * var(--font-scale, 1))' }}>
              {t('review.emptyHint')}
            </p>
          </div>
        </section>
      ) : (
        <>
          <div className="review-hero">
            <div className="head">{t('review.heroExpense')}</div>
            <div className="big mono">{formatCents(totals.expense)}</div>
            {lastTotals.expense === 0 ? (
              <div className="delta">{t('review.vsLastNoBase')}</div>
            ) : Math.abs(delta) < 100 ? (
              <div className="delta">{t('review.vsLastFlat')}</div>
            ) : delta > 0 ? (
              <div className="delta up">
                {t('review.vsLastUp', {
                  amount: formatCents(Math.abs(delta)),
                  pct: `${((pct ?? 0) * 100).toFixed(0)}%`,
                })}
              </div>
            ) : (
              <div className="delta down">
                {t('review.vsLastDown', {
                  amount: formatCents(Math.abs(delta)),
                  pct: `${((pct ?? 0) * 100).toFixed(0)}%`,
                })}
              </div>
            )}
          </div>

          <div className="review-lines">
            {facts.map((f) => (
              <div className="review-line" key={f.key}>
                <span className="ico" aria-hidden="true">
                  {f.icon}
                </span>
                <span>{t(f.text as never, f.vars)}</span>
              </div>
            ))}
          </div>

          <div className="section-title">{t('annual.heatTitle')}</div>
          <section className="card">
            <div className="heatmap">
              {dict.weekShort.map((w, i) => (
                <div key={`w-${i}`} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
                  {w}
                </div>
              ))}
              {Array.from({ length: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1).getDay() }).map(
                (_, i) => (
                  <div key={`pad-${i}`} />
                ),
              )}
              {heat.map((d) => {
                const ratio = d.amount / maxHeat;
                const bg =
                  d.amount <= 0
                    ? 'var(--bg-elev-2)'
                    : ratio > 0.75
                      ? '#ef8a4b'
                      : ratio > 0.5
                        ? 'rgba(239,138,75,0.72)'
                        : ratio > 0.25
                          ? 'rgba(239,138,75,0.45)'
                          : 'rgba(239,138,75,0.22)';
                return (
                  <div
                    key={d.date}
                    className="heat-cell"
                    style={{ background: bg }}
                    title={`${d.date} ${formatCents(d.amount)}`}
                  >
                    {Number(d.date.slice(8, 10))}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="section-title">{t('review.plainHead', { month: monthLabel })}</div>
          <div className="review-plain">{plain}</div>
          <div className="muted" style={{ marginTop: 10, fontSize: 'calc(11px * var(--font-scale, 1))' }}>
            {t('review.exportHint')}
          </div>
        </>
      )}
    </>
  );
}
