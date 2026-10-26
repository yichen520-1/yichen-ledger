import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useToast } from '../components/Toast';
import { createTransaction, deleteTransaction, updateTransaction } from '../db/repository';
import { formatCents, parseAmountToCents, toDateKey, type TxType } from '../domain/model';

// 4 列键盘：最后一列的「完成」跨两行，正好填满 4×4 的格子
const KEYS = ['1', '2', '3', '⌫', '4', '5', '6', '清空', '7', '8', '9', 'OK', '00', '0', '.'];

export default function Add() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { accounts, categories, transactions, loading } = useLedger();

  const editing = id ? transactions.find((t) => t.id === id) : undefined;

  const [type, setType] = useState<TxType>(editing?.type ?? 'expense');
  const [amountText, setAmountText] = useState(editing ? (editing.amount / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [accountId, setAccountId] = useState(editing?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.toAccountId ?? null);
  const [date, setDate] = useState(editing?.date ?? toDateKey(new Date()));
  const [note, setNote] = useState(editing?.note ?? '');
  const [tagsText, setTagsText] = useState(editing?.tags.join(' ') ?? '');
  const [busy, setBusy] = useState(false);
  // 编辑模式下，进页面时账目可能还在从 IndexedDB 读；读到之前不能算初始化完成
  const [formSeeded, setFormSeeded] = useState(false);

  const liveAccounts = useMemo(() => accounts.filter((a) => !a.archived), [accounts]);

  // 数据到齐后回填表单（直接打开 /edit/xxx 或刷新页面时，首帧 editing 是 undefined）
  useEffect(() => {
    if (formSeeded) return;
    if (id && loading) return; // 还在读，等等
    if (id && !editing) {
      // 读完了却找不到这条记录，说明已被删除
      setFormSeeded(true);
      return;
    }
    if (editing) {
      setType(editing.type);
      setAmountText((editing.amount / 100).toFixed(2));
      setCategoryId(editing.categoryId);
      setAccountId(editing.accountId);
      setToAccountId(editing.toAccountId);
      setDate(editing.date);
      setNote(editing.note);
      setTagsText(editing.tags.join(' '));
    }
    setFormSeeded(true);
  }, [id, loading, editing, formSeeded]);

  useEffect(() => {
    if (!accountId && liveAccounts.length > 0) setAccountId(liveAccounts[0].id);
  }, [accountId, liveAccounts]);

  const visibleCategories = useMemo(
    () => categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense')),
    [categories, type],
  );

  useEffect(() => {
    if (type !== 'transfer' && !visibleCategories.some((c) => c.id === categoryId)) {
      setCategoryId(null);
    }
  }, [type, visibleCategories, categoryId]);

  const cents = parseAmountToCents(amountText) ?? 0;
  const canSubmit = cents > 0 && !!accountId && (type === 'transfer' ? !!toAccountId && toAccountId !== accountId : !!categoryId);
  // 带着 id 进来但数据读完仍找不到 -> 这条记录已经被删掉了
  const missing = !!id && !loading && !editing;

  function press(key: string) {
    if (key === 'OK') return;
    if (key === '清空') return setAmountText('');
    if (key === '⌫') return setAmountText((s) => s.slice(0, -1));
    if (key === '.') {
      return setAmountText((s) => (s.includes('.') ? s : s === '' ? '0.' : `${s}.`));
    }
    setAmountText((s) => {
      const next = s + key;
      // 最多两位小数
      const dot = next.indexOf('.');
      if (dot >= 0 && next.length - dot > 3) return s;
      if (next.length > 10) return s;
      return next.replace(/^0(?=\d)/, '');
    });
  }

  async function submit() {
    if (!canSubmit || busy || missing) return;
    setBusy(true);
    try {
      const draft = {
        type,
        amountText,
        categoryId,
        accountId,
        toAccountId,
        date,
        note,
        tagsText,
      };
      if (editing) {
        await updateTransaction(editing.id, draft);
        toast('已保存修改');
      } else {
        await createTransaction(draft);
        toast(`已记一笔 ${formatCents(cents)}`);
      }
      navigate('/');
    } catch (e) {
      toast(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!window.confirm('确定删除这条记录吗？')) return;
    await deleteTransaction(editing.id);
    toast('已删除');
    navigate('/');
  }

  return (
    <div className="add-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">{missing ? '记录不存在' : editing ? '修改记录' : '记一笔'}</h1>
          <div className="page-sub">
            {missing ? '这条记录可能已经被删除了' : date === toDateKey(new Date()) ? '今天' : date}
          </div>
        </div>
        {editing ? (
          <button className="btn danger" onClick={remove}>
            <Trash2 size={15} />
            删除
          </button>
        ) : null}
      </div>

      {missing ? (
        <div className="card empty">
          <span className="emoji">🔍</span>
          找不到这条记录
          <button className="btn" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
            回到总览
          </button>
        </div>
      ) : !formSeeded ? (
        <div className="empty">正在读取…</div>
      ) : (
      <div className="add-layout">
        <div>
          <div className="segmented">
            {(
              [
                ['expense', '支出'],
                ['income', '收入'],
                ['transfer', '转账'],
              ] as Array<[TxType, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                data-type={value}
                className={type === value ? 'on' : ''}
                onClick={() => setType(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={`amount-display${amountText === '' ? ' placeholder' : ''}`}>
            {amountText === '' ? '0.00' : amountText}
            <span className="suffix">元</span>
          </div>

          {type === 'transfer' ? (
            <>
              <div className="field">
                <label>转出</label>
                <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {liveAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>转入</label>
                <select value={toAccountId ?? ''} onChange={(e) => setToAccountId(e.target.value || null)}>
                  <option value="">请选择</option>
                  {liveAccounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </div>
            </>
          ) : (
            <div className="cat-grid">
              {visibleCategories.map((c) => (
                <button
                  key={c.id}
                  className={`cat-chip${categoryId === c.id ? ' on' : ''}`}
                  onClick={() => setCategoryId(c.id)}
                >
                  <span className="ico">{c.icon}</span>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {type !== 'transfer' ? (
            <div className="field">
              <label>账户</label>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {liveAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="field">
            <label>日期</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label>备注</label>
            <input
              value={note}
              placeholder="可选，比如「和同事吃午饭」"
              maxLength={80}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <div className="field">
            <label>标签</label>
            <input
              value={tagsText}
              placeholder="空格或逗号分隔"
              maxLength={80}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="keypad">
            {KEYS.map((k) =>
              k === 'OK' ? (
                <button key={k} className="key-ok" disabled={!canSubmit || busy} onClick={submit}>
                  {editing ? '保存' : '完成'}
                </button>
              ) : (
                <button key={k} className={/[+.⌫]/.test(k) || k === '清空' ? 'key-fn' : ''} onClick={() => press(k)}>
                  {k}
                </button>
              ),
            )}
          </div>
          <div className="muted" style={{ marginTop: 10, textAlign: 'center' }}>
            金额以「分」为单位存储，不会有小数误差
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
