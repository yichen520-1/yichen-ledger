/**
 * 周期性账单（纯领域层）
 * ------------------------------------------------------------------
 * 房租、话费、会员订阅这类「每个月都来一次」的支出，不该每月手动记一遍。
 *
 * 核心设计：**到期不自动入账**。
 *   到日子只在总览顶部冒出一条「待确认：房租 ¥3500」，用户点一下才写进账本，
 *   可以跳过、也可以改金额（这月水电涨了）。
 *
 * 为什么不做「到期自动入账」：
 *   自动写库听起来省事，但它有一个要命的副作用 —— 你取消了订阅、或者这个月
 *   房租免了，App 还是会替你记一笔支出。账本一旦不可信，就没人在用了。
 *   多一次点击，换来的是「账本上每一笔都是我看过的」。
 */

import { daysInMonth, monthKeyOf, toDateKey, type Transaction, type TxType } from './model';

/** 重复节奏。只做这四种：日常记账里 99% 的固定支出都能落进去。 */
export type BillFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurringRule {
  id: string;
  /** 名字，比如「房租」「视频会员」 */
  title: string;
  type: Exclude<TxType, 'transfer'>;
  /** 金额，单位：分 */
  amount: number;
  categoryId: string | null;
  accountId: string;
  /** 重复节奏 */
  freq: BillFreq;
  /** 每 N 天 / N 周 / N 月 / N 年 */
  interval: number;
  /** 起始日 'YYYY-MM-DD'：第一次该出账的日期 */
  startDate: string;
  /** 结束日（含），null 表示一直重复 */
  endDate: string | null;
  /** monthly / yearly 用：每月几号（1~31）。月末不足时自动落到当月最后一天。 */
  dayOfMonth: number | null;
  /** weekly 用：星期几，0=周日 … 6=周六 */
  weekday: number | null;
  /** yearly 用：几月（1~12） */
  monthOfYear: number | null;
  note: string;
  tags: string[];
  /** 已确认过的日期（'YYYY-MM-DD'）—— 确认后写进账本，同时记在这里，避免重复提醒 */
  confirmedDates: string[];
  /** 已跳过的日期 —— 跳过也是「处理过了」，不再出现在待确认里 */
  skippedDates: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** 一条「该出账了但还没确认」的记录 */
export interface PendingBill {
  rule: RecurringRule;
  /** 这条账单该记在哪一天 */
  date: string;
  /** 已逾期几天（0 = 就是今天） */
  overdueDays: number;
  key: string;
}

/** 待确认最多往回看多少天。再往前的就不再打扰了，太旧的账用户也不会去补。 */
export const PENDING_LOOKBACK_DAYS = 60;

/** 新建规则时的默认值 */
export function newRule(): RecurringRule {
  const now = new Date().toISOString();
  const today = toDateKey(new Date());
  return {
    id: '',
    title: '',
    type: 'expense',
    amount: 0,
    categoryId: null,
    accountId: '',
    freq: 'monthly',
    interval: 1,
    startDate: today,
    endDate: null,
    dayOfMonth: Number(today.slice(8, 10)),
    weekday: new Date(`${today}T00:00:00`).getDay(),
    monthOfYear: Number(today.slice(5, 7)),
    note: '',
    tags: [],
    confirmedDates: [],
    skippedDates: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** 解析 'YYYY-MM-DD' 成 Date（本地零点） */
function parseDay(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

/** 两个日期相差几天（b - a） */
function diffDays(a: string, b: string): number {
  const ms = parseDay(b).getTime() - parseDay(a).getTime();
  return Math.round(ms / 86400000);
}

function shiftDays(key: string, n: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/**
 * 某个月的「第 dayOfMonth 天」。
 * 2 月没有 30 号，4 月没有 31 号 —— 这时落到当月最后一天。
 * 这是账单类产品的通行做法：信用卡账单日在 31 号，2 月就按 28/29 号算。
 */
export function dayInMonth(monthKey: string, dayOfMonth: number): string {
  const last = daysInMonth(monthKey);
  const day = Math.min(Math.max(1, dayOfMonth), last);
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/** 这条规则在指定日期该不该出账 */
export function ruleOccursOn(rule: RecurringRule, dateKey: string): boolean {
  if (rule.archived) return false;
  if (dateKey < rule.startDate) return false;
  if (rule.endDate && dateKey > rule.endDate) return false;

  const interval = Math.max(1, rule.interval || 1);

  switch (rule.freq) {
    case 'daily': {
      const gap = diffDays(rule.startDate, dateKey);
      return gap >= 0 && gap % interval === 0;
    }
    case 'weekly': {
      const gap = diffDays(rule.startDate, dateKey);
      if (gap < 0) return false;
      // 每 interval 周。先看是不是同一周的星期几，再看隔了几周。
      const targetWeekday = rule.weekday ?? parseDay(rule.startDate).getDay();
      if (parseDay(dateKey).getDay() !== targetWeekday) return false;
      // 以 startDate 所在周为第 0 周
      const startWeekStart = shiftDays(rule.startDate, -((parseDay(rule.startDate).getDay() + 7) % 7));
      const thisWeekStart = shiftDays(dateKey, -((parseDay(dateKey).getDay() + 7) % 7));
      const weeks = Math.round(diffDays(startWeekStart, thisWeekStart) / 7);
      return weeks >= 0 && weeks % interval === 0;
    }
    case 'monthly': {
      const day = rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10));
      const month = monthKeyOf(dateKey);
      if (dateKey !== dayInMonth(month, day)) return false;
      // 隔几个月：以 startDate 那个月为第 0 个月
      const [sy, sm] = rule.startDate.slice(0, 7).split('-').map(Number);
      const [cy, cm] = month.split('-').map(Number);
      const months = (cy - sy) * 12 + (cm - sm);
      return months >= 0 && months % interval === 0;
    }
    case 'yearly': {
      const month = rule.monthOfYear ?? Number(rule.startDate.slice(5, 7));
      const day = rule.dayOfMonth ?? Number(rule.startDate.slice(8, 10));
      const thisMonth = monthKeyOf(dateKey);
      if (Number(thisMonth.slice(5, 7)) !== month) return false;
      if (dateKey !== dayInMonth(thisMonth, day)) return false;
      const years = Number(dateKey.slice(0, 4)) - Number(rule.startDate.slice(0, 4));
      return years >= 0 && years % interval === 0;
    }
    default:
      return false;
  }
}

/** 规则在 from..to 之间会出账的所有日期 */
export function ruleDatesBetween(rule: RecurringRule, from: string, to: string): string[] {
  const out: string[] = [];
  if (to < from) return out;
  // 逐日走。区间最多几十天，一天一次判断比推导公式好写也不易错。
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 4000) {
    if (ruleOccursOn(rule, cursor)) out.push(cursor);
    cursor = shiftDays(cursor, 1);
    guard++;
  }
  return out;
}

/** 下一次该出账的日期（不含今天，严格晚于 today） */
export function nextDueDate(rule: RecurringRule, today: string): string | null {
  if (rule.archived) return null;
  const handled = new Set([...rule.confirmedDates, ...rule.skippedDates]);
  // 从今天开始找（含今天）：今天正好是到期日、又还没处理，那「下次到期」就是今天。
  // 从明天开始找的话，用户会在到期当天看到「下次 2 月 15 日」，以为这个月不用管。
  // 最多往后找 400 天：年度账单也能找到。
  let cursor = shiftDays(today, -1);
  for (let i = 0; i < 401; i++) {
    cursor = shiftDays(cursor, 1);
    if (rule.endDate && cursor > rule.endDate) return null;
    if (ruleOccursOn(rule, cursor) && !handled.has(cursor)) return cursor;
  }
  return null;
}

/**
 * 扫出所有「已经到日子、还没确认也没跳过」的账单。
 * 只往回看 PENDING_LOOKBACK_DAYS 天，再早的不打扰。
 */
export function pendingBills(rules: RecurringRule[], today: string): PendingBill[] {
  const from = shiftDays(today, -PENDING_LOOKBACK_DAYS);
  const out: PendingBill[] = [];
  for (const rule of rules) {
    if (rule.archived) continue;
    const start = rule.startDate > from ? rule.startDate : from;
    if (start > today) continue;
    const handled = new Set([...rule.confirmedDates, ...rule.skippedDates]);
    for (const date of ruleDatesBetween(rule, start, today)) {
      if (handled.has(date)) continue;
      out.push({
        rule,
        date,
        overdueDays: diffDays(date, today),
        key: `${rule.id}@${date}`,
      });
    }
  }
  // 最该处理的排前面：逾期越久越靠前；同一天按金额从大到小
  return out.sort(
    (a, b) => b.overdueDays - a.overdueDays || b.rule.amount - a.rule.amount || a.date.localeCompare(b.date),
  );
}

/** 把「这条规则某一天」变成一条可入库的账目草稿 */
export function billToDraft(bill: PendingBill): {
  type: Exclude<TxType, 'transfer'>;
  amountText: string;
  categoryId: string | null;
  accountId: string;
  toAccountId: null;
  date: string;
  note: string;
  tagsText: string;
} {
  return {
    type: bill.rule.type,
    amountText: (bill.rule.amount / 100).toFixed(2),
    categoryId: bill.rule.categoryId,
    accountId: bill.rule.accountId,
    toAccountId: null,
    date: bill.date,
    note: bill.rule.note || bill.rule.title,
    tagsText: bill.rule.tags.join(' '),
  };
}

/**
 * 从一条已有账目反推一条周期规则（「这笔要不要每月提醒」）。
 * 默认按「每月同一天」重复 —— 房租、订阅绝大多数都是月度。
 */
export function ruleFromTransaction(
  tx: Transaction,
  id: string,
  now: string = new Date().toISOString(),
): RecurringRule {
  return {
    ...newRule(),
    id,
    title: tx.note || '',
    type: tx.type === 'income' ? 'income' : 'expense',
    amount: tx.amount,
    categoryId: tx.categoryId,
    accountId: tx.accountId,
    freq: 'monthly',
    interval: 1,
    startDate: tx.date,
    endDate: null,
    dayOfMonth: Number(tx.date.slice(8, 10)),
    weekday: null,
    monthOfYear: null,
    note: tx.note,
    tags: tx.tags.slice(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 从一条日程反推一条周期规则（日程 → 账单）。
 * 日程的重复规则和账单的重复规则能对上三种：每月、每周、每年。
 * 对不上（比如「每 3 天」）就退回按月，因为账单场景里按月才是常态。
 */
export function ruleFromEvent(
  event: {
    title: string;
    date: string;
    startTime: string;
    recurrence: { freq: string; interval: number; weekdays: number[]; until: string | null };
  },
  id: string,
  now: string = new Date().toISOString(),
): RecurringRule {
  const freq = event.recurrence.freq;
  const base = newRule();
  const dayOfMonth = Number(event.date.slice(8, 10));
  const monthOfYear = Number(event.date.slice(5, 7));

  if (freq === 'weekly') {
    return {
      ...base,
      id,
      title: event.title,
      freq: 'weekly',
      interval: Math.max(1, event.recurrence.interval || 1),
      startDate: event.date,
      endDate: event.recurrence.until,
      weekday: event.recurrence.weekdays.length
        ? event.recurrence.weekdays[0]
        : new Date(`${event.date}T00:00:00`).getDay(),
      dayOfMonth: null,
      monthOfYear: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (freq === 'yearly') {
    return {
      ...base,
      id,
      title: event.title,
      freq: 'yearly',
      interval: Math.max(1, event.recurrence.interval || 1),
      startDate: event.date,
      endDate: event.recurrence.until,
      dayOfMonth,
      monthOfYear,
      weekday: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  if (freq === 'daily') {
    return {
      ...base,
      id,
      title: event.title,
      freq: 'daily',
      interval: Math.max(1, event.recurrence.interval || 1),
      startDate: event.date,
      endDate: event.recurrence.until,
      dayOfMonth: null,
      weekday: null,
      monthOfYear: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  // monthly 或 none：都按「每月同一天」
  return {
    ...base,
    id,
    title: event.title,
    freq: 'monthly',
    interval: freq === 'monthly' ? Math.max(1, event.recurrence.interval || 1) : 1,
    startDate: event.date,
    endDate: event.recurrence.until,
    dayOfMonth,
    weekday: null,
    monthOfYear: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** 一条规则每月大概多少钱 —— 界面上「每月固定支出 ¥xxxx」用 */
export function monthlyEquivalent(rule: RecurringRule): number {
  if (rule.archived) return 0;
  const per = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case 'daily':
      return Math.round((rule.amount * 30) / per);
    case 'weekly':
      return Math.round((rule.amount * 52) / 12 / per);
    case 'monthly':
      return Math.round(rule.amount / per);
    case 'yearly':
      return Math.round(rule.amount / 12 / per);
    default:
      return 0;
  }
}

/** 所有规则折算成「每月固定支出 / 收入」合计 */
export function fixedTotals(rules: RecurringRule[]): { expense: number; income: number } {
  let expense = 0;
  let income = 0;
  for (const rule of rules) {
    const m = monthlyEquivalent(rule);
    if (rule.type === 'income') income += m;
    else expense += m;
  }
  return { expense, income };
}

/** 规则的重复节奏说成一句可翻译的参数（界面拼句子用） */
export function ruleShape(rule: RecurringRule): {
  freq: BillFreq;
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
} {
  return {
    freq: rule.freq,
    interval: Math.max(1, rule.interval || 1),
    dayOfMonth: rule.dayOfMonth,
    weekday: rule.weekday,
    monthOfYear: rule.monthOfYear,
  };
}
