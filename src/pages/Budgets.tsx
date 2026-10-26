import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { deleteBudget, saveBudget } from '../db/repository';
import {
  budgetStatus,
  currentMonthKey,
  formatCents,
  newId,
  parseAmountToCents,
  shiftMonth,
  type Budget,
} from '../domain/model';

export default function Budgets() {
  const { budgets, categories, transactions } = useLedger();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonthKey());
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState<string>('');
  const [amountText, setAmountText] = useState('');
  const [scope, setScope] = useState<'month' | 'always'>('always');

  const statuses = useMemo(() => budgetStatus(budgets, transactions, month), [budgets, transactions, month]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const expenseCats = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories]);

  const monthStatuses = statuses.filter((s) => s.budget.month === month || s.budget.month === null);
  const totalBudget = monthStatuses
    .filter((s) => s.budget.categoryId === null)
    .reduce((sum, s) => sum + s.budget.amount, 0);
  const totalSpent = monthStatuses.filter((s) => s.budget.categoryId === null).reduce((sum, s) => sum + s.spent, 0);

  async function add() {
    const amount = parseAmountToCents(amountText);
    if (amount === null || amount <= 0) return toast('请输入预算金额');
    const budget: Budget = {
      id: newId('bg-'),
      categoryId: categoryId || null,
      amount,
      month: scope === 'month' ? month : null,
      createdAt: new Date().toISOString(),
    };
    await saveBudget(budget);
    setOpen(false);
    setAmountText('');
    setCategoryId('');
    toast('预算已设置');
  }

  async function remove(id: string) {
    if (!window.confirm('删除这个预算？')) return;
    await deleteBudget(id);
    toast('已删除');
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">预算</h1>
          <div className="page-sub">
            {month.replace('-', '/')} · {monthStatuses.length} 个预算
          </div>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          新建
        </button>
      </div>

      <div className="month-nav" style={{ marginBottom: 14 }}>
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="上个月">
          ‹
        </button>
        <div className="label">{month.replace('-', '/')}</div>
        <button onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="下个月">
          ›
        </button>
      </div>

      {totalBudget > 0 ? (
        <section className="card">
          <div className="row">
            <div className="grow">
              <div className="muted">总预算</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 700 }}>
                {formatCents(totalSpent)} <span className="muted">/ {formatCents(totalBudget)}</span>
              </div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: totalSpent > totalBudget ? 'var(--red)' : 'var(--accent)' }}>
              {((totalSpent / totalBudget) * 100).toFixed(0)}%
            </div>
          </div>
          <div className={`progress-line${totalSpent > totalBudget ? ' over' : ''}`}>
            <i style={{ width: `${Math.min(100, (totalSpent / totalBudget) * 100)}%` }} />
          </div>
          <div className="muted">
            {totalSpent > totalBudget
              ? `已超支 ${formatCents(totalSpent - totalBudget)}`
              : `还剩 ${formatCents(totalBudget - totalSpent)} 可用`}
          </div>
        </section>
      ) : null}

      {monthStatuses.length === 0 ? (
        <div className="card empty">
          <span className="emoji">🎯</span>
          还没有设置预算。设一个每月上限，超支时会提醒你。
        </div>
      ) : (
        <section className="card" style={{ marginTop: 12 }}>
          {monthStatuses.map((s) => {
            const cat = s.budget.categoryId ? catMap.get(s.budget.categoryId) : null;
            const color = s.over ? 'var(--red)' : s.ratio > 0.8 ? 'var(--accent)' : 'var(--green)';
            return (
              <div key={s.budget.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-soft)' }}>
                <div className="row">
                  <div className="grow">
                    <div style={{ fontWeight: 500 }}>
                      {cat ? `${cat.icon} ${cat.name}` : '🌈 总预算'}
                      {s.budget.month ? <span className="muted"> · 仅本月</span> : null}
                    </div>
                    <div className="muted">
                      已用 {formatCents(s.spent)} / {formatCents(s.budget.amount)}
                    </div>
                  </div>
                  <div className="mono" style={{ color, fontWeight: 700 }}>
                    {(s.ratio * 100).toFixed(0)}%
                  </div>
                  <button onClick={() => remove(s.budget.id)} aria-label="删除预算" style={{ color: 'var(--text-faint)' }}>
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className={`progress-line${s.over ? ' over' : ''}`}>
                  <i style={{ width: `${Math.min(100, s.ratio * 100)}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </section>
      )}

      <div className="muted" style={{ marginTop: 14, paddingLeft: 4 }}>
        提示：预算只管「支出」，转账和收入不计入。
      </div>

      {open ? (
        <div className="sheet-mask" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>新建预算</h3>
            <div className="field">
              <label>分类</label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">全部分类（总预算）</option>
                {expenseCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>金额</label>
              <input
                inputMode="decimal"
                value={amountText}
                placeholder="0.00"
                onChange={(e) => setAmountText(e.target.value)}
                autoFocus
              />
            </div>
            <div className="field">
              <label>周期</label>
              <select value={scope} onChange={(e) => setScope(e.target.value as 'month' | 'always')}>
                <option value="always">每月重复</option>
                <option value="month">仅 {month}</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn grow" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="btn primary grow" onClick={add}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
