import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCK,
  EMPTY_ATTEMPT,
  LOCKOUT_SECONDS,
  MAX_ATTEMPTS_BEFORE_WAIT,
  PIN_LENGTH,
  checkPinStrength,
  hashPin,
  isValidPin,
  normalizeLock,
  recordFailure,
  verifyPin,
  waitLeft,
} from '../src/domain/lock';
import {
  eventSpend,
  eventsWithSpend,
  excludedFromStats,
  openReceivables,
  receivableTotal,
  settledReceivables,
  settlementDraft,
  txsOfEvent,
} from '../src/domain/receivable';
import { RECEIPT_MAX_BYTES, checkReceiptFile, formatBytes, groupByTx, isImageFile } from '../src/domain/receipt';
import { dailyAllowance, lastRecordDate, pickNudge, streakDays, type NudgeContext } from '../src/domain/nudge';
import type { Transaction } from '../src/domain/model';

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

/* ============================================================ 应用锁 */

describe('应用锁 · PIN', () => {
  it('必须是 6 位数字', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12345a')).toBe(false);
    expect(isValidPin('')).toBe(false);
    expect(PIN_LENGTH).toBe(6);
  });

  it('同一个 PIN 每次哈希结果一样', () => {
    expect(hashPin('123456')).toBe(hashPin('123456'));
  });

  it('不同 PIN 哈希不同', () => {
    expect(hashPin('123456')).not.toBe(hashPin('654321'));
  });

  it('哈希里不出现明文', () => {
    const h = hashPin('123456');
    expect(h).not.toContain('123456');
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('verifyPin 只对正确的 PIN 返回 true', () => {
    const h = hashPin('246810');
    expect(verifyPin('246810', h)).toBe(true);
    expect(verifyPin('246811', h)).toBe(false);
  });

  it('空哈希永远验不过（没设密码时不能被空串绕过）', () => {
    expect(verifyPin('', '')).toBe(false);
    expect(verifyPin('123456', '')).toBe(false);
  });

  it('弱密码能被认出来', () => {
    // 123456 在常见密码表里，所以先被判成 common（比 sequence 更该拦）
    expect(checkPinStrength('123456')).toBe('common');
    expect(checkPinStrength('234567')).toBe('sequence');
    expect(checkPinStrength('987654')).toBe('sequence');
    // 111111 也在常见密码表里，同样先判 common
    expect(checkPinStrength('111111')).toBe('common');
    expect(checkPinStrength('777777')).toBe('repeat');
    expect(checkPinStrength('482913')).toBe('ok');
  });
});

describe('应用锁 · 失败等待', () => {
  it('前 4 次不锁', () => {
    let st = EMPTY_ATTEMPT;
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_WAIT - 1; i += 1) st = recordFailure(st, 1000);
    expect(waitLeft(st, 1000)).toBe(0);
  });

  it('第 5 次开始锁 30 秒', () => {
    let st = EMPTY_ATTEMPT;
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_WAIT; i += 1) st = recordFailure(st, 1000);
    expect(waitLeft(st, 1000)).toBe(LOCKOUT_SECONDS);
    expect(waitLeft(st, 1000 + LOCKOUT_SECONDS * 1000)).toBe(0);
  });

  it('再错满 5 次，等待时间翻倍', () => {
    let st = EMPTY_ATTEMPT;
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_WAIT; i += 1) st = recordFailure(st, 0);
    const first = waitLeft(st, 0);
    // 第 6~9 次仍是同一档等待
    for (let i = 0; i < MAX_ATTEMPTS_BEFORE_WAIT - 1; i += 1) st = recordFailure(st, 0);
    expect(waitLeft(st, 0)).toBe(first);
    // 第 10 次才升级
    st = recordFailure(st, 0);
    expect(waitLeft(st, 0)).toBeGreaterThan(first);
  });
});

describe('应用锁 · 配置归一', () => {
  it('空值给默认配置', () => {
    expect(normalizeLock(null)).toEqual(DEFAULT_LOCK);
    expect(normalizeLock(undefined)).toEqual(DEFAULT_LOCK);
  });

  it('保留用户设置', () => {
    const cfg = normalizeLock({ enabled: true, hash: 'abc', biometric: false, graceMinutes: 5 });
    expect(cfg.enabled).toBe(true);
    expect(cfg.graceMinutes).toBe(5);
    expect(cfg.biometric).toBe(false);
  });

  it('负数宽限值回落到默认', () => {
    expect(normalizeLock({ graceMinutes: -5 }).graceMinutes).toBe(DEFAULT_LOCK.graceMinutes);
  });

  it('宽限值原样保留（不做上限夹取）', () => {
    expect(normalizeLock({ graceMinutes: 999 }).graceMinutes).toBe(999);
  });

  it('开着锁但没有哈希时仍然算开（由界面负责先设 PIN）', () => {
    expect(normalizeLock({ enabled: true, hash: '' }).enabled).toBe(true);
  });
});

/* ============================================================ 待收 */

describe('待收 · 报销与垫付', () => {
  const pending = tx({ type: 'expense', amount: 8800, date: '2024-03-01', receivable: true, note: '垫付打车' });
  const settled = tx({
    type: 'income',
    amount: 8800,
    date: '2024-03-05',
    categoryId: 'cat-i-0',
    receivableId: pending.id,
    note: '报销到账',
  });

  it('未结清的进 openReceivables，并算得出天数', () => {
    const list = openReceivables([pending], '2024-03-06');
    expect(list).toHaveLength(1);
    expect(list[0].ageDays).toBe(5);
  });

  it('结清之后不再出现', () => {
    const list = openReceivables([{ ...pending, settledBy: settled.id }, settled], '2024-03-10');
    expect(list).toHaveLength(0);
  });

  it('合计只算还没收回来的', () => {
    expect(receivableTotal([pending])).toBe(8800);
    expect(receivableTotal([{ ...pending, settledBy: settled.id }, settled])).toBe(0);
  });

  it('已结清列表里能查到', () => {
    const done = settledReceivables([{ ...pending, settledBy: settled.id }, settled]);
    expect(done).toHaveLength(1);
  });

  it('冲平生成的是收入，金额一样，日期是到账那天', () => {
    const d = settlementDraft(pending, '2024-03-05', '报销到账');
    expect(d.type).toBe('income');
    expect(d.amount).toBe(8800);
    expect(d.date).toBe('2024-03-05');
    expect(d.receivableId).toBe(pending.id);
    expect(d.toAccountId).toBeNull();
  });

  it('被挡在统计外的是净额：支出减去冲平的收入 = 0', () => {
    // 只有那笔待收支出时，被挡掉的是 8800
    expect(excludedFromStats([pending], '2024-03')).toBe(8800);
    // 冲平之后一进一出正好抵消，统计口径上「没有额外影响」
    expect(excludedFromStats([pending, settled], '2024-03')).toBe(0);
  });
});

describe('事件账本 · 一场活动花了多少', () => {
  const a = tx({ type: 'expense', amount: 12000, date: '2024-03-01', eventId: 'ev-1', note: '高铁' });
  const b = tx({ type: 'expense', amount: 30000, date: '2024-03-02', eventId: 'ev-1', note: '住宿' });
  const c = tx({ type: 'income', amount: 5000, date: '2024-03-03', eventId: 'ev-1', categoryId: 'cat-i-0' });
  const other = tx({ type: 'expense', amount: 999, date: '2024-03-04', eventId: 'ev-2' });

  it('只算挂在这场活动上的', () => {
    expect(txsOfEvent([a, b, c, other], 'ev-1')).toHaveLength(3);
  });

  it('支出/收入/净额分开算', () => {
    const s = eventSpend([a, b, c, other], 'ev-1');
    expect(s.expense).toBe(42000);
    expect(s.income).toBe(5000);
    expect(s.net).toBe(37000);
    expect(s.count).toBe(3);
  });

  it('没有账目时全是 0', () => {
    const s = eventSpend([a], 'ev-none');
    expect(s.count).toBe(0);
    expect(s.net).toBe(0);
  });

  it('eventsWithSpend 返回挂过账的活动 id', () => {
    expect(eventsWithSpend([a, other])).toEqual(new Set(['ev-1', 'ev-2']));
  });
});

/* ============================================================ 收据 */

describe('收据 · 附件校验', () => {
  it('只收图片', () => {
    expect(isImageFile({ type: 'image/png' } as File)).toBe(true);
    expect(isImageFile({ type: 'image/jpeg' } as File)).toBe(true);
    expect(isImageFile({ type: 'application/pdf' } as File)).toBe(false);
    expect(isImageFile({ type: 'text/plain' } as File)).toBe(false);
  });

  it('非图片被拒', () => {
    expect(checkReceiptFile({ type: 'application/pdf', size: 100 } as File)).toBe('receipt.notImage');
  });

  it('超过 8MB 被拒', () => {
    expect(checkReceiptFile({ type: 'image/png', size: RECEIPT_MAX_BYTES + 1 } as File)).toBe('receipt.tooLarge');
  });

  it('正常图片通过', () => {
    expect(checkReceiptFile({ type: 'image/png', size: 1024 } as File)).toBeNull();
  });

  it('字节数格式化', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('按账目分组', () => {
    const rows = [
      { id: 'r1', txId: 't1', blob: null, mime: 'image/png', name: 'a.png', size: 1, createdAt: '' },
      { id: 'r2', txId: 't1', blob: null, mime: 'image/png', name: 'b.png', size: 1, createdAt: '' },
      { id: 'r3', txId: 't2', blob: null, mime: 'image/png', name: 'c.png', size: 1, createdAt: '' },
    ];
    const map = groupByTx(rows as never);
    expect(map.get('t1')).toHaveLength(2);
    expect(map.get('t2')).toHaveLength(1);
  });
});

/* ============================================================ 忆小尘主动开口 */

describe('忆小尘 · 主动开口', () => {
  function ctx(partial: Partial<NudgeContext> = {}): NudgeContext {
    return {
      today: '2024-03-15',
      transactions: [],
      rules: [],
      categories: [{ id: 'cat-e-0', name: '餐饮', type: 'expense', icon: '🍜', color: '#f00', builtin: true, sort: 0 }],
      lastRecordDate: null,
      ...partial,
    };
  }

  it('什么都没发生时保持沉默', () => {
    const txs = [tx({ type: 'expense', amount: 1000, date: '2024-03-15' })];
    expect(pickNudge(ctx({ transactions: txs, lastRecordDate: '2024-03-15' }))).toBeNull();
  });

  it('有到期的账单要先说账单', () => {
    const rule = {
      id: 'r1',
      title: '房租',
      type: 'expense' as const,
      amount: 350000,
      categoryId: 'cat-e-0',
      accountId: 'acc-cash',
      freq: 'monthly' as const,
      interval: 1,
      startDate: '2024-01-15',
      endDate: null,
      dayOfMonth: 15,
      weekday: null,
      monthOfYear: null,
      note: '',
      tags: [],
      confirmedDates: [],
      skippedDates: [],
      archived: false,
      createdAt: '',
      updatedAt: '',
    };
    const n = pickNudge(ctx({ rules: [rule], lastRecordDate: '2024-03-15' }));
    expect(n?.kind).toBe('billDue');
  });

  it('好几天没记账会提醒', () => {
    const n = pickNudge(ctx({ lastRecordDate: '2024-03-01' }));
    expect(n?.kind).toBe('noRecord');
  });

  it('刚记过账就不提醒', () => {
    const n = pickNudge(ctx({ lastRecordDate: '2024-03-14' }));
    expect(n).toBeNull();
  });

  it('lastRecordDate 取最新那笔', () => {
    const txs = [
      tx({ type: 'expense', amount: 100, date: '2024-03-01' }),
      tx({ type: 'expense', amount: 100, date: '2024-03-12' }),
      tx({ type: 'expense', amount: 100, date: '2024-03-05' }),
    ];
    expect(lastRecordDate(txs)).toBe('2024-03-12');
  });

  it('连续记账天数', () => {
    const txs = [
      tx({ type: 'expense', amount: 100, date: '2024-03-15' }),
      tx({ type: 'expense', amount: 100, date: '2024-03-14' }),
      tx({ type: 'expense', amount: 100, date: '2024-03-13' }),
      tx({ type: 'expense', amount: 100, date: '2024-03-11' }),
    ];
    expect(streakDays(txs, '2024-03-15')).toBe(3);
  });

  it('每日可用额度 = (预算 - 已花) / 剩余天数', () => {
    const txs = [tx({ type: 'expense', amount: 10000, date: '2024-03-01' })];
    // 3 月 31 天，今天 15 号 → 还剩 17 天（含今天）；预算 31000，已花 10000
    const allow = dailyAllowance(txs, '2024-03', 31000, '2024-03-15')!;
    expect(allow.left).toBe(21000);
    expect(allow.daysLeft).toBe(17);
    expect(allow.perDay).toBe(Math.round(21000 / 17));
  });

  it('没有预算时返回 null（而不是 0，0 会被当成「今天一分钱都不能花」）', () => {
    expect(dailyAllowance([], '2024-03', 0, '2024-03-15')).toBeNull();
  });
});
