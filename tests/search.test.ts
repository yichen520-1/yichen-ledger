import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTER,
  NO_CATEGORY_ID,
  activeFilterCount,
  collectTags,
  describeFilter,
  filterTransactions,
  isFilterEmpty,
  summarize,
  toggleIn,
} from '../src/domain/search';
import type { Account, Category, Transaction } from '../src/domain/model';

const cat = (id: string, name: string): Category => ({
  id,
  name,
  type: 'expense',
  icon: '🍚',
  color: '#fff',
  builtin: false,
  sort: 0,
});

const acc = (id: string, name: string): Account => ({
  id,
  name,
  kind: 'bank',
  initialBalance: 0,
  currency: 'CNY',
  includeInTotal: true,
  archived: false,
  sort: 0,
  createdAt: '2024-01-01T00:00:00.000Z',
});

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

const ctx = { categories: [cat('c-food', '餐饮'), cat('c-movie', '娱乐')], accounts: [acc('a-bank', '银行卡')] };

const rows = [
  tx({ id: 't1', amount: 3500, note: '午饭', categoryId: 'c-food', tags: ['工作日'] }),
  tx({ id: 't2', amount: 128000, note: '房租水电', categoryId: 'c-food' }),
  tx({ id: 't3', amount: 8800, note: '看电影', categoryId: 'c-movie', date: '2024-03-20' }),
  tx({ id: 't4', type: 'income', amount: 500000, note: '工资', categoryId: null, date: '2024-03-01' }),
  tx({ id: 't5', type: 'transfer', amount: 20000, note: '还信用卡', categoryId: null, toAccountId: 'a-card' }),
];

describe('搜索与筛选', () => {
  it('空条件不筛掉任何东西', () => {
    expect(isFilterEmpty(EMPTY_FILTER)).toBe(true);
    expect(filterTransactions(rows, EMPTY_FILTER, ctx)).toHaveLength(5);
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
  });

  it('按备注搜索', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, text: '午饭' }, ctx);
    expect(out.map((x) => x.id)).toEqual(['t1']);
  });

  it('按分类名搜索 —— 用户搜「餐饮」想的是这一类', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, text: '餐饮' }, ctx);
    expect(out.map((x) => x.id).sort()).toEqual(['t1', 't2']);
  });

  it('按金额搜索，两种写法都认', () => {
    // 3500 分 = 35.00 元，搜「35」和「35.00」都能命中
    expect(filterTransactions(rows, { ...EMPTY_FILTER, text: '35' }, ctx).map((x) => x.id)).toEqual(['t1']);
    expect(filterTransactions(rows, { ...EMPTY_FILTER, text: '35.00' }, ctx).map((x) => x.id)).toEqual(['t1']);
    expect(filterTransactions(rows, { ...EMPTY_FILTER, text: '1280' }, ctx).map((x) => x.id)).toEqual(['t2']);
  });

  it('按账户名搜索', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, text: '银行卡' }, ctx);
    expect(out).toHaveLength(5);
  });

  it('按类型筛选', () => {
    expect(filterTransactions(rows, { ...EMPTY_FILTER, types: ['income'] }, ctx)).toHaveLength(1);
    expect(filterTransactions(rows, { ...EMPTY_FILTER, types: ['expense', 'transfer'] }, ctx)).toHaveLength(4);
  });

  it('按日期区间筛选（含两端）', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, from: '2024-03-01', to: '2024-03-10' }, ctx);
    // t5 没有单独指定日期，用的是默认的 2024-03-10，也在区间里
    expect(out.map((x) => x.id).sort()).toEqual(['t1', 't2', 't4', 't5']);
  });

  it('按金额区间筛选', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, minAmount: 10000, maxAmount: 200000 }, ctx);
    // t3 是 8800 分（88 元），低于下限
    expect(out.map((x) => x.id).sort()).toEqual(['t2', 't5']);
  });

  it('按标签筛选', () => {
    expect(filterTransactions(rows, { ...EMPTY_FILTER, tags: ['工作日'] }, ctx).map((x) => x.id)).toEqual(['t1']);
  });

  it('未分类用 __none__ 表示', () => {
    const out = filterTransactions(rows, { ...EMPTY_FILTER, categoryIds: [NO_CATEGORY_ID] }, ctx);
    expect(out.map((x) => x.id).sort()).toEqual(['t4', 't5']);
  });

  it('多个条件叠加', () => {
    const out = filterTransactions(
      rows,
      { ...EMPTY_FILTER, types: ['expense'], categoryIds: ['c-food'], minAmount: 10000 },
      ctx,
    );
    expect(out.map((x) => x.id)).toEqual(['t2']);
    expect(activeFilterCount({ ...EMPTY_FILTER, types: ['expense'], categoryIds: ['c-food'], minAmount: 10000 })).toBe(3);
  });

  it('汇总按类型分开算', () => {
    const s = summarize(rows);
    expect(s.count).toBe(5);
    expect(s.expense).toBe(3500 + 128000 + 8800);
    expect(s.income).toBe(500000);
    expect(s.transfer).toBe(20000);
    expect(s.net).toBe(500000 - 3500 - 128000 - 8800);
  });

  it('收集标签去重且带计数', () => {
    const tags = collectTags(rows);
    expect(tags).toEqual([{ tag: '工作日', count: 1 }]);
  });

  it('描述筛选条件', () => {
    expect(describeFilter(EMPTY_FILTER, ctx)).toBeNull();
    const d = describeFilter({ ...EMPTY_FILTER, text: '午饭', types: ['expense'] }, ctx);
    expect(d?.parts.map((x) => x.value)).toEqual(['午饭', 'expense']);
  });

  it('toggleIn 增删', () => {
    expect(toggleIn([], 'a')).toEqual(['a']);
    expect(toggleIn(['a'], 'a')).toEqual([]);
    expect(toggleIn(['a'], 'b')).toEqual(['a', 'b']);
  });
});
