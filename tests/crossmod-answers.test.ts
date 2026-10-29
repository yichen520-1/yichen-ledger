import { describe, expect, it } from 'vitest';
import { ask, type LedgerSnapshot } from '../src/domain/assistant';
import { newRule } from '../src/domain/recurring';
import type { Transaction } from '../src/domain/model';

/**
 * 忆小尘跨模块回答的几个「说漏嘴」缺陷的回归测试。
 *
 * 这几条都是自检脚本跑出来的，不是凭空想的：
 *   1. 周报回答里的「收入」原来在渲染层写死成 0，明明有收入也说 0；
 *   2. 「下周有几场活动」在没有日程时只回一句「没有日程」，
 *      钱的部分一个字不提 —— 等于没回答。
 */

const TODAY = '2026-10-30';

function tx(partial: Partial<Transaction> & { amount: number; type: Transaction['type'] }): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    categoryId: 'cat-e-0',
    accountId: 'acc-cash',
    toAccountId: null,
    date: TODAY,
    note: '',
    tags: [],
    createdAt: `${TODAY}T00:00:00.000Z`,
    updatedAt: `${TODAY}T00:00:00.000Z`,
    ...partial,
  };
}

function snap(txs: Transaction[], extra: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  return {
    today: TODAY,
    accounts: [{ id: 'acc-cash', name: '现金', kind: 'cash', initialBalance: 0, currency: 'CNY', includeInTotal: true, archived: false, sort: 0, createdAt: '' }],
    categories: [
      { id: 'cat-e-0', name: '餐饮', type: 'expense', icon: '🍜', color: '#f00', builtin: true, sort: 0 },
      { id: 'cat-i-0', name: '工资', type: 'income', icon: '💰', color: '#0f0', builtin: true, sort: 0 },
    ],
    transactions: txs,
    budgets: [],
    events: [],
    rules: [],
    ...extra,
  };
}

describe('忆小尘跨模块 · 周报带收入', () => {
  it('有收入时回答里是真实数字，不是 0', () => {
    const txs = [
      tx({ type: 'expense', amount: 12000, date: '2026-10-28' }),
      tx({ type: 'income', amount: 800000, categoryId: 'cat-i-0', date: '2026-10-27' }),
    ];
    const a = ask('这一周怎么样', 'ledger', snap(txs));
    expect(a.kind).toBe('weekly');
    if (a.kind !== 'weekly') return;
    expect(a.expense).toBe(12000);
    // 这一条就是当初写死成 0 的地方
    expect(a.income).toBe(800000);
  });

  it('没有收入时是 0，不是 undefined', () => {
    const txs = [tx({ type: 'expense', amount: 5000, date: '2026-10-28' })];
    const a = ask('这一周怎么样', 'ledger', snap(txs));
    if (a.kind !== 'weekly') throw new Error('expected weekly');
    expect(a.income).toBe(0);
  });
});

describe('忆小尘跨模块 · 预估要回答钱', () => {
  it('没有日程时也给得出日均和预计花费', () => {
    const txs = [tx({ type: 'expense', amount: 30000, date: '2026-10-20' })];
    const a = ask('下周有几场活动', 'ledger', snap(txs));
    expect(a.kind).toBe('forecast');
    if (a.kind !== 'forecast') return;
    expect(a.eventCount).toBe(0);
    expect(a.busyDates).toEqual([]);
    // 日均 = 最近 30 天支出 / 30
    expect(a.dailyAvg).toBe(1000);
    // 没有日程也要给出一个预计数（按 7 天算）
    expect(a.expected).toBeGreaterThan(0);
  });

  it('有日程时 busyDates 是升序去重的', () => {
    const txs = [tx({ type: 'expense', amount: 30000, date: '2026-10-20' })];
    const events = [
      { id: 'e1', title: '开会', notes: '', location: '', date: '2026-11-02', startTime: '09:00', endTime: '10:00', allDay: false, color: '#5aa9f0', tag: '', recurrence: { freq: 'none' as const, interval: 1, weekdays: [], until: null }, reminders: [], done: false, doneDates: [], createdAt: '', updatedAt: '' },
      { id: 'e2', title: '复诊', notes: '', location: '', date: '2026-11-04', startTime: '14:00', endTime: '15:00', allDay: false, color: '#5aa9f0', tag: '', recurrence: { freq: 'none' as const, interval: 1, weekdays: [], until: null }, reminders: [], done: false, doneDates: [], createdAt: '', updatedAt: '' },
    ];
    const a = ask('下周有几场活动', 'ledger', snap(txs, { events }));
    if (a.kind !== 'forecast') throw new Error('expected forecast');
    expect(a.eventCount).toBe(2);
    expect(a.busyDates).toEqual(['2026-11-02', '2026-11-04']);
  });
});

describe('忆小尘跨模块 · 账单要说清「金额待填」', () => {
  it('从日程生成的规则金额是 0，回答里能看出金额没填', () => {
    const rule = { ...newRule(), id: 'r1', title: '还信用卡', type: 'expense' as const, amount: 0, accountId: 'acc-cash', categoryId: 'cat-e-0', freq: 'monthly' as const, interval: 1, startDate: '2026-10-01', dayOfMonth: 30 };
    const a = ask('接下来要付哪些账单', 'ledger', snap([], { rules: [rule] }));
    if (a.kind !== 'bills') throw new Error('expected bills');
    expect(a.items.length).toBe(1);
    expect(a.items[0].amount).toBe(0);
    // 渲染层据此换成「金额待填」，不会说成「合计 ¥0.00」
    expect(a.items.every((x) => x.amount === 0)).toBe(true);
  });
});
