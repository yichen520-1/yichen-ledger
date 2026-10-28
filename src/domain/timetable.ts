import { newId, toDateKey } from './model';
import { addDays, daysBetween, parseDateKey, startOfWeek } from './schedule';

/**
 * 课表的纯领域层。
 * 和 model.ts / schedule.ts 一样：不依赖 React、不依赖 Dexie，可以单独测。
 *
 * 为什么课表不直接复用「日程」：
 *   日程是「某一天某个时刻的一件事」，课表是「每周这个格子里固定有课」。
 *   用日程去表达一周五天的课，要么写五条重复日程，要么写一条带五个星期几的
 *   重复规则 —— 前者改一次要改五遍，后者没法表达「单双周」「第 3-16 周」。
 *   课表是另一个维度（星期 × 节次 × 周次），所以单独一套结构。
 */

/** 一节课的时段：第几节、几点到几点 */
export interface Period {
  /** 1 起 */
  index: number;
  /** 'HH:mm' */
  start: string;
  /** 'HH:mm' */
  end: string;
}

/** 单双周：all=每周，odd=单周，even=双周 */
export type WeekParity = 'all' | 'odd' | 'even';

/**
 * 一次上课：星期几、第几节到第几节、哪几周。
 *
 * 一门课可以有多个 session —— 比如「高等数学」周一 1-2 节、周三 3-4 节，
 * 是同一门课的两个时段，共用书名、老师、颜色。
 */
export interface CourseSession {
  /** 1=周一 … 7=周日（和 startOfWeek 的周一为一周之首对齐） */
  weekday: number;
  /** 1 起，含 */
  startPeriod: number;
  /** 1 起，含 */
  endPeriod: number;
  parity: WeekParity;
  /** 第几周开始 / 结束，1 起、含两端 */
  weekFrom: number;
  weekTo: number;
}

export interface Course {
  id: string;
  name: string;
  teacher: string;
  location: string;
  color: string;
  note: string;
  sessions: CourseSession[];
  createdAt: string;
  updatedAt: string;
}

/** 课表本身的一点设置：开学日期（用来算现在是第几周）与节次时间表 */
export interface TimetableMeta {
  /** 'YYYY-MM-DD'，开学第一周的周一 */
  termStart: string;
  /** 一学期多少周，算「第几周」时用来兜底 */
  totalWeeks: number;
  periods: Period[];
}

export const COURSE_COLORS = [
  '#5aa9f0',
  '#4cc38a',
  '#ffb454',
  '#f2645a',
  '#c96fb7',
  '#8a7cd6',
  '#3aa7a0',
  '#7f8cae',
];

/** 中国高校最常见的 12 节时间表。用户可以逐条改。 */
export function defaultPeriods(): Period[] {
  const raw: Array<[string, string]> = [
    ['08:00', '08:45'],
    ['08:55', '09:40'],
    ['10:00', '10:45'],
    ['10:55', '11:40'],
    ['14:00', '14:45'],
    ['14:55', '15:40'],
    ['16:00', '16:45'],
    ['16:55', '17:40'],
    ['19:00', '19:45'],
    ['19:55', '20:40'],
    ['20:50', '21:35'],
    ['21:45', '22:30'],
  ];
  return raw.map(([start, end], i) => ({ index: i + 1, start, end }));
}

export function defaultTimetableMeta(): TimetableMeta {
  return {
    // 默认开学日取「本周周一」，这样第一次打开时是第 1 周，不至于一进来就是第 37 周
    termStart: startOfWeek(toDateKey(new Date())),
    totalWeeks: 20,
    periods: defaultPeriods(),
  };
}

export function newCourse(partial: Partial<Course> = {}): Course {
  const now = new Date().toISOString();
  return {
    id: newId('co'),
    name: '',
    teacher: '',
    location: '',
    color: COURSE_COLORS[0],
    note: '',
    sessions: [
      { weekday: 1, startPeriod: 1, endPeriod: 2, parity: 'all', weekFrom: 1, weekTo: 16 },
    ],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

/* ---------------------------------------------------------------- 周次 */

/**
 * 某个日期是第几周（1 起）。
 *
 * 以开学那周的周一为第 1 周的周一，按「相差几周」算。
 * 开学前返回 0 或负数 —— 调用方自己决定怎么显示（课表页显示「未开学」）。
 */
export function weekNoOf(termStart: string, dateKey: string): number {
  const base = startOfWeek(termStart);
  const diff = daysBetween(base, startOfWeek(dateKey));
  return Math.floor(diff / 7) + 1;
}

/** 第 n 周周一的日期 */
export function weekStartOf(termStart: string, weekNo: number): string {
  return addDays(startOfWeek(termStart), (weekNo - 1) * 7);
}

/** 这个学期一共有多少周（按 meta 算，至少 1） */
export function totalWeeksOf(meta: TimetableMeta): number {
  return Math.max(1, Math.floor(meta.totalWeeks) || 1);
}

/** 把周次夹到 [1, totalWeeks] */
export function clampWeek(meta: TimetableMeta, weekNo: number): number {
  const total = totalWeeksOf(meta);
  if (!Number.isFinite(weekNo)) return 1;
  return Math.min(total, Math.max(1, Math.round(weekNo)));
}

/* ---------------------------------------------------------------- 单双周 */

export function parityMatches(parity: WeekParity, weekNo: number): boolean {
  if (parity === 'odd') return weekNo % 2 === 1;
  if (parity === 'even') return weekNo % 2 === 0;
  return true;
}

/** 这一节课在这一周上不上 */
export function sessionActive(session: CourseSession, weekNo: number): boolean {
  if (weekNo < session.weekFrom || weekNo > session.weekTo) return false;
  return parityMatches(session.parity, weekNo);
}

/**
 * 某节课在某几周上 —— 用来在表单里预览「这学期一共上 N 次」。
 * 返回周次列表，升序。
 */
export function sessionWeeks(session: CourseSession, totalWeeks: number): number[] {
  const from = Math.max(1, Math.min(session.weekFrom, session.weekTo));
  const to = Math.min(totalWeeks, Math.max(session.weekFrom, session.weekTo));
  const out: number[] = [];
  for (let w = from; w <= to; w += 1) if (parityMatches(session.parity, w)) out.push(w);
  return out;
}

/** 「1-16周 单周」这种人话的中间形态，界面层负责翻译 */
export function weekSpanText(session: CourseSession): string {
  return `${session.weekFrom}-${session.weekTo}|${session.parity}`;
}

/* ---------------------------------------------------------------- 网格 */

/** 一个格子：星期几的第几节 */
export interface CellRef {
  weekday: number;
  period: number;
}

export interface PlacedCourse {
  course: Course;
  session: CourseSession;
  weekday: number;
  startPeriod: number;
  endPeriod: number;
}

/**
 * 某一周的课表：把每门课展开成「块」，按星期几分组。
 *
 * 一个块可能跨 2~4 节（高数连着上两节），所以返回的是**块**而不是格子 ——
 * 界面上一个块占一行里连续的几个格子，用 grid-row 跨行渲染。
 */
export function weekBlocks(courses: Course[], weekNo: number): PlacedCourse[] {
  const out: PlacedCourse[] = [];
  for (const c of courses) {
    for (const s of c.sessions ?? []) {
      if (!sessionActive(s, weekNo)) continue;
      out.push({
        course: c,
        session: s,
        weekday: s.weekday,
        startPeriod: Math.min(s.startPeriod, s.endPeriod),
        endPeriod: Math.max(s.startPeriod, s.endPeriod),
      });
    }
  }
  // 同一天里先上的排前面；同一节再按名字，保证渲染顺序稳定
  return out.sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.startPeriod - b.startPeriod ||
      a.course.name.localeCompare(b.course.name, 'zh-CN'),
  );
}

/** 某天（1=周一…7=周日）有几门课，日历上画点用 */
export function countByWeekday(blocks: PlacedCourse[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const b of blocks) m.set(b.weekday, (m.get(b.weekday) ?? 0) + 1);
  return m;
}

/* ---------------------------------------------------------------- 时间 */

/** 取若干节的起止时间：第 1 节到第 2 节 → ['08:00','09:40'] */
export function periodSpan(periods: Period[], startPeriod: number, endPeriod: number): { start: string; end: string } {
  const a = periods.find((p) => p.index === Math.min(startPeriod, endPeriod));
  const b = periods.find((p) => p.index === Math.max(startPeriod, endPeriod));
  return { start: a?.start ?? '08:00', end: b?.end ?? '09:40' };
}

/** 现在这一格算不算「正在上」：同一天、同一节 */
export function isOngoing(now: Date, periods: Period[], block: PlacedCourse): boolean {
  const weekday = ((now.getDay() + 6) % 7) + 1;
  if (block.weekday !== weekday) return false;
  const { start, end } = periodSpan(periods, block.startPeriod, block.endPeriod);
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return hm >= start && hm <= end;
}

/* ---------------------------------------------------------------- 冲突 */

export interface Conflict {
  a: Course;
  b: Course;
  weekday: number;
  /** 重叠的节次区间 */
  from: number;
  to: number;
  /** 重叠的周次（取交集后的一段，够用来提示） */
  weeks: number[];
}

function sessionOverlap(a: CourseSession, b: CourseSession): number[] {
  if (a.weekday !== b.weekday) return [];
  const pFrom = Math.max(Math.min(a.startPeriod, a.endPeriod), Math.min(b.startPeriod, b.endPeriod));
  const pTo = Math.min(Math.max(a.startPeriod, a.endPeriod), Math.max(b.startPeriod, b.endPeriod));
  if (pFrom > pTo) return [];
  const wFrom = Math.max(a.weekFrom, b.weekFrom);
  const wTo = Math.min(a.weekTo, b.weekTo);
  if (wFrom > wTo) return [];
  const weeks: number[] = [];
  for (let w = wFrom; w <= wTo; w += 1) {
    if (parityMatches(a.parity, w) && parityMatches(b.parity, w)) weeks.push(w);
  }
  return weeks;
}

/**
 * 找出时间冲突的课。
 *
 * 为什么要做这件事：手填课表最容易出的错就是把两门课排在同一格，
 * 而界面上一个格子只画得下一个块 —— 后画的会把先画的盖住，看起来像「课没了」。
 * 与其让人自己发现，不如排完就告诉他。
 */
export function findConflicts(courses: Course[]): Conflict[] {
  const out: Conflict[] = [];
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      const a = courses[i];
      const b = courses[j];
      for (const sa of a.sessions ?? []) {
        for (const sb of b.sessions ?? []) {
          const weeks = sessionOverlap(sa, sb);
          if (!weeks.length) continue;
          out.push({
            a,
            b,
            weekday: sa.weekday,
            from: Math.max(Math.min(sa.startPeriod, sa.endPeriod), Math.min(sb.startPeriod, sb.endPeriod)),
            to: Math.min(Math.max(sa.startPeriod, sa.endPeriod), Math.max(sb.startPeriod, sb.endPeriod)),
            weeks,
          });
        }
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 提醒 */

export interface CourseOccurrence {
  course: Course;
  session: CourseSession;
  /** 'YYYY-MM-DD' */
  date: string;
  /** `${course.id}@${date}@${startPeriod}` */
  key: string;
  startTime: string;
  endTime: string;
}

/**
 * 把课表在 [from, to] 区间内展开成「哪天几点上什么课」。
 *
 * 和日程的 expandRange 对应，但它算的是「第几周 + 星期几」而不是重复规则。
 * 上限同样是 800 天 —— 再多就不是课表该干的事了。
 */
export function courseOccurrences(
  courses: Course[],
  meta: TimetableMeta,
  from: string,
  to: string,
): CourseOccurrence[] {
  const total = daysBetween(from, to);
  if (total < 0 || total > 800) return [];
  const out: CourseOccurrence[] = [];

  for (let i = 0; i <= total; i += 1) {
    const date = addDays(from, i);
    const weekNo = weekNoOf(meta.termStart, date);
    if (weekNo < 1) continue;
    const weekday = ((parseDateKey(date).getDay() + 6) % 7) + 1;
    for (const c of courses) {
      for (const s of c.sessions ?? []) {
        if (s.weekday !== weekday) continue;
        if (!sessionActive(s, weekNo)) continue;
        const { start, end } = periodSpan(meta.periods, s.startPeriod, s.endPeriod);
        out.push({
          course: c,
          session: s,
          date,
          key: `${c.id}@${date}@${Math.min(s.startPeriod, s.endPeriod)}`,
          startTime: start,
          endTime: end,
        });
      }
    }
  }

  return out.sort(
    (a, b) =>
      (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
      (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0),
  );
}

/** 今天还剩几节课（首页/课表页顶部那句「今天还有 N 节」） */
export function todayRemaining(occs: CourseOccurrence[], now: Date): CourseOccurrence[] {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return occs.filter((o) => o.endTime >= hm);
}
