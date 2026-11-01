import {
  currentMonthKey,
  daysInMonth,
  formatCents,
  monthTotals,
  shiftMonth,
  isStatistical,
  type Category,
  type Transaction,
} from './model';

/**
 * 年度统计（v0.9.0）
 * ------------------------------------------------------------------
 * 统计页原来只有「月」，看的是「这个月怎么了」。
 * 年看的是另一件事：我这一年怎么活的。
 *
 * 为什么同比比环比重要：
 *   环比（这个月 vs 上个月）会被春节、年终奖、开学这些季节性因素搅乱；
 *   同比（今年 10 月 vs 去年 10 月）把季节抵消掉了，是唯一能看出
 *   「我是不是真的变了」的对比。
 */

export interface MonthPoint {
  month: string;
  income: number;
  expense: number;
}

export interface YearStats {
  year: string;
  income: number;
  expense: number;
  net: number;
  /** 12 个月，缺的月份补 0，图表不用自己补空 */
  months: MonthPoint[];
  /** 有数据的月份数，用来算月均 */
  activeMonths: number;
  avgExpense: number;
  avgIncome: number;
  /** 花得最多的那个月（全为 0 时是 null） */
  topMonth: MonthPoint | null;
  /** 同比：去年同期 */
  lastIncome: number;
  lastExpense: number;
  /** 同比百分比；去年为 0 时是 null（除不尽，说 100% 是撒谎） */
  yoyExpense: number | null;
  yoyIncome: number | null;
  /** 最近一个整月的环比 */
  momExpense: number | null;
  momIncome: number | null;
  /** 这一年一共记了多少笔（含转账，因为「记了多少次」问的是行为） */
  count: number;
}

/** 某年的 12 个（收入, 支出） */
export function yearMonths(txs: Transaction[], year: string): MonthPoint[] {
  const out: MonthPoint[] = [];
  for (let m = 1; m <= 12; m += 1) {
    const month = `${year}-${m.toString().padStart(2, '0')}`;
    const t = monthTotals(txs, month);
    out.push({ month, income: t.income, expense: t.expense });
  }
  return out;
}

/** 百分比变化；base 为 0 时返回 null（不能拿「涨了无穷倍」糊人） */
export function pctChange(now: number, base: number): number | null {
  if (base === 0) return now === 0 ? 0 : null;
  return (now - base) / base;
}

/** 年度汇总 */
export function yearStats(txs: Transaction[], year: string): YearStats {
  const months = yearMonths(txs, year);
  const income = months.reduce((s, m) => s + m.income, 0);
  const expense = months.reduce((s, m) => s + m.expense, 0);
  const active = months.filter((m) => m.income > 0 || m.expense > 0);
  const lastYear = yearMonths(txs, String(Number(year) - 1));
  const lastIncome = lastYear.reduce((s, m) => s + m.income, 0);
  const lastExpense = lastYear.reduce((s, m) => s + m.expense, 0);

  // 环比取「这一年里最后一个有数据的月」和它上一个月
  const last = active.length > 0 ? active[active.length - 1].month : null;
  const momExpense = last ? pctChange(monthTotals(txs, last).expense, monthTotals(txs, shiftMonth(last, -1)).expense) : null;
  const momIncome = last ? pctChange(monthTotals(txs, last).income, monthTotals(txs, shiftMonth(last, -1)).income) : null;

  const top = [...months].sort((a, b) => b.expense - a.expense)[0];

  return {
    year,
    income,
    expense,
    net: income - expense,
    months,
    activeMonths: active.length,
    avgExpense: active.length > 0 ? Math.round(expense / active.length) : 0,
    avgIncome: active.length > 0 ? Math.round(income / active.length) : 0,
    topMonth: top && top.expense > 0 ? top : null,
    lastIncome,
    lastExpense,
    yoyExpense: pctChange(expense, lastExpense),
    yoyIncome: pctChange(income, lastIncome),
    momExpense,
    momIncome,
    count: txs.filter((tx) => tx.date.startsWith(year)).length,
  };
}

/** 按分类汇总整年支出，降序 */
export function yearExpenseByCategory(
  txs: Transaction[],
  year: string,
): Array<{ categoryId: string | null; amount: number; months: number }> {
  const map = new Map<string | null, { amount: number; months: Set<string> }>();
  for (const tx of txs) {
    if (tx.type !== 'expense') continue;
    if (!tx.date.startsWith(year)) continue;
    if (!isStatistical(tx)) continue;
    const cur = map.get(tx.categoryId) ?? { amount: 0, months: new Set<string>() };
    cur.amount += tx.amount;
    cur.months.add(tx.date.slice(0, 7));
    map.set(tx.categoryId, cur);
  }
  return [...map.entries()]
    .map(([categoryId, v]) => ({ categoryId, amount: v.amount, months: v.months.size }))
    .sort((a, b) => b.amount - a.amount);
}

/** 某一年里花得最多的一天 */
export function topDayOfYear(
  txs: Transaction[],
  year: string,
): { date: string; amount: number } | null {
  const map = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type !== 'expense') continue;
    if (!tx.date.startsWith(year)) continue;
    if (!isStatistical(tx)) continue;
    map.set(tx.date, (map.get(tx.date) ?? 0) + tx.amount);
  }
  let best: { date: string; amount: number } | null = null;
  for (const [date, amount] of map) {
    if (!best || amount > best.amount) best = { date, amount };
  }
  return best;
}

/** 某月的日历热力图数据：每天一笔支出合计 */
export function monthHeat(txs: Transaction[], monthKey: string): Array<{ date: string; amount: number }> {
  const n = daysInMonth(monthKey);
  const map = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type !== 'expense') continue;
    if (tx.date.slice(0, 7) !== monthKey) continue;
    if (!isStatistical(tx)) continue;
    map.set(tx.date, (map.get(tx.date) ?? 0) + tx.amount);
  }
  return Array.from({ length: n }, (_, i) => {
    const date = `${monthKey}-${(i + 1).toString().padStart(2, '0')}`;
    return { date, amount: map.get(date) ?? 0 };
  });
}

/** 月度回顾用的一条事实（渲染层按 key 取 i18n 文案） */
export interface ReviewFact {
  key: string;
  text: string;
  vars: Record<string, string>;
  icon: string;
}

/** 月度回顾：一个大数字 + 几条事实 */
export function reviewFacts(
  txs: Transaction[],
  monthKey: string,
  categories: Category[],
  fixedExpense: number,
): ReviewFact[] {
  const facts: ReviewFact[] = [];
  const totals = monthTotals(txs, monthKey);
  const prev = monthTotals(txs, shiftMonth(monthKey, -1));
  const byCat = yearExpenseByCategory(txs, monthKey.slice(0, 4)).filter((c) =>
    txs.some(
      (tx) =>
        tx.type === 'expense' &&
        isStatistical(tx) &&
        tx.categoryId === c.categoryId &&
        tx.date.slice(0, 7) === monthKey,
    ),
  );
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const heat = monthHeat(txs, monthKey);
  const top = [...heat].sort((a, b) => b.amount - a.amount)[0];

  if (totals.expense === 0 && totals.income === 0) return facts;

  if (prev.expense > 0) {
    const diff = totals.expense - prev.expense;
    facts.push({
      key: diff >= 0 ? 'review.vsLastUp' : 'review.vsLastDown',
      text: diff >= 0 ? 'review.vsLastUp' : 'review.vsLastDown',
      vars: { amount: formatCents(Math.abs(diff)), pct: Math.abs(Math.round((diff / prev.expense) * 100)).toString() },
      icon: diff >= 0 ? '📈' : '📉',
    });
  }

  const topCat = byCat[0];
  if (topCat) {
    facts.push({
      key: 'review.topCategory',
      text: 'review.topCategory',
      vars: {
        name: catName.get(topCat.categoryId ?? '') ?? '',
        amount: formatCents(topCat.amount),
        pct: totals.expense > 0 ? Math.round((topCat.amount / totals.expense) * 100).toString() : '0',
      },
      icon: '🏷️',
    });
  }

  if (top && top.amount > 0) {
    facts.push({
      key: 'review.topDay',
      text: 'review.topDay',
      vars: { date: top.date.slice(8), amount: formatCents(top.amount) },
      icon: '🔥',
    });
  }

  const spentDays = heat.filter((d) => d.amount > 0).length;
  if (spentDays > 0) {
    facts.push({
      key: 'review.activeDays',
      text: 'review.activeDays',
      vars: { days: spentDays.toString(), avg: formatCents(Math.round(totals.expense / spentDays)) },
      icon: '📅',
    });
  }

  if (fixedExpense > 0) {
    facts.push({
      key: 'review.fixed',
      text: 'review.fixed',
      vars: { amount: formatCents(fixedExpense) },
      icon: '🔁',
    });
  }

  return facts;
}

/** 月度回顾的纯文本版（复制用） */
export function reviewPlainText(
  txs: Transaction[],
  monthKey: string,
  translate: (key: string, vars?: Record<string, string>) => string,
  facts: ReviewFact[],
): string {
  const totals = monthTotals(txs, monthKey);
  const head = translate('review.plainHead', {
    month: monthKey,
    expense: formatCents(totals.expense),
    income: formatCents(totals.income),
  });
  const lines = facts.map((f) => `· ${translate(f.text, f.vars)}`);
  return [head, ...lines].join('\n');
}

/** 今年是哪一年（本地日历） */
export function currentYear(now: Date = new Date()): string {
  return String(now.getFullYear());
}

/** 当前月，给默认值用 */
export const thisMonth = currentMonthKey;
