import { describe, expect, it } from 'vitest';
import { toDateKey } from '../src/domain/model';
import { newRule, pendingBills, nextDueDate } from '../src/domain/recurring';

/**
 * 这一组是「本地日历日 vs UTC」的回归测试。
 *
 * 起因：忆小尘的 LedgerSnapshot.today 原来用 `new Date().toISOString().slice(0,10)`，
 * 那是 UTC 日期。在 UTC+8 的凌晨（本地 10-30 00:50、UTC 还是 10-29），
 * 「今天到期的账单」会被判成还没到，助手回答「接下来 30 天没有固定账单」。
 * 这里把日期语义钉死：一律用本地日历日。
 */
describe('日期语义 · 本地日历日', () => {
  it('toDateKey 取的是本地年月日，不是 UTC', () => {
    // 本地 10 月 30 日凌晨 0:50
    const local = new Date(2026, 9, 30, 0, 50, 0);
    expect(toDateKey(local)).toBe('2026-10-30');
    // 同一时刻的 UTC 日期是 10-29 —— 这正是当初出错的根源
    expect(local.toISOString().slice(0, 10)).toBe('2026-10-29');
  });

  it('跨年边界也按本地算', () => {
    const ny = new Date(2027, 0, 1, 0, 10, 0);
    expect(toDateKey(ny)).toBe('2027-01-01');
  });

  it('到期当天算「该出了」，不会被 UTC 挪到明天', () => {
    const today = '2026-10-30';
    const rule = {
      ...newRule(),
      id: 'r-utc',
      title: '还信用卡',
      type: 'expense' as const,
      amount: 350000,
      accountId: 'acc-bank',
      categoryId: 'cat-e-0',
      freq: 'monthly' as const,
      interval: 1,
      startDate: '2026-10-30',
      dayOfMonth: 30,
    };
    const bills = pendingBills([rule], today);
    expect(bills.length).toBe(1);
    expect(bills[0].date).toBe('2026-10-30');
    expect(bills[0].overdueDays).toBe(0);
    expect(nextDueDate(rule, today)).toBe('2026-10-30');
  });
});
