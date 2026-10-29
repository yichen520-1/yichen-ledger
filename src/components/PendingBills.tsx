import { useState } from 'react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText } from '../i18n';
import { useToast } from '../components/Toast';
import { confirmBill, skipBill } from '../db/repository';
import { formatCents } from '../domain/model';
import type { PendingBill } from '../domain/recurring';

/**
 * 总览顶部的「待确认账单」
 * ------------------------------------------------------------------
 * 周期账单到日子了不会自己入账（理由见 src/domain/recurring.ts），
 * 而是先在这里冒出来，等用户点「记账」或「这次不用」。
 *
 * 为什么一次最多画 4 条：
 *   待确认里可能有十几条（比如第一次用、或者两个月没开 App），
 *   全铺出来会把总览整个顶下去。前 4 条足够说明问题，
 *   剩下的用「还有 N 笔」指到周期账单页去处理。
 */
export function PendingBills() {
  const { pending, categoryOf } = useLedger();
  const { t } = useI18n();
  const toast = useToast();
  const errorText = useErrorText();
  const [busy, setBusy] = useState<string | null>(null);

  if (pending.length === 0) return null;

  const shown = pending.slice(0, 4);
  const rest = pending.length - shown.length;

  async function confirm(bill: PendingBill) {
    if (busy) return;
    setBusy(bill.key);
    try {
      await confirmBill(bill);
      toast(t('recurring.confirmed', { amount: formatCents(bill.rule.amount) }));
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function skip(bill: PendingBill) {
    if (busy) return;
    setBusy(bill.key);
    try {
      await skipBill(bill);
      toast(t('recurring.skipped'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pending-card">
      <div className="pending-head">
        <span className="t">{t('recurring.pendingTitle')}</span>
        <span className="s">{t('recurring.pendingSub')}</span>
      </div>
      {shown.map((bill) => {
        const cat = categoryOf(bill.rule.categoryId);
        const overdue =
          bill.overdueDays === 0
            ? t('recurring.pendingToday')
            : t('recurring.pendingOverdue', { n: String(bill.overdueDays) });
        return (
          <div className="pending-item" key={bill.key}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>{cat?.icon ?? '🧾'}</span>
            <div className="body">
              <div className="name">{bill.rule.title}</div>
              <div className="meta">
                {bill.date} · {overdue}
              </div>
            </div>
            <div className="amt">
              {bill.rule.amount > 0 ? formatCents(bill.rule.amount) : t('recurring.amountUnset')}
            </div>
            <div className="pending-actions">
              <button className="mini-btn primary" disabled={busy === bill.key} onClick={() => confirm(bill)}>
                {t('recurring.confirm')}
              </button>
              <button className="mini-btn" disabled={busy === bill.key} onClick={() => skip(bill)}>
                {t('recurring.skip')}
              </button>
            </div>
          </div>
        );
      })}
      {rest > 0 ? (
        <div className="meta" style={{ marginTop: 8, fontSize: 11.5 }}>
          {t('recurring.pendingMore', { n: String(rest) })}
        </div>
      ) : null}
    </section>
  );
}
