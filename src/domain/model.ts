/**
 * 领域模型（Domain model）
 * ------------------------------------------------------------------
 * 这里只放「纯数据 + 纯函数」，不依赖 React / Dexie / 任何运行时，
 * 方便在 Node 里跑单元测试（见 tests/domain.test.ts）。
 */

/** 记录方向：支出 / 收入 / 转账 */
export type TxType = 'expense' | 'income' | 'transfer';

/** 账户类型 */
export type AccountKind = 'cash' | 'bank' | 'credit' | 'wallet' | 'investment';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** 初始余额，单位：分 */
  initialBalance: number;
  /** 币种代码，默认 CNY */
  currency: string;
  /** 是否计入总资产（信用卡一般也算，只是余额可为负） */
  includeInTotal: boolean;
  archived: boolean;
  sort: number;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  type: Exclude<TxType, 'transfer'>;
  /** emoji 图标 */
  icon: string;
  /** 主题色 */
  color: string;
  /** 内置分类不可删除 */
  builtin: boolean;
  sort: number;
}

/** 一条账目记录 */
export interface Transaction {
  id: string;
  type: TxType;
  /** 金额，单位：分，恒为正数，方向由 type 决定 */
  amount: number;
  categoryId: string | null;
  accountId: string;
  /** 仅转账使用：转入账户 */
  toAccountId: string | null;
  /** 记账日期，YYYY-MM-DD（本地日历日，不含时区） */
  date: string;
  note: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** 预算：对某个支出分类（或全部分类，categoryId=null）设月度上限 */
export interface Budget {
  id: string;
  categoryId: string | null;
  /** 每月上限，单位：分 */
  amount: number;
  /** 生效月份，YYYY-MM；为空表示长期有效 */
  month: string | null;
  createdAt: string;
}

/** 应用级设置 */
export interface Settings {
  key: string;
  value: unknown;
}

/** 金额显示用的货币格式 */
export interface MoneyFormat {
  symbol: string;
  locale: string;
}

export const CNY: MoneyFormat = { symbol: '¥', locale: 'zh-CN' };

/**
 * 分 -> 显示字符串。
 * 所有金额在内存和数据库里都用「分」的整数，避免浮点误差。
 */
export function formatCents(cents: number, fmt: MoneyFormat = CNY): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  const body = `${yuan.toLocaleString(fmt.locale)}.${fen.toString().padStart(2, '0')}`;
  return `${negative ? '-' : ''}${fmt.symbol}${body}`;
}

/** 紧凑显示（图表轴用）：1234567 分 -> 1.23万 */
export function formatCentsCompact(cents: number): string {
  const yuan = cents / 100;
  const abs = Math.abs(yuan);
  const sign = yuan < 0 ? '-' : '';
  if (abs >= 100000000) return `${sign}${(abs / 100000000).toFixed(2)}亿`;
  if (abs >= 10000) return `${sign}${(abs / 10000).toFixed(2)}万`;
  return `${sign}${abs.toFixed(0)}`;
}

/**
 * 把用户输入的金额字符串解析成分。
 * 支持「12」「12.3」「12.34」「1,234.56」「¥ 12.30」，拒绝非法输入。
 * 返回 null 表示非法。
 */
export function parseAmountToCents(input: string): number | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[,\s¥￥$]/g, '').trim();
  if (cleaned === '') return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  if (cleaned === '.' || cleaned === '-' || cleaned === '-.') return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  // 四舍五入到分，规避 0.1*100 = 10.000000000000002 这类浮点误差
  return Math.round(value * 100);
}

/** 本地日历日的 YYYY-MM-DD */
export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD -> YYYY-MM */
export function monthKeyOf(dateKey: string): string {
  return dateKey.slice(0, 7);
}

/** 当前本地月份的 YYYY-MM */
export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
}

/** 在 YYYY-MM 上做月份加减 */
export function shiftMonth(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  const base = new Date(y, m - 1 + delta, 1);
  return `${base.getFullYear()}-${(base.getMonth() + 1).toString().padStart(2, '0')}`;
}

/** 某个月有多少天 */
export function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** 起止日期（含）之间的所有 YYYY-MM-DD */
export function dateRange(startKey: string, endKey: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  for (let d = start; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(toDateKey(d));
  }
  return out;
}

/** 账户当前余额（分）= 初始余额 + 收入 - 支出 + 转入 - 转出 */
export function accountBalance(account: Account, txs: Transaction[]): number {
  let balance = account.initialBalance;
  for (const tx of txs) {
    if (tx.type === 'income' && tx.accountId === account.id) balance += tx.amount;
    else if (tx.type === 'expense' && tx.accountId === account.id) balance -= tx.amount;
    else if (tx.type === 'transfer') {
      if (tx.accountId === account.id) balance -= tx.amount;
      if (tx.toAccountId === account.id) balance += tx.amount;
    }
  }
  return balance;
}

/** 净资产 = 所有计入总资产的账户余额之和 */
export function netWorth(accounts: Account[], txs: Transaction[]): number {
  return accounts
    .filter((a) => a.includeInTotal && !a.archived)
    .reduce((sum, a) => sum + accountBalance(a, txs), 0);
}

/** 某月收入 / 支出合计（转账不计入收支） */
export function monthTotals(txs: Transaction[], monthKey: string): { income: number; expense: number } {
  let income = 0;
  let expense = 0;
  for (const tx of txs) {
    if (monthKeyOf(tx.date) !== monthKey) continue;
    if (tx.type === 'income') income += tx.amount;
    else if (tx.type === 'expense') expense += tx.amount;
  }
  return { income, expense };
}

/** 按分类汇总支出，降序 */
export function expenseByCategory(
  txs: Transaction[],
  monthKey: string,
): Array<{ categoryId: string | null; amount: number }> {
  const map = new Map<string | null, number>();
  for (const tx of txs) {
    if (tx.type !== 'expense' || monthKeyOf(tx.date) !== monthKey) continue;
    map.set(tx.categoryId, (map.get(tx.categoryId) ?? 0) + tx.amount);
  }
  return [...map.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** 最近 N 个月的（收入, 支出）序列，用于趋势图 */
export function monthlyTrend(
  txs: Transaction[],
  endMonth: string,
  count: number,
): Array<{ month: string; income: number; expense: number }> {
  const out: Array<{ month: string; income: number; expense: number }> = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = shiftMonth(endMonth, -i);
    const t = monthTotals(txs, month);
    out.push({ month, income: t.income, expense: t.expense });
  }
  return out;
}

/** 某天的支出合计（日历热力图用） */
export function dailyExpense(txs: Transaction[], dateKey: string): number {
  return txs
    .filter((tx) => tx.type === 'expense' && tx.date === dateKey)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

/** 预算执行情况：已用 / 上限 / 是否超支 */
export interface BudgetStatus {
  budget: Budget;
  spent: number;
  ratio: number;
  over: boolean;
}

export function budgetStatus(
  budgets: Budget[],
  txs: Transaction[],
  monthKey: string,
): BudgetStatus[] {
  const byCategory = new Map(expenseByCategory(txs, monthKey).map((e) => [e.categoryId, e.amount]));
  const totalSpent = [...byCategory.values()].reduce((a, b) => a + b, 0);
  return budgets
    .filter((b) => b.month === null || b.month === monthKey)
    .map((budget) => {
      const spent = budget.categoryId === null ? totalSpent : byCategory.get(budget.categoryId) ?? 0;
      const ratio = budget.amount > 0 ? spent / budget.amount : 0;
      return { budget, spent, ratio, over: spent > budget.amount };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

/** CSV 里的类型用中文，保证 Excel 打开可读、也能被本应用重新导入 */
export type CsvType = '支出' | '收入' | '转账';

/** CSV 导出 / 导入用的一行 */
export interface CsvRow {
  date: string;
  type: CsvType;
  amount: string;
  category: string;
  account: string;
  toAccount: string;
  note: string;
  tags: string;
}

const CSV_HEADER = ['日期', '类型', '金额', '分类', '账户', '转入账户', '备注', '标签'];

export const csvTypeLabel: Record<TxType, CsvType> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
};

export function txsToCsvRows(
  txs: Transaction[],
  categories: Category[],
  accounts: Account[],
): CsvRow[] {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const accName = new Map(accounts.map((a) => [a.id, a.name]));
  return txs.map((tx): CsvRow => ({
    date: tx.date,
    type: csvTypeLabel[tx.type],
    amount: (tx.amount / 100).toFixed(2),
    category: tx.categoryId ? catName.get(tx.categoryId) ?? '' : '',
    account: accName.get(tx.accountId) ?? '',
    toAccount: tx.toAccountId ? accName.get(tx.toAccountId) ?? '' : '',
    note: tx.note,
    tags: tx.tags.join('|'),
  }));
}

/** RFC 4180 风格的单元格转义 */
export function csvEscape(cell: string): string {
  if (/[",\n\r]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.date,
        row.type,
        row.amount,
        row.category,
        row.account,
        row.toAccount,
        row.note,
        row.tags,
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  // BOM 让 Excel 正确识别 UTF-8 中文
  return `\uFEFF${lines.join('\r\n')}`;
}

/** 解析 CSV 文本为行（支持引号内逗号/换行） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\r') {
      // 忽略，等 \n
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 解析用户输入的标签：「吃饭 朋友,聚餐」-> ['吃饭','朋友','聚餐'] */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[\s,，、;；]+/).map((t) => t.trim()).filter(Boolean))];
}

/** 生成 id（不依赖 crypto，Electron / WebView / 浏览器都能跑） */
export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}
