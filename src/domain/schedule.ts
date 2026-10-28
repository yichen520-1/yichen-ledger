import { daysInMonth, newId, toDateKey } from './model';

/**
 * 日程的纯领域层：类型、重复规则、日期展开、排序与格式化。
 * 和 model.ts 一样，这里不依赖 React / Dexie，方便单独测。
 */

export type RecurFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Recurrence {
  freq: RecurFreq;
  /** 每 N 天 / N 周 / N 月 / N 年 */
  interval: number;
  /** 仅 weekly 用：0=周日 … 6=周六。空数组表示「就用开始那天的星期」 */
  weekdays: number[];
  /** 重复截止日（含当天），'YYYY-MM-DD'；null 表示一直重复 */
  until: string | null;
}

export const NO_RECUR: Recurrence = { freq: 'none', interval: 1, weekdays: [], until: null };

export interface EventItem {
  id: string;
  title: string;
  notes: string;
  location: string;
  /** 开始日期 'YYYY-MM-DD' */
  date: string;
  /** 'HH:mm'；allDay 时忽略 */
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  tag: string;
  recurrence: Recurrence;
  /** 提前多少分钟提醒，可多个；空数组表示不提醒 */
  reminders: number[];
  /** 单次日程的完成状态 */
  done: boolean;
  /** 重复日程里已完成的那些日期（'YYYY-MM-DD'） */
  doneDates: string[];
  createdAt: string;
  updatedAt: string;
}

/** 展开之后的一次「发生」：同一条重复日程在不同日期会各产生一个 */
export interface Occurrence {
  event: EventItem;
  date: string;
  /** `${event.id}@${date}`，列表 key 用 */
  key: string;
  done: boolean;
}

export const EVENT_COLORS = [
  '#5aa9f0',
  '#4cc38a',
  '#ffb454',
  '#f2645a',
  '#c96fb7',
  '#8a7cd6',
  '#3aa7a0',
  '#8d8d8d',
];

export const REMINDER_CHOICES = [0, 5, 15, 30, 60, 120, 1440];

/** 把 'YYYY-MM-DD' 解析成本地时区的 Date（0 点），避开 new Date(str) 的 UTC 偏移 */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** 本地日期加减天数，返回新的 'YYYY-MM-DD' */
export function addDays(key: string, n: number): string {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

/** 周一为一周的第一天（和中文日历习惯一致） */
export function startOfWeek(key: string): string {
  const d = parseDateKey(key);
  const wd = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
  d.setDate(d.getDate() - wd);
  return toDateKey(d);
}

export function weekdayMon0(key: string): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

/** 两个日期相差多少天（后者减前者） */
export function daysBetween(a: string, b: string): number {
  const ms = parseDateKey(b).getTime() - parseDateKey(a).getTime();
  return Math.round(ms / 86400000);
}

/** 这条日程是否发生在指定日期 */
export function occursOn(ev: EventItem, dateKey: string): boolean {
  if (dateKey < ev.date) return false;
  const r = ev.recurrence ?? NO_RECUR;
  if (r.until && dateKey > r.until) return false;

  if (r.freq === 'none') return dateKey === ev.date;

  const start = parseDateKey(ev.date);
  const cur = parseDateKey(dateKey);
  const iv = Math.max(1, Math.floor(r.interval) || 1);

  if (r.freq === 'daily') {
    return daysBetween(ev.date, dateKey) % iv === 0;
  }

  if (r.freq === 'weekly') {
    const wds = r.weekdays.length ? r.weekdays : [start.getDay()];
    if (!wds.includes(cur.getDay())) return false;
    const weeks = daysBetween(startOfWeek(ev.date), startOfWeek(dateKey)) / 7;
    return Math.round(weeks) % iv === 0;
  }

  if (r.freq === 'monthly') {
    const startLast = daysInMonth(ev.date.slice(0, 7));
    const curMonth = dateKey.slice(0, 7);
    const curLast = daysInMonth(curMonth);
    // 开始日是月末时，把每个月最后一天都算上（31 号不会在 2 月消失）
    const dayOk =
      cur.getDate() === start.getDate() ||
      (start.getDate() === startLast && cur.getDate() === curLast);
    if (!dayOk) return false;
    const months = (cur.getFullYear() - start.getFullYear()) * 12 + (cur.getMonth() - start.getMonth());
    return months % iv === 0;
  }

  if (r.freq === 'yearly') {
    if (cur.getMonth() !== start.getMonth()) return false;
    // 和「每月」同理：2 月 29 日的纪念日，在平年落到 2 月 28 日，而不是整年消失
    const startLast = daysInMonth(ev.date.slice(0, 7));
    const curMonth = dateKey.slice(0, 7);
    const curLast = daysInMonth(curMonth);
    const dayOk =
      cur.getDate() === start.getDate() ||
      (start.getDate() === startLast && cur.getDate() === curLast);
    if (!dayOk) return false;
    return (cur.getFullYear() - start.getFullYear()) % iv === 0;
  }

  return false;
}

/** 把一批日程在 [from, to] 区间内展开成有序的发生列表 */
export function expandRange(events: EventItem[], from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const total = daysBetween(from, to);
  // 上限 800 天：搜索要扫「过去 180 天 + 未来 365 天」，月视图 42 天，
  // 定太小会让搜索莫名其妙搜不到，定太大又会把重复日程展开成几万条。
  if (total < 0 || total > 800) return out;

  for (const ev of events) {
    for (let i = 0; i <= total; i += 1) {
      const date = addDays(from, i);
      if (!occursOn(ev, date)) continue;
      out.push({
        event: ev,
        date,
        key: `${ev.id}@${date}`,
        done: ev.recurrence?.freq === 'none' ? ev.done : ev.doneDates.includes(date),
      });
    }
  }

  return out.sort(compareOccurrence);
}

/** 全天在前、然后按开始时间，最后按标题 */
export function compareOccurrence(a: Occurrence, b: Occurrence): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const aa = a.event.allDay ? '' : a.event.startTime;
  const bb = b.event.allDay ? '' : b.event.startTime;
  if (aa !== bb) return aa < bb ? -1 : 1;
  return a.event.title.localeCompare(b.event.title);
}

/** 'HH:mm' → 一天中的分钟数，用于排序/比较 */
export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** 生成 6×7 = 42 天的月视图网格（从周一开始，含前后月的补白） */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** 某一周（从 key 所在周的周一开始）的 7 天 */
export function weekDays(key: string): string[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 把 'HH:mm' 与日期拼成 Date，用于通知 */
export function toDate(dateKey: string, time: string): Date {
  const d = parseDateKey(dateKey);
  const [h, m] = time.split(':').map(Number);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

/** 提醒时刻列表（已按时间排序，过去的时间会被过滤掉） */
export function reminderTimes(occ: Occurrence, now = new Date()): Date[] {
  const base = occ.event.allDay
    ? (() => {
        const d = parseDateKey(occ.date);
        d.setHours(9, 0, 0, 0); // 全天日程默认早上 9 点提醒
        return d;
      })()
    : toDate(occ.date, occ.event.startTime);

  return occ.event.reminders
    .map((min) => new Date(base.getTime() - min * 60000))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
}

export function newEvent(partial: Partial<EventItem> = {}): EventItem {
  const now = new Date().toISOString();
  return {
    id: newId('ev'),
    title: '',
    notes: '',
    location: '',
    date: toDateKey(new Date()),
    startTime: '09:00',
    endTime: '10:00',
    allDay: false,
    color: EVENT_COLORS[0],
    tag: '',
    recurrence: { ...NO_RECUR },
    reminders: [],
    done: false,
    doneDates: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/** 人类可读的重复说明，由界面层翻译；这里只给出「结构」 */
export function recurrenceShape(r: Recurrence): {
  freq: RecurFreq;
  interval: number;
  weekdays: number[];
} {
  return {
    freq: r?.freq ?? 'none',
    interval: Math.max(1, r?.interval ?? 1),
    weekdays: r?.weekdays ?? [],
  };
}

/** 某天有几条日程（月视图画点用） */
export function countByDate(occs: Occurrence[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const o of occs) m.set(o.date, (m.get(o.date) ?? 0) + 1);
  return m;
}
