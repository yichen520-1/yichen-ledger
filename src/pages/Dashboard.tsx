import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import {
  accountBalance,
  currentMonthKey,
  formatCents,
  monthTotals,
  netWorth,
  toDateKey,
  shiftMonth,
  monthKeyOf,
} from '../domain/model';
import type { Transaction } from '../domain/model';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function dayLabel(dateKey: string): string {
  const today = toDateKey(new Date());
  const yesterday = toDateKey(new Date(Date.now() - 86400000));
  if (dateKey === today) return '今天';
  if (dateKey === yesterday) return '昨天';
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日 ${WEEK[dt.getDay()]}`;
}

export default function Dashboard() {
  const { accounts, transactions, categoryOf, accountName } = useLedger();
  const navigate = useNavigate();
  const month = currentMonthKey();

  const totals = useMemo(() => monthTotals(transactions, month), [transactions, month]);
  const lastTotals = useMemo(() => monthTotals(transactions, shiftMonth(month, -1)), [transactions, month]);
  const worth = useMemo(() => netWorth(accounts, transactions), [accounts, transactions]);

  const recent = useMemo(
    () =>
      transactions
        .slice()
        .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)))
        .slice(0, 60),
    [transactions],
  );

  const groups = useMemo(() => {
    const out: Array<{ date: string; items: Transaction[]; expense: number; income: number }> = [];
    for (const tx of recent) {
      let g = out[out.length - 1];
      if (!g || g.date !== tx.date) {
        g = { date: tx.date, items: [], expense: 0, income: 0 };
        out.push(g);
      }
      g.items.push(tx);
      if (tx.type === 'expense') g.expense += tx.amount;
      else if (tx.type === 'income') g.income += tx.amount;
    }
    return out;
  }, [recent]);

  const topAccounts = useMemo(
    () =>
      accounts
        .filter((a) => !a.archived)
        .map((a) => ({ account: a, balance: accountBalance(a, transactions) }))
        .sort((a, b) => b.balance - a.balance)
        .slice(0, 4),
    [accounts, transactions],
  );

  const delta = totals.expense - lastTotals.expense;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">总览</h1>
          <div className="page-sub">
            {month.replace('-', ' 年 ')} 月 · 共 {transactions.length} 笔记录
          </div>
        </div>
      </div>

      <section className="card overview">
        <div className="networth-label">净资产</div>
        <div className="networth">{formatCents(worth)}</div>
        <div className="split">
          <div>
            <div className="k">本月支出</div>
            <div className="v expense">{formatCents(totals.expense)}</div>
          </div>
          <div>
            <div className="k">本月收入</div>
            <div className="v income">{formatCents(totals.income)}</div>
          </div>
          <div>
            <div className="k">结余</div>
            <div className="v" style={{ color: totals.income - totals.expense >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {formatCents(totals.income - totals.expense)}
            </div>
          </div>
        </div>
      </section>

      {lastTotals.expense > 0 ? (
        <div className="muted" style={{ marginTop: 10, paddingLeft: 4 }}>
          比上月{delta >= 0 ? '多花' : '少花'} {formatCents(Math.abs(delta))}
          {delta !== 0 ? `（${((Math.abs(delta) / lastTotals.expense) * 100).toFixed(0)}%）` : ''}
        </div>
      ) : null}

      <div className="section-title">
        账户
        <Link to="/accounts">管理</Link>
      </div>
      <section className="card" style={{ padding: '6px 14px' }}>
        {topAccounts.length === 0 ? (
          <div className="empty" style={{ padding: '20px 0' }}>
            还没有账户
          </div>
        ) : (
          topAccounts.map(({ account, balance }) => (
            <div key={account.id} className="tx-row" onClick={() => navigate('/accounts')} style={{ cursor: 'pointer' }}>
              <div className="tx-icon">
                {account.kind === 'cash' ? '💵' : account.kind === 'bank' ? '🏦' : account.kind === 'credit' ? '💳' : account.kind === 'investment' ? '📈' : '📱'}
              </div>
              <div className="tx-body">
                <div className="tx-title">{account.name}</div>
              </div>
              <div className="tx-amount" style={{ color: balance < 0 ? 'var(--red)' : 'var(--text)' }}>
                {formatCents(balance)}
              </div>
            </div>
          ))
        )}
      </section>

      <div className="section-title">
        本月分类占比
        <Link to="/stats">看统计</Link>
      </div>
      <CategoryMini month={month} />

      <div className="section-title">
        最近记录
        <Link to="/add">记一笔</Link>
      </div>

      {groups.length === 0 ? (
        <div className="card empty">
          <span className="emoji">🧾</span>
          还没有任何账目，点下面的「+」记第一笔吧
        </div>
      ) : (
        <section className="card" style={{ padding: '2px 14px 10px' }}>
          {groups.map((g) => (
            <div key={g.date}>
              <div className="day-head">
                <span>{dayLabel(g.date)}</span>
                <span>
                  {g.expense > 0 ? `支出 ${formatCents(g.expense)}` : ''}
                  {g.expense > 0 && g.income > 0 ? ' · ' : ''}
                  {g.income > 0 ? `收入 ${formatCents(g.income)}` : ''}
                </span>
              </div>
              <div className="tx-list">
                {g.items.map((tx) => {
                  const cat = categoryOf(tx.categoryId);
                  const sign = tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '';
                  return (
                    <div
                      key={tx.id}
                      className="tx-row"
                      onClick={() => navigate(`/edit/${tx.id}`)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="tx-icon" style={cat ? { background: `${cat.color}22` } : undefined}>
                        {tx.type === 'transfer' ? '🔁' : cat?.icon ?? '🏷️'}
                      </div>
                      <div className="tx-body">
                        <div className="tx-title">
                          {tx.type === 'transfer'
                            ? `${accountName(tx.accountId)} → ${accountName(tx.toAccountId)}`
                            : cat?.name ?? '未分类'}
                        </div>
                        <div className="tx-meta">
                          {accountName(tx.accountId)}
                          {tx.note ? ` · ${tx.note}` : ''}
                        </div>
                      </div>
                      <div className={`tx-amount ${tx.type}`}>
                        {sign}
                        {formatCents(tx.amount)}
                      </div>
                      <ChevronRight size={15} color="var(--text-faint)" />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function CategoryMini({ month }: { month: string }) {
  const { categories, transactions } = useLedger();
  const rows = useMemo(() => {
    const map = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type !== 'expense' || monthKeyOf(tx.date) !== month || !tx.categoryId) continue;
      map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amount);
    }
    const all = [...map.entries()]
      .map(([id, amount]) => ({ cat: categories.find((c) => c.id === id), amount }))
      .filter((r) => r.cat)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);
    const total = all.reduce((s, r) => s + r.amount, 0);
    return { all, total };
  }, [categories, transactions, month]);

  if (rows.all.length === 0) {
    return (
      <div className="card empty" style={{ padding: '24px 16px' }}>
        本月还没有支出
      </div>
    );
  }

  return (
    <section className="card">
      {rows.all.map((r) => (
        <div className="bar-row" key={r.cat!.id}>
          <div className="bar-label">
            {r.cat!.icon} {r.cat!.name}
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.max(2, (r.amount / rows.total) * 100)}%`, background: r.cat!.color }}
            />
          </div>
          <div className="bar-value">{formatCents(r.amount)}</div>
          <div className="bar-pct">{((r.amount / rows.total) * 100).toFixed(0)}%</div>
        </div>
      ))}
    </section>
  );
}
