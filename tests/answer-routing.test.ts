import { describe, expect, it } from 'vitest';
import { answerLedger, answerSchedule, parseEventCommand } from '../src/domain/assistant';
import type { LedgerSnapshot, ScheduleSnapshot } from '../src/domain/snapshot';
import type { Account, Budget, Category, Transaction } from '../src/domain/model';
import { newEvent, type EventItem } from '../src/domain/schedule';

/**
 * v0.10.1：答非所问的回归测试。
 *
 * 每一条都是拿真实问法跑出来才发现的，不是凭空想的：
 *   - 日程模式没有闲聊层，「你好」被答成「这周没有日程」
 *   - 「这周有什么安排」被当成建日程，要新建一条标题叫「有什么安排」的日程
 *   - 「今天几号」「现在几点」被当成「问今天的日程」
 *   - 「账户余额」不带账户名时答不出
 *   - 「这周打车那几笔都算交通」在改一笔和批量之间认错了
 *   - 日程模式下说记账的话，回的是「没听懂」而不是「去记账那边」
 */

const TODAY = '2026-11-03'; // 周二

const ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: '现金', kind: 'cash', initialBalance: 0, currency: 'CNY', includeInTotal: true, archived: false, sort: 0, createdAt: '' },
  { id: 'acc-alipay', name: '支付宝', kind: 'wallet', initialBalance: 0, currency: 'CNY', includeInTotal: true, archived: false, sort: 1, createdAt: '' },
];

const CATEGORIES: Category[] = [
  { id: 'cat-e-0', name: '餐饮', type: 'expense', icon: '🍜', color: '#f00', builtin: true, sort: 0 },
  { id: 'cat-e-1', name: '交通', type: 'expense', icon: '🚌', color: '#0f0', builtin: true, sort: 1 },
  { id: 'cat-e-2', name: '购物', type: 'expense', icon: '🛍️', color: '#00f', builtin: true, sort: 2 },
];

let seq = 0;
function tx(partial: Partial<Transaction> & { amount: number; date: string }): Transaction {
  seq += 1;
  return {
    id: `tx-${seq}`,
    type: 'expense',
    categoryId: 'cat-e-0',
    accountId: 'acc-cash',
    toAccountId: null,
    note: '',
    tags: [],
    createdAt: `${partial.date}T0${seq % 10}:00:00.000Z`,
    updatedAt: `${partial.date}T0${seq % 10}:00:00.000Z`,
    ...partial,
  };
}

function ev(partial: Partial<EventItem>): EventItem {
  return { ...newEvent(), ...partial };
}

function schedule(events: EventItem[] = []): ScheduleSnapshot {
  return { today: TODAY, events };
}

function ledger(txs: Transaction[] = [], extra: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
  return {
    today: TODAY,
    accounts: ACCOUNTS,
    categories: CATEGORIES,
    transactions: txs,
    budgets: [] as Budget[],
    events: [],
    rules: [],
    ...extra,
  };
}

/* ============================================================ 日程模式的闲聊 */

describe('日程模式 · 闲聊不再被答成「这周没有日程」', () => {
  const chatty = ['你好', '你好呀', '谢谢', '谢谢你', '你是谁', '你能做什么', '早上好', '晚安', '拜拜', '累死了', '心情不好', '讲个笑话', '2+3等于几', '现在几点'];

  for (const text of chatty) {
    it(`「${text}」不返回日程清单`, () => {
      const a = answerSchedule(text, schedule([ev({ title: '周会', date: '2026-11-04' })]));
      expect(a.kind).not.toBe('eventsInPeriod');
      // 交给上层去试闲聊，试不出来才说「没听懂」
      expect(a.kind).toBe('vague');
      if (a.kind !== 'vague') return;
      expect(a.guess).toBe('smalltalk');
    });
  }

  it('「今天几号」「今天星期几」也不当日程问题', () => {
    for (const text of ['今天几号', '今天星期几', '现在几点']) {
      const a = answerSchedule(text, schedule([ev({ title: '周会', date: TODAY })]));
      expect(a.kind).toBe('vague');
      if (a.kind !== 'vague') return;
      expect(a.guess).toBe('smalltalk');
    }
  });

  it('真的问日程时照常返回清单', () => {
    const events = [ev({ title: '周会', date: '2026-11-04' }), ev({ title: '看牙', date: '2026-11-06' })];
    for (const text of ['这周有什么日程', '这周有什么安排', '这周有几个日程', '周末有安排吗', '昨天有什么日程']) {
      const a = answerSchedule(text, schedule(events));
      expect(a.kind).toBe('eventsInPeriod');
    }
  });

  it('空字符串和纯标点不会崩，也不会硬答日程', () => {
    for (const text of ['', '   ', '？？？', 'a']) {
      const a = answerSchedule(text, schedule([]));
      expect(a.kind).toBe('vague');
    }
  });
});

/* ============================================================ 建日程的误判 */

describe('建日程 · 疑问句不该变成新建日程', () => {
  const questions = ['这周有什么安排', '周末有安排吗', '下周有几天要上班', '这周安排是什么', '明天有什么安排吗'];

  for (const text of questions) {
    it(`「${text}」不返回 proposeEvent`, () => {
      expect(parseEventCommand(text, schedule([]))).toBeNull();
    });
  }

  const commands = ['提醒我周三下午三点开会', '加个日程 明天 14:00-15:30 评审', '提醒我明天交房租', '安排一下明天下午三点评审'];

  for (const text of commands) {
    it(`「${text}」仍然能建日程`, () => {
      expect(parseEventCommand(text, schedule([]))).not.toBeNull();
    });
  }
});

/* ============================================================ 跨模式提示 */

describe('跨模式 · 说错地方时告诉用户去哪儿', () => {
  it('日程模式下说「记一笔午饭25」→ 指向记账', () => {
    const a = answerSchedule('记一笔午饭25', schedule([]));
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('money');
  });

  it('日程模式下说「这个月花了多少」→ 指向记账（时间词不该压过钱味）', () => {
    const a = answerSchedule('这个月花了多少', schedule([ev({ title: '周会', date: TODAY })]));
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('money');
  });

  it('账本模式下说「这周有什么安排」→ 指向日程', () => {
    const a = answerLedger('这周有什么安排', ledger([]));
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('schedule');
  });

  it('混着说「这周安排花了不少时间」仍然按日程处理，不被推走', () => {
    const a = answerSchedule('这周安排花了不少时间', schedule([ev({ title: '周会', date: '2026-11-04' })]));
    // 有日程词 + 有钱词，按日程走
    expect(a.kind).toBe('eventsInPeriod');
  });
});

/* ============================================================ 账户余额 */

describe('账户余额 · 不点名时列出各账户', () => {
  const txs = [tx({ amount: 10000, date: '2026-11-01', accountId: 'acc-cash' })];

  it('「账户余额」列出各账户明细，而不是「没听懂」', () => {
    const a = answerLedger('账户余额', ledger(txs));
    expect(a.kind).toBe('netWorth');
    if (a.kind !== 'netWorth') return;
    expect(a.top.length).toBeGreaterThan(0);
    expect(a.top.map((x) => x.name)).toContain('现金');
  });

  it('点名账户时仍然答单个账户', () => {
    const a = answerLedger('支付宝余额', ledger(txs));
    expect(a.kind).toBe('accountBalance');
    if (a.kind !== 'accountBalance') return;
    expect(a.name).toBe('支付宝');
  });

  it('「现金还有多少」答现金', () => {
    const a = answerLedger('现金还有多少', ledger(txs));
    expect(['accountBalance', 'netWorth']).toContain(a.kind);
  });
});

/* ============================================================ 批量归类 */

describe('批量归类 · 不要被「改一笔」抢走', () => {
  const txs = [
    tx({ amount: 3000, date: '2026-11-02', note: '打车' }),
    tx({ amount: 2800, date: '2026-11-03', note: '打车' }),
  ];

  it('「这周打车那几笔都算交通」改多笔', () => {
    const a = answerLedger('这周打车那几笔都算交通', ledger(txs));
    expect(a.kind).toBe('proposeBulk');
    if (a.kind !== 'proposeBulk') return;
    expect(a.bulk.txIds.length).toBe(2);
    expect(a.bulk.categoryName).toBe('交通');
  });

  it('「本周打车都改成交通」也改多笔（「都改成」不该被当成改一笔）', () => {
    const a = answerLedger('本周打车都改成交通', ledger(txs));
    expect(a.kind).toBe('proposeBulk');
  });

  it('「把刚才那笔改成 35」仍然是改一笔', () => {
    const a = answerLedger('把刚才那笔改成 35', ledger(txs));
    expect(a.kind).toBe('proposeEdit');
  });

  it('没有时间范围时不批量改（防止误伤去年的账）', () => {
    const a = answerLedger('打车那几笔都算交通', ledger(txs));
    expect(a.kind).not.toBe('proposeBulk');
  });
});

/* ============================================================ 事件账本 */

describe('事件账本 · 问活动花了多少不该被「花了多少」抢走', () => {
  // newEvent() 会随机生成 id，测试里必须用真实 id 去挂账
  const trip = ev({ title: '杭州出差', date: '2026-10-20' });
  const events = [trip];
  const txs = [
    tx({ amount: 50000, date: '2026-10-20', note: '高铁', eventId: trip.id }),
    tx({ amount: 80000, date: '2026-10-21', note: '住宿', eventId: trip.id }),
  ];

  it('「杭州出差那趟一共花了多少」答事件账本', () => {
    const a = answerLedger('杭州出差那趟一共花了多少', ledger(txs, { events }));
    expect(a.kind).toBe('eventSpend');
    if (a.kind !== 'eventSpend') return;
    expect(a.count).toBe(2);
    expect(a.expense).toBe(130000);
  });

  it('没有挂账时说明这场活动名下还没有账目', () => {
    const a = answerLedger('杭州出差那趟一共花了多少', ledger([], { events }));
    expect(a.kind).toBe('eventSpend');
    if (a.kind !== 'eventSpend') return;
    expect(a.count).toBe(0);
  });
});

/* ============================================================ 多笔记账 */

describe('多笔记账 · 明细和合计都要对', () => {
  it('两笔的合计是两笔之和，明细里各自有分类', () => {
    const a = answerLedger('记一笔：午饭12，打车28', ledger([]));
    expect(a.kind).toBe('proposeTransaction');
    if (a.kind !== 'proposeTransaction') return;
    expect(a.action.items).toHaveLength(2);
    expect(a.action.amount).toBe(4000);
    expect(a.action.items![0].categoryName).toBe('餐饮');
    expect(a.action.items![1].categoryName).toBe('交通');
  });

  it('只有一笔时不带 items', () => {
    const a = answerLedger('记一笔午饭25', ledger([]));
    if (a.kind !== 'proposeTransaction') throw new Error('expected proposeTransaction');
    expect(a.action.items).toBeUndefined();
    expect(a.action.amount).toBe(2500);
  });
});
