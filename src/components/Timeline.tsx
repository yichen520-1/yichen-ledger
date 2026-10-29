import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedger } from '../state/LedgerContext';
import { useI18n } from '../i18n';
import { formatCents, toDateKey } from '../domain/model';
import { addDays, expandRange } from '../domain/schedule';

/**
 * 总览时间轴：账目和日程画在同一根轴上
 * ------------------------------------------------------------------
 * 这是「一张纸上记两样东西」这句品牌设定的视觉落地 —— 记账 App 和日程 App
 * 各自都有一条时间线，但只有把两条叠起来，才能看见「这天花了 320，
 * 还开了三个会」这种关系。
 *
 * 为什么从 14 天开始、而不是一次铺完：
 *   时间轴的价值在「最近这段日子」；账本用几年之后，一次全画出来既慢又没用。
 *   默认 14 天，点一下再多 30 天，是一直往后翻的感觉。
 *
 * 为什么账目用红绿、日程用蓝色：
 *   账目有方向（花出去 / 收进来），红绿是这个产品里已经用熟的语义；
 *   日程不是钱，用第三种颜色（蓝）才不会被误读成金额。
 */

const INITIAL_DAYS = 30;
const STEP_DAYS = 30;

export function Timeline() {
  const { transactions, events, categoryOf } = useLedger();
  const { t, lang, dict } = useI18n();
  const navigate = useNavigate();
  const [days, setDays] = useState(INITIAL_DAYS);

  const today = toDateKey(new Date());
  const from = addDays(today, -(days - 1));

  const dayList = useMemo(() => {
    const occurrences = expandRange(events, from, today);

    // 按日期归并两类东西
    const map = new Map<
      string,
      {
        tx: typeof transactions;
        ev: typeof occurrences;
      }
    >();
    const ensure = (date: string) => {
      let row = map.get(date);
      if (!row) {
        row = { tx: [], ev: [] };
        map.set(date, row);
      }
      return row;
    };

    for (const tx of transactions) {
      if (tx.date < from || tx.date > today) continue;
      ensure(tx.date).tx.push(tx);
    }
    for (const occ of occurrences) {
      ensure(occ.date).ev.push(occ);
    }

    // 日期倒序：最新的一天在最上面
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, row]) => ({
        date,
        tx: row.tx.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        ev: row.ev.slice(),
      }));
  }, [transactions, events, from, today]);

  function dayLabel(dateKey: string): string {
    if (dateKey === today) return t('common.today');
    const [y, m, d] = dateKey.split('-').map(Number);
    const weekday = dict.weekShort[new Date(y, m - 1, d).getDay()];
    if (lang === 'en') return `${MONS[m - 1]} ${d} ${weekday}`;
    return `${m}月${d}日 ${weekday}`;
  }

  if (dayList.length === 0) {
    return (
      <section className="card empty" style={{ padding: '24px 16px' }}>
        {t('timeline.empty')}
      </section>
    );
  }

  return (
    <>
      <section className="card" style={{ padding: '16px 14px 6px' }}>
        <div className="timeline">
          {dayList.map((day) => (
            <div key={day.date} className={`tl-day${day.date === today ? ' today' : ''}`}>
              <span className="tl-dot" />
              <div className="tl-date">
                {dayLabel(day.date)} ·{' '}
                {t('timeline.dayCount', { tx: String(day.tx.length), ev: String(day.ev.length) })}
              </div>
              {day.tx.map((tx) => {
                const cat = categoryOf(tx.categoryId);
                const sign = tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '';
                return (
                  <div key={tx.id} className="tl-item tx" onClick={() => navigate(`/edit/${tx.id}`)}>
                    <span className="tag">{t('timeline.tx')}</span>
                    <span className="txt">
                      {tx.note || cat?.name || t('common.uncategorized')}
                      {tx.note && cat ? ` · ${cat.name}` : ''}
                    </span>
                    <span className={`amt ${tx.type}`}>
                      {sign}
                      {formatCents(tx.amount)}
                    </span>
                  </div>
                );
              })}
              {day.ev.map((occ) => (
                <div
                  key={occ.key}
                  className="tl-item ev"
                  onClick={() => navigate('/schedule')}
                  style={{ opacity: occ.done ? 0.55 : 1 }}
                >
                  <span className="tag">{t('timeline.event')}</span>
                  <span className="txt">{occ.event.title}</span>
                  <span className="when">{occ.event.allDay ? '—' : occ.event.startTime}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
      <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
        <button className="mini-btn" onClick={() => setDays((d) => d + STEP_DAYS)}>
          {t('timeline.loadMore')}
        </button>
      </div>
    </>
  );
}

const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
