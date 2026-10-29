/**
 * 账目搜索与筛选（纯领域层）
 * ------------------------------------------------------------------
 * 这里只做「给一堆账目和一组条件，返回筛出来的那些」，
 * 不碰 React、不碰 Dexie，方便在 Node 里直接测（见 tests/search.test.ts）。
 *
 * 为什么把条件收成一个 TxFilter 对象而不是一串可选参数：
 *   界面上有 7 种条件（关键词、类型、分类、账户、日期、金额区间、标签），
 *   而且它们要能「叠加」、要能「一键清空」、要能算出「现在生效了几条」。
 *   收成一个对象之后，这三个动作都只是对同一个东西做操作，
 *   不用在页面里维护七个 useState 的联动。
 */

import type { Account, Category, Transaction, TxType } from './model';

/** 一次筛选的全部条件。空数组 / null 都表示「这一项不限制」。 */
export interface TxFilter {
  /** 关键词：备注、标签、分类名、账户名、金额数字都算 */
  text: string;
  /** 记录方向；空数组 = 支出收入转账都要 */
  types: TxType[];
  categoryIds: string[];
  accountIds: string[];
  /** 起止日期，含端点，'YYYY-MM-DD'；null = 不限 */
  from: string | null;
  to: string | null;
  /** 金额区间，单位：分；null = 不限 */
  minAmount: number | null;
  maxAmount: number | null;
  /** 标签，命中任意一个即可 */
  tags: string[];
}

/** 「未分类」在筛选条件里的占位 id。真实分类 id 都是 cat- 开头，不会撞。 */
export const NO_CATEGORY_ID = '__none__';

export const EMPTY_FILTER: TxFilter = {
  text: '',
  types: [],
  categoryIds: [],
  accountIds: [],
  from: null,
  to: null,
  minAmount: null,
  maxAmount: null,
  tags: [],
};

/** 把名字查出来要用到的两张表 */
export interface FilterContext {
  categories: Category[];
  accounts: Account[];
}

/** 当前有几项条件在生效（界面上显示「筛选 · 3」那种角标用） */
export function activeFilterCount(f: TxFilter): number {
  let n = 0;
  if (f.text.trim()) n++;
  if (f.types.length) n++;
  if (f.categoryIds.length) n++;
  if (f.accountIds.length) n++;
  if (f.from || f.to) n++;
  if (f.minAmount !== null || f.maxAmount !== null) n++;
  if (f.tags.length) n++;
  return n;
}

/** 一条条件都没设时，列表应该显示「全部」而不是「空」 */
export function isFilterEmpty(f: TxFilter): boolean {
  return activeFilterCount(f) === 0;
}

/**
 * 关键词匹配。
 *
 * 匹配范围刻意放宽到「分类名 / 账户名 / 金额」：
 * 用户搜「餐饮」时想的是「餐饮这一类」，搜「支付宝」时想的是「用支付宝付的」，
 * 搜「3500」时想的是「那笔 3500 的账」。这些都不是备注里的字，
 * 但都符合「我搜这个词，希望看到它」的直觉。
 */
function matchesText(tx: Transaction, raw: string, ctx: FilterContext): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;

  const cat = tx.categoryId ? ctx.categories.find((c) => c.id === tx.categoryId) : undefined;
  const acc = ctx.accounts.find((a) => a.id === tx.accountId);
  const to = tx.toAccountId ? ctx.accounts.find((a) => a.id === tx.toAccountId) : undefined;

  // 金额两种写法都试：「35」「35.00」都能搜到 3500 分
  const yuan = (tx.amount / 100).toFixed(2);
  const yuanShort = yuan.replace(/\.00$/, '');

  const haystack = [
    tx.note,
    tx.tags.join(' '),
    cat?.name ?? '',
    acc?.name ?? '',
    to?.name ?? '',
    yuan,
    yuanShort,
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}

/**
 * 按条件筛账目。
 * 多个条件之间是「并且」；同一个条件内部的多个值是「或者」
 * （选了餐饮和交通，就是这两类都要）。
 */
export function filterTransactions(
  txs: Transaction[],
  filter: TxFilter,
  ctx: FilterContext,
): Transaction[] {
  const tagSet = filter.tags.map((t) => t.toLowerCase());
  // 界面上「未分类」那一格传的是 __none__，不是一个真实的分类 id。
  // 不单独处理的话，勾了它永远筛不出东西 —— 因为没有任何账目的 categoryId 叫 __none__。
  const wantNone = filter.categoryIds.includes(NO_CATEGORY_ID);
  const realCats = filter.categoryIds.filter((id) => id !== NO_CATEGORY_ID);
  return txs.filter((tx) => {
    if (filter.types.length && !filter.types.includes(tx.type)) return false;
    if (filter.categoryIds.length) {
      const hit = realCats.includes(tx.categoryId ?? '');
      const isNone = !tx.categoryId;
      if (!hit && !(wantNone && isNone)) return false;
    }
    if (filter.accountIds.length) {
      const inFrom = filter.accountIds.includes(tx.accountId);
      const inTo = tx.toAccountId ? filter.accountIds.includes(tx.toAccountId) : false;
      if (!inFrom && !inTo) return false;
    }
    if (filter.from && tx.date < filter.from) return false;
    if (filter.to && tx.date > filter.to) return false;
    if (filter.minAmount !== null && tx.amount < filter.minAmount) return false;
    if (filter.maxAmount !== null && tx.amount > filter.maxAmount) return false;
    if (tagSet.length) {
      const own = tx.tags.map((t) => t.toLowerCase());
      if (!own.some((t) => tagSet.includes(t))) return false;
    }
    return matchesText(tx, filter.text, ctx);
  });
}

/** 日期倒序、同一天按创建时间倒序 —— 和总览「最近记录」的排法保持一致 */
export function sortTransactions(txs: Transaction[]): Transaction[] {
  return txs
    .slice()
    .sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

/** 筛完之后的合计。转账不计入收支，但要单独给一个数字（它动了账户余额）。 */
export interface FilterSummary {
  count: number;
  income: number;
  expense: number;
  transfer: number;
  /** 收入 - 支出，转账不算 */
  net: number;
}

export function summarize(txs: Transaction[]): FilterSummary {
  let income = 0;
  let expense = 0;
  let transfer = 0;
  for (const tx of txs) {
    if (tx.type === 'income') income += tx.amount;
    else if (tx.type === 'expense') expense += tx.amount;
    else transfer += tx.amount;
  }
  return { count: txs.length, income, expense, transfer, net: income - expense };
}

/** 从已选的账目里收集出出现过的标签，做成可点的筛选块 */
export function collectTags(txs: Transaction[], limit = 24): Array<{ tag: string; count: number }> {
  const map = new Map<string, number>();
  for (const tx of txs) {
    for (const tag of tx.tags) {
      const key = tag.trim();
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/**
 * 把筛选条件压成一句人话的参数（界面自己拼句子，这里只给数字和名字）。
 * 返回 null 表示没有任何条件 —— 界面就不显示这一行。
 */
export function describeFilter(
  f: TxFilter,
  ctx: FilterContext,
): { parts: Array<{ kind: 'text' | 'type' | 'category' | 'account' | 'date' | 'amount' | 'tag'; value: string }> } | null {
  if (isFilterEmpty(f)) return null;
  const parts: Array<{ kind: 'text' | 'type' | 'category' | 'account' | 'date' | 'amount' | 'tag'; value: string }> = [];
  if (f.text.trim()) parts.push({ kind: 'text', value: f.text.trim() });
  for (const type of f.types) parts.push({ kind: 'type', value: type });
  for (const id of f.categoryIds) {
    parts.push({ kind: 'category', value: ctx.categories.find((c) => c.id === id)?.name ?? '—' });
  }
  for (const id of f.accountIds) {
    parts.push({ kind: 'account', value: ctx.accounts.find((a) => a.id === id)?.name ?? '—' });
  }
  if (f.from || f.to) parts.push({ kind: 'date', value: `${f.from ?? '…'} ~ ${f.to ?? '…'}` });
  if (f.minAmount !== null || f.maxAmount !== null) {
    parts.push({ kind: 'amount', value: `${f.minAmount ?? 0} ~ ${f.maxAmount ?? '…'}` });
  }
  for (const tag of f.tags) parts.push({ kind: 'tag', value: tag });
  return { parts };
}

/** 切换数组里的某个值（筛选块点一下选上、再点一下取消） */
export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}
