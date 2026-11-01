import { isStatistical, monthKeyOf, type Transaction } from './model';

/**
 * 待收 / 报销（v0.9.0）
 * ------------------------------------------------------------------
 * 垫了 3000 出差，两个月后报销到账。这笔钱确实离开了账户，
 * 但它不是「花掉」—— 如果照常算进当月支出，那个月的生活成本会虚高，
 * 而真实消费水平完全没变。
 *
 * 所以这里做的事是：
 *   1. 标成待收 → 从统计口径里排除（但账户余额照常扣，钱是真的出去了）
 *   2. 到账时 → 生成一笔金额相同的收入，两笔互相指，一起排除出统计
 *
 * 为什么不直接「记一笔负数支出」：
 *   那样会污染分类统计（餐饮出现负值），而且导出 CSV 到 Excel 里
 *   别人看不懂负数支出是什么意思。收入才是它本来的性质。
 */

/** 待收的那笔支出 */
export interface OpenReceivable {
  tx: Transaction;
  /** 已经挂了多久（天） */
  ageDays: number;
}

/** 从账目里挑出「还没收回来的」 */
export function openReceivables(txs: Transaction[], today: string): OpenReceivable[] {
  return txs
    .filter((tx) => tx.type === 'expense' && tx.receivable && !tx.settledBy)
    .map((tx) => ({ tx, ageDays: daysBetween(tx.date, today) }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

/** 已经冲平的（有 settledBy 的支出） */
export function settledReceivables(txs: Transaction[]): Transaction[] {
  return txs
    .filter((tx) => tx.type === 'expense' && tx.receivable && !!tx.settledBy)
    .sort((a, b) => (b.settledBy ?? '').localeCompare(a.settledBy ?? ''));
}

/** 所有待收金额合计 */
export function receivableTotal(txs: Transaction[]): number {
  return txs
    .filter((tx) => tx.type === 'expense' && tx.receivable && !tx.settledBy)
    .reduce((s, tx) => s + tx.amount, 0);
}

/**
 * 生成冲平记录。
 *
 * 日期用「到账那天」而不是原支出的日期 —— 钱是哪天回来的就记哪天，
 * 否则账目按时间排下来会看不懂。
 */
export interface SettlementDraft {
  type: 'income';
  amount: number;
  categoryId: string | null;
  accountId: string;
  /** 收入没有转出账户，但 Transaction 这个字段是必填的，显式给 null */
  toAccountId: null;
  date: string;
  note: string;
  tags: string[];
  receivableId: string;
}

export function settlementDraft(
  original: Transaction,
  date: string,
  note: string,
): SettlementDraft {
  return {
    type: 'income',
    amount: original.amount,
    categoryId: original.categoryId,
    accountId: original.accountId,
    toAccountId: null,
    date,
    note,
    tags: original.tags,
    receivableId: original.id,
  };
}

/**
 * 某个月「被待收挡在统计外」的金额。
 * 总览页用它解释「为什么账目加起来和支出合计对不上」。
 */
export function excludedFromStats(txs: Transaction[], monthKey: string): number {
  return txs
    .filter((tx) => monthKeyOf(tx.date) === monthKey && !isStatistical(tx))
    .reduce((s, tx) => s + (tx.type === 'expense' ? tx.amount : -tx.amount), 0);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000));
}

/** 事件账本：某条日程下挂了哪些账目 */
export function txsOfEvent(txs: Transaction[], eventId: string): Transaction[] {
  return txs
    .filter((tx) => tx.eventId === eventId)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** 事件合计：支出 / 收入 / 净花 */
export function eventSpend(txs: Transaction[], eventId: string): { expense: number; income: number; net: number; count: number } {
  const list = txsOfEvent(txs, eventId);
  let expense = 0;
  let income = 0;
  for (const tx of list) {
    if (tx.type === 'expense') expense += tx.amount;
    else if (tx.type === 'income') income += tx.amount;
  }
  return { expense, income, net: expense - income, count: list.length };
}

/**
 * 哪些日程值得显示「这次花了多少」。
 * 有账目挂上去的才算 —— 空日程不该占版面。
 */
export function eventsWithSpend(txs: Transaction[]): Set<string> {
  const set = new Set<string>();
  for (const tx of txs) {
    if (tx.eventId) set.add(tx.eventId);
  }
  return set;
}
