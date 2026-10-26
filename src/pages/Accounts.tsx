import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { deleteAccount, saveAccount } from '../db/repository';
import { accountBalance, formatCents, newId, parseAmountToCents, type Account, type AccountKind } from '../domain/model';

const KINDS: Array<[AccountKind, string, string]> = [
  ['cash', '现金', '💵'],
  ['wallet', '电子钱包', '📱'],
  ['bank', '银行卡', '🏦'],
  ['credit', '信用卡', '💳'],
  ['investment', '投资', '📈'],
];

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
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('cash');
  const [balanceText, setBalanceText] = useState('');
  const [includeInTotal, setIncludeInTotal] = useState(true);

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
    if (!name.trim()) return toast('请填写账户名称');
    const cents = parseAmountToCents(balanceText || '0');
    if (cents === null) return toast('初始余额格式不正确');
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
    toast(editing ? '已保存' : '账户已添加');
  }

  async function toggleArchive(a: Account) {
    await saveAccount({ ...a, archived: !a.archived });
    toast(a.archived ? '已恢复' : '已归档（余额不计入总资产，但历史账目保留）');
  }

  async function remove(a: Account) {
    if (!window.confirm(`删除账户「${a.name}」？只有没有账目的账户才能删除。`)) return;
    try {
      await deleteAccount(a.id);
      toast('已删除');
    } catch (e) {
      toast(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">账户</h1>
          <div className="page-sub">合计 {formatCents(total)}</div>
        </div>
        <button className="btn primary" onClick={openNew}>
          <Plus size={15} />
          添加
        </button>
      </div>

      <section className="card" style={{ padding: '4px 14px' }}>
        {rows.length === 0 ? (
          <div className="empty">还没有账户</div>
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
                  {account.archived ? <span className="muted"> · 已归档</span> : null}
                </div>
                <div className="tx-meta">
                  {KINDS.find((k) => k[0] === account.kind)?.[1]}
                  {account.includeInTotal ? '' : ' · 不计入总资产'}
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
        账户余额 = 初始余额 + 收入 − 支出 ± 转账。点账户可修改初始余额。
      </div>

      {open ? (
        <div className="sheet-mask" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>{editing ? '编辑账户' : '添加账户'}</h3>
            <div className="field">
              <label>名称</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="比如 招商银行" maxLength={20} />
            </div>
            <div className="field">
              <label>类型</label>
              <select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                {KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>初始余额</label>
              <input
                inputMode="decimal"
                value={balanceText}
                onChange={(e) => setBalanceText(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="field">
              <label>总资产</label>
              <select value={includeInTotal ? '1' : '0'} onChange={(e) => setIncludeInTotal(e.target.value === '1')}>
                <option value="1">计入总资产</option>
                <option value="0">不计入（比如临时账户）</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <button className="btn grow" onClick={() => setOpen(false)}>
                取消
              </button>
              <button className="btn primary grow" onClick={save}>
                保存
              </button>
            </div>
            {editing ? (
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn grow" onClick={() => toggleArchive(editing)}>
                  {editing.archived ? '恢复账户' : '归档账户'}
                </button>
                <button className="btn danger grow" onClick={() => remove(editing)}>
                  删除
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
