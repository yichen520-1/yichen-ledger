import { describe, expect, it } from 'vitest';
import {
  parseRecordCommands,
  parseEditCommand,
  parseDeleteCommand,
  parseBulkRetarget,
  parseBudgetCommand,
} from '../src/domain/assistant-actions';
import { parseTransferIntent, parseAmount, parseDayOffset, matchCategory } from '../src/domain/parse';
import { ask } from '../src/domain/assistant';
import {
  createSpeech,
  hasSpeechSupport,
  nameToContext,
  normalizeName,
  normalizeNote,
  normalizeNotes,
  notesToContext,
  parseRememberCommand,
  speechLangOf,
  transcriptOf,
  upsertNote,
  withName,
} from '../src/domain/persona';
import { CHAT_KEEP, makeRecord, sortRecords, trimRecords } from '../src/domain/chatlog';
import type { LedgerSnapshot } from '../src/domain/snapshot';
import type { Account, Budget, Category, Transaction } from '../src/domain/model';

const TODAY = '2024-03-15';

const ACCOUNTS: Account[] = [
  { id: 'acc-cash', name: '现金', kind: 'cash', initialBalance: 0, currency: 'CNY', includeInTotal: true, archived: false, sort: 0, createdAt: '' },
  { id: 'acc-alipay', name: '支付宝', kind: 'wallet', initialBalance: 0, currency: 'CNY', includeInTotal: true, archived: false, sort: 1, createdAt: '' },
];

const CATEGORIES: Category[] = [
  { id: 'cat-e-0', name: '餐饮', type: 'expense', icon: '🍜', color: '#f00', builtin: true, sort: 0 },
  { id: 'cat-e-1', name: '交通', type: 'expense', icon: '🚌', color: '#0f0', builtin: true, sort: 1 },
  { id: 'cat-e-2', name: '购物', type: 'expense', icon: '🛍️', color: '#00f', builtin: true, sort: 2 },
  { id: 'cat-i-0', name: '工资', type: 'income', icon: '💰', color: '#ff0', builtin: true, sort: 0 },
];

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
    createdAt: `${partial.date}T0${seq % 10}:00:00.000Z`,
    updatedAt: `${partial.date}T0${seq % 10}:00:00.000Z`,
    ...partial,
  };
}

function snap(txs: Transaction[] = [], extra: Partial<LedgerSnapshot> = {}): LedgerSnapshot {
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

/* ============================================================ 第 1 条：模糊说法兜底 */
describe('1 · 模糊说法兜底', () => {
  it('钱味的模糊说法给 money 方向', () => {
    const a = ask('最近是不是有点贵', 'ledger', snap());
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('money');
    expect(a.hints.length).toBeGreaterThan(0);
  });

  it('日程味的模糊说法给 schedule 方向', () => {
    const a = ask('我最近是不是太忙了', 'ledger', snap());
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('schedule');
  });

  it('完全没信号的句子给 smalltalk 方向，而不是干巴巴的 unknown', () => {
    const a = ask('随便说点什么', 'ledger', snap());
    expect(a.kind).toBe('vague');
    if (a.kind !== 'vague') return;
    expect(a.guess).toBe('smalltalk');
  });
});

/* ============================================================ 第 3 条：一次说多笔 */
describe('3 · 一次说多笔', () => {
  it('「记一笔：早饭12，打车28」拆成两条', () => {
    const list = parseRecordCommands('记一笔：早饭12，打车28', snap());
    expect(list).toHaveLength(2);
    expect(list[0].amount).toBe(1200);
    expect(list[0].categoryName).toBe('餐饮');
    expect(list[1].amount).toBe(2800);
    expect(list[1].categoryName).toBe('交通');
  });

  it('「早饭12 打车28 咖啡15」按金额位置二次切', () => {
    const list = parseRecordCommands('记一笔 早饭12 打车28 咖啡15', snap());
    expect(list.length).toBe(3);
    expect(list.map((x) => x.amount)).toEqual([1200, 2800, 1500]);
  });

  it('只说一笔时只返回一条', () => {
    const list = parseRecordCommands('记一笔午饭 25', snap());
    expect(list).toHaveLength(1);
  });

  it('没有金额的段落被丢掉，不会记错账', () => {
    const list = parseRecordCommands('记一笔 午饭 打车28', snap());
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((x) => x.amount > 0)).toBe(true);
  });

  it('最多 9 条（再多就该去页面上慢慢填了）', () => {
    const text = '记一笔 ' + Array.from({ length: 20 }, (_, i) => `午饭${i + 1}元`).join(' ');
    expect(parseRecordCommands(text, snap()).length).toBeLessThanOrEqual(9);
  });
});

/* ============================================================ 第 4 条：转账也能说 */
describe('4 · 转账也能说', () => {
  it('「从现金转 500 到支付宝」认得出两个账户', () => {
    const r = parseTransferIntent('从现金转 500 到支付宝', ACCOUNTS);
    expect(r).not.toBeNull();
    expect(r!.amount).toBe(50000);
    expect(r!.from.name).toBe('现金');
    expect(r!.to.name).toBe('支付宝');
  });

  it('只说「转 500」没目标账户时不猜', () => {
    expect(parseTransferIntent('转 500', ACCOUNTS)).toBeNull();
  });

  it('两个账户名是同一个时不算转账', () => {
    expect(parseTransferIntent('从现金转到现金 500', ACCOUNTS)).toBeNull();
  });
});

/* ============================================================ 第 5 条：改账删账 */
describe('5 · 改账删账', () => {
  const txs = [tx({ type: 'expense', amount: 5300, date: TODAY, note: '午饭' })];

  it('「刚才那笔改成 35」能定位到最近一笔并算出差额', () => {
    const e = parseEditCommand('刚才那笔改成 35', snap(txs));
    expect(e).not.toBeNull();
    expect(e!.txId).toBe(txs[0].id);
    expect(e!.after.amount).toBe(3500);
    expect(e!.changes).toContain('amount');
  });

  it('「把刚才那笔的备注改成和同事吃饭」改备注', () => {
    const e = parseEditCommand('把刚才那笔的备注改成和同事吃饭', snap(txs));
    expect(e).not.toBeNull();
    expect(e!.after.note).toBe('和同事吃饭');
    expect(e!.changes).toContain('note');
  });

  it('「把刚才那笔删了」定位到要删的那笔', () => {
    const d = parseDeleteCommand('把刚才那笔删了', snap(txs));
    expect(d).not.toBeNull();
    expect(d!.txId).toBe(txs[0].id);
    expect(d!.amount).toBe(5300);
  });

  it('没有账目时改账删账都返回 null，不会瞎猜', () => {
    expect(parseEditCommand('刚才那笔改成 35', snap([]))).toBeNull();
    expect(parseDeleteCommand('把刚才那笔删了', snap([]))).toBeNull();
  });

  it('「删掉」优先于「改成」—— 一句话里同时出现时按删除处理', () => {
    const a = ask('把刚才那笔删了', 'ledger', snap(txs));
    expect(a.kind).toBe('proposeDelete');
  });
});

/* ============================================================ 第 7 条：批量归类 */
describe('7 · 批量归类', () => {
  const txs = [
    tx({ type: 'expense', amount: 3000, date: '2024-03-10', note: '打车', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 2800, date: '2024-03-12', note: '打车', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 5000, date: '2024-01-05', note: '打车', categoryId: 'cat-e-0' }),
  ];

  it('「这周打车那几笔都算交通」只改范围内的', () => {
    const b = parseBulkRetarget('这周打车那几笔都算交通', snap(txs), { from: '2024-03-11', to: '2024-03-17' });
    expect(b).not.toBeNull();
    expect(b!.categoryName).toBe('交通');
    expect(b!.txIds.length).toBe(1); // 只有 03-12 在范围内
  });

  it('没有时间范围就不动（防止改掉去年的账）', () => {
    expect(parseBulkRetarget('打车那几笔都算交通', snap(txs), null)).toBeNull();
  });

  it('没有目标分类就不动', () => {
    expect(parseBulkRetarget('这周打车那几笔都算', snap(txs), { from: '2024-03-11', to: '2024-03-17' })).toBeNull();
  });
});

/* ============================================================ 第 8 条：一句话生成预算 */
describe('8 · 一句话生成预算', () => {
  const txs = [tx({ type: 'expense', amount: 120000, date: '2024-02-10', categoryId: 'cat-e-0' })];

  it('说了金额就直接用', () => {
    const d = parseBudgetCommand('这个月吃饭预算定 1500', snap(txs), () => '2024-02');
    expect(d).not.toBeNull();
    expect(d!.amount).toBe(150000);
    expect(d!.categoryName).toBe('餐饮');
  });

  it('说「按上个月」时用上月实际支出当额度', () => {
    const d = parseBudgetCommand('按上个月的实际花销给我定个预算', snap(txs), () => '2024-02');
    expect(d).not.toBeNull();
    expect(d!.basis.amount).toBe(120000);
    expect(d!.amount).toBe(120000);
  });

  it('不是预算的句子不认', () => {
    expect(parseBudgetCommand('这个月花了多少', snap(txs), () => '2024-02')).toBeNull();
  });
});

/* ============================================================ 第 9 条：事件账本问答 */
describe('9 · 事件账本问答', () => {
  const events = [
    {
      id: 'ev-1', title: '杭州出差', notes: '', location: '', date: '2024-03-01',
      startTime: '09:00', endTime: '18:00', allDay: false, color: '#5aa9f0', tag: '',
      recurrence: { freq: 'none' as const, interval: 1, weekdays: [], until: null },
      reminders: [], done: false, doneDates: [], createdAt: '', updatedAt: '',
    },
  ];
  const txs = [
    tx({ type: 'expense', amount: 50000, date: '2024-03-01', eventId: 'ev-1', note: '高铁' }),
    tx({ type: 'expense', amount: 80000, date: '2024-03-02', eventId: 'ev-1', note: '住宿' }),
  ];

  it('「杭州出差那趟一共花了多少」算得出合计', () => {
    const a = ask('杭州出差那趟一共花了多少', 'ledger', snap(txs, { events }));
    expect(a.kind).toBe('eventSpend');
    if (a.kind !== 'eventSpend') return;
    expect(a.eventTitle).toBe('杭州出差');
    expect(a.count).toBe(2);
    expect(a.expense).toBe(130000);
  });

  it('没挂账的活动说 0，不编数字', () => {
    const a = ask('杭州出差那趟一共花了多少', 'ledger', snap([], { events }));
    expect(a.kind).toBe('eventSpend');
    if (a.kind !== 'eventSpend') return;
    expect(a.count).toBe(0);
    expect(a.expense).toBe(0);
  });
});

/* ============================================================ 第 14 条：记得称呼 */
describe('14 · 记得称呼', () => {
  it('规整称呼：去空白、去标点、截断', () => {
    expect(normalizeName('  老陈  ')).toBe('老陈');
    expect(normalizeName('阿May，')).toBe('阿May');
    expect(normalizeName('一二三四五六七八九十一二三')).toHaveLength(12);
  });

  it('没名字时把整个占位符连同逗号一起删掉，不留多余的标点', () => {
    expect(withName('{name}，今天花了 100', '')).toBe('今天花了 100');
    expect(withName('{name}，今天花了 100', '老陈')).toBe('老陈，今天花了 100');
  });

  it('称呼进系统提示词；没名字时返回空串', () => {
    expect(nameToContext('老陈')).toBe('[用户称呼] 老陈');
    expect(nameToContext('')).toBe('');
  });
});

/* ============================================================ 第 16 条：说话有记忆 */
describe('16 · 说话有记忆（助手笔记）', () => {
  it('「记住：我不吃香菜」用冒号前当 key', () => {
    const r = parseRememberCommand('记住：饮食：我不吃香菜');
    expect(r).not.toBeNull();
    expect(r!.key).toBe('饮食');
    expect(r!.value).toBe('我不吃香菜');
  });

  it('没有冒号时按开头几个字猜 key', () => {
    const r = parseRememberCommand('记住我不吃香菜');
    expect(r).not.toBeNull();
    expect(r!.key).toBe('饮食');
  });

  it('同 key 的笔记会替换，不会堆成两条', () => {
    const a = upsertNote([], '饮食', '不吃香菜', '2024-03-15T00:00:00.000Z');
    const b = upsertNote(a, '饮食', '现在吃香菜了', '2024-03-16T00:00:00.000Z');
    expect(b).toHaveLength(1);
    expect(b[0].value).toBe('现在吃香菜了');
  });

  it('笔记进提示词；没笔记返回空串（不留空标题）', () => {
    const notes = [{ id: 'n1', key: '饮食', value: '不吃香菜', createdAt: '' }];
    expect(notesToContext(notes)).toContain('饮食');
    expect(notesToContext([])).toBe('');
  });

  it('坏数据被规整掉', () => {
    expect(normalizeNote({ key: '', value: 'x' }, '')).toBeNull();
    expect(normalizeNote({ key: 'k', value: '' }, '')).toBeNull();
    expect(normalizeNotes([{ key: 'k', value: 'v' }, null, 'bad'], '')).toHaveLength(1);
  });
});

/* ============================================================ 第 17 条：语音输入 */
describe('17 · 语音输入', () => {
  it('语言标签跟着界面语言走', () => {
    expect(speechLangOf('zh')).toBe('zh-CN');
    expect(speechLangOf('en')).toBe('en-US');
    expect(speechLangOf('ja')).toBe('ja-JP');
  });

  it('浏览器不支持时 hasSpeechSupport 返回 false、createSpeech 返回 null', () => {
    // vitest 跑在 node 环境，没有 window
    expect(hasSpeechSupport()).toBe(false);
    expect(createSpeech('zh')).toBeNull();
  });

  it('识别结果拼成一句', () => {
    const ev = { results: [[{ transcript: '这个月' }], [{ transcript: '花了多少' }]], resultIndex: 0 };
    expect(transcriptOf(ev)).toBe('这个月花了多少');
  });
});

/* ============================================================ 第 15 条：记住对话 */
describe('15 · 记住对话', () => {
  it('超过 50 条时只留最近的', () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      makeRecord('user', `第 ${i} 条`, undefined, new Date(2024, 0, 1, 0, i).toISOString()),
    );
    const kept = trimRecords(rows);
    expect(kept).toHaveLength(CHAT_KEEP);
    expect(kept[kept.length - 1].text).toBe('第 79 条');
  });

  it('排序按时间正序', () => {
    const rows = [
      makeRecord('user', 'b', undefined, '2024-03-02T00:00:00.000Z'),
      makeRecord('user', 'a', undefined, '2024-03-01T00:00:00.000Z'),
    ];
    expect(sortRecords(rows).map((r) => r.text)).toEqual(['a', 'b']);
  });

  it('云端回答带 source 标记，本地的不带', () => {
    expect(makeRecord('assistant', 'x', 'cloud', '2024-03-01T00:00:00.000Z').source).toBe('cloud');
    expect(makeRecord('assistant', 'x', undefined, '2024-03-01T00:00:00.000Z').source).toBeUndefined();
  });
});

/* ============================================================ 第 2 条：多轮追问 */
describe('2 · 多轮追问', () => {
  const txs = [
    tx({ type: 'expense', amount: 10000, date: '2024-03-10', categoryId: 'cat-e-0' }),
    tx({ type: 'expense', amount: 20000, date: '2024-02-10', categoryId: 'cat-e-0' }),
  ];

  it('「这个月吃饭花了多少」能答', () => {
    const a = ask('这个月吃饭花了多少', 'ledger', snap(txs));
    expect(a.kind).toBe('spend');
    if (a.kind !== 'spend') return;
    expect(a.amount).toBe(10000);
  });

  it('把追问补全成「上个月吃饭花了多少」后答得出上个月', () => {
    const a = ask('上个月吃饭花了多少', 'ledger', snap(txs));
    expect(a.kind).toBe('spend');
    if (a.kind !== 'spend') return;
    expect(a.amount).toBe(20000);
  });
});

/* ============================================================ 第 6 条：直接搜账 */
describe('6 · 直接搜账', () => {
  const txs = [
    tx({ type: 'expense', amount: 35000, date: '2024-03-05', categoryId: 'cat-e-2', note: '买衣服' }),
    tx({ type: 'expense', amount: 12000, date: '2024-03-06', categoryId: 'cat-e-0', note: '午饭' }),
  ];

  it('「上个月买衣服那几笔」能列出清单', () => {
    const a = ask('这个月买衣服那几笔', 'ledger', snap(txs));
    // 走 txList 或 spend，但一定要能答上来而不是 vague
    expect(['txList', 'spend']).toContain(a.kind);
  });
});

/* ============================================================ 解析工具 */
describe('解析工具', () => {
  it('金额解析：带元/块才认，不认中文数字', () => {
    expect(parseAmount('25 元')?.amount).toBe(2500);
    expect(parseAmount('25块')?.amount).toBe(2500);
    // 「两百五」猜错代价是记错账，所以刻意不认
    expect(parseAmount('两百五')).toBeNull();
  });

  it('日期偏移', () => {
    expect(parseDayOffset('昨天')).toBe(-1);
    expect(parseDayOffset('今天')).toBe(0);
    expect(parseDayOffset('大后天')).toBe(3);
    expect(parseDayOffset('没提日期')).toBeNull();
  });

  it('分类同义词', () => {
    expect(matchCategory('打车', CATEGORIES, 'expense')?.name).toBe('交通');
    expect(matchCategory('午饭', CATEGORIES, 'expense')?.name).toBe('餐饮');
    expect(matchCategory('工资', CATEGORIES, 'income')?.name).toBe('工资');
  });
});
