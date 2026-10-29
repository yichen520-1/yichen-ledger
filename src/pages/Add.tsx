import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n, useErrorText } from '../i18n';
import { useToast } from '../components/Toast';
import { createTransaction, deleteTransaction, updateTransaction } from '../db/repository';
import { formatCents, parseAmountToCents, toDateKey, type TxType } from '../domain/model';
import { recentShapes } from '../domain/quick';
import { createRuleFromTransaction, saveQuickTemplate, shouldOfferRecurring } from '../db/repository';

/**
 * 键盘的四个功能键用固定的 ASCII 标记，显示时才翻译：
 * 这样 press() 里的判断与界面语言无关，切语言不会打乱逻辑。
 */
const KEYS = ['1', '2', '3', 'BACK', '4', '5', '6', 'CLEAR', '7', '8', '9', 'OK', '00', '0', '.'];

export default function Add() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useI18n();
  const errorText = useErrorText();
  const { accounts, categories, transactions, quickTemplates, categoryOf, loading } = useLedger();

  const editing = id ? transactions.find((tx) => tx.id === id) : undefined;

  const [type, setType] = useState<TxType>(editing?.type ?? 'expense');
  const [amountText, setAmountText] = useState(editing ? (editing.amount / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState<string | null>(editing?.categoryId ?? null);
  const [accountId, setAccountId] = useState(editing?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState<string | null>(editing?.toAccountId ?? null);
  const [date, setDate] = useState(editing?.date ?? toDateKey(new Date()));
  const [note, setNote] = useState(editing?.note ?? '');
  const [tagsText, setTagsText] = useState(editing?.tags.join(' ') ?? '');
  const [busy, setBusy] = useState(false);
  // 记完之后那条「要不要每月提醒」的提示：存下刚记的那笔，由用户点「好」或「不用」
  const [offerRule, setOfferRule] = useState<{ id: string; note: string; amount: number } | null>(null);
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
  const canSubmit =
    cents > 0 &&
    !!accountId &&
    (type === 'transfer' ? !!toAccountId && toAccountId !== accountId : !!categoryId);
  // 带着 id 进来但数据读完仍找不到 -> 这条记录已经被删掉了
  const missing = !!id && !loading && !editing;

  function press(key: string) {
    if (key === 'OK') return;
    if (key === 'CLEAR') return setAmountText('');
    if (key === 'BACK') return setAmountText((s) => s.slice(0, -1));
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
        toast(t('add.saved'));
        navigate('/');
      } else {
        const created = await createTransaction(draft);
        toast(t('add.created', { amount: formatCents(cents) }));
        /*
         * 记完不立刻跳走：如果这笔长得像固定支出（支出 + 有备注 + 金额不小），
         * 就在原地问一句「要不要每月提醒」。用户点「不用」再走 ——
         * 因为一旦跳走，这条提示就没有地方出现了。
         */
        if (shouldOfferRecurring(created)) {
          setOfferRule({ id: created.id, note: created.note, amount: created.amount });
        } else {
          navigate('/');
        }
      }
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** 把刚记的那笔设成每月提醒 */
  async function acceptRule() {
    if (!offerRule) return;
    const tx = transactions.find((x) => x.id === offerRule.id);
    if (tx) {
      await createRuleFromTransaction(tx);
      toast(t('recurring.fromTxDone', { date: String(Number(tx.date.slice(8, 10))) }));
    }
    setOfferRule(null);
    navigate('/');
  }

  function declineRule() {
    setOfferRule(null);
    navigate('/');
  }

  /** 把当前表单存成模板（只用已经填好的东西，不写库里的账目） */
  async function saveTemplate() {
    const name = window.prompt(t('quick.templateName'), note || '');
    if (!name || !name.trim()) return;
    const centsNow = parseAmountToCents(amountText) ?? 0;
    if (centsNow <= 0) return toast(t('errors.amountInvalid'));
    try {
      await saveQuickTemplate(
        {
          id: 'tmp',
          type,
          amount: centsNow,
          categoryId,
          accountId,
          toAccountId,
          date,
          note,
          tags: tagsText.split(/[\s,，]+/).filter(Boolean),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        name,
      );
      toast(t('quick.templateSaved'));
    } catch (e) {
      toast(errorText(e));
    }
  }

  /** 点一下模板：把类型、金额、分类、账户、备注、标签全填好 */
  function applyTemplate(tpl: {
    type: TxType;
    amount: number;
    categoryId: string | null;
    accountId: string;
    toAccountId: string | null;
    note: string;
    tags: string[];
  }) {
    setType(tpl.type);
    setAmountText((tpl.amount / 100).toFixed(2));
    setCategoryId(tpl.categoryId);
    setAccountId(tpl.accountId);
    setToAccountId(tpl.toAccountId);
    setNote(tpl.note);
    setTagsText(tpl.tags.join(' '));
  }

  async function remove() {
    if (!editing) return;
    if (!window.confirm(t('add.confirmDelete'))) return;
    await deleteTransaction(editing.id);
    toast(t('common.delete'));
    navigate('/');
  }

  /** 功能键显示文字；数字键原样显示 */
  function keyLabel(k: string): string {
    if (k === 'BACK') return '⌫';
    if (k === 'CLEAR') return t('common.clear');
    if (k === 'OK') return editing ? t('common.save') : t('add.finish');
    return k;
  }

  const segmentLabels: Array<[TxType, string]> = [
    ['expense', t('common.expense')],
    ['income', t('common.income')],
    ['transfer', t('common.transfer')],
  ];

  return (
    <div className="add-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {missing ? t('add.notFound') : editing ? t('add.titleEdit') : t('add.title')}
          </h1>
          <div className="page-sub">
            {missing
              ? t('add.notFoundSub')
              : date === toDateKey(new Date())
                ? t('common.today')
                : date}
          </div>
        </div>
        {editing ? (
          <button className="btn danger" onClick={remove}>
            <Trash2 size={15} />
            {t('common.delete')}
          </button>
        ) : null}
      </div>

      {missing ? (
        <div className="card empty">
          <span className="emoji">🔍</span>
          {t('add.notFoundBody')}
          <button className="btn" style={{ marginTop: 14 }} onClick={() => navigate('/')}>
            {t('common.backToDashboard')}
          </button>
        </div>
      ) : !formSeeded ? (
        <div className="empty">{t('common.loading')}</div>
      ) : (
        <div className="add-layout">
          <div>
            <div className="segmented">
              {segmentLabels.map(([value, label]) => (
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
              <span className="suffix">{t('common.currency')}</span>
            </div>

            {/* 快捷记账：上次金额 + 最近记过的 + 自己存的模板。
                只在新建时出现；改一笔旧账时这里没有意义。
                高度固定成一行（见 .quick-band），因为它一长就会把数字键盘
                最后一行顶出屏幕 —— 手机上滚不到就点不着「确定」。 */}
            {!editing && (quickTemplates.length > 0 || recentShapes(transactions).length > 0) ? (
              <div className="quick-band">
                <div className="quick-head">
                  <span className="k">{t('quick.title')}</span>
                  {canSubmit ? (
                    <button className="mini-btn" onClick={saveTemplate}>
                      {t('quick.templateSave')}
                    </button>
                  ) : null}
                </div>
                <div className="quick-strip">
                  {quickTemplates.map((tpl) => (
                    <button
                      key={tpl.id}
                      className="quick-chip"
                      onClick={() => applyTemplate(tpl)}
                      title={t('quick.templateUse')}
                    >
                      <span className="n">
                        <span className="ico">{categoryOf(tpl.categoryId)?.icon ?? '⭐'}</span> {tpl.name}
                      </span>
                      <span className="m">{formatCents(tpl.amount)}</span>
                    </button>
                  ))}
                  {recentShapes(transactions).map((tx) => {
                    const cat = categoryOf(tx.categoryId);
                    return (
                      <button
                        key={tx.id}
                        className="quick-chip"
                        onClick={() => applyTemplate(tx)}
                        title={t('quick.lastSame')}
                      >
                        <span className="n">
                          <span className="ico">{cat?.icon ?? '🧾'}</span> {cat?.name ?? (tx.note || '—')}
                        </span>
                        <span className="m">{formatCents(tx.amount)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {type === 'transfer' ? (
              <>
                <div className="field">
                  <label>{t('add.from')}</label>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                    {liveAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>{t('add.to')}</label>
                  <select
                    value={toAccountId ?? ''}
                    onChange={(e) => setToAccountId(e.target.value || null)}
                  >
                    <option value="">{t('common.pick')}</option>
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
                <label>{t('add.account')}</label>
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
              <label>{t('add.date')}</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('add.note')}</label>
              <input
                value={note}
                placeholder={t('add.notePlaceholder')}
                maxLength={80}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="field">
              <label>{t('add.tags')}</label>
              <input
                value={tagsText}
                placeholder={t('add.tagsPlaceholder')}
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
                    {keyLabel(k)}
                  </button>
                ) : (
                  <button
                    key={k}
                    className={/[+.⌫]/.test(k) || k === 'CLEAR' ? 'key-fn' : ''}
                    onClick={() => press(k)}
                  >
                    {keyLabel(k)}
                  </button>
                ),
              )}
            </div>
            <div className="muted" style={{ marginTop: 10, textAlign: 'center' }}>
              {t('add.centsHint')}
            </div>
          </div>
        </div>
      )}

      {/* 记完一笔后问「要不要每月提醒」。放在 add-page 底部而不是弹层，
          因为弹层会挡住数字键盘；这条只是加一句话，用户答完就走。 */}
      {offerRule ? (
        <div className="remind-strip">
          <span className="grow">
            {t('recurring.fromTxAsk')}（{formatCents(offerRule.amount)}）
          </span>
          <button className="mini-btn primary" onClick={acceptRule}>
            {t('recurring.fromTxYes')}
          </button>
          <button className="mini-btn" onClick={declineRule}>
            {t('recurring.fromTxNo')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
