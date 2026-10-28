import { describe, expect, it } from 'vitest';
import {
  clampWeek,
  courseOccurrences,
  defaultPeriods,
  defaultTimetableMeta,
  findConflicts,
  isOngoing,
  newCourse,
  parityMatches,
  periodSpan,
  sessionActive,
  sessionWeeks,
  todayRemaining,
  totalWeeksOf,
  weekBlocks,
  weekNoOf,
  weekStartOf,
  type Course,
  type CourseSession,
  type TimetableMeta,
} from '../src/domain/timetable';
import { findPeriods, findWeekdays, findWeeks, parseTimetableText } from '../src/domain/timetableOcr';

/* ------------------------------------------------------------------ 工具 */

function sess(partial: Partial<CourseSession> = {}): CourseSession {
  return { weekday: 1, startPeriod: 1, endPeriod: 2, parity: 'all', weekFrom: 1, weekTo: 16, ...partial };
}

function course(name: string, sessions: CourseSession[], partial: Partial<Course> = {}): Course {
  return { ...newCourse({ name, sessions }), ...partial };
}

function meta(termStart = '2024-09-02', totalWeeks = 20): TimetableMeta {
  return { termStart, totalWeeks, periods: defaultPeriods() };
}

/* ------------------------------------------------------------------ 周次 */

describe('周次换算', () => {
  it('开学那周是第 1 周', () => {
    // 2024-09-02 是周一
    expect(weekNoOf('2024-09-02', '2024-09-02')).toBe(1);
    expect(weekNoOf('2024-09-02', '2024-09-08')).toBe(1);
  });

  it('跨周递增，开学前是 0 或负数', () => {
    expect(weekNoOf('2024-09-02', '2024-09-09')).toBe(2);
    expect(weekNoOf('2024-09-02', '2024-09-30')).toBe(5);
    expect(weekNoOf('2024-09-02', '2024-08-26')).toBe(0);
    expect(weekNoOf('2024-09-02', '2024-08-19')).toBe(-1);
  });

  it('开学日给的是周中某天时，也对齐到那一周的周一', () => {
    // 2024-09-04 是周三，第 2 周仍从 09-09 算起
    expect(weekStartOf('2024-09-04', 1)).toBe('2024-09-02');
    expect(weekStartOf('2024-09-04', 2)).toBe('2024-09-09');
    expect(weekNoOf('2024-09-04', '2024-09-11')).toBe(2);
  });

  it('clampWeek 夹在 1..总周数 之间', () => {
    const m = meta('2024-09-02', 18);
    expect(clampWeek(m, 0)).toBe(1);
    expect(clampWeek(m, 5)).toBe(5);
    expect(clampWeek(m, 99)).toBe(18);
    expect(clampWeek(m, Number.NaN)).toBe(1);
  });

  it('totalWeeksOf 至少是 1', () => {
    expect(totalWeeksOf(meta('2024-09-02', 0))).toBe(1);
    expect(totalWeeksOf(meta('2024-09-02', 16))).toBe(16);
  });
});

/* ------------------------------------------------------------------ 单双周 */

describe('单双周', () => {
  it('parityMatches', () => {
    expect(parityMatches('all', 1)).toBe(true);
    expect(parityMatches('all', 2)).toBe(true);
    expect(parityMatches('odd', 1)).toBe(true);
    expect(parityMatches('odd', 2)).toBe(false);
    expect(parityMatches('even', 2)).toBe(true);
    expect(parityMatches('even', 3)).toBe(false);
  });

  it('sessionActive 同时看周次区间与单双周', () => {
    const s = sess({ weekFrom: 3, weekTo: 9, parity: 'odd' });
    expect(sessionActive(s, 2)).toBe(false); // 区间外
    expect(sessionActive(s, 3)).toBe(true); // 区间内且是单周
    expect(sessionActive(s, 4)).toBe(false); // 区间内但双周
    expect(sessionActive(s, 5)).toBe(true);
    expect(sessionActive(s, 9)).toBe(true);
    expect(sessionActive(s, 10)).toBe(false); // 区间外
  });

  it('sessionWeeks 展开成具体周次', () => {
    expect(sessionWeeks(sess({ weekFrom: 1, weekTo: 6, parity: 'odd' }), 20)).toEqual([1, 3, 5]);
    expect(sessionWeeks(sess({ weekFrom: 1, weekTo: 6, parity: 'even' }), 20)).toEqual([2, 4, 6]);
    expect(sessionWeeks(sess({ weekFrom: 1, weekTo: 4 }), 20)).toEqual([1, 2, 3, 4]);
    // 超出学期总周数的那部分要截掉
    expect(sessionWeeks(sess({ weekFrom: 1, weekTo: 30 }), 16)).toHaveLength(16);
  });
});

/* ------------------------------------------------------------------ 网格 */

describe('一周的课块', () => {
  const courses: Course[] = [
    course('高等数学', [sess({ weekday: 1, startPeriod: 1, endPeriod: 2 })]),
    course('线性代数', [sess({ weekday: 1, startPeriod: 3, endPeriod: 4, parity: 'odd' })]),
    course('大学英语', [sess({ weekday: 3, startPeriod: 5, endPeriod: 6 })]),
  ];

  it('只展开这一周真正要上的课', () => {
    const w1 = weekBlocks(courses, 1);
    expect(w1.map((b) => b.course.name)).toEqual(['高等数学', '线性代数', '大学英语']);
    // 第 2 周线代是双周，不上
    expect(weekBlocks(courses, 2).map((b) => b.course.name)).toEqual(['高等数学', '大学英语']);
  });

  it('排序稳定：先按星期、再按起始节', () => {
    const w3 = weekBlocks(courses, 3);
    expect(w3.map((b) => b.course.name)).toEqual(['高等数学', '线性代数', '大学英语']);
    expect(w3.map((b) => b.weekday)).toEqual([1, 1, 3]);
  });

  it('起止节反着填也能摆正', () => {
    const bad = course('倒着填', [sess({ startPeriod: 4, endPeriod: 2 })]);
    const [b] = weekBlocks([bad], 1);
    expect(b.startPeriod).toBe(2);
    expect(b.endPeriod).toBe(4);
  });
});

/* ------------------------------------------------------------------ 时间 */

describe('节次与时间', () => {
  const periods = defaultPeriods();

  it('periodSpan 取首节的开始与末节的结束', () => {
    expect(periodSpan(periods, 1, 2)).toEqual({ start: '08:00', end: '09:40' });
    expect(periodSpan(periods, 5, 5)).toEqual({ start: '14:00', end: '14:45' });
  });

  it('isOngoing 只在同一天且落在时段内时为真', () => {
    const block = weekBlocks([course('课', [sess({ weekday: 1, startPeriod: 1, endPeriod: 2 })])], 1)[0];
    // 2024-09-02 是周一
    expect(isOngoing(new Date(2024, 8, 2, 8, 30), periods, block)).toBe(true);
    expect(isOngoing(new Date(2024, 8, 2, 9, 30), periods, block)).toBe(true);
    expect(isOngoing(new Date(2024, 8, 2, 7, 30), periods, block)).toBe(false);
    expect(isOngoing(new Date(2024, 8, 2, 9, 50), periods, block)).toBe(false);
    // 周二同一时刻不算
    expect(isOngoing(new Date(2024, 8, 3, 8, 30), periods, block)).toBe(false);
  });
});

/* ------------------------------------------------------------------ 冲突 */

describe('时间冲突', () => {
  it('同一格的两门课会被找出来', () => {
    const a = course('高数', [sess({ weekday: 2, startPeriod: 1, endPeriod: 2 })]);
    const b = course('物理', [sess({ weekday: 2, startPeriod: 2, endPeriod: 3 })]);
    const found = findConflicts([a, b]);
    expect(found).toHaveLength(1);
    expect(found[0].weekday).toBe(2);
    expect(found[0].from).toBe(2);
    expect(found[0].to).toBe(2);
  });

  it('节次不重叠就不算冲突', () => {
    const a = course('高数', [sess({ weekday: 2, startPeriod: 1, endPeriod: 2 })]);
    const b = course('物理', [sess({ weekday: 2, startPeriod: 3, endPeriod: 4 })]);
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it('单双周错开的课不算冲突', () => {
    const a = course('高数', [sess({ weekday: 2, startPeriod: 1, endPeriod: 2, parity: 'odd' })]);
    const b = course('物理', [sess({ weekday: 2, startPeriod: 1, endPeriod: 2, parity: 'even' })]);
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it('周次区间不相交也不算冲突', () => {
    const a = course('前半学期', [sess({ weekday: 2, weekFrom: 1, weekTo: 8 })]);
    const b = course('后半学期', [sess({ weekday: 2, weekFrom: 9, weekTo: 16 })]);
    expect(findConflicts([a, b])).toHaveLength(0);
  });

  it('冲突里带着重叠的周次，便于提示', () => {
    const a = course('甲', [sess({ weekday: 4, startPeriod: 5, endPeriod: 6, weekFrom: 1, weekTo: 10 })]);
    const b = course('乙', [sess({ weekday: 4, startPeriod: 5, endPeriod: 6, weekFrom: 6, weekTo: 16 })]);
    const [c] = findConflicts([a, b]);
    expect(c.weeks).toEqual([6, 7, 8, 9, 10]);
  });
});

/* ------------------------------------------------------------------ 展开 */

describe('课表展开成具体日期', () => {
  const m = meta('2024-09-02', 20);
  const courses = [course('高数', [sess({ weekday: 1, startPeriod: 1, endPeriod: 2, weekTo: 4 })])];

  it('每个周一都有一条', () => {
    const occs = courseOccurrences(courses, m, '2024-09-02', '2024-09-29');
    expect(occs.map((o) => o.date)).toEqual(['2024-09-02', '2024-09-09', '2024-09-16', '2024-09-23']);
    expect(occs[0].startTime).toBe('08:00');
    expect(occs[0].endTime).toBe('09:40');
  });

  it('超出周次区间的不再展开', () => {
    const occs = courseOccurrences(courses, m, '2024-09-23', '2024-10-20');
    // 第 5 周（09-30）之后就没有这门课了
    expect(occs.map((o) => o.date)).toEqual(['2024-09-23']);
  });

  it('开学前的日期不产生课', () => {
    expect(courseOccurrences(courses, m, '2024-08-01', '2024-08-31')).toHaveLength(0);
  });

  it('区间超过 800 天直接返回空，防止把整个世纪展开一遍', () => {
    expect(courseOccurrences(courses, m, '2024-09-02', '2030-01-01')).toEqual([]);
  });

  it('todayRemaining 只留还没下课的', () => {
    const occs = courseOccurrences(
      [course('一天四节', [
        sess({ weekday: 1, startPeriod: 1, endPeriod: 2 }),
        sess({ weekday: 1, startPeriod: 5, endPeriod: 6 }),
      ])],
      m,
      '2024-09-02',
      '2024-09-02',
    );
    expect(occs).toHaveLength(2);
    const left = todayRemaining(occs, new Date(2024, 8, 2, 9, 0));
    expect(left).toHaveLength(2); // 9:00 时第一节还没下课
    expect(todayRemaining(occs, new Date(2024, 8, 2, 9, 45))).toHaveLength(1);
    expect(todayRemaining(occs, new Date(2024, 8, 2, 16, 0))).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ 默认值 */

describe('默认设置', () => {
  it('默认 12 节，时间递增', () => {
    const p = defaultPeriods();
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ index: 1, start: '08:00', end: '08:45' });
    for (let i = 1; i < p.length; i += 1) expect(p[i].index).toBe(i + 1);
  });

  it('默认开学日是本周周一', () => {
    const m = defaultTimetableMeta();
    expect(m.termStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(weekNoOf(m.termStart, m.termStart)).toBe(1);
  });
});

/* ------------------------------------------------------------------ 识别 */

describe('课表文字识别', () => {
  it('认星期几', () => {
    expect(findWeekdays('周一 1-2节')).toEqual([1]);
    expect(findWeekdays('周三、周五')).toEqual([3, 5]);
    expect(findWeekdays('星期日')).toEqual([7]);
    expect(findWeekdays('周天')).toEqual([7]);
    expect(findWeekdays('今天天气不错')).toEqual([]);
  });

  it('认节次', () => {
    expect(findPeriods('第1-2节')).toEqual({ from: 1, to: 2 });
    expect(findPeriods('3~4节')).toEqual({ from: 3, to: 4 });
    expect(findPeriods('第5节')).toEqual({ from: 5, to: 5 });
    expect(findPeriods('高等数学')).toBeNull();
  });

  it('认周次与单双周', () => {
    expect(findWeeks('1-16周')).toEqual({ from: 1, to: 16, parity: 'all' });
    expect(findWeeks('第3-8周(单)')).toEqual({ from: 3, to: 8, parity: 'odd' });
    expect(findWeeks('双周')).toEqual({ from: 1, to: 30, parity: 'even' });
    expect(findWeeks('高等数学')).toBeNull();
  });

  it('一行一门课', () => {
    const text = ['周一 第1-2节 高等数学 张三 A101 1-16周', '周三 第5-6节 大学英语 李四 B203 1-16周'].join('\n');
    const found = parseTimetableText(text, { totalWeeks: 16 });
    expect(found).toHaveLength(2);
    // 结果按课程名排序（zh-CN 拼音序），所以按名字取而不是按下标取
    const byName = new Map(found.map((c) => [c.name, c]));
    const math = byName.get('高等数学');
    const english = byName.get('大学英语');
    expect(math?.location).toBe('A101');
    expect(math?.sessions[0]).toMatchObject({ weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16 });
    expect(english?.sessions[0]).toMatchObject({ weekday: 3, startPeriod: 5, endPeriod: 6 });
  });

  it('同名多行合并成一门课的多时段', () => {
    const text = ['周一 第1-2节 高等数学 1-16周', '周四 第3-4节 高等数学 1-16周'].join('\n');
    const found = parseTimetableText(text, { totalWeeks: 16 });
    expect(found).toHaveLength(1);
    expect(found[0].sessions).toHaveLength(2);
  });

  it('表头行不会被当成课', () => {
    const text = ['课程表', '节次 时间 星期一 星期二', '周一 第1-2节 高等数学 1-16周'].join('\n');
    const found = parseTimetableText(text, { totalWeeks: 16 });
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe('高等数学');
  });

  it('整段文字没有课程时返回空数组', () => {
    expect(parseTimetableText('今天天气不错\n记得带伞')).toEqual([]);
  });
});
