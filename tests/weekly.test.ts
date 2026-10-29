import { describe, it, expect } from 'vitest';
import { lastTransaction, recentShapes, templateFromTransaction, upsertTemplate } from '../src/domain/quick';
import type { Transaction } from '../src/domain/model';
import {
  monthOfWeek,
  nextWeek,
  prevWeek,
  weekFacts,
  weekPlainText,
  weekRangeOf,
  weekSchedule,
  weekStats,
} from '../src/domain/weekly';
import type { EventItem } from '../src/domain/schedule';

const tx = (over: Partial<Transaction>): Transaction => ({
  id: Math.random().toString(36).slice(2),
  type: 'expense',
  amount: 1000,
  categoryId: 'c-food',
  accountId: 'a-bank',
  toAccountId: null,
  date: '2024-03-10',
  note: '',
  tags: [],
  createdAt: '2024-03-10T00:00:00.000Z',
  updatedAt: '2024-03-10T00:00:00.000Z',
  ...over,
});

describe('快捷记账', () => {
  it('「和上次一样」取最新那一笔，不做聚合', () => {
    const rows = [
      tx({ id: 'a', date: '2024-03-01', amount: 1000 }),
      tx({ id: 'b', date: '2024-03-05', amount: 2500 }),
      tx({ id: 'c', date: '2024-03-03', amount: 900 }),
    ];
    expect(lastTransaction(rows)?.id).toBe('b');
  });

  it('同一天按 createdAt 取更晚的', () => {
    const rows = [
      tx({ id: 'a', date: '2024-03-05', createdAt: '2024-03-05T01:00:00.000Z' }),
      tx({ id: 'b', date: '2024-03-05', createdAt: '2024-03-05T09:00:00.000Z' }),
    ];
    expect(lastTransaction(rows)?.id).toBe('b');
  });

  it('空账本没有「上次」', () => {
    expect(lastTransaction([])).toBeNull();
  });

  it('最近记过的形状按 类型+分类+金额 去重，跳过转账', () => {
    const rows = [
      tx({ id: 'a', amount: 1000, categoryId: 'c-food' }),
      tx({ id: 'b', amount: 1000, categoryId: 'c-food' }),
      tx({ id: 'c', amount: 2000, categoryId: 'c-food' }),
      tx({ id: 'd', type: 'transfer', amount: 5000, categoryId: null }),
    ];
    const shapes = recentShapes(rows);
    expect(shapes.map((x) => x.id).sort()).toEqual(['a', 'c']);
    expect(shapes.some((x) => x.type === 'transfer')).toBe(false);
  });

  it('模板从账目生成', () => {
    const tpl = templateFromTransaction(tx({ amount: 2500, note: '午饭', tags: ['工作日'] }), '午饭', 'tpl-1');
    expect(tpl.id).toBe('tpl-1');
    expect(tpl.name).toBe('午饭');
    expect(tpl.amount).toBe(2500);
    expect(tpl.tags).toEqual(['工作日']);
  });

  it('同名模板替换而不是并排两份', () => {
    const a = templateFromTransaction(tx({ amount: 1000 }), '午饭', 'tpl-1');
    const b = templateFromTransaction(tx({ amount: 3000 }), '午饭', 'tpl-2');
    const list = upsertTemplate(upsertTemplate([], a), b);
    expect(list).toHaveLength(1);
    expect(list[0].amount).toBe(3000);
  });
});

describe('周报', () => {
  it('一周从周一到周日', () => {
    // 2024-03-13 是周三
    expect(weekRangeOf('2024-03-13')).toEqual({ from: '2024-03-11', to: '2024-03-17' });
    // 周日算这一周的最后一天，不是下一周
    expect(weekRangeOf('2024-03-17')).toEqual({ from: '2024-03-11', to: '2024-03-17' });
    // 周一是第一天
    expect(weekRangeOf('2024-03-11')).toEqual({ from: '2024-03-11', to: '2024-03-17' });
  });

  it('上一周 / 下一周', () => {
    const r = weekRangeOf('2024-03-13');
    expect(prevWeek(r)).toEqual({ from: '2024-03-04', to: '2024-03-10' });
    expect(nextWeek(r)).toEqual({ from: '2024-03-18', to: '2024-03-24' });
  });

  it('跨月跨年也算得对', () => {
    expect(weekRangeOf('2024-01-01')).toEqual({ from: '2024-01-01', to: '2024-01-07' });
    expect(weekRangeOf('2023-12-31')).toEqual({ from: '2023-12-25', to: '2023-12-31' });
  });

  it('统计这一周和上一周的支出', () => {
    const rows = [
      tx({ id: 'a', date: '2024-03-12', amount: 1000 }),
      tx({ id: 'b', date: '2024-03-14', amount: 2000 }),
      tx({ id: 'c', date: '2024-03-06', amount: 500 }), // 上一周
      tx({ id: 'd', date: '2024-03-12', amount: 9000, type: 'income' }),
      tx({ id: 'e', date: '2024-03-25', amount: 9999 }), // 下一周，不该算进来
    ];
    const s = weekStats(rows, weekRangeOf('2024-03-13'));
    expect(s.expense).toBe(3000);
    expect(s.income).toBe(9000);
    expect(s.count).toBe(3);
    expect(s.lastExpense).toBe(500);
    expect(s.delta).toBe(2500);
    expect(s.deltaPct).toBe(500); // 2500 / 500
  });

  it('上周没花钱时百分比是 null 而不是无穷', () => {
    const s = weekStats([tx({ date: '2024-03-12', amount: 1000 })], weekRangeOf('2024-03-13'));
    expect(s.lastExpense).toBe(0);
    expect(s.deltaPct).toBeNull();
  });

  it('找出一周里花得最多的分类和一天', () => {
    const rows = [
      tx({ id: 'a', date: '2024-03-12', amount: 1000, categoryId: 'c-food' }),
      tx({ id: 'b', date: '2024-03-12', amount: 5000, categoryId: 'c-movie' }),
      tx({ id: 'c', date: '2024-03-14', amount: 3000, categoryId: 'c-movie' }),
    ];
    const s = weekStats(rows, weekRangeOf('2024-03-13'));
    expect(s.topCategory?.categoryId).toBe('c-movie');
    expect(s.topCategory?.amount).toBe(8000);
    expect(s.topDay?.date).toBe('2024-03-12');
    expect(s.topDay?.amount).toBe(6000);
  });

  it('日程统计含完成数与最忙的一天', () => {
    const ev = (id: string, date: string, done: boolean): EventItem => ({
      id,
      title: id,
      notes: '',
      location: '',
      date,
      startTime: '09:00',
      endTime: '10:00',
      allDay: false,
      color: '#fff',
      tag: '',
      recurrence: { freq: 'none', interval: 1, weekdays: [], until: null },
      reminders: [],
      done,
      doneDates: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const events = [ev('a', '2024-03-12', true), ev('b', '2024-03-12', false), ev('c', '2024-03-14', false)];
    const s = weekSchedule(events, weekRangeOf('2024-03-13'));
    expect(s.total).toBe(3);
    expect(s.done).toBe(1);
    expect(s.busiest).toEqual({ date: '2024-03-12', count: 2 });
  });

  it('周报跨月时预算按周末所在的月算', () => {
    expect(monthOfWeek({ from: '2024-01-29', to: '2024-02-04' })).toBe('2024-02');
  });

  it('事实条目只说有的，不硬凑空话', () => {
    const s = weekStats([tx({ date: '2024-03-12', amount: 1000 })], weekRangeOf('2024-03-13'));
    const sched = weekSchedule([], weekRangeOf('2024-03-13'));
    const facts = weekFacts(s, sched, {
      categories: [],
      budgets: [],
      txs: [],
      fixedExpense: 0,
      monthKey: '2024-03',
      categoryName: () => '餐饮',
      dayLabel: (d) => d,
    });
    const keys = facts.map((f) => f.key);
    expect(keys).toContain('topCategory');
    expect(keys).toContain('noEvents');
    expect(keys).toContain('noUpcoming');
    // 没有固定支出就不该出现 fixed 那条
    expect(keys).not.toContain('fixed');
  });

  it('纯文本版能拼出可复制的一段', () => {
    const s = weekStats([tx({ date: '2024-03-12', amount: 1000 })], weekRangeOf('2024-03-13'));
    const text = weekPlainText(s, [], (k, vars) => `${k}${vars ? JSON.stringify(vars) : ''}`);
    expect(text).toContain('weekly.range');
    expect(text).toContain('weekly.spend');
  });
});
