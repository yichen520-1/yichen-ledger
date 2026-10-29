import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search as SearchIcon, SlidersHorizontal, X } from 'lucide-react';
import { useLedger } from '../state/LedgerContext';
import { useI18n } from '../i18n';
import {
  activeFilterCount,
  collectTags,
  EMPTY_FILTER,
  filterTransactions,
  sortTransactions,
  summarize,
  toggleIn,
  type TxFilter,
} from '../domain/search';
import { formatCents, shiftMonth, currentMonthKey, toDateKey, type TxType } from '../domain/model';

/**
 * 搜索与筛选
 * ------------------------------------------------------------------
 * 一个页面同时承担两件事：上面是搜索框，下面是可以随手点的筛选条件。
 *
 * 为什么不做「搜索页 + 筛选弹层」两个入口：
 *   记账 App 里搜一笔账，绝大多数时候是「我记得大概」而不是「我有精确条件」。
 *   分两个入口会让用户在「我到底该用哪个」上停一下。合成一页之后，
 *   打几个字就开始出结果，想收窄再往下点条件，路径是一条直的。
 *
 * 为什么条件不存进 URL：
 *   HashRouter 下 URL 里再塞七八个参数会很难看，而且用户离开再回来
 *   多半也不想要上次那套条件。这里只在页面内存着，刷新就清空。
 */

const TYPES: TxType[] = ['expense', 'income', 'transfer'];

/** 界面上把「分」写成「元」的输入框里读回来 */
function centsOf(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export default function SearchPage() {
  const { transactions, categories, accounts, accountName, categoryOf } = useLedger();
  const { t } = useI18n();

  const [filter, setFilter] = useState<TxFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);

  const ctx = useMemo(() => ({ categories, accounts }), [categories, accounts]);

  const results = useMemo(
    () => sortTransactions(filterTransactions(transactions, filter, ctx)),
    [transactions, filter, ctx],
  );
  const summary = useMemo(() => summarize(results), [results]);
  const activeCount = activeFilterCount(filter);
  const tags = useMemo(() => collectTags(transactions), [transactions]);

  // 结果太多时先只画前 200 条：账本上万条时，一次渲染完会卡住主线程
  const visible = results.slice(0, 200);

  function patch(next: Partial<TxFilter>) {
    setFilter((old) => ({ ...old, ...next }));
  }

  /** 快捷条件：点一下就把日期区间设好，这是最常用的四个 */
  function quickRange(kind: 'thisMonth' | 'lastMonth' | 'last7' | 'last30') {
    const today = toDateKey(new Date());
    const thisMonth = currentMonthKey();
    if (kind === 'thisMonth') {
      patch({ from: `${thisMonth}-01`, to: today });
    } else if (kind === 'lastMonth') {
      const last = shiftMonth(thisMonth, -1);
      patch({ from: `${last}-01`, to: `${last}-31` });
    } else if (kind === 'last7') {
      const d = new Date();
      d.setDate(d.getDate() - 6);
      patch({ from: toDateKey(d), to: today });
    } else {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      patch({ from: toDateKey(d), to: today });
    }
  }

  const noCategoryId = '__none__';

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('search.title')}</h1>
          <div className="page-sub">{t('search.sub')}</div>
        </div>
        <div className="page-actions">
          <button className={`btn${activeCount ? ' primary' : ''}`} onClick={() => setShowFilters((v) => !v)}>
            <SlidersHorizontal size={15} />
            {t('search.filter')}
            {activeCount ? <span className="filter-badge">{activeCount}</span> : null}
          </button>
        </div>
      </div>

      <div className="search-bar" style={{ marginBottom: 12 }}>
        <span className="ico">
          <SearchIcon size={16} />
        </span>
        <input
          value={filter.text}
          onChange={(e) => patch({ text: e.target.value })}
          placeholder={t('search.placeholder')}
          autoComplete="off"
        />
        {filter.text ? (
          <button className="search-clear" onClick={() => patch({ text: '' })} aria-label={t('search.reset')}>
            <X size={15} />
          </button>
        ) : null}
      </div>

      {showFilters ? (
        <section className="card" style={{ marginBottom: 12 }}>
          <div className="filter-group">
            <div className="k">{t('search.type')}</div>
            <div className="chip-wrap">
              {TYPES.map((type) => (
                <button
                  key={type}
                  className={`filter-toggle${filter.types.includes(type) ? ' on' : ''}`}
                  onClick={() => patch({ types: toggleIn(filter.types, type) })}
                >
                  {t(`common.${type}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.quick')}</div>
            <div className="chip-wrap">
              <button className="filter-toggle" onClick={() => quickRange('thisMonth')}>
                {t('search.quickThisMonth')}
              </button>
              <button className="filter-toggle" onClick={() => quickRange('lastMonth')}>
                {t('search.quickLastMonth')}
              </button>
              <button className="filter-toggle" onClick={() => quickRange('last7')}>
                {t('search.quickLast7')}
              </button>
              <button className="filter-toggle" onClick={() => quickRange('last30')}>
                {t('search.quickLast30')}
              </button>
              <button
                className={`filter-toggle${filter.minAmount === 50000 ? ' on' : ''}`}
                onClick={() => patch({ minAmount: filter.minAmount === 50000 ? null : 50000 })}
              >
                {t('search.quickLarge')}
              </button>
              <button
                className={`filter-toggle${filter.categoryIds.includes(noCategoryId) ? ' on' : ''}`}
                onClick={() => patch({ categoryIds: toggleIn(filter.categoryIds, noCategoryId) })}
              >
                {t('search.quickNoCategory')}
              </button>
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.category')}</div>
            <div className="chip-wrap">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className={`filter-toggle${filter.categoryIds.includes(cat.id) ? ' on' : ''}`}
                  onClick={() => patch({ categoryIds: toggleIn(filter.categoryIds, cat.id) })}
                >
                  {cat.icon} {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.account')}</div>
            <div className="chip-wrap">
              {accounts
                .filter((a) => !a.archived)
                .map((acc) => (
                  <button
                    key={acc.id}
                    className={`filter-toggle${filter.accountIds.includes(acc.id) ? ' on' : ''}`}
                    onClick={() => patch({ accountIds: toggleIn(filter.accountIds, acc.id) })}
                  >
                    {acc.name}
                  </button>
                ))}
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.dateRange')}</div>
            <div className="filter-inputs">
              <input
                type="date"
                value={filter.from ?? ''}
                onChange={(e) => patch({ from: e.target.value || null })}
                aria-label={t('search.dateFrom')}
              />
              <span className="muted">~</span>
              <input
                type="date"
                value={filter.to ?? ''}
                onChange={(e) => patch({ to: e.target.value || null })}
                aria-label={t('search.dateTo')}
              />
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.amountRange')}</div>
            <div className="filter-inputs">
              <input
                inputMode="decimal"
                value={filter.minAmount === null ? '' : String(filter.minAmount / 100)}
                onChange={(e) => patch({ minAmount: centsOf(e.target.value) })}
                placeholder={t('search.amountMin')}
                aria-label={t('search.amountMin')}
              />
              <span className="muted">~</span>
              <input
                inputMode="decimal"
                value={filter.maxAmount === null ? '' : String(filter.maxAmount / 100)}
                onChange={(e) => patch({ maxAmount: centsOf(e.target.value) })}
                placeholder={t('search.amountMax')}
                aria-label={t('search.amountMax')}
              />
            </div>
          </div>

          <div className="filter-group">
            <div className="k">{t('search.tags')}</div>
            {tags.length === 0 ? (
              <div className="set-hint">{t('search.tagEmpty')}</div>
            ) : (
              <div className="chip-wrap">
                {tags.map(({ tag, count }) => (
                  <button
                    key={tag}
                    className={`filter-toggle${filter.tags.includes(tag) ? ' on' : ''}`}
                    onClick={() => patch({ tags: toggleIn(filter.tags, tag) })}
                  >
                    #{tag} · {count}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeCount ? (
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn grow" onClick={() => setFilter(EMPTY_FILTER)}>
                {t('search.reset')}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="filter-summary" style={{ marginBottom: 12 }}>
        <span>
          {t('search.result', { n: String(summary.count) })}
        </span>
        {summary.income > 0 ? (
          <span className="pos">{t('search.summaryIncome', { amount: formatCents(summary.income) })}</span>
        ) : null}
        {summary.expense > 0 ? (
          <span className="neg">{t('search.summaryExpense', { amount: formatCents(summary.expense) })}</span>
        ) : null}
        {summary.transfer > 0 ? (
          <span>{t('search.summaryTransfer', { amount: formatCents(summary.transfer) })}</span>
        ) : null}
        <span>
          {t('search.summaryNet', { amount: formatCents(summary.net) })}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="empty">
          <div>{t('search.resultEmpty')}</div>
          <div className="set-hint" style={{ marginTop: 6 }}>
            {t('search.resultEmptyHint')}
          </div>
        </div>
      ) : (
        <section className="card stagger" style={{ padding: '4px 14px' }}>
          <div className="tx-list">
            {visible.map((tx) => {
              const cat = categoryOf(tx.categoryId);
              const sign = tx.type === 'expense' ? '-' : tx.type === 'income' ? '+' : '';
              return (
                <Link key={tx.id} to={`/edit/${tx.id}`} className="tx-row" style={{ textDecoration: 'none' }}>
                  <div className="tx-icon">{cat?.icon ?? (tx.type === 'transfer' ? '⇄' : '·')}</div>
                  <div className="tx-body">
                    <div className="tx-title">
                      {tx.note || cat?.name || accountName(tx.accountId)}
                      {tx.tags.length ? <span className="muted"> #{tx.tags.join(' #')}</span> : null}
                    </div>
                    <div className="tx-meta">
                      {tx.date} · {cat?.name ?? accountName(tx.accountId)}
                      {tx.type === 'transfer' ? ` → ${accountName(tx.toAccountId ?? '')}` : ''}
                    </div>
                  </div>
                  <div
                    className="tx-amount"
                    style={{
                      color:
                        tx.type === 'expense' ? 'var(--red)' : tx.type === 'income' ? 'var(--green)' : 'var(--text)',
                    }}
                  >
                    {sign}
                    {formatCents(tx.amount)}
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
