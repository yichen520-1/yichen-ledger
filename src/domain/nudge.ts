import {
  daysInMonth,
  formatCents,
  isStatistical,
  monthKeyOf,
  monthTotals,
  shiftMonth,
  toDateKey,
  type Category,
  type Transaction,
} from './model';
import { pendingBills, type RecurringRule } from './recurring';
import { weekRangeOf, weekStats } from './weekly';

/**
 * 忆小尘主动开口（v0.9.0）
 * ------------------------------------------------------------------
 * 以前它只会等你问。但真正有用的助手会在你没问的时候说一句。
 *
 * 分寸感是这个模块的全部难点：
 *   - 只在**打开 App 时**判断一次，不轮询、不推送
 *   - 一天最多说一条，说过就记下来，别重复
 *   - 没有值得说的事就**完全不出现**，不硬凑「今天也要加油哦」
 *
 * 所以这里全是纯函数：给它账本、规则、今天，它返回 0 或 1 条提示。
 * 判断逻辑能单测，不依赖浏览器。
 */

export type NudgeKind = 'overspend' | 'billDue' | 'noRecord' | 'budgetOver' | 'topCategory';

export interface Nudge {
  kind: NudgeKind;
  /** i18n 键，渲染层直接 t() */
  text: string;
  /** 文案里的变量，值是已经格式化好的字符串 */
  vars: Record<string, string>;
  /** 排序权重，越大越先说 */
  weight: number;
}

export interface NudgeContext {
  today: string;
  transactions: Transaction[];
  rules: RecurringRule[];
  categories: Category[];
  /** 最近一次记账的日期；没有账目时传 null */
  lastRecordDate: string | null;
}

/**
 * 今天是不是已经说过话了。
 * 存在 settings 里（键 `nudge.lastDate`），一天只出一条。
 */
export const NUDGE_LAST_KEY = 'nudge.lastDate';

/** 「连续几天没记账」的门槛：3 天。少于 3 天不算「忘了」，只是周末没花钱。 */
export const NO_RECORD_DAYS = 3;

/** 「比上周多花」的门槛：金额 200 元且比例 30%，两个都要过。 */
export const OVERSPEND_MIN_CENTS = 20000;
export const OVERSPEND_MIN_RATIO = 0.3;

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/**
 * 算今天该不该说话、说什么。
 *
 * 返回 null 表示今天没什么值得说的 —— 这是最常见的结果，也是设计目标。
 */
export function pickNudge(ctx: NudgeContext): Nudge | null {
  const candidates: Nudge[] = [];

  /* ---- 1) 待确认的账单：这个最有时间压力，权重最高 ---- */
  const pending = pendingBills(ctx.rules, ctx.today);
  if (pending.length > 0) {
    const first = pending[0];
    const overdue = first.overdueDays;
    candidates.push({
      kind: 'billDue',
      text: overdue > 0 ? 'nudge.billOverdue' : 'nudge.billToday',
      vars: {
        title: first.rule.title,
        amount: first.rule.amount > 0 ? formatCents(first.rule.amount) : '',
        days: String(overdue),
        n: String(pending.length),
      },
      weight: 100 + Math.min(overdue, 30),
    });
  }

  /* ---- 2) 这周比上周多花太多 ---- */
  const thisWeek = weekRangeOf(ctx.today);
  const lastWeekRange = weekRangeOf(shiftDay(ctx.today, -7));
  const now = weekStats(ctx.transactions, thisWeek);
  const before = weekStats(ctx.transactions, lastWeekRange);
  if (before.expense > 0) {
    const diff = now.expense - before.expense;
    const ratio = diff / before.expense;
    if (diff >= OVERSPEND_MIN_CENTS && ratio >= OVERSPEND_MIN_RATIO) {
      const catName = now.topCategory
        ? ctx.categories.find((c) => c.id === now.topCategory!.categoryId)?.name ?? null
        : null;
      candidates.push({
        kind: 'overspend',
        text: catName ? 'nudge.overspendWithCat' : 'nudge.overspend',
        vars: {
          amount: formatCents(diff),
          pct: Math.round(ratio * 100).toString(),
          name: catName ?? '',
        },
        weight: 60 + Math.min(Math.round(ratio * 20), 30),
      });
    }
  }

  /* ---- 3) 好久没记账 ---- */
  if (ctx.lastRecordDate) {
    const gap = daysBetween(ctx.lastRecordDate, ctx.today);
    if (gap >= NO_RECORD_DAYS) {
      candidates.push({
        kind: 'noRecord',
        text: 'nudge.noRecord',
        vars: { days: String(gap) },
        weight: 30,
      });
    }
  }

  /* ---- 4) 本月预算超了 ---- */
  const month = monthKeyOf(ctx.today);
  const totals = monthTotals(ctx.transactions, month);
  const budgetTotal = ctx.rules
    .filter((r) => r.type === 'expense' && !r.archived && r.amount > 0)
    .reduce((s, r) => s + r.amount, 0);
  if (budgetTotal > 0 && totals.expense > budgetTotal) {
    candidates.push({
      kind: 'budgetOver',
      text: 'nudge.budgetOver',
      vars: { over: formatCents(totals.expense - budgetTotal) },
      weight: 50,
    });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0];
}

function shiftDay(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return toDateKey(d);
}

/**
 * 本月还剩几天、按剩余预算算每天还能花多少。
 * 给总览页的「今日额度」用 —— 比一个冷冰冰的「预算已用 80%」有用。
 */
export function dailyAllowance(
  txs: Transaction[],
  monthKey: string,
  budgetTotal: number,
  today: string,
): { left: number; daysLeft: number; perDay: number } | null {
  if (budgetTotal <= 0) return null;
  const totals = monthTotals(txs, monthKey);
  const left = budgetTotal - totals.expense;
  const dim = daysInMonth(monthKey);
  const dayNum = Number(today.slice(8, 10));
  const daysLeft = Math.max(1, dim - dayNum + 1);
  return { left, daysLeft, perDay: Math.round(left / daysLeft) };
}

/**
 * 连续记账天数（今天没记就往前找）。
 * 这个数字本身有点上瘾，所以只在设置里显示，不主动弹。
 */
export function streakDays(txs: Transaction[], today: string): number {
  const days = new Set(
    txs.filter((tx) => isStatistical(tx) || tx.type === 'transfer').map((tx) => tx.date),
  );
  let n = 0;
  let cursor = today;
  // 今天还没记不算断 —— 一天才刚开始
  if (!days.has(cursor)) cursor = shiftDay(cursor, -1);
  while (days.has(cursor)) {
    n += 1;
    cursor = shiftDay(cursor, -1);
  }
  return n;
}

/** 最近一次记账的日期（任意类型） */
export function lastRecordDate(txs: Transaction[]): string | null {
  let best: string | null = null;
  for (const tx of txs) {
    if (!best || tx.date > best) best = tx.date;
  }
  return best;
}

/** 这个月记了多少笔（含转账） */
export function monthRecordCount(txs: Transaction[], monthKey: string): number {
  return txs.filter((tx) => tx.date.slice(0, 7) === monthKey).length;
}

/** 上个月的月份键 */
export function lastMonth(monthKey: string): string {
  return shiftMonth(monthKey, -1);
}
