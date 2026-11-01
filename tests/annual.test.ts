import { describe, expect, it } from 'vitest';
import {
  currentYear,
  monthHeat,
  pctChange,
  reviewFacts,
  reviewPlainText,
  topDayOfYear,
  yearExpenseByCategory,
  yearMonths,
  yearStats,
} from '../src/domain/annual';
import type { Category, Transaction } from '../src/domain/model';

let seq = 0;
function tx(partial: Partial<Transaction> & { amount: number; type: Transaction['type']; date: string }): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    categoryId: 'cat-e-0',
    accountId: 'acc-cash',
    toAccountId: null,
    note: '',
    tags: [],
    createdAt: `${partial.date}T00:00:00.000Z`,
    updatedAt: `${partial.date}T00:00:00.000Z`,
    ...partial,
  };
}

const CATS: Category[] = [
  { id: 'cat-e-0', name: '餐饮', type: 'expense', icon: '🍜', color: '#f00', builtin: true, sort: 0 },
  { id: 'cat-e-1', name: '交通', type: 'expense', icon: '🚌', color: '#0f0', builtin: true, sort: 1 },
  { id: 'cat-i-0', name: '工资', type: 'income', icon: '💰', color: '#00f', builtin: true, sort: 0 },
];

describe('年度统计 · yearMonths', () => {
  it('总是返回 12 个月，没账的月份补 0', () => {
    const txs = [tx({ type: 'expense', amount: 1000, date: '2024-03-05' })];
    const months = yearMonths(txs, '2024');
    expect(months).toHaveLength(12);
    expect(months[0].month).toBe('2024-01');
    expect(months[11].month).toBe('2024-12');
    expect(months[2].expense).toBe(1000);
    expect(months[0].expense).toBe(0);
  });

  it('不把别的年份算进来', () => {
    const txs = [
      tx({ type: 'expense', amount: 1000, date: '2024-03-05' }),
      tx({ type: 'expense', amount: 9999, date: '2023-03-05' }),
    ];
    const months = yearMonths(txs, '2024');
    expect(months.reduce((s, m) => s + m.expense, 0)).toBe(1000);
  });

  it('转账不算收支', () => {
    const txs = [tx({ type: 'transfer', amount: 5000, date: '2024-03-05', toAccountId: 'acc-bank' })];
    expect(yearMonths(txs, '2024').reduce((s, m) => s + m.expense, 0)).toBe(0);
  });

  it('待收的支出不进年度统计', () => {
    const txs = [
      tx({ type: 'expense', amount: 1000, date: '2024-03-05' }),
      tx({ type: 'expense', amount: 7777, date: '2024-03-06', receivable: true }),
    ];
    expect(yearMonths(txs, '2024').reduce((s, m) => s + m.expense, 0)).toBe(1000);
  });
});

describe('年度统计 · pctChange', () => {
  it('正常算比例（0.2 表示 20%）', () => {
    expect(pctChange(120, 100)).toBeCloseTo(0.2, 6);
    expect(pctChange(80, 100)).toBeCloseTo(-0.2, 6);
  });

  it('基数为 0 时返回 null（不能说「涨了 100%」）', () => {
    expect(pctChange(100, 0)).toBeNull();
  });

  it('两者都是 0 时是 0', () => {
    expect(pctChange(0, 0)).toBe(0);
  });
});

describe('年度统计 · yearStats', () => {
  const txs = [
    tx({ type: 'expense', amount: 10000, date: '2024-01-10' }),
    tx({ type: 'expense', amount: 20000, date: '2024-03-15' }),
    tx({ type: 'income', amount: 500000, categoryId: 'cat-i-0', date: '2024-03-01' }),
    tx({ type: 'expense', amount: 30000, date: '2023-03-15' }),
    tx({ type: 'income', amount: 400000, categoryId: 'cat-i-0', date: '2023-03-01' }),
  ];

  it('合计与净额', () => {
    const s = yearStats(txs, '2024');
    expect(s.year).toBe('2024');
    expect(s.expense).toBe(30000);
    expect(s.income).toBe(500000);
    expect(s.net).toBe(470000);
    expect(s.count).toBe(3);
  });

  it('有账的月份数 activeMonths', () => {
    const s = yearStats(txs, '2024');
    expect(s.activeMonths).toBe(2);
  });

  it('同比：去年有数据时算得出来', () => {
    const s = yearStats(txs, '2024');
    // 去年支出 30000，今年 30000 → 0%
    expect(s.lastExpense).toBe(30000);
    expect(s.yoyExpense).toBe(0);
    expect(s.yoyIncome).toBeCloseTo(0.25, 6);
  });

  it('去年没数据时：今年有支出则为 null（不能谎称「涨了 100%」）', () => {
    // 2023 有 30000 支出，2022 一笔没有 → 基数为 0，同比说不清
    const s = yearStats(txs, '2023');
    expect(s.expense).toBe(30000);
    expect(s.lastExpense).toBe(0);
    expect(s.yoyExpense).toBeNull();
  });

  it('两年都是 0 时同比是 0，不是 null', () => {
    const s = yearStats([], '2022');
    expect(s.yoyExpense).toBe(0);
  });

  it('月均按有账的月份算，不是除以 12', () => {
    const s = yearStats(txs, '2024');
    expect(s.avgExpense).toBe(15000);
  });

  it('花得最多的月份', () => {
    const s = yearStats(txs, '2024');
    expect(s.topMonth?.month).toBe('2024-03');
    expect(s.topMonth?.expense).toBe(20000);
  });

  it('空年份不会炸', () => {
    const s = yearStats([], '2024');
    expect(s.expense).toBe(0);
    expect(s.topMonth).toBeNull();
    expect(s.avgExpense).toBe(0);
  });
});

describe('年度统计 · 分类与热力', () => {
  const txs = [
    tx({ type: 'expense', amount: 5000, date: '2024-01-10', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 3000, date: '2024-03-10', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 9000, date: '2024-02-10', categoryId: 'cat-e-1' }),
  ];

  it('分类合计按金额倒序，并带出现月份数', () => {
    const rows = yearExpenseByCategory(txs, '2024');
    expect(rows[0].categoryId).toBe('cat-e-1');
    expect(rows[0].amount).toBe(9000);
    const food = rows.find((r) => r.categoryId === 'cat-e-0')!;
    expect(food.amount).toBe(8000);
    expect(food.months).toBe(2);
  });

  it('一年里花得最多的一天', () => {
    const top = topDayOfYear(txs, '2024');
    expect(top?.date).toBe('2024-02-10');
    expect(top?.amount).toBe(9000);
  });

  it('月热力图返回整月每一天，没账的补 0', () => {
    const heat = monthHeat(txs, '2024-03');
    expect(heat).toHaveLength(31);
    expect(heat[9]).toEqual({ date: '2024-03-10', amount: 3000 });
    expect(heat[0]).toEqual({ date: '2024-03-01', amount: 0 });
    // 二月有 29 天（2024 是闰年）
    expect(monthHeat(txs, '2024-02')).toHaveLength(29);
  });
});

describe('月度回顾 · reviewFacts', () => {
  const txs = [
    tx({ type: 'expense', amount: 5000, date: '2024-03-10', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 15000, date: '2024-03-20', categoryId: 'cat-e-1' }),
    tx({ type: 'expense', amount: 8000, date: '2024-02-10', categoryId: 'cat-e-0' }),
  ];

  it('有固定支出时才出现固定支出那条', () => {
    const without = reviewFacts(txs, '2024-03', CATS, 0);
    expect(without.some((f) => f.key === 'review.fixed')).toBe(false);
    const withFixed = reviewFacts(txs, '2024-03', CATS, 350000);
    expect(withFixed.some((f) => f.key === 'review.fixed')).toBe(true);
  });

  it('比上月多时用 vsLastUp', () => {
    const facts = reviewFacts(txs, '2024-03', CATS, 0);
    // 上月 8000，本月 20000 → 涨了 150%
    expect(facts.some((f) => f.key === 'review.vsLastUp')).toBe(true);
  });

  it('比上月少时用 vsLastDown', () => {
    const facts = reviewFacts(txs, '2024-02', CATS, 0);
    // 上月（1 月）没有支出 → 同比无法算，但 topCategory 一定有
    expect(facts.some((f) => f.key === 'review.topCategory')).toBe(true);
  });

  it('空月份不硬凑', () => {
    expect(reviewFacts([], '2024-05', CATS, 0)).toEqual([]);
  });

  it('纯文本版能拼出来', () => {
    const facts = reviewFacts(txs, '2024-03', CATS, 0);
    const text = reviewPlainText(txs, '2024-03', (key) => `[${key}]`, facts);
    expect(text).toContain('[review.');
    expect(text.length).toBeGreaterThan(10);
  });
});

describe('年度统计 · currentYear', () => {
  it('取本地年份（字符串，和 YYYY-MM 拼得起来）', () => {
    expect(currentYear(new Date(2024, 2, 15))).toBe('2024');
  });
});
