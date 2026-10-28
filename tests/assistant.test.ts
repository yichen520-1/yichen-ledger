import { describe, expect, it } from 'vitest';
import {
  answerLedger,
  answerSchedule,
  buildLedgerContext,
  buildScheduleContext,
  freeSlots,
  matchCategory,
  parseEventCommand,
  parsePeriod,
  parseRecordCommand,
  resolvePeriod,
  type LedgerSnapshot,
  type ScheduleSnapshot,
} from '../src/domain/assistant';
import type { Account, Budget, Category, Transaction } from '../src/domain/model';
import { newEvent, type EventItem } from '../src/domain/schedule';

/* --------------------------------------------------------------- 测试夹具 */

const TODAY = '2024-03-15'; // 周五

function cat(id: string, name: string, type: 'expense' | 'income' = 'expense'): Category {
  return { id, name, type, icon: '·', color: '#fff', builtin: true, sort: 0 };
}

const CATS: Category[] = [
  cat('c-food', '餐饮'),
  cat('c-trans', '交通'),
  cat('c-shop', '购物'),
  cat('c-salary', '工资', 'income'),
  cat('c-other', '其他支出'),
  cat('c-other-in', '其他收入', 'income'),
];

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

const ACCOUNTS: Account[] = [acc('a-cash', '现金', 100000), acc('a-alipay', '支付宝', 20000)];

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

function ledger(txs: Transaction[], budgets: Budget[] = []): LedgerSnapshot {
  return { today: TODAY, accounts: ACCOUNTS, categories: CATS, transactions: txs, budgets };
}

function ev(partial: Partial<EventItem>): EventItem {
  return { ...newEvent(), ...partial };
}

function schedule(events: EventItem[] = []): ScheduleSnapshot {
  return { today: TODAY, events };
}

/* ------------------------------------------------------------------ 区间 */

describe('时间区间', () => {
  it('「这个月」「上个月」落在正确的日期边界', () => {
    const thisMonth = resolvePeriod('thisMonth', 1, TODAY);
    expect(thisMonth.from).toBe('2024-03-01');
    expect(thisMonth.to).toBe('2024-03-31');

    const lastMonth = resolvePeriod('lastMonth', 1, TODAY);
    expect(lastMonth.from).toBe('2024-02-01');
    expect(lastMonth.to).toBe('2024-02-29'); // 闰年
  });

  it('「最近7天」包含今天', () => {
    const p = resolvePeriod('recentDays', 7, TODAY);
    expect(p.from).toBe('2024-03-09');
    expect(p.to).toBe(TODAY);
  });

  it('「这周」从周一开始算', () => {
    const p = resolvePeriod('thisWeek', 1, TODAY);
    expect(p.from).toBe('2024-03-11'); // 周一
    expect(p.to).toBe('2024-03-17'); // 周日
  });

  it('parsePeriod 能认出常见说法', () => {
    expect(parsePeriod('这个月花了多少', TODAY)?.kind).toBe('thisMonth');
    expect(parsePeriod('昨天吃饭', TODAY)?.from).toBe('2024-03-14');
    expect(parsePeriod('最近30天', TODAY)?.kind).toBe('recentDays');
    expect(parsePeriod('最近三个月', TODAY)?.n).toBe(3);
    expect(parsePeriod('随便说说', TODAY)).toBeNull();
  });

  it('「上个月」优先于「月」，不会被拆错', () => {
    const p = parsePeriod('上个月', TODAY);
    expect(p?.kind).toBe('lastMonth');
  });
});

/* ------------------------------------------------------------- 分类匹配 */

describe('分类匹配', () => {
  it('分类名直接命中', () => {
    expect(matchCategory('这个月交通花了多少', CATS)?.id).toBe('c-trans');
  });

  it('口语同义词能落到分类上', () => {
    expect(matchCategory('这个月吃饭花了多少', CATS)?.id).toBe('c-food');
    expect(matchCategory('打车花了多少', CATS)?.id).toBe('c-trans');
    expect(matchCategory('买衣服', CATS)?.id).toBe('c-shop');
  });

  it('收入类只在自己的池子里找', () => {
    expect(matchCategory('工资多少', CATS, 'income')?.id).toBe('c-salary');
    expect(matchCategory('工资多少', CATS, 'expense')).toBeNull();
  });

  it('认不出来就是 null，不瞎猜', () => {
    expect(matchCategory('今天心情不错', CATS)).toBeNull();
  });
});

/* ------------------------------------------------------------- 记账问答 */

describe('记账问答', () => {
  const txs = [
    tx({ amount: 3000, categoryId: 'c-food', date: '2024-03-02' }),
    tx({ amount: 2000, categoryId: 'c-food', date: '2024-03-08' }),
    tx({ amount: 6000, categoryId: 'c-shop', date: '2024-03-10' }),
    tx({ amount: 1200, categoryId: 'c-trans', date: '2024-03-12' }),
    tx({ amount: 900000, type: 'income', categoryId: 'c-salary', date: '2024-03-01' }),
    // 上个月，不该被「这个月」算进去
    tx({ amount: 9900, categoryId: 'c-food', date: '2024-02-20' }),
    // 转账不该算收支
    tx({ amount: 50000, type: 'transfer', toAccountId: 'a-alipay', date: '2024-03-11' }),
  ];

  it('问这个月花了多少，只统计本月支出', () => {
    const a = answerLedger('这个月花了多少', ledger(txs));
    expect(a.kind).toBe('spend');
    if (a.kind !== 'spend') return;
    expect(a.amount).toBe(3000 + 2000 + 6000 + 1200);
    expect(a.count).toBe(4);
    expect(a.categoryName).toBeNull();
  });

  it('问某个分类的支出，会缩小范围', () => {
    const a = answerLedger('这个月吃饭花了多少', ledger(txs));
    expect(a.kind).toBe('spend');
    if (a.kind !== 'spend') return;
    expect(a.amount).toBe(5000);
    expect(a.count).toBe(2);
    expect(a.categoryName).toBe('餐饮');
  });

  it('没有记录的区间返回 0，而不是报错', () => {
    const a = answerLedger('今天花了多少', ledger(txs));
    expect(a.kind).toBe('spend');
    if (a.kind !== 'spend') return;
    expect(a.amount).toBe(0);
    expect(a.count).toBe(0);
  });

  it('问收入', () => {
    const a = answerLedger('这个月收入多少', ledger(txs));
    expect(a.kind).toBe('income');
    if (a.kind !== 'income') return;
    expect(a.amount).toBe(900000);
    expect(a.count).toBe(1);
  });

  it('问哪一类花得最多，并给出占比', () => {
    const a = answerLedger('这个月哪一类花得最多', ledger(txs));
    expect(a.kind).toBe('topCategory');
    if (a.kind !== 'topCategory') return;
    expect(a.name).toBe('购物');
    expect(a.amount).toBe(6000);
    expect(a.total).toBe(12200);
    expect(a.share).toBeCloseTo(6000 / 12200, 5);
    expect(a.rest.map((r) => r.name)).toContain('餐饮');
  });

  it('净资产把账户初始余额和流水一起算', () => {
    const a = answerLedger('我现在有多少钱', ledger(txs));
    expect(a.kind).toBe('netWorth');
    if (a.kind !== 'netWorth') return;
    // 初始 100000 + 20000，加上本月收入 900000，减去本月支出 12200 与上月的 9900
    expect(a.amount).toBe(120000 + 900000 - 12200 - 9900);
  });

  it('预算：超支的会标出来', () => {
    const budgets: Budget[] = [
      { id: 'b1', categoryId: 'c-food', amount: 4000, month: null, createdAt: '2024-01-01' },
      { id: 'b2', categoryId: 'c-shop', amount: 3000, month: null, createdAt: '2024-01-01' },
    ];
    const a = answerLedger('预算还剩多少', ledger(txs, budgets));
    expect(a.kind).toBe('budgetStatus');
    if (a.kind !== 'budgetStatus') return;
    const food = a.items.find((x) => x.name === '餐饮');
    const shop = a.items.find((x) => x.name === '购物');
    expect(food?.spent).toBe(5000);
    expect(food?.limit).toBe(4000);
    expect(food!.ratio).toBeGreaterThan(1);
    expect(shop?.ratio).toBeGreaterThan(1); // 6000 / 3000
  });

  it('预算建议按最近几个月平均', () => {
    const a = answerLedger('下个月预算定多少合适', ledger(txs));
    expect(a.kind).toBe('budgetSuggest');
    if (a.kind !== 'budgetSuggest') return;
    expect(a.amount).toBeGreaterThan(0);
    expect(a.basisMonths).toBeGreaterThanOrEqual(1);
  });

  it('趋势给出连续月份的支出', () => {
    const a = answerLedger('最近6个月的趋势', ledger(txs));
    expect(a.kind).toBe('trend');
    if (a.kind !== 'trend') return;
    expect(a.points.length).toBe(6);
    expect(a.points[a.points.length - 1].month).toBe('2024-03');
  });

  it('听不懂时给出提示而不是崩溃', () => {
    const a = answerLedger('今天天气怎么样', ledger(txs));
    expect(a.kind).toBe('unknown');
  });
});

/* ------------------------------------------------------------- 记一笔 */

describe('从一句话里记账', () => {
  const snap = ledger([]);

  it('「记一笔午饭 25」能拆出金额与分类', () => {
    const p = parseRecordCommand('记一笔午饭 25', snap);
    expect(p).not.toBeNull();
    expect(p!.amount).toBe(2500);
    expect(p!.type).toBe('expense');
    expect(p!.categoryName).toBe('餐饮');
    expect(p!.date).toBe(TODAY);
  });

  it('带账户名会认到账户', () => {
    const p = parseRecordCommand('记一笔打车 30 支付宝', snap);
    expect(p!.amount).toBe(3000);
    expect(p!.accountName).toBe('支付宝');
  });

  it('带「收入」就是收入', () => {
    const p = parseRecordCommand('记一笔收入 5000 工资', snap);
    expect(p!.type).toBe('income');
    expect(p!.amount).toBe(500000);
    expect(p!.categoryName).toBe('工资');
  });

  it('「昨天」会落到昨天', () => {
    const p = parseRecordCommand('记一笔昨天晚饭 40', snap);
    expect(p!.date).toBe('2024-03-14');
  });

  it('小数金额按分四舍五入', () => {
    const p = parseRecordCommand('记一笔咖啡 12.35', snap);
    expect(p!.amount).toBe(1235);
  });

  it('不是记账句式就不返回', () => {
    expect(parseRecordCommand('这个月花了多少', snap)).toBeNull();
    expect(parseRecordCommand('记一笔', snap)).toBeNull();
  });

  it('answerLedger 遇到记账句式会给出待确认动作', () => {
    const a = answerLedger('记一笔午饭 25', snap);
    expect(a.kind).toBe('proposeTransaction');
    if (a.kind !== 'proposeTransaction') return;
    expect(a.action.amount).toBe(2500);
  });
});

/* ------------------------------------------------------------- 日程问答 */

describe('日程问答', () => {
  const events: EventItem[] = [
    ev({ id: 'e1', title: '周会', date: '2024-03-15', startTime: '10:00', endTime: '11:00', allDay: false }),
    ev({ id: 'e2', title: '评审', date: '2024-03-15', startTime: '14:00', endTime: '15:30', allDay: false }),
    ev({ id: 'e3', title: '交房租', date: '2024-03-16', allDay: true, startTime: '', endTime: '' }),
  ];

  it('问这周有几个日程', () => {
    const a = answerSchedule('这周有几个日程', schedule(events));
    expect(a.kind).toBe('eventsInPeriod');
    if (a.kind !== 'eventsInPeriod') return;
    expect(a.items.length).toBe(3);
  });

  it('问某个区间没有日程时说没有', () => {
    const a = answerSchedule('昨天有什么日程', schedule(events));
    expect(a.kind).toBe('eventsInPeriod');
    if (a.kind !== 'eventsInPeriod') return;
    expect(a.items).toEqual([]);
  });

  it('问空闲时间会扣掉已占用的', () => {
    const a = answerSchedule('今天下午有空吗', schedule(events));
    expect(a.kind).toBe('freeTime');
    if (a.kind !== 'freeTime') return;
    expect(a.busy.map((b) => b.title)).toEqual(['周会', '评审']);
    // 15:30 之后到 22:00 应该是空的
    expect(a.freeSlots.some(([s]) => s >= '15:30')).toBe(true);
    // 10:00–11:00 被占，不该出现在空闲里
    expect(a.freeSlots.some(([s, e]) => s < '11:00' && e > '10:00')).toBe(false);
  });

  it('freeSlots 在没有日程时给出一整段', () => {
    const r = freeSlots([], '2024-03-15');
    expect(r.busy).toEqual([]);
    expect(r.free).toEqual([['09:00', '22:00']]);
  });

  it('问接下来的日程', () => {
    const a = answerSchedule('接下来有什么', schedule(events));
    expect(a.kind).toBe('nextEvents');
    if (a.kind !== 'nextEvents') return;
    expect(a.items.length).toBe(3);
    expect(a.items[0].title).toBe('周会');
  });

  it('「提醒我周五三点开会」会变成一条待确认日程', () => {
    const p = parseEventCommand('提醒我周五下午三点开会', schedule([]));
    expect(p).not.toBeNull();
    expect(p!.date).toBe('2024-03-15');
    expect(p!.startTime).toBe('15:00');
    expect(p!.endTime).toBe('16:00');
    expect(p!.title).toContain('开会');
  });

  it('「明天 14:00-15:30 评审」能认出时间段', () => {
    const p = parseEventCommand('加个日程 明天 14:00-15:30 评审', schedule([]));
    expect(p!.date).toBe('2024-03-16');
    expect(p!.startTime).toBe('14:00');
    expect(p!.endTime).toBe('15:30');
  });

  it('没有时间词就当成全天', () => {
    const p = parseEventCommand('提醒我明天交房租', schedule([]));
    expect(p!.allDay).toBe(true);
    expect(p!.date).toBe('2024-03-16');
  });

  it('不是建日程的句子不返回', () => {
    expect(parseEventCommand('这周有几个日程', schedule([]))).toBeNull();
  });
});

/* --------------------------------------------------- 给云端的数据摘要 */

describe('云端上下文', () => {
  const txs = [tx({ amount: 3000, categoryId: 'c-food', date: '2024-03-02', note: '午饭' })];

  it('账本摘要包含本月合计与分类', () => {
    const ctx = buildLedgerContext(ledger(txs), 'zh');
    expect(ctx).toContain('[今天] 2024-03-15');
    expect(ctx).toContain('[本月 2024-03]');
    expect(ctx).toContain('餐饮');
    expect(ctx).toContain('[净资产]');
  });

  it('日程摘要包含今天与近期安排', () => {
    const ctx = buildScheduleContext(
      schedule([ev({ id: 'e1', title: '周会', date: '2024-03-15', startTime: '10:00', endTime: '11:00' })]),
      'zh',
    );
    expect(ctx).toContain('[今天] 2024-03-15');
    expect(ctx).toContain('周会');
  });

  it('空数据也能生成摘要，不会崩', () => {
    expect(buildLedgerContext(ledger([]), 'en')).toContain('[今天]');
    expect(buildScheduleContext(schedule([]), 'ja')).toContain('[今天]');
  });
});
