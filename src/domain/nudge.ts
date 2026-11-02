import {
  daysInMonth,
  formatCents,
  isStatistical,
  monthKeyOf,
  monthTotals,
  shiftMonth,
  toDateKey,
  type Budget,
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

export type NudgeKind =
  | 'overspend'
  | 'billDue'
  | 'noRecord'
  | 'budgetOver'
  | 'topCategory'
  /* ---- v0.10.0 ---- */
  /** 每月 1~3 号，说上个月过得怎么样 */
  | 'monthlyReview'
  /** 某个分类这个月突然花得比过去半年多很多 */
  | 'abnormal'
  /** 预算快用完了，但离月底还有一段 */
  | 'budgetAlmost'
  /** 晚上还没记账 */
  | 'lateNight';

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
  /** v0.10.0：预算表。要判断「预算快用完了」，光有固定支出规则不够 */
  budgets?: Budget[];
  /** v0.10.0：当前几点（0~23）。记账提醒要挑时机，晚上才提 */
  hour?: number;
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

/* ---------------------------------------------------------- v0.10.0 门槛 */

/** 月末回顾只在每月这几天说（1~3 号），再晚就不叫「月末」了 */
export const REVIEW_DAYS = 3;
/** 异常消费：这个月这一类得超过过去半年月均的这么多倍才算「异常」 */
export const ABNORMAL_RATIO = 2;
/** 异常消费还得有个绝对门槛，不然「宠物这个月花了 3 块 vs 半年月均 1 块」也会报 */
export const ABNORMAL_MIN_CENTS = 30000;
/** 预算用了这么多就算「快用完了」 */
export const BUDGET_ALMOST_RATIO = 0.8;
/** 但离月底不足这么多天时就不提了 —— 那时候说「快用完了」只是添堵 */
export const BUDGET_ALMOST_MIN_DAYS_LEFT = 7;
/** 晚上几点之后才提「今天还没记账」 */
export const LATE_NIGHT_HOUR = 21;

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

  /* ================================================================
   * v0.10.0：四种新的主动开口
   * ----------------------------------------------------------------
   * 这四种的共同点是「有时间性」：
   *   月末回顾只在 1~3 号有意义，过了就永远不说了；
   *   异常消费得在当月说，等下个月就变成历史；
   *   预算将尽要在还来得及的时候说；
   *   记账提醒要在晚上说 —— 早上九点催人记账只会被划走。
   * 所以它们都自带时间闸门，闸门关着就根本不进候选列表。
   * ================================================================ */

  /* ---- 5) 月末回顾：每月 1~3 号 ---- */
  const dayOfMonth = Number(ctx.today.slice(8, 10));
  if (dayOfMonth <= REVIEW_DAYS) {
    const prev = shiftMonth(month, -1);
    const prevTotals = monthTotals(ctx.transactions, prev);
    const beforeTotals = monthTotals(ctx.transactions, shiftMonth(month, -2));
    if (prevTotals.expense > 0) {
      const diff = prevTotals.expense - beforeTotals.expense;
      const pct = beforeTotals.expense > 0 ? Math.abs(diff) / beforeTotals.expense : null;
      candidates.push({
        kind: 'monthlyReview',
        text: 'nudge.monthlyReview',
        vars: {
          month: prev,
          amount: formatCents(prevTotals.expense),
          dir: diff >= 0 ? 'nudge.monthlyReviewUp' : 'nudge.monthlyReviewDown',
          pct: pct === null ? '—' : `${Math.round(pct * 100)}%`,
        },
        // 月末回顾只在头三天出现，出现时优先级仅次于账单到期
        weight: 90,
      });
    }
  }

  /* ---- 6) 异常消费：某类这个月超过过去半年月均的 2 倍 ---- */
  {
    const sixMonths = [1, 2, 3, 4, 5, 6].map((i) => shiftMonth(month, -i));
    const perCat = new Map<string, number[]>();
    for (const m of sixMonths) {
      for (const tx of ctx.transactions) {
        if (tx.type !== 'expense' || monthKeyOf(tx.date) !== m) continue;
        if (!isStatistical(tx)) continue;
        const key = tx.categoryId ?? '';
        const arr = perCat.get(key) ?? [];
        arr.push(tx.amount);
        perCat.set(key, arr);
      }
    }
    const thisMonth = new Map<string, number>();
    for (const tx of ctx.transactions) {
      if (tx.type !== 'expense' || monthKeyOf(tx.date) !== month) continue;
      if (!isStatistical(tx)) continue;
      const key = tx.categoryId ?? '';
      thisMonth.set(key, (thisMonth.get(key) ?? 0) + tx.amount);
    }
    let worst: { id: string; now: number; avg: number; ratio: number } | null = null;
    for (const [id, now] of thisMonth) {
      const past = perCat.get(id) ?? [];
      if (past.length === 0) continue;
      const avg = Math.round(past.reduce((a, b) => a + b, 0) / sixMonths.length);
      if (avg <= 0) continue;
      const ratio = now / avg;
      if (ratio < ABNORMAL_RATIO || now < ABNORMAL_MIN_CENTS) continue;
      if (!worst || ratio > worst.ratio) worst = { id, now, avg, ratio };
    }
    if (worst) {
      const name = ctx.categories.find((c) => c.id === worst!.id)?.name ?? null;
      if (name) {
        candidates.push({
          kind: 'abnormal',
          text: 'nudge.abnormal',
          vars: {
            cat: name,
            amount: formatCents(worst.now),
            ratio: worst.ratio.toFixed(1),
          },
          weight: 70 + Math.min(Math.round((worst.ratio - ABNORMAL_RATIO) * 10), 25),
        });
      }
    }
  }

  /* ---- 7) 预算将尽：用了 80% 且离月底还有一周以上 ---- */
  {
    const dim = daysInMonth(month);
    const daysLeft = dim - dayOfMonth + 1;
    if (daysLeft >= BUDGET_ALMOST_MIN_DAYS_LEFT) {
      for (const b of ctx.budgets ?? []) {
        if (b.amount <= 0) continue;
        const spent = ctx.transactions
          .filter((tx) => tx.type === 'expense' && monthKeyOf(tx.date) === month)
          .filter((tx) => (b.categoryId ? tx.categoryId === b.categoryId : true))
          .filter((tx) => isStatistical(tx))
          .reduce((acc, tx) => acc + tx.amount, 0);
        const ratio = spent / b.amount;
        if (ratio < BUDGET_ALMOST_RATIO || ratio > 1) continue;
        const name = b.categoryId
          ? ctx.categories.find((c) => c.id === b.categoryId)?.name ?? null
          : null;
        candidates.push({
          kind: 'budgetAlmost',
          text: 'nudge.budgetAlmost',
          vars: {
            cat: name ?? '',
            pct: `${Math.round(ratio * 100)}%`,
            days: String(daysLeft),
          },
          weight: 45 + Math.round(ratio * 10),
        });
      }
    }
  }

  /* ---- 8) 晚上还没记账 ---- */
  if (ctx.hour !== undefined && ctx.hour >= LATE_NIGHT_HOUR) {
    const recordedToday = ctx.transactions.some((tx) => tx.date === ctx.today);
    if (!recordedToday) {
      candidates.push({
        kind: 'lateNight',
        text: 'nudge.lateNight',
        vars: {},
        weight: 35,
      });
    }
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
/** 上个月的月份键 */
export function lastMonth(monthKey: string): string {
  return shiftMonth(monthKey, -1);
}
