import { describe, it, expect } from 'vitest';
import {
  PENDING_LOOKBACK_DAYS,
  billToDraft,
  dayInMonth,
  fixedTotals,
  monthlyEquivalent,
  newRule,
  nextDueDate,
  pendingBills,
  ruleDatesBetween,
  ruleFromEvent,
  ruleFromTransaction,
  ruleOccursOn,
} from '../src/domain/recurring';
import type { Transaction } from '../src/domain/model';
import type { EventItem } from '../src/domain/schedule';

const rule = (over: Partial<ReturnType<typeof newRule>> = {}) => ({
  ...{ ...newRule(), id: 'r1', startDate: '2024-01-15' },
  title: '房租',
  type: 'expense' as const,
  amount: 350000,
  categoryId: 'cat-e-5',
  accountId: 'acc-bank',
  freq: 'monthly' as const,
  interval: 1,
  startDate: '2024-01-15',
  dayOfMonth: 15,
  ...over,
});

describe('周期账单', () => {
  it('月末不足时落到当月最后一天', () => {
    expect(dayInMonth('2024-02', 31)).toBe('2024-02-29'); // 闰年
    expect(dayInMonth('2023-02', 31)).toBe('2023-02-28');
    expect(dayInMonth('2024-04', 31)).toBe('2024-04-30');
    expect(dayInMonth('2024-01', 15)).toBe('2024-01-15');
  });

  it('每月同一天会发生', () => {
    const r = rule();
    expect(ruleOccursOn(r, '2024-03-15')).toBe(true);
    expect(ruleOccursOn(r, '2024-03-16')).toBe(false);
    expect(ruleOccursOn(r, '2024-02-29')).toBe(false); // dayOfMonth 是 15
  });

  it('月末规则在短月也能命中', () => {
    const r = rule({ dayOfMonth: 31 });
    expect(ruleOccursOn(r, '2024-01-31')).toBe(true);
    expect(ruleOccursOn(r, '2024-02-29')).toBe(true);
    expect(ruleOccursOn(r, '2024-04-30')).toBe(true);
  });

  it('起始日之前不发生，结束日之后不发生', () => {
    const r = rule({ startDate: '2024-03-01', endDate: '2024-05-31' });
    expect(ruleOccursOn(r, '2024-02-15')).toBe(false);
    expect(ruleOccursOn(r, '2024-03-15')).toBe(true);
    expect(ruleOccursOn(r, '2024-06-15')).toBe(false);
  });

  it('每周按 weekday 发生', () => {
    // 2024-01-15 是周一
    const r = rule({ freq: 'weekly', weekday: 1, dayOfMonth: 0 });
    expect(ruleOccursOn(r, '2024-01-15')).toBe(true);
    expect(ruleOccursOn(r, '2024-01-22')).toBe(true);
    expect(ruleOccursOn(r, '2024-01-16')).toBe(false);
  });

  it('每 N 周会隔周跳过', () => {
    const r = rule({ freq: 'weekly', weekday: 1, interval: 2, dayOfMonth: 0 });
    expect(ruleOccursOn(r, '2024-01-15')).toBe(true);
    expect(ruleOccursOn(r, '2024-01-22')).toBe(false);
    expect(ruleOccursOn(r, '2024-01-29')).toBe(true);
  });

  it('每年按 monthOfYear 发生', () => {
    const r = rule({ freq: 'yearly', monthOfYear: 3, dayOfMonth: 8 });
    expect(ruleOccursOn(r, '2024-03-08')).toBe(true);
    expect(ruleOccursOn(r, '2024-04-08')).toBe(false);
  });

  it('列出区间内的所有到期日', () => {
    const r = rule();
    expect(ruleDatesBetween(r, '2024-01-01', '2024-03-31')).toEqual([
      '2024-01-15',
      '2024-02-15',
      '2024-03-15',
    ]);
  });

  it('暂停的规则不再产生到期日', () => {
    const r = rule({ archived: true });
    expect(ruleDatesBetween(r, '2024-01-01', '2024-03-31')).toEqual([]);
    expect(nextDueDate(r, '2024-01-01')).toBeNull();
  });

  it('下次到期日', () => {
    const r = rule();
    expect(nextDueDate(r, '2024-01-01')).toBe('2024-01-15');
    expect(nextDueDate(r, '2024-01-15')).toBe('2024-01-15');
    expect(nextDueDate(r, '2024-01-16')).toBe('2024-02-15');
  });

  it('待确认：已确认和已跳过的都不再出现', () => {
    const r = rule({ confirmedDates: ['2024-01-15'], skippedDates: ['2024-02-15'] });
    const pending = pendingBills([r], '2024-03-20');
    expect(pending.map((b) => b.date)).toEqual(['2024-03-15']);
  });

  it('待确认只往回看 60 天', () => {
    const r = rule();
    // 2024-06-30 往回 60 天是 2024-05-01，所以 5/15 和 6/15 应该出现
    const pending = pendingBills([r], '2024-06-30');
    // 排序是「逾期越久越靠前」，所以旧的日期在前
    expect(pending.map((b) => b.date)).toEqual(['2024-05-15', '2024-06-15']);
    // 再往前 3 个月的不该出现
    expect(pending.some((b) => b.date < '2024-05-01')).toBe(false);
    expect(PENDING_LOOKBACK_DAYS).toBe(60);
  });

  it('待确认按逾期天数倒序：拖得最久的排最前', () => {
    const r1 = rule({ id: 'r1', title: '房租', dayOfMonth: 5 });
    const r2 = rule({ id: 'r2', title: '宽带', dayOfMonth: 25 });
    const pending = pendingBills([r1, r2], '2024-03-28');
    // 60 天窗口从 2024-01-28 起算，所以 2 月和 3 月的都在；
    // 顺序是逾期越久越靠前（2/5 最旧，3/25 最新）
    expect(pending.map((b) => b.date)).toEqual([
      '2024-02-05',
      '2024-02-25',
      '2024-03-05',
      '2024-03-25',
    ]);
    for (let i = 1; i < pending.length; i += 1) {
      expect(pending[i - 1].overdueDays).toBeGreaterThanOrEqual(pending[i].overdueDays);
    }
  });

  it('账单能变成记账草稿', () => {
    const r = rule();
    const bill = { rule: r, date: '2024-03-15', overdueDays: 0, key: 'r1@2024-03-15' };
    const draft = billToDraft(bill);
    expect(draft.type).toBe('expense');
    expect(draft.amountText).toBe('3500.00');
    expect(draft.categoryId).toBe('cat-e-5');
    expect(draft.accountId).toBe('acc-bank');
    expect(draft.date).toBe('2024-03-15');
  });

  it('从一笔账目生成规则：每月同一天', () => {
    const tx: Transaction = {
      id: 't1',
      type: 'expense',
      amount: 350000,
      categoryId: 'cat-e-5',
      accountId: 'acc-bank',
      toAccountId: null,
      date: '2024-01-15',
      note: '房租',
      tags: [],
      createdAt: '2024-01-15T00:00:00.000Z',
      updatedAt: '2024-01-15T00:00:00.000Z',
    };
    const r = ruleFromTransaction(tx, 'rec-1');
    expect(r.title).toBe('房租');
    expect(r.freq).toBe('monthly');
    expect(r.dayOfMonth).toBe(15);
    expect(r.amount).toBe(350000);
    expect(r.startDate).toBe('2024-01-15');
  });

  it('从日程生成规则', () => {
    const ev: EventItem = {
      id: 'e1',
      title: '还信用卡',
      notes: '',
      location: '',
      date: '2024-01-20',
      startTime: '09:00',
      endTime: '09:30',
      allDay: false,
      color: '#fff',
      tag: '',
      recurrence: { freq: 'monthly', interval: 1, weekdays: [], until: null },
      reminders: [],
      done: false,
      doneDates: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };
    const r = ruleFromEvent(ev, 'rec-2');
    expect(r.title).toBe('还信用卡');
    expect(r.freq).toBe('monthly');
    expect(r.dayOfMonth).toBe(20);
    // 日程里没有金额，所以留 0 让用户自己填
    expect(r.amount).toBe(0);
  });

  it('每月等价金额', () => {
    expect(monthlyEquivalent(rule())).toBe(350000);
    expect(monthlyEquivalent(rule({ freq: 'yearly' }))).toBe(Math.round(350000 / 12));
    expect(monthlyEquivalent(rule({ freq: 'weekly' }))).toBe(Math.round((350000 * 52) / 12));
    expect(monthlyEquivalent(rule({ freq: 'daily' }))).toBe(350000 * 30);
  });

  it('固定收支合计（暂停的不算）', () => {
    const rules = [
      rule({ id: 'r1', amount: 350000 }),
      rule({ id: 'r2', amount: 10000, type: 'expense' }),
      rule({ id: 'r3', amount: 1000000, type: 'income' }),
      rule({ id: 'r4', amount: 99999, archived: true }),
    ];
    const totals = fixedTotals(rules);
    expect(totals.expense).toBe(360000);
    expect(totals.income).toBe(1000000);
  });
});
