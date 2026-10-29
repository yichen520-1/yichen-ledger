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
 *
 * 注意：断言不能写成「toISOString 一定是前一天」——
 * 在 UTC 时区的 CI 机器上两者相同，那种写法会在 GitHub Actions 上挂。
 * 所以只在本地时区确实领先 UTC 时才检查这个差异。
 */
describe('日期语义 · 本地日历日', () => {
  it('toDateKey 取的是本地年月日，不是 UTC', () => {
    // 本地 10 月 30 日凌晨 0:50
    const local = new Date(2026, 9, 30, 0, 50, 0);
    expect(toDateKey(local)).toBe('2026-10-30');

    // 只有本地时区领先 UTC 时（东半球），这一刻的 UTC 日期才比本地早一天。
    // 这正是当初出错的场景，但前提是这个时区条件成立。
    if (local.getTimezoneOffset() < 0) {
      expect(local.toISOString().slice(0, 10)).toBe('2026-10-29');
    }
  });

  it('toDateKey 在一天的最后时刻也还是当天', () => {
    const late = new Date(2026, 9, 30, 23, 59, 59);
    expect(toDateKey(late)).toBe('2026-10-30');
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
