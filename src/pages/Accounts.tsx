import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText } from '../i18n';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/Sheet';
import { deleteAccount, saveAccount } from '../db/repository';
import { accountBalance, formatCents, newId, parseAmountToCents, type Account, type AccountKind } from '../domain/model';

const ICON: Record<AccountKind, string> = {
  cash: '💵',
  wallet: '📱',
  bank: '🏦',
  credit: '💳',
  investment: '📈',
};

export default function Accounts() {
  const { accounts, transactions } = useLedger();
  const toast = useToast();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('cash');
  const [balanceText, setBalanceText] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);

  // 类型选项的形状保持不变（[kind, 标签, emoji]），只有标签走词条：
  // 放在组件里才能跟着当前语言重算，emoji 与逻辑都不受影响。
  const KINDS: Array<[AccountKind, string, string]> = [
    ['cash', t('accounts.kinds.cash'), '💵'],
    ['wallet', t('accounts.kinds.wallet'), '📱'],
    ['bank', t('accounts.kinds.bank'), '🏦'],
    ['credit', t('accounts.kinds.credit'), '💳'],
    ['investment', t('accounts.kinds.investment'), '📈'],
  ];

  const rows = useMemo(
    () =>
      accounts
        .slice()
        .sort((a, b) => a.sort - b.sort)
        .map((a) => ({ account: a, balance: accountBalance(a, transactions) })),
    [accounts, transactions],
  );

  const total = rows.filter((r) => r.account.includeInTotal && !r.account.archived).reduce((s, r) => s + r.balance, 0);

  function openNew() {
    setEditing(null);
    setName('');
    setKind('cash');
    setBalanceText('');
    setIncludeInTotal(true);
    setOpen(true);
  }

  function openEdit(a: Account) {
    setEditing(a);
    setName(a.name);
    setKind(a.kind);
    setBalanceText((a.initialBalance / 100).toFixed(2));
    setIncludeInTotal(a.includeInTotal);
    setOpen(true);
  }

  async function save() {
    if (!name.trim()) return toast(t('accounts.nameRequired'));
    const cents = parseAmountToCents(balanceText || '0');
    if (cents === null) return toast(t('accounts.balanceInvalid'));
    const account: Account = {
      id: editing?.id ?? newId('acc-'),
      name: name.trim(),
      kind,
      initialBalance: cents,
      currency: 'CNY',
      includeInTotal,
      archived: editing?.archived ?? false,
      sort: editing?.sort ?? accounts.length,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
    };
    await saveAccount(account);
    setOpen(false);
    toast(editing ? t('add.saved') : t('accounts.added'));
  }

  async function toggleArchive(a: Account) {
    await saveAccount({ ...a, archived: !a.archived });
    toast(a.archived ? t('accounts.unarchivedToast') : t('accounts.archivedToast'));
  }

  async function remove(a: Account) {
    if (!window.confirm(t('accounts.confirmDelete', { name: a.name }))) return;
    try {
      await deleteAccount(a.id);
      toast(t('common.delete'));
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('accounts.title')}</h1>
          <div className="page-sub">{t('accounts.sub', { total: formatCents(total) })}</div>
        </div>
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} />
          {t('accounts.add')}
        </button>
      </div>

      <section className="card" style={{ padding: '4px 14px' }}>
        {rows.length === 0 ? (
          <div className="empty">{t('accounts.empty')}</div>
        ) : (
          rows.map(({ account, balance }) => (
            <div
              key={account.id}
              className="tx-row"
              style={{ cursor: 'pointer', opacity: account.archived ? 0.55 : 1 }}
              onClick={() => openEdit(account)}
            >
              <div className="tx-icon">{ICON[account.kind]}</div>
              <div className="tx-body">
                <div className="tx-title">
                  {account.name}
                  {account.archived ? <span className="muted"> · {t('accounts.archived')}</span> : null}
                </div>
                <div className="tx-meta">
                  {KINDS.find((k) => k[0] === account.kind)?.[1]}
                  {account.includeInTotal ? '' : ` · ${t('accounts.excluded')}`}
                </div>
              </div>
              <div className="tx-amount" style={{ color: balance < 0 ? 'var(--red)' : 'var(--text)' }}>
                {formatCents(balance)}
              </div>
            </div>
          ))
        )}
      </section>

      <div className="muted" style={{ marginTop: 14, paddingLeft: 4 }}>
        {t('accounts.hint')}
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('accounts.sheetEdit') : t('accounts.sheetNew')}
      >
        <div className="field">
          <label>{t('accounts.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('accounts.namePlaceholder')}
            maxLength={20}
          />
        </div>
        <div className="field">
          <label>{t('accounts.kind')}</label>
          <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>{t('accounts.initialBalance')}</label>
          <input
            inputMode="decimal"
            value={balanceText}
            onChange={(e) => setBalanceText(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="field">
          <label>{t('accounts.inTotal')}</label>
          <select value={includeInTotal ? '1' : '0'} onChange={(e) => setIncludeInTotal(e.target.value === '1')}>
            <option value="1">{t('accounts.yesTotal')}</option>
            <option value="0">{t('accounts.noTotal')}</option>
          </select>
        </div>
        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn grow" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary grow" onClick={save}>
            {t('common.save')}
          </button>
        </div>
        {editing ? (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn grow" onClick={() => toggleArchive(editing)}>
              {editing.archived ? t('accounts.unarchive') : t('accounts.archive')}
            </button>
            <button className="btn danger grow" onClick={() => remove(editing)}>
              {t('common.delete')}
            </button>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
