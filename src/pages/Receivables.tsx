import { useMemo, useState } from 'react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { useErrorText, useI18n } from '../i18n';
import { Sheet } from '../components/Sheet';
import { formatCents, toDateKey } from '../domain/model';
import { openReceivables, receivableTotal } from '../domain/receivable';
import { settleReceivable, unsettleReceivable } from '../db/repository';

/**
 * 待收的钱
 * ------------------------------------------------------------------
 * 为什么单独一页而不是塞进账户页：
 *   账户页回答「我有多少钱」，这一页回答「还有多少钱没回来」。
 *   两件事的紧急程度不一样 —— 前者是静态的余额，后者是会忘掉的钱。
 *
 * 为什么标记收回时不改原来那笔支出：
 *   改金额会让账目时间线上凭空少一笔，而且分类统计里会出现负数，
 *   导出 CSV 到 Excel 里别人也看不懂「负数支出」是什么意思。
 *   生成一笔收入才是它本来的性质。
 */

export default function Receivables() {
  const { transactions, accountName, categoryOf } = useLedger();
  const { t } = useI18n();
  const toast = useToast();
  const errorText = useErrorText();

  const today = toDateKey(new Date());
  const open = useMemo(() => openReceivables(transactions, today), [transactions, today]);
  const total = useMemo(() => receivableTotal(transactions), [transactions]);

  const [target, setTarget] = useState<{ id: string; amount: number; note: string } | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const openSheet = (txId: string, amount: number, txNote: string) => {
    setTarget({ id: txId, amount, note: txNote });
    setDate(today);
    setNote('');
  };

  const submit = async () => {
    if (!target) return;
    const original = transactions.find((tx) => tx.id === target.id);
    if (!original) return;
    setBusy(true);
    try {
      await settleReceivable(original, date, note.trim() || t('receivable.settleNotePlaceholder'));
      toast(t('receivable.settled'));
      setTarget(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async (txId: string) => {
    const original = transactions.find((tx) => tx.id === txId);
    if (!original) return;
    if (!window.confirm(t('receivable.unsettleConfirm'))) return;
    try {
      await unsettleReceivable(original);
      toast(t('receivable.unsettled'));
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('receivable.listTitle')}</h1>
          <div className="page-sub">
            {t('receivable.listSub', { count: String(open.length), total: formatCents(total) })}
          </div>
        </div>
      </div>

      {total > 0 ? (
        <div className="rc-summary">
          <span className="k">{t('receivable.total')}</span>
          <span className="v mono">{formatCents(total)}</span>
        </div>
      ) : null}

      <section className="card">
        {open.length === 0 ? (
          <div className="empty">
            <p className="muted">{t('receivable.empty')}</p>
            <p className="muted" style={{ fontSize: 'calc(11.5px * var(--font-scale, 1))' }}>
              {t('receivable.emptyHint')}
            </p>
          </div>
        ) : (
          open.map(({ tx, ageDays }) => {
            const cat = categoryOf(tx.categoryId);
            return (
              <div className="rc-row" key={tx.id}>
                <div className="rc-body">
                  <div className="rc-title">
                    {cat?.icon ?? '🧾'} {tx.note || cat?.name || t('common.uncategorized')}
                  </div>
                  <div className="rc-meta">
                    {tx.date} · {accountName(tx.accountId)} ·{' '}
                    {ageDays === 0 ? t('receivable.ageToday') : t('receivable.ageDays', { days: String(ageDays) })}
                  </div>
                </div>
                <div className="rc-amount mono">{formatCents(tx.amount)}</div>
                <button className="mini-btn primary" onClick={() => openSheet(tx.id, tx.amount, tx.note)}>
                  {t('receivable.settle')}
                </button>
              </div>
            );
          })
        )}
      </section>

      {/* 已收回的放在下面，折叠起来 —— 它们是历史，不是待办 */}
      {(() => {
        const settled = transactions.filter((tx) => tx.receivable && tx.settledBy);
        if (settled.length === 0) return null;
        return (
          <>
            <div className="section-title">{t('receivable.settledBadge')}</div>
            <section className="card">
              {settled.slice(0, 30).map((tx) => {
                const cat = categoryOf(tx.categoryId);
                return (
                  <div className="rc-row" key={tx.id}>
                    <div className="rc-body">
                      <div className="rc-title">
                        {cat?.icon ?? '🧾'} {tx.note || cat?.name || t('common.uncategorized')}
                        <span className="badge-settled">{t('receivable.settledBadge')}</span>
                      </div>
                      <div className="rc-meta">
                        {tx.date} · {accountName(tx.accountId)}
                      </div>
                    </div>
                    <div className="rc-amount mono" style={{ color: 'var(--green)' }}>
                      {formatCents(tx.amount)}
                    </div>
                    <button className="mini-btn" onClick={() => undo(tx.id)}>
                      {t('receivable.unsettle')}
                    </button>
                  </div>
                );
              })}
            </section>
          </>
        );
      })()}

      <Sheet open={!!target} onClose={() => setTarget(null)} title={t('receivable.settleTitle')}>
        <div className="field">
          <label>{t('receivable.settleDate')}</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>{t('receivable.settleNote')}</label>
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('receivable.settleNotePlaceholder')}
          />
        </div>
        <div className="sheet-actions">
          <button className="btn grow" onClick={() => setTarget(null)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary grow" onClick={submit} disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
