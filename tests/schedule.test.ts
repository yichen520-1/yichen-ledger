import { describe, expect, it } from 'vitest';
import {
  addDays,
  countByDate,
  daysBetween,
  expandRange,
  monthGrid,
  newEvent,
  occursOn,
  reminderTimes,
  startOfWeek,
  toDate,
  weekDays,
  weekdayMon0,
  type EventItem,
} from '../src/domain/schedule';
import { parseScheduleText, findDate, findTimeRange } from '../src/domain/ocr';

function ev(partial: Partial<EventItem>): EventItem {
  return { ...newEvent(), ...partial };
}

describe('日期工具', () => {
  it('addDays 跨月跨年', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    expect(addDays('2024-01-01', -1)).toBe('2023-12-31');
  });

  it('daysBetween 正负都成立', () => {
    expect(daysBetween('2024-01-01', '2024-01-31')).toBe(30);
    expect(daysBetween('2024-01-31', '2024-01-01')).toBe(-30);
    expect(daysBetween('2024-01-01', '2024-01-01')).toBe(0);
  });

  it('一周从周一开始', () => {
    // 2024-10-27 是周日
    expect(startOfWeek('2024-10-27')).toBe('2024-10-21');
    expect(startOfWeek('2024-10-21')).toBe('2024-10-21');
    expect(weekdayMon0('2024-10-27')).toBe(6);
    expect(weekdayMon0('2024-10-21')).toBe(0);
    expect(weekDays('2024-10-27')).toEqual([
      '2024-10-21',
      '2024-10-22',
      '2024-10-23',
      '2024-10-24',
      '2024-10-25',
      '2024-10-26',
      '2024-10-27',
    ]);
  });

  it('monthGrid 是 42 格、周一起、含上下月', () => {
    const g = monthGrid('2024-10');
    expect(g).toHaveLength(42);
    expect(g[0]).toBe('2024-09-30');
    expect(g[g.length - 1]).toBe('2024-11-10');
    expect(g).toContain('2024-10-01');
    expect(g).toContain('2024-10-31');
  });

  it('toDate 把日期与时间拼成本地时间', () => {
    const d = toDate('2024-10-28', '14:30');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(9);
    expect(d.getDate()).toBe(28);
    expect(d.getHours()).toBe(14);
    expect(d.getMinutes()).toBe(30);
  });
});

describe('重复规则', () => {
  it('不重复只命中那一天', () => {
    const e = ev({ date: '2024-10-28' });
    expect(occursOn(e, '2024-10-28')).toBe(true);
    expect(occursOn(e, '2024-10-29')).toBe(false);
  });

  it('每天 / 每两天', () => {
    const e = ev({ date: '2024-10-28', recurrence: { freq: 'daily', interval: 1, weekdays: [], until: null } });
    expect(occursOn(e, '2024-10-29')).toBe(true);
    expect(occursOn(e, '2024-11-30')).toBe(true);
    expect(occursOn(e, '2024-10-27')).toBe(false);

    const e2 = ev({ date: '2024-10-28', recurrence: { freq: 'daily', interval: 2, weekdays: [], until: null } });
    expect(occursOn(e2, '2024-10-28')).toBe(true);
    expect(occursOn(e2, '2024-10-30')).toBe(true);
    expect(occursOn(e2, '2024-10-29')).toBe(false);
  });

  it('每周 + 指定星期', () => {
    // 2024-10-28 是周一
    const e = ev({
      date: '2024-10-28',
      recurrence: { freq: 'weekly', interval: 1, weekdays: [1, 3], until: null },
    });
    expect(occursOn(e, '2024-10-28')).toBe(true); // 周一
    expect(occursOn(e, '2024-10-30')).toBe(true); // 周三
    expect(occursOn(e, '2024-10-29')).toBe(false); // 周二
    expect(occursOn(e, '2024-11-04')).toBe(true); // 下周一
  });

  it('每周隔周', () => {
    const e = ev({
      date: '2024-10-28',
      recurrence: { freq: 'weekly', interval: 2, weekdays: [1], until: null },
    });
    expect(occursOn(e, '2024-10-28')).toBe(true);
    expect(occursOn(e, '2024-11-04')).toBe(false);
    expect(occursOn(e, '2024-11-11')).toBe(true);
  });

  it('每月：31 号在短月落到月末', () => {
    const e = ev({ date: '2024-01-31', recurrence: { freq: 'monthly', interval: 1, weekdays: [], until: null } });
    expect(occursOn(e, '2024-02-29')).toBe(true);
    expect(occursOn(e, '2024-02-28')).toBe(false);
    expect(occursOn(e, '2024-04-30')).toBe(true);
    expect(occursOn(e, '2024-03-31')).toBe(true);
    expect(occursOn(e, '2024-03-30')).toBe(false);
  });

  it('每月 15 号不受短月影响', () => {
    const e = ev({ date: '2024-01-15', recurrence: { freq: 'monthly', interval: 1, weekdays: [], until: null } });
    expect(occursOn(e, '2024-02-15')).toBe(true);
    expect(occursOn(e, '2024-02-29')).toBe(false);
  });

  it('每年', () => {
    const e = ev({ date: '2024-02-29', recurrence: { freq: 'yearly', interval: 1, weekdays: [], until: null } });
    expect(occursOn(e, '2025-02-28')).toBe(true); // 平年落到 28
    expect(occursOn(e, '2028-02-29')).toBe(true);
    expect(occursOn(e, '2024-03-01')).toBe(false);
  });

  it('until 之后不再出现', () => {
    const e = ev({
      date: '2024-10-28',
      recurrence: { freq: 'daily', interval: 1, weekdays: [], until: '2024-10-30' },
    });
    expect(occursOn(e, '2024-10-30')).toBe(true);
    expect(occursOn(e, '2024-10-31')).toBe(false);
  });
});

describe('expandRange', () => {
  it('只返回区间内的发生，按时间排序', () => {
    const a = ev({ id: 'a', title: '早会', date: '2024-10-28', startTime: '09:00', endTime: '09:30' });
    const b = ev({ id: 'b', title: '复盘', date: '2024-10-28', startTime: '14:00', endTime: '15:00' });
    const c = ev({ id: 'c', title: '全天', date: '2024-10-28', allDay: true });
    const out = expandRange([b, c, a], '2024-10-28', '2024-10-28');
    expect(out.map((o) => o.event.id)).toEqual(['c', 'a', 'b']);
    expect(out.every((o) => o.date === '2024-10-28')).toBe(true);
  });

  it('重复日程在区间内展开成多条', () => {
    const e = ev({ id: 'r', date: '2024-10-28', recurrence: { freq: 'daily', interval: 1, weekdays: [], until: null } });
    const out = expandRange([e], '2024-10-28', '2024-11-01');
    expect(out).toHaveLength(5);
    expect(out.map((o) => o.date)).toEqual([
      '2024-10-28',
      '2024-10-29',
      '2024-10-30',
      '2024-10-31',
      '2024-11-01',
    ]);
  });

  it('done 标记跟着 doneDates 走', () => {
    const e = ev({
      id: 'r',
      date: '2024-10-28',
      recurrence: { freq: 'daily', interval: 1, weekdays: [], until: null },
      doneDates: ['2024-10-29'],
    });
    const out = expandRange([e], '2024-10-28', '2024-10-30');
    expect(out.map((o) => o.done)).toEqual([false, true, false]);
  });

  it('countByDate 统计每天条数', () => {
    const a = ev({ id: 'a', date: '2024-10-28' });
    const b = ev({ id: 'b', date: '2024-10-28' });
    const c = ev({ id: 'c', date: '2024-10-29' });
    const m = countByDate(expandRange([a, b, c], '2024-10-28', '2024-10-30'));
    expect(m.get('2024-10-28')).toBe(2);
    expect(m.get('2024-10-29')).toBe(1);
    expect(m.get('2024-10-30')).toBeUndefined();
  });
});

describe('提醒时刻', () => {
  it('提前 N 分钟', () => {
    const e = ev({ date: '2024-10-28', startTime: '10:00', endTime: '11:00', reminders: [15] });
    const occ = { event: e, date: '2024-10-28', key: 'x', done: false };
    const times = reminderTimes(occ, new Date(2024, 9, 27, 12, 0));
    expect(times).toHaveLength(1);
    expect(times[0].getHours()).toBe(9);
    expect(times[0].getMinutes()).toBe(45);
  });

  it('全天日程默认早上 9 点提醒', () => {
    const e = ev({ date: '2024-10-28', allDay: true, reminders: [0] });
    const occ = { event: e, date: '2024-10-28', key: 'x', done: false };
    const times = reminderTimes(occ, new Date(2024, 9, 27, 12, 0));
    expect(times[0].getHours()).toBe(9);
  });

  it('已经过去的时刻不再返回', () => {
    const e = ev({ date: '2024-10-28', startTime: '10:00', endTime: '11:00', reminders: [15] });
    const occ = { event: e, date: '2024-10-28', key: 'x', done: false };
    expect(reminderTimes(occ, new Date(2024, 9, 28, 23, 0))).toHaveLength(0);
  });
});

describe('从文字里认日程', () => {
  it('认日期', () => {
    expect(findDate('2024-10-28 开会', '2024-01-01')).toBe('2024-10-28');
    expect(findDate('10月28日 开会', '2024-01-01')).toBe('2024-10-28');
    expect(findDate('10/28 开会', '2024-01-01')).toBe('2024-10-28');
    expect(findDate('没有日期的一行', '2024-01-01')).toBeNull();
  });

  it('认时间段', () => {
    expect(findTimeRange('14:00-15:00 对稿')).toEqual({ start: '14:00', end: '15:00' });
    expect(findTimeRange('14:00~15:30 对稿')).toEqual({ start: '14:00', end: '15:30' });
    expect(findTimeRange('下午 2 点 开会')).toEqual({ start: '14:00', end: '15:00' });
    expect(findTimeRange('9点30 站会')).toEqual({ start: '09:30', end: '10:30' });
    expect(findTimeRange('只有标题')).toBeNull();
  });

  it('整段解析：日期上下文 + 多行日程', () => {
    const text = [
      '10月28日 周一',
      '09:00-09:30 早会 @会议室A',
      '14:00-15:00 和设计对稿',
      '10月29日',
      '16:00-17:00 复盘',
    ].join('\n');
    const out = parseScheduleText(text, '2024-10-01');
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ title: '早会', date: '2024-10-28', startTime: '09:00', endTime: '09:30', location: '会议室A' });
    expect(out[1]).toMatchObject({ title: '和设计对稿', date: '2024-10-28' });
    expect(out[2]).toMatchObject({ title: '复盘', date: '2024-10-29' });
  });

  it('只有日期没时间 → 全天', () => {
    const out = parseScheduleText('2024-10-28 交房租', '2024-10-01');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: '交房租', date: '2024-10-28', allDay: true });
  });

  it('纯噪声不会产出候选', () => {
    expect(parseScheduleText('随便一段没有日期也没有时间的话', '2024-10-01')).toHaveLength(0);
  });
});
