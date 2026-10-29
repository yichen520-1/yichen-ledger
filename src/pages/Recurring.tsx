import { useMemo, useState } from 'react';
import { Plus, Pause, Play, Trash2 } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText } from '../i18n';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { deleteRule, saveRule, setRuleArchived, type RuleDraft } from '../db/repository';
import {
  fixedTotals,
  monthlyEquivalent,
  newRule,
  nextDueDate,
  ruleDatesBetween,
  type BillFreq,
  type RecurringRule,
} from '../domain/recurring';
import { formatCents, toDateKey, type TxType } from '../domain/model';

/**
 * 周期账单
 * ------------------------------------------------------------------
 * 房租、话费、会员订阅这类每月固定支出，在这里配一次，之后到日子在总览
 * 顶部冒出「待确认」，点一下才入账（见 src/domain/recurring.ts 顶部的说明）。
 *
 * 这一页只管「规则本身」：新建、改、暂停、删。
 * 「待确认」的处理在总览页，因为那是每天打开 App 第一眼看到的地方。
 */

const FREQS: BillFreq[] = ['daily', 'weekly', 'monthly', 'yearly'];

const WEEKDAYS: Array<[number, string]> = [
  [1, '一'],
  [2, '二'],
  [3, '三'],
  [4, '四'],
  [5, '五'],
  [6, '六'],
  [0, '日'],
];

export default function Recurring() {
  const { rules, categories, accounts, accountName, categoryOf } = useLedger();
  const { t, lang } = useI18n();
  const toast = useToast();
  const errorText = useErrorText();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRule | null>(null);

  // 表单
  const [title, setTitle] = useState('');
  const [type, setType] = useState<Exclude<TxType, 'transfer'>>('expense');
  const [amountText, setAmountText] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [freq, setFreq] = useState<BillFreq>('monthly');
  const [intervalText, setIntervalText] = useState('1');
  const [startDate, setStartDate] = useState(toDateKey(new Date()));
  const [endDate, setEndDate] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState(new Date().getDate());
  const [weekday, setWeekday] = useState(new Date().getDay());
  const [monthOfYear, setMonthOfYear] = useState(new Date().getMonth() + 1);
  const [note, setNote] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [busy, setBusy] = useState(false);

  const today = toDateKey(new Date());
  const totals = useMemo(() => fixedTotals(rules), [rules]);

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  );

  const rows = useMemo(
    () =>
      rules.map((rule) => ({
        rule,
        next: nextDueDate(rule, today),
        monthly: monthlyEquivalent(rule),
        // 接下来三次：给详情用
        upcoming: rule.archived ? [] : ruleDatesBetween(rule, today, addDays(today, 200)).slice(0, 3),
      })),
    [rules, today],
  );

  function resetForm() {
    const base = newRule();
    setTitle('');
    setType('expense');
    setAmountText('');
    setCategoryId(null);
    setAccountId(accounts[0]?.id ?? '');
    setFreq('monthly');
    setIntervalText('1');
    setStartDate(base.startDate);
    setEndDate('');
    setDayOfMonth(base.dayOfMonth ?? new Date().getDate());
    setWeekday(base.weekday ?? new Date().getDay());
    setMonthOfYear(base.monthOfYear ?? new Date().getMonth() + 1);
    setNote('');
    setTagsText('');
  }

  function openNew() {
    setEditing(null);
    resetForm();
    setOpen(true);
  }

  function openEdit(rule: RecurringRule) {
    setEditing(rule);
    setTitle(rule.title);
    setType(rule.type);
    setAmountText((rule.amount / 100).toFixed(2));
    setCategoryId(rule.categoryId);
    setAccountId(rule.accountId);
    setFreq(rule.freq);
    setIntervalText(String(rule.interval));
    setStartDate(rule.startDate);
    setEndDate(rule.endDate ?? '');
    setDayOfMonth(rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10)));
    setWeekday(rule.weekday ?? new Date(`${rule.startDate}T00:00:00`).getDay());
    setMonthOfYear(rule.monthOfYear ?? Number(rule.startDate.slice(5, 7)));
    setNote(rule.note);
    setTagsText(rule.tags.join(' '));
    setOpen(true);
  }

  async function save() {
    if (busy) return;
    const draft: RuleDraft = {
      title,
      type,
      amountText,
      categoryId,
      accountId,
      freq,
      intervalText,
      startDate,
      endDate: endDate || null,
      dayOfMonth: freq === 'monthly' || freq === 'yearly' ? dayOfMonth : null,
      weekday: freq === 'weekly' ? weekday : null,
      monthOfYear: freq === 'yearly' ? monthOfYear : null,
      note,
      tagsText,
    };
    setBusy(true);
    try {
      await saveRule(draft, editing?.id);
      setOpen(false);
      toast(t('recurring.created'));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function togglePause(rule: RecurringRule) {
    await setRuleArchived(rule.id, !rule.archived);
    toast(rule.archived ? t('recurring.resume') : t('recurring.pause'));
  }

  async function remove(rule: RecurringRule) {
    if (!window.confirm(t('recurring.confirmDelete'))) return;
    await deleteRule(rule.id);
    setOpen(false);
    toast(t('common.delete'));
  }

  /** 「每 2 个月」这种说法的单位 */
  function unitOf(f: BillFreq): string {
    if (f === 'daily') return t('recurring.unitDay');
    if (f === 'weekly') return t('recurring.unitWeek');
    if (f === 'monthly') return t('recurring.unitMonth');
    return t('recurring.unitYear');
  }

  function freqLabel(f: BillFreq): string {
    if (f === 'daily') return t('recurring.freqDaily');
    if (f === 'weekly') return t('recurring.freqWeekly');
    if (f === 'monthly') return t('recurring.freqMonthly');
    return t('recurring.freqYearly');
  }

  /** 一条规则的重复节奏说成短句：「每月 15 日」「每 2 周 周一」 */
  function shapeText(rule: RecurringRule): string {
    const n = Math.max(1, rule.interval || 1);
    const unit = unitOf(rule.freq);
    const every = n === 1 ? freqLabel(rule.freq) : t('recurring.intervalUnit', { n: String(n), unit });
    if (rule.freq === 'monthly') return `${every} ${rule.dayOfMonth ?? '—'}`;
    if (rule.freq === 'yearly') return `${every} ${rule.monthOfYear ?? '—'}/${rule.dayOfMonth ?? '—'}`;
    if (rule.freq === 'weekly') {
      const wd = WEEKDAYS.find(([v]) => v === (rule.weekday ?? 0))?.[1] ?? '—';
      return `${every} ${lang === 'zh' || lang === 'ja' ? '周' : 'W'}${wd}`;
    }
    return every;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('recurring.title')}</h1>
          <div className="page-sub">{t('recurring.sub')}</div>
        </div>
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} />
          {t('recurring.add')}
        </button>
      </div>

      {rules.length > 0 ? (
        <div className="fixed-totals" style={{ marginBottom: 14 }}>
          <div>
            <div className="k">{t('recurring.fixedExpense')}</div>
            <div className="v" style={{ color: 'var(--red)' }}>
              {formatCents(totals.expense)}
            </div>
          </div>
          <div>
            <div className="k">{t('recurring.fixedIncome')}</div>
            <div className="v" style={{ color: 'var(--green)' }}>
              {formatCents(totals.income)}
            </div>
          </div>
        </div>
      ) : null}

      <section className="card" style={{ padding: '4px 14px' }}>
        {rows.length === 0 ? (
          <div className="empty">
            <div>{t('recurring.empty')}</div>
            <div className="set-hint" style={{ marginTop: 8 }}>
              {t('recurring.emptyHint')}
            </div>
          </div>
        ) : (
          rows.map(({ rule, next }) => {
            const cat = categoryOf(rule.categoryId);
            return (
              <div
                key={rule.id}
                className={`bill-row${rule.archived ? ' paused' : ''}`}
                onClick={() => openEdit(rule)}
              >
                <div className="bill-icon">{cat?.icon ?? (rule.type === 'income' ? '💰' : '🧾')}</div>
                <div className="bill-body">
                  <div className="bill-title">
                    {rule.title}
                    {rule.archived ? <span className="muted"> · {t('recurring.paused')}</span> : null}
                  </div>
                  <div className="bill-meta">
                    {shapeText(rule)} · {next ? t('recurring.nextDue', { date: next }) : t('recurring.nextDueNone')}
                  </div>
                </div>
                <div className="bill-amount" style={{ color: rule.type === 'income' ? 'var(--green)' : 'var(--text)' }}>
                  {rule.amount > 0 ? formatCents(rule.amount) : t('recurring.amountUnset')}
                </div>
              </div>
            );
          })
        )}
      </section>

      {rules.length > 0 ? (
        <div className="muted" style={{ marginTop: 14, paddingLeft: 4 }}>
          {t('recurring.fixedHint')}
        </div>
      ) : null}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('recurring.edit') : t('recurring.add')}
      >
        <div className="field">
          <label>{t('recurring.name')}</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('recurring.namePlaceholder')}
            maxLength={30}
          />
        </div>

        <div className="field">
          <label>{t('recurring.amount')}</label>
          <input
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="field">
          <label>{t('recurring.freq')}</label>
          <div className="segmented">
            {FREQS.map((f) => (
              <button key={f} className={freq === f ? 'on' : ''} onClick={() => setFreq(f)}>
                {freqLabel(f)}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>{t('recurring.interval')}</label>
          <div className="filter-inputs">
            <input
              inputMode="numeric"
              value={intervalText}
              onChange={(e) => setIntervalText(e.target.value.replace(/[^\d]/g, ''))}
              style={{ maxWidth: 90 }}
            />
            <span className="muted">
              {t('recurring.intervalUnit', { n: intervalText || '1', unit: unitOf(freq) })}
            </span>
          </div>
        </div>

        {freq === 'monthly' || freq === 'yearly' ? (
          <div className="field">
            <label>{t('recurring.dayOfMonth')}</label>
            <input
              inputMode="numeric"
              value={String(dayOfMonth)}
              onChange={(e) => setDayOfMonth(Math.max(1, Math.min(31, Number(e.target.value.replace(/[^\d]/g, '')) || 1)))}
              style={{ maxWidth: 90 }}
            />
          </div>
        ) : null}

        {freq === 'weekly' ? (
          <div className="field">
            <label>{t('recurring.weekday')}</label>
            <div className="freq-row">
              {WEEKDAYS.map(([value, label]) => (
                <button
                  key={value}
                  className={`filter-toggle${weekday === value ? ' on' : ''}`}
                  onClick={() => setWeekday(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {freq === 'yearly' ? (
          <div className="field">
            <label>{t('recurring.monthOfYear')}</label>
            <input
              inputMode="numeric"
              value={String(monthOfYear)}
              onChange={(e) => setMonthOfYear(Math.max(1, Math.min(12, Number(e.target.value.replace(/[^\d]/g, '')) || 1)))}
              style={{ maxWidth: 90 }}
            />
          </div>
        ) : null}

        <div className="field">
          <label>{t('recurring.startDate')}</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>

        <div className="field">
          <label>{t('recurring.endDate')}</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <div className="set-hint">{t('recurring.endDateHint')}</div>
        </div>

        <div className="field">
          <label>{t('search.category')}</label>
          <select value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
            <option value="">{t('common.pick')}</option>
            {visibleCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{t('add.account')}</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts
              .filter((a) => !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </div>

        <div className="field">
          <label>{t('add.note')}</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} />
        </div>

        <div className="field">
          <label>{t('add.tags')}</label>
          <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} maxLength={80} />
        </div>

        {editing ? (
          <div className="set-hint" style={{ marginTop: 6 }}>
            {t('recurring.history', { n: String(editing.confirmedDates.length) })} ·{' '}
            {accountName(editing.accountId)}
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn grow" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary grow" onClick={save} disabled={busy}>
            {t('common.save')}
          </button>
        </div>

        {editing ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn grow" onClick={() => togglePause(editing)}>
              {editing.archived ? <Play size={15} /> : <Pause size={15} />}
              {editing.archived ? t('recurring.resume') : t('recurring.pause')}
            </button>
            <button className="btn danger grow" onClick={() => remove(editing)}>
              <Trash2 size={15} />
              {t('common.delete')}
            </button>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}

/** 往后推 n 天（本地日期），只在页面里用来算「接下来三次」 */
function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}
