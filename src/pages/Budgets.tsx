import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { useI18n } from '../i18n';
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
  const { t } = useI18n();
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
    if (amount === null || amount <= 0) return toast(t('budgets.amountRequired'));
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
    toast(t('budgets.added'));
  }

  async function remove(id: string) {
    if (!window.confirm(t('budgets.confirmDelete'))) return;
    await deleteBudget(id);
    toast(t('common.delete'));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('budgets.title')}</h1>
          <div className="page-sub">
            {t('budgets.sub', { month: month.replace('-', '/'), count: monthStatuses.length })}
          </div>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          {t('budgets.new')}
        </button>
      </div>

      <div className="month-nav" style={{ marginBottom: 14 }}>
        <button onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label={t('stats.prevMonth')}>
          ‹
        </button>
        <div className="label">{t('stats.monthLabel', { m: Number(month.slice(5)) })}</div>
        <button onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label={t('stats.nextMonth')}>
          ›
        </button>
      </div>

      {totalBudget > 0 ? (
        <section className="card">
          <div className="row">
            <div className="grow">
              <div className="muted">{t('budgets.total')}</div>
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
              ? t('budgets.over', { amount: formatCents(totalSpent - totalBudget) })
              : t('budgets.remain', { amount: formatCents(totalBudget - totalSpent) })}
          </div>
        </section>
      ) : null}

      {monthStatuses.length === 0 ? (
        <div className="card empty">
          <span className="emoji">🎯</span>
          {t('budgets.empty')}
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
                      {cat ? `${cat.icon} ${cat.name}` : `🌈 ${t('budgets.allBudget')}`}
                      {s.budget.month ? <span className="muted"> · {t('common.monthOnly')}</span> : null}
                    </div>
                    <div className="muted">
                      {t('budgets.used', {
                        spent: formatCents(s.spent),
                        total: formatCents(s.budget.amount),
                      })}
                    </div>
                  </div>
                  <div className="mono" style={{ color, fontWeight: 700 }}>
                    {(s.ratio * 100).toFixed(0)}%
                  </div>
                  <button onClick={() => remove(s.budget.id)} aria-label={t('common.delete')} style={{ color: 'var(--text-faint)' }}>
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
        {t('budgets.tip')}
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('budgets.sheetTitle')}>
        <div className="field">
          <label>{t('budgets.category')}</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">{t('budgets.allCategories')}</option>
            {expenseCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t('budgets.amount')}</label>
          <input
            inputMode="decimal"
            value={amountText}
            placeholder="0.00"
            onChange={(e) => setAmountText(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <label>{t('budgets.period')}</label>
          <select value={scope} onChange={(e) => setScope(e.target.value as 'month' | 'always')}>
            <option value="always">{t('budgets.monthly')}</option>
            <option value="month">{t('budgets.onlyMonth', { month })}</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn grow" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary grow" onClick={add}>
            {t('common.save')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
