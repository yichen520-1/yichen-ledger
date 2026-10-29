import { describe, it, expect } from 'vitest';
import { answerLedger, buildLedgerContext, type LedgerSnapshot } from '../src/domain/assistant';
import { newRule } from '../src/domain/recurring';
import type { Account, Budget, Category, Transaction } from '../src/domain/model';
import { newEvent, type EventItem } from '../src/domain/schedule';

const TODAY = '2024-03-15'; // 周五

function cat(id: string, name: string, type: 'expense' | 'income' = 'expense'): Category {
  return { id, name, type, icon: '·', color: '#fff', builtin: true, sort: 0 };
}

const CATS: Category[] = [cat('c-food', '餐饮'), cat('c-movie', '娱乐'), cat('c-salary', '工资', 'income')];

function acc(id: string, name: string, initial = 0): Account {
  return {
    id,
    name,
    kind: 'cash',
    initialBalance: initial,
    currency: 'CNY',
    includeInTotal: true,
    archived: false,
    sort: 0,
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

const ACCOUNTS: Account[] = [acc('a-cash', '现金', 100000)];

let seq = 0;
function tx(partial: Partial<Transaction> & { amount: number }): Transaction {
  seq += 1;
  return {
    id: `t${seq}`,
    type: 'expense',
    categoryId: 'c-food',
    accountId: 'a-cash',
    toAccountId: null,
    date: TODAY,
    note: '',
    tags: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...partial,
  } as Transaction;
}

function ledger(txs: Transaction[], budgets: Budget[] = [], extra: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  return { today: TODAY, accounts: ACCOUNTS, categories: CATS, transactions: txs, budgets, ...extra };
}

function ev(partial: Partial<EventItem>): EventItem {
  return { ...newEvent(), ...partial };
}

/* ------------------------------------------------------- 跨模块：笔数清单 */

describe('跨模块问答 · 笔数清单', () => {
  it('「这个月看电影花了几次」列出每一笔', () => {
    const txs = [
      tx({ amount: 4500, categoryId: 'c-movie', note: '电影票', date: '2024-03-03' }),
      tx({ amount: 3800, categoryId: 'c-movie', note: '电影票', date: '2024-03-10' }),
      tx({ amount: 2000, categoryId: 'c-food', note: '午饭', date: '2024-03-05' }),
    ];
    const a = answerLedger('这个月看电影花了几次', ledger(txs));
    expect(a.kind).toBe('txList');
    if (a.kind !== 'txList') return;
    expect(a.count).toBe(2);
    expect(a.total).toBe(8300);
    expect(a.categoryName).toBe('娱乐');
    expect(a.items.map((x) => x.date)).toEqual(['2024-03-10', '2024-03-03']);
  });

  it('没说过分类就问「花了几笔」时列出全部', () => {
    const txs = [tx({ amount: 1000 }), tx({ amount: 2000, date: '2024-03-01' })];
    const a = answerLedger('这个月花了几笔', ledger(txs));
    expect(a.kind).toBe('txList');
    if (a.kind !== 'txList') return;
    expect(a.count).toBe(2);
    expect(a.categoryName).toBeNull();
  });

  it('一笔都没有时说清是空的', () => {
    const a = answerLedger('这个月看电影花了几次', ledger([]));
    expect(a.kind).toBe('txList');
    if (a.kind !== 'txList') return;
    expect(a.count).toBe(0);
  });
});

/* --------------------------------------------------- 跨模块：日程与花钱预估 */

describe('跨模块问答 · 日程那几天要花多少', () => {
  it('「下周有几场活动」给出日程数和日均预估', () => {
    const events = [ev({ title: '开会', date: '2024-03-18' }), ev({ title: '聚餐', date: '2024-03-20' })];
    // 最近 30 天平均每天 100 元
    const txs = [tx({ amount: 300000, date: '2024-03-01' })];
    const a = answerLedger('下周有几场活动，那几天大概要花多少', ledger(txs, [], { events }));
    expect(a.kind).toBe('forecast');
    if (a.kind !== 'forecast') return;
    expect(a.eventCount).toBe(2);
    expect(a.busyDates).toEqual(['2024-03-18', '2024-03-20']);
    expect(a.dailyAvg).toBe(10000);
    expect(a.expected).toBe(20000); // 2 天 × 100 元
  });

  it('没日程时 eventCount 是 0，但日均仍然算得出', () => {
    const txs = [tx({ amount: 300000, date: '2024-03-01' })];
    const a = answerLedger('下周有几场活动', ledger(txs, [], { events: [] }));
    expect(a.kind).toBe('forecast');
    if (a.kind !== 'forecast') return;
    expect(a.eventCount).toBe(0);
    expect(a.busyDates).toEqual([]);
    expect(a.dailyAvg).toBe(10000);
  });
});

/* ------------------------------------------------------- 跨模块：待确认账单 */

describe('跨模块问答 · 账单', () => {
  it('「接下来要付哪些账单」列出待确认的和每月固定额', () => {
    const rules = [
      { ...{ ...newRule(), id: 'r1', startDate: '2024-01-15' }, title: '房租', amount: 350000, dayOfMonth: 15 },
      { ...{ ...newRule(), id: 'r2', startDate: '2024-01-20' }, title: '宽带', amount: 10000, dayOfMonth: 20 },
    ];
    const a = answerLedger('接下来要付哪些账单', ledger([], [], { rules }));
    expect(a.kind).toBe('bills');
    if (a.kind !== 'bills') return;
    expect(a.fixedExpense).toBe(360000);
    expect(a.items.length).toBeGreaterThan(0);
    expect(a.items.map((x) => x.title)).toContain('房租');
  });

  it('没有规则时说清没有', () => {
    const a = answerLedger('有哪些待确认的账单', ledger([], [], { rules: [] }));
    expect(a.kind).toBe('bills');
    if (a.kind !== 'bills') return;
    expect(a.items).toEqual([]);
    expect(a.fixedExpense).toBe(0);
  });
});

/* ------------------------------------------------------------- 跨模块：周报 */

describe('跨模块问答 · 周报', () => {
  it('「这一周怎么样」给出本周支出与日程数', () => {
    const txs = [tx({ amount: 5000, date: '2024-03-13' }), tx({ amount: 3000, date: '2024-03-14' })];
    const events = [ev({ title: '开会', date: '2024-03-13' })];
    const a = answerLedger('这一周怎么样', ledger(txs, [], { events }));
    expect(a.kind).toBe('weekly');
    if (a.kind !== 'weekly') return;
    expect(a.expense).toBe(8000);
    expect(a.eventCount).toBe(1);
    expect(a.from).toBe('2024-03-11');
    expect(a.to).toBe('2024-03-17');
  });
});

/* ------------------------------------------------------- 跨模块：上下文摘要 */

describe('跨模块问答 · 云端上下文', () => {
  it('摘要里带上日程和固定支出', () => {
    const events = [ev({ title: '开会', date: '2024-03-18' })];
    const rules = [{ ...{ ...newRule(), id: 'r1', startDate: '2024-01-15' }, title: '房租', amount: 350000, dayOfMonth: 15 }];
    const text = buildLedgerContext(ledger([tx({ amount: 1000 })], [], { events, rules }), 'zh');
    expect(text).toContain('本周');
    expect(text).toContain('开会');
    expect(text).toContain('固定支出');
    expect(text).toContain('房租');
  });

  it('没日程没规则时不会崩，也不硬塞空段落', () => {
    const text = buildLedgerContext(ledger([tx({ amount: 1000 })]), 'zh');
    expect(text).toContain('[本月');
    expect(text).not.toContain('[未来两周日程]');
  });
});
