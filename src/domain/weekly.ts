/**
 * 周报
 * ------------------------------------------------------------------
 * 这是「记账 + 日程」第一次在数字上碰面：一页里同时说钱和事。
 *
 * 为什么是「周」不是「月」：
 *   月报在统计页已经有了（按月的趋势图、分类排名）。周报的价值在**及时**：
 *   一周过完，你还能想起来周三那顿为什么花那么多；一个月过完就只剩数字了。
 *
 * 为什么所有数字都做成「可选的事实条目」而不是固定版式：
 *   有的人一周只花三笔、有的人一周全是日程。硬凑版式会出现「本周没有数据」
 *   的空洞；这里改成「有什么说什么」，有预算就提预算，没日程就不提日程。
 */
import type { Transaction, Category, Budget } from './model';
import { formatCents, shiftMonth } from './model';
import type { EventItem, Occurrence } from './schedule';
import { expandRange, addDays } from './schedule';
import { budgetStatus } from './model';

/** 一周的起止（周一到周日，ISO 习惯） */
export interface WeekRange {
  from: string;
  to: string;
}

export interface WeekStats {
  from: string;
  to: string;
  /** 这一周的支出合计（分） */
  expense: number;
  /** 这一周的收入合计（分） */
  income: number;
  /** 上一周同口径的支出，用来做对比 */
  lastExpense: number;
  /** 差多少（分，正数=比上周多花了） */
  delta: number;
  /** 变化的百分比；上周为 0 时是 null（除不出有意义的数） */
  deltaPct: number | null;
  /** 花得最多的分类 */
  topCategory: { categoryId: string | null; amount: number } | null;
  /** 花钱最多的一天 */
  topDay: { date: string; amount: number } | null;
  /** 这一周记了几笔 */
  count: number;
}

export interface WeekSchedule {
  /** 这一周展开后的日程项数 */
  total: number;
  /** 其中已经勾掉的 */
  done: number;
  /** 最忙的一天 */
  busiest: { date: string; count: number } | null;
  /** 下周（下一周）的日程项数 */
  nextTotal: number;
  /** 下周最挤的那天 */
  nextBusiest: { date: string; count: number } | null;
}

/** 周报里的一条「事实」 */
export interface WeekFact {
  key: string;
  /** i18n 键，形如 weekly.topCategory */
  text: string;
  /** 插值参数 */
  vars: Record<string, string>;
  /** 图标（emoji，和 App 其它地方一致） */
  icon: string;
}

/** 周一到周日 */
export function weekRangeOf(dayKey: string): WeekRange {
  const d = new Date(`${dayKey}T00:00:00`);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  const from = addDays(dayKey, -dow);
  return { from, to: addDays(from, 6) };
}

/** 上一周 */
export function prevWeek(range: WeekRange): WeekRange {
  const from = addDays(range.from, -7);
  return { from, to: addDays(from, 6) };
}

/** 下一周 */
export function nextWeek(range: WeekRange): WeekRange {
  const from = addDays(range.from, 7);
  return { from, to: addDays(from, 6) };
}

function inRange(dateKey: string, range: WeekRange): boolean {
  return dateKey >= range.from && dateKey <= range.to;
}

function sumExpense(txs: Transaction[], range: WeekRange): number {
  let n = 0;
  for (const tx of txs) {
    if (tx.type === 'expense' && inRange(tx.date, range)) n += tx.amount;
  }
  return n;
}

/** 这一周（及上一周）的账目统计 */
export function weekStats(txs: Transaction[], range: WeekRange): WeekStats {
  let expense = 0;
  let income = 0;
  let count = 0;
  const byCat = new Map<string | null, number>();
  const byDay = new Map<string, number>();

  for (const tx of txs) {
    if (!inRange(tx.date, range)) continue;
    count += 1;
    if (tx.type === 'income') {
      income += tx.amount;
    } else if (tx.type === 'expense') {
      expense += tx.amount;
      byCat.set(tx.categoryId, (byCat.get(tx.categoryId) ?? 0) + tx.amount);
      byDay.set(tx.date, (byDay.get(tx.date) ?? 0) + tx.amount);
    }
  }

  let topCategory: WeekStats['topCategory'] = null;
  for (const [categoryId, amount] of byCat) {
    if (!topCategory || amount > topCategory.amount) topCategory = { categoryId, amount };
  }

  let topDay: WeekStats['topDay'] = null;
  for (const [date, amount] of byDay) {
    if (!topDay || amount > topDay.amount) topDay = { date, amount };
  }

  const lastExpense = sumExpense(txs, prevWeek(range));
  const delta = expense - lastExpense;
  const deltaPct = lastExpense > 0 ? Math.round((delta / lastExpense) * 100) : null;

  return { from: range.from, to: range.to, expense, income, lastExpense, delta, deltaPct, topCategory, topDay, count };
}

/** 这一周（及下周）的日程统计 */
export function weekSchedule(events: EventItem[], range: WeekRange): WeekSchedule {
  const thisWeek: Occurrence[] = expandRange(events, range.from, range.to);
  const next: Occurrence[] = expandRange(events, nextWeek(range).from, nextWeek(range).to);

  const countByDate = (list: Occurrence[]) => {
    const map = new Map<string, number>();
    for (const o of list) map.set(o.date, (map.get(o.date) ?? 0) + 1);
    let busiest: { date: string; count: number } | null = null;
    for (const [date, count] of map) {
      if (!busiest || count > busiest.count) busiest = { date, count };
    }
    return busiest;
  };

  return {
    total: thisWeek.length,
    done: thisWeek.filter((o) => o.done).length,
    busiest: countByDate(thisWeek),
    nextTotal: next.length,
    nextBusiest: countByDate(next),
  };
}

/**
 * 把一周的数字翻成「能读的几句话」。
 *
 * 顺序是有讲究的：先说花了多少（最想知道），再说花在哪儿、哪天，
 * 然后是日程（钱的事比事急），最后是固定支出和预算（这是「以后」的事）。
 * 没数据的条目不生成 —— 而不是生成一条「本周无数据」。
 */
export function weekFacts(
  stats: WeekStats,
  sched: WeekSchedule,
  ctx: {
    categories: Category[];
    budgets: Budget[];
    txs: Transaction[];
    fixedExpense: number;
    monthKey: string;
    categoryName: (id: string | null) => string;
    dayLabel: (dateKey: string) => string;
  },
): WeekFact[] {
  const facts: WeekFact[] = [];

  if (stats.topCategory && stats.topCategory.amount > 0) {
    facts.push({
      key: 'topCategory',
      text: 'weekly.topCategory',
      icon: '🥇',
      vars: {
        name: ctx.categoryName(stats.topCategory.categoryId),
        amount: formatCents(stats.topCategory.amount),
      },
    });
  }

  if (stats.topDay && stats.topDay.amount > 0) {
    facts.push({
      key: 'topDay',
      text: 'weekly.topDay',
      icon: '📅',
      vars: { date: ctx.dayLabel(stats.topDay.date), amount: formatCents(stats.topDay.amount) },
    });
  }

  if (sched.total > 0) {
    facts.push({
      key: 'events',
      text: 'weekly.events',
      icon: '🗓️',
      vars: { n: String(sched.total), done: String(sched.done) },
    });
  } else {
    facts.push({ key: 'noEvents', text: 'weekly.noEvents', icon: '🗓️', vars: {} });
  }

  if (sched.busiest && sched.busiest.count >= 2) {
    facts.push({
      key: 'busyDay',
      text: 'weekly.busyDay',
      icon: '⏳',
      vars: { date: ctx.dayLabel(sched.busiest.date), n: String(sched.busiest.count) },
    });
  }

  if (sched.nextTotal > 0) {
    facts.push({
      key: 'upcoming',
      text: 'weekly.upcoming',
      icon: '➡️',
      vars: {
        n: String(sched.nextTotal),
        busy: String(sched.nextBusiest?.count ?? 0),
        date: sched.nextBusiest ? ctx.dayLabel(sched.nextBusiest.date) : '',
      },
    });
  } else {
    facts.push({ key: 'noUpcoming', text: 'weekly.noUpcoming', icon: '➡️', vars: {} });
  }

  if (ctx.fixedExpense > 0) {
    facts.push({
      key: 'fixed',
      text: 'weekly.fixed',
      icon: '🔁',
      vars: { amount: formatCents(ctx.fixedExpense) },
    });
  }

  // 预算：只说「已经用掉一半以上」的那几个，全在范围内就一句话带过
  const statuses = budgetStatus(ctx.budgets, ctx.txs, ctx.monthKey);
  const warn = statuses.filter((s) => s.ratio >= 0.5).slice(0, 2);
  if (warn.length > 0) {
    for (const s of warn) {
      facts.push({
        key: `budget-${s.budget.id}`,
        text: 'weekly.budgetWarn',
        icon: s.over ? '⚠️' : '📊',
        vars: { name: s.budget.categoryId ? ctx.categoryName(s.budget.categoryId) : ctx.categoryName(null), pct: String(Math.round(s.ratio * 100)) },
      });
    }
  } else if (statuses.length > 0) {
    facts.push({ key: 'budgetOk', text: 'weekly.budgetOk', icon: '✅', vars: {} });
  }

  return facts;
}

/** 周报的纯文本版（「复制文字版」用） */
export function weekPlainText(
  stats: WeekStats,
  facts: WeekFact[],
  translate: (key: string, vars?: Record<string, string>) => string,
): string {
  const lines: string[] = [];
  lines.push(translate('weekly.range', { from: stats.from, to: stats.to }));
  lines.push(translate('weekly.spend', { amount: formatCents(stats.expense) }));
  if (stats.lastExpense > 0) {
    if (Math.abs(stats.delta) < 100) {
      lines.push(translate('weekly.sameAsLast'));
    } else {
      lines.push(
        translate('weekly.vsLast', {
          sign: stats.delta > 0 ? '+' : '-',
          amount: formatCents(Math.abs(stats.delta)),
          pct: String(Math.abs(stats.deltaPct ?? 0)),
        }),
      );
    }
  }
  for (const f of facts) {
    lines.push(translate(f.text, f.vars));
  }
  return lines.join('\n');
}

/** 本月（用于预算）——周报跨月时用周报结束那天所在的月 */
export function monthOfWeek(range: WeekRange): string {
  return range.to.slice(0, 7);
}

export { shiftMonth };
