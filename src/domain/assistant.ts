/**
 * 忆小尘的「本地规则引擎」
 * ------------------------------------------------------------------
 * 这个文件是纯领域层：不依赖 React、不依赖 Dexie、不碰网络。
 * 输入是「用户说的一句话 + 一份数据快照」，输出是一个结构化的回答。
 *
 * 为什么不让它直接产出中文句子：
 *   界面有三种语言。规则引擎算出来的应该是「花了 1234 分、餐饮分类、这个月」
 *   这样的事实，具体怎么说交给 i18n 层（见 src/state/assistant.tsx 的
 *   renderAnswer）。这和数据层只抛错误码是同一个思路。
 *
 * 为什么先做规则而不是直接接大模型：
 *   - 大多数人问的是同样那十几个问题（这个月花了多少、哪类最多、预算还剩多少），
 *     本地算一遍几十毫秒，还不用联网、不花钱、不把账单发给任何服务器；
 *   - 没填 API Key 的时候它必须是能用的，这是「本地优先」的底线；
 *   - 填了 Key 之后云端会接手自由对话，但常见问题仍然先走本地，省一次往返。
 */

import {
  accountBalance,
  budgetStatus,
  expenseByCategory,
  formatCents,
  monthKeyOf,
  monthTotals,
  monthlyTrend,
  netWorth,
  shiftMonth,
  toDateKey,
  type Account,
  type Budget,
  type Category,
  type Transaction,
  type TxType,
} from './model';
import {
  addDays,
  expandRange,
  monthGrid,
  minutesOf,
  startOfWeek,
  weekDays,
  type EventItem,
  type Occurrence,
} from './schedule';
import { fixedTotals, pendingBills, type RecurringRule } from './recurring';
import { weekRangeOf, weekSchedule, weekStats } from './weekly';

/* ------------------------------------------------------------------ 时间区间 */

export type PeriodKind =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'recentDays'
  | 'recentMonths'
  | 'month'
  | 'all';

/** 一个已经解析成具体日期的区间，from / to 都是含端点的 'YYYY-MM-DD' */
export interface Period {
  kind: PeriodKind;
  /** recentDays 的天数、recentMonths 的月数、month 的「几月」 */
  n: number;
  /** month 类型时是 'YYYY-MM' */
  month: string | null;
  from: string;
  to: string;
}

/** 中文数字 → 阿拉伯数字，只处理 1~12，够用了 */
const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

function toNum(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  return CN_NUM[raw] ?? 0;
}

/** 某月第一天 / 最后一天 */
function monthBounds(monthKey: string): { from: string; to: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${monthKey}-01`, to: `${monthKey}-${String(last).padStart(2, '0')}` };
}

export function resolvePeriod(kind: PeriodKind, n: number, today: string, month?: string | null): Period {
  const curMonth = monthKeyOf(today);
  const curYear = today.slice(0, 4);

  switch (kind) {
    case 'today':
      return { kind, n: 1, month: null, from: today, to: today };
    case 'yesterday': {
      const d = new Date(`${today}T00:00:00`);
      d.setDate(d.getDate() - 1);
      const key = toDateKey(d);
      return { kind, n: 1, month: null, from: key, to: key };
    }
    case 'thisWeek': {
      const from = startOfWeek(today);
      const days = weekDays(today);
      return { kind, n: 1, month: null, from, to: days[6] };
    }
    case 'lastWeek': {
      const d = new Date(`${startOfWeek(today)}T00:00:00`);
      d.setDate(d.getDate() - 7);
      const from = toDateKey(d);
      const days = weekDays(from);
      return { kind, n: 1, month: null, from, to: days[6] };
    }
    case 'thisMonth': {
      const b = monthBounds(curMonth);
      return { kind, n: 1, month: curMonth, ...b };
    }
    case 'lastMonth': {
      const m = shiftMonth(curMonth, -1);
      const b = monthBounds(m);
      return { kind, n: 1, month: m, ...b };
    }
    case 'thisYear':
      return { kind, n: 1, month: null, from: `${curYear}-01-01`, to: `${curYear}-12-31` };
    case 'lastYear': {
      const y = String(Number(curYear) - 1);
      return { kind, n: 1, month: null, from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case 'recentDays': {
      const days = Math.max(1, n || 7);
      const d = new Date(`${today}T00:00:00`);
      d.setDate(d.getDate() - (days - 1));
      return { kind, n: days, month: null, from: toDateKey(d), to: today };
    }
    case 'recentMonths': {
      const count = Math.max(1, n || 3);
      const firstMonth = shiftMonth(curMonth, -(count - 1));
      return {
        kind,
        n: count,
        month: null,
        from: monthBounds(firstMonth).from,
        to: monthBounds(curMonth).to,
      };
    }
    case 'month': {
      const mk = month ?? curMonth;
      const b = monthBounds(mk);
      return { kind, n: 1, month: mk, ...b };
    }
    case 'all':
    default:
      return { kind: 'all', n: 1, month: null, from: '1970-01-01', to: '2999-12-31' };
  }
}

/**
 * 从一句话里找时间区间。
 * 顺序很重要：先匹配更长的词（「上个月」要在「月」之前），否则会解析错。
 */
export function parsePeriod(text: string, today: string): Period | null {
  const t = text.replace(/\s+/g, '');
  const curMonth = monthKeyOf(today);
  const curYear = Number(today.slice(0, 4));

  // 「最近7天」「最近三个月」「过去 30 天」
  const recentDay = t.match(/(?:最近|过去|近)(\d+|[一二两三四五六七八九十]+)(?:天|日)/);
  if (recentDay) return resolvePeriod('recentDays', toNum(recentDay[1]), today);
  const recentWeek = t.match(/(?:最近|过去|近)(\d+|[一二两三四五六七八九十]+)(?:周|个?星期)/);
  if (recentWeek) return resolvePeriod('recentDays', toNum(recentWeek[1]) * 7, today);
  const recentMonth = t.match(/(?:最近|过去|近)(\d+|[一二两三四五六七八九十]+)(?:个?月)/);
  if (recentMonth) return resolvePeriod('recentMonths', toNum(recentMonth[1]), today);

  if (/今天|今日/.test(t)) return resolvePeriod('today', 1, today);
  if (/昨天|昨日/.test(t)) return resolvePeriod('yesterday', 1, today);
  // 「明天」「后天」「前天」不是「区间」，但记一笔/建日程都要知道是哪天，
  // 所以借 today 这个形状返回一个只有一天的单日区间，调用方看 from 就行。
  const offsetDay = t.match(/(明天|明日|后天|前天)/);
  if (offsetDay) {
    const delta = offsetDay[1] === '后天' ? 2 : offsetDay[1] === '前天' ? -2 : 1;
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + delta);
    return resolvePeriod('today', 1, toDateKey(d));
  }
  if (/上个?星期|上个?周|上星期/.test(t)) return resolvePeriod('lastWeek', 1, today);
  if (/这个?星期|这个?周|本星期|本周/.test(t)) return resolvePeriod('thisWeek', 1, today);
  if (/上个?月/.test(t)) return resolvePeriod('lastMonth', 1, today);
  if (/这个?月|本月|当月/.test(t)) return resolvePeriod('thisMonth', 1, today);
  if (/去年/.test(t)) return resolvePeriod('lastYear', 1, today);
  if (/今年|本年/.test(t)) return resolvePeriod('thisYear', 1, today);

  // 「9月」「三月」这种单独的月份：默认取今年，如果今年还没到那个月就取去年
  const monthOnly = t.match(/(\d{1,2}|[一二三四五六七八九十]{1,2})月(?!份?[一二三四五六七八九十\d]*[天日])/);
  if (monthOnly) {
    const m = toNum(monthOnly[1]);
    if (m >= 1 && m <= 12) {
      const curMonthNum = Number(curMonth.slice(5, 7));
      const year = m > curMonthNum ? curYear - 1 : curYear;
      const mk = `${year}-${String(m).padStart(2, '0')}`;
      return resolvePeriod('month', 1, today, mk);
    }
  }

  return null;
}

/* ------------------------------------------------------------------ 回答形状 */

/** 一条「事实」回答。界面层负责把它说成人话。 */
export type Answer =
  | { kind: 'spend'; period: Period; amount: number; count: number; categoryName: string | null }
  | { kind: 'income'; period: Period; amount: number; count: number }
  | { kind: 'netWorth'; amount: number; top: Array<{ name: string; amount: number }> }
  | { kind: 'accountBalance'; name: string; amount: number; matched: string[] }
  | { kind: 'topCategory'; period: Period; name: string; amount: number; total: number; share: number; rest: Array<{ name: string; amount: number }> }
  | { kind: 'rising'; period: Period; prevMonth: string; items: Array<{ name: string; now: number; before: number; delta: number }> }
  | { kind: 'budgetStatus'; month: string; items: Array<{ name: string; spent: number; limit: number; ratio: number }> }
  | { kind: 'budgetSuggest'; month: string; amount: number; basisMonths: number; detail: Array<{ month: string; amount: number }> }
  | { kind: 'trend'; points: Array<{ month: string; expense: number; income: number }> }
  | { kind: 'eventsInPeriod'; period: Period; items: Array<{ title: string; date: string; time: string; allDay: boolean; done: boolean }> }
  | { kind: 'freeTime'; date: string; busy: Array<{ title: string; start: string; end: string }>; freeSlots: Array<[string, string]> }
  | { kind: 'nextEvents'; items: Array<{ title: string; date: string; time: string }> }
  | { kind: 'proposeTransaction'; action: ProposedTransaction; note: string }
  | { kind: 'proposeEvent'; action: ProposedEvent; note: string }
  /* ---- v0.8.0 跨模块 ---- */
  | {
      kind: 'txList';
      /** 查的是哪一段时间 */
      period: Period;
      /** 命中的笔数（可能多于 items.length） */
      count: number;
      total: number;
      items: Array<{ id: string; title: string; date: string; amount: number; type: TxType; categoryName: string | null }>;
      /** 用户问的是某个分类时带上分类名，用来拼「这个月看电影花了 3 次」 */
      categoryName: string | null;
    }
  | {
      kind: 'forecast';
      /** 往后看的起止 */
      from: string;
      to: string;
      /** 这几天有几项日程 */
      eventCount: number;
      /** 这几天已经排了事的日期（去重升序） */
      busyDates: string[];
      /** 这几天已经花掉的钱 */
      spent: number;
      /** 按最近 30 天日均推算出来的、这几天大概还会花多少 */
      expected: number;
      /** 日均（分） */
      dailyAvg: number;
      /** 这几个日期里每天大概花多少 */
      perDay: Array<{ date: string; events: number; expected: number }>;
    }
  | {
      kind: 'bills';
      /** 待确认的账单 */
      items: Array<{ title: string; date: string; amount: number; overdueDays: number }>;
      /** 每月固定支出合计 */
      fixedExpense: number;
      /** 每月固定收入合计 */
      fixedIncome: number;
    }
  | {
      kind: 'weekly';
      from: string;
      to: string;
      expense: number;
      income: number;
      lastExpense: number;
      delta: number;
      deltaPct: number | null;
      eventCount: number;
      topCategoryName: string | null;
      topCategoryAmount: number;
    }
  | { kind: 'unknown'; mode: 'ledger' | 'schedule'; hints: string[] };

export interface ProposedTransaction {
  type: TxType;
  /** 分 */
  amount: number;
  categoryName: string | null;
  accountName: string | null;
  date: string;
  note: string;
}

export interface ProposedEvent {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
}

export interface LedgerSnapshot {
  today: string;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  /**
   * v0.8.0 跨模块问答要用到的东西。
   * 都设成可选：老的调用点（单测、日程侧）不传也能跑，
   * 只是跨模块那几类问题会退化成 unknown。
   */
  events?: EventItem[];
  rules?: RecurringRule[];
}

export interface ScheduleSnapshot {
  today: string;
  events: EventItem[];
}

/* ------------------------------------------------------------- 分类同义词 */

/**
 * 口语 → 分类名的映射。
 * 用户不会说「我餐饮花了多少」，他会说「吃饭」「点外卖」「打车」。
 * 这里只放最常见的，匹配不到就退回「按分类名包含」的模糊匹配。
 */
const CATEGORY_SYNONYMS: Record<string, string[]> = {
  餐饮: ['吃饭', '吃饭钱', '吃', '外卖', '餐厅', '下馆子', '伙食', '餐费', '咖啡', '奶茶', '早餐', '午饭', '晚饭'],
  买菜: ['菜', '超市', '生鲜', '菜钱'],
  交通: ['打车', '地铁', '公交', '车费', '加油', '高铁', '火车票', '机票'],
  购物: ['买东西', '网购', '衣服', '鞋', '购物'],
  居住: ['房租', '房贷', '租房', '物业'],
  水电燃气: ['水费', '电费', '燃气', '煤气', '水电'],
  通讯: ['话费', '流量', '网费', '宽带'],
  娱乐: ['玩', '游戏', '电影', '演出', '娱乐'],
  医疗: ['看病', '药', '医院', '体检'],
  教育: ['学费', '书', '课程', '培训'],
  人情: ['红包', '礼金', '随礼', '份子'],
  宠物: ['猫', '狗', '宠物'],
  旅行: ['旅游', '出行', '酒店', '住宿'],
  工资: ['薪水', '工资'],
};

/** 在文本里找分类，返回分类 id（找不到返回 null） */
export function matchCategory(text: string, categories: Category[], type: TxType = 'expense'): Category | null {
  const pool = categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense'));
  // 1. 分类名直接出现
  const direct = pool.find((c) => text.includes(c.name));
  if (direct) return direct;
  // 2. 同义词
  for (const cat of pool) {
    const syns = CATEGORY_SYNONYMS[cat.name];
    if (!syns) continue;
    if (syns.some((s) => text.includes(s))) return cat;
  }
  return null;
}

/* --------------------------------------------------------------- 记账类问答 */

/** 把交易按区间过滤（转账不算收支，直接排除） */
function txsInPeriod(txs: Transaction[], p: Period): Transaction[] {
  return txs.filter((tx) => tx.type !== 'transfer' && tx.date >= p.from && tx.date <= p.to);
}

export function answerLedger(text: string, snap: LedgerSnapshot): Answer {
  const raw = text.trim();
  const t = raw.replace(/\s+/g, '');
  const period = parsePeriod(t, snap.today) ?? resolvePeriod('thisMonth', 1, snap.today);

  /* ---- 先看是不是「记一笔」这种写操作 ---- */
  const record = parseRecordCommand(raw, snap);
  if (record) return { kind: 'proposeTransaction', action: record, note: raw };

  /* ---- 净资产 / 我还有多少钱 ---- */
  // 「我现在有多少钱」这种问法里没有「净资产」三个字，但它问的就是总资产，
  // 所以在花销分支（也含「多少钱」）之前先接住。
  if (/(净资产|总资产|总共多少钱|还有多少钱|一共多少钱|资产|有多少钱)/.test(t)) {
    const list = snap.accounts
      .filter((a) => !a.archived)
      .map((a) => ({ name: a.name, amount: accountBalance(a, snap.transactions) }))
      .sort((a, b) => b.amount - a.amount);
    return { kind: 'netWorth', amount: netWorth(snap.accounts, snap.transactions), top: list.slice(0, 4) };
  }

  /* ---- 某个账户的余额 ---- */
  if (/(余额|还剩|剩下)/.test(t) && !/(预算)/.test(t)) {
    const hit = snap.accounts.filter((a) => t.includes(a.name));
    if (hit.length > 0) {
      return {
        kind: 'accountBalance',
        name: hit[0].name,
        amount: accountBalance(hit[0], snap.transactions),
        matched: hit.map((a) => a.name),
      };
    }
  }

  /* ---- 预算 ---- */
  if (/(预算)/.test(t)) {
    // 「下个月预算定多少合适」→ 建议
    if (/(建议|定多少|多少合适|该定|合理)/.test(t)) {
      const months = monthlyTrend(snap.transactions, monthKeyOf(snap.today), 3).filter((p) => p.expense > 0);
      const avg = months.length ? Math.round(months.reduce((s, p) => s + p.expense, 0) / months.length) : 0;
      return {
        kind: 'budgetSuggest',
        month: shiftMonth(monthKeyOf(snap.today), 1),
        amount: avg,
        basisMonths: months.length,
        detail: months.map((m) => ({ month: m.month, amount: m.expense })),
      };
    }
    const month = period.kind === 'month' || period.kind === 'lastMonth' ? monthKeyOf(period.from) : monthKeyOf(snap.today);
    const statuses = budgetStatus(snap.budgets, snap.transactions, month);
    return {
      kind: 'budgetStatus',
      month,
      items: statuses.map((s) => ({
        name: s.budget.categoryId ? snap.categories.find((c) => c.id === s.budget.categoryId)?.name ?? '—' : '*',
        spent: s.spent,
        limit: s.budget.amount,
        ratio: s.ratio,
      })),
    };
  }

  /* ---- 趋势 ---- */
  if (/(趋势|走势|变化|最近.{0,4}个月)/.test(t) && !/(涨得最快|增长|哪个类)/.test(t)) {
    const count = period.kind === 'recentMonths' ? period.n : 6;
    return { kind: 'trend', points: monthlyTrend(snap.transactions, monthKeyOf(snap.today), count) };
  }

  /* ---- 哪一类涨得最快 ---- */
  if (/(涨得最快|涨最多|增长最快|变贵|哪个类.{0,4}涨|哪类.{0,4}涨)/.test(t)) {
    const cur = monthKeyOf(period.from);
    const prev = shiftMonth(cur, -1);
    const now = new Map(expenseByCategory(snap.transactions, cur).map((e) => [e.categoryId, e.amount]));
    const before = new Map(expenseByCategory(snap.transactions, prev).map((e) => [e.categoryId, e.amount]));
    const items = [...new Set([...now.keys(), ...before.keys()])]
      .map((id) => ({
        name: id ? snap.categories.find((c) => c.id === id)?.name ?? '—' : '—',
        now: now.get(id) ?? 0,
        before: before.get(id) ?? 0,
        delta: (now.get(id) ?? 0) - (before.get(id) ?? 0),
      }))
      .filter((x) => x.now > 0 || x.before > 0)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3);
    return { kind: 'rising', period, prevMonth: prev, items };
  }

  /* ---- 哪一类花得最多 ---- */
  if (/(哪一?类|哪个分类|什么最费钱|花在哪|最大头|最多)/.test(t) && !/(涨)/.test(t)) {
    const list = expenseByCategory(snap.transactions, monthKeyOf(period.from));
    const total = list.reduce((s, x) => s + x.amount, 0);
    const first = list[0];
    return {
      kind: 'topCategory',
      period,
      name: first ? snap.categories.find((c) => c.id === first.categoryId)?.name ?? '—' : '—',
      amount: first?.amount ?? 0,
      total,
      share: total > 0 ? (first?.amount ?? 0) / total : 0,
      rest: list.slice(1, 4).map((x) => ({
        name: snap.categories.find((c) => c.id === x.categoryId)?.name ?? '—',
        amount: x.amount,
      })),
    };
  }

  /* ================================================================
   * v0.8.0 跨模块问答
   * ----------------------------------------------------------------
   * 下面这几段都同时要用到账本和日程。放在最后、unknown 之前，
   * 是因为它们的关键词比较「泛」（「几次」「那几天」「待确认」），
   * 排在前面会把「这个月花了多少」这类基础问题抢走。
   * ================================================================ */

  /* ---- 「这个月看电影花了几次，分别是哪几天」 ---- */
  // 关键词组合：次数 + 花钱（或直接问「哪几笔」）。分类靠 matchCategory 认。
  if (/(几次|几笔|哪几笔|哪几天|哪几号|都花在哪|花了几次)/.test(t) && /(花|支出|消费|买|用)/.test(t)) {
    const cat = matchCategory(t, snap.categories, 'expense');
    const list = txsInPeriod(snap.transactions, period)
      .filter((tx) => tx.type === 'expense' && (!cat || tx.categoryId === cat.id))
      .sort((a, b) => b.date.localeCompare(a.date));
    return {
      kind: 'txList',
      period,
      count: list.length,
      total: list.reduce((acc, tx) => acc + tx.amount, 0),
      items: list.slice(0, 12).map((tx) => ({
        id: tx.id,
        title: tx.note || snap.categories.find((c) => c.id === tx.categoryId)?.name || '—',
        date: tx.date,
        amount: tx.amount,
        type: tx.type,
        categoryName: snap.categories.find((c) => c.id === tx.categoryId)?.name ?? null,
      })),
      categoryName: cat?.name ?? null,
    };
  }

  /* ---- 「下周有几场活动，那几天大概要花多少」 ---- */
  if (
    /(下周|未来几天|接下来几天|这几天)/.test(t) &&
    /(花|开销|支出|活动|日程|几场|安排|忙)/.test(t)
  ) {
    const events = snap.events ?? [];
    const from = addDays(snap.today, 1);
    const to = addDays(snap.today, /(下周)/.test(t) ? 7 : 3);
    const occ = expandRange(events, from, to);
    const busyDates = [...new Set(occ.map((o) => o.date))].sort();

    // 日均：用最近 30 天的支出算，只算真正过去的日子
    const since = addDays(snap.today, -29);
    const recent = snap.transactions.filter(
      (tx) => tx.type === 'expense' && tx.date >= since && tx.date <= snap.today,
    );
    const dailyAvg = Math.round(recent.reduce((acc, tx) => acc + tx.amount, 0) / 30);
    const perDay = busyDates.map((date) => ({
      date,
      events: occ.filter((o) => o.date === date).length,
      expected: dailyAvg,
    }));
    const spent = snap.transactions
      .filter((tx) => tx.type === 'expense' && tx.date >= from && tx.date <= to)
      .reduce((acc, tx) => acc + tx.amount, 0);

    return {
      kind: 'forecast',
      from,
      to,
      eventCount: occ.length,
      busyDates,
      spent,
      // 有日程的那几天按日均算，没日程的那几天也算 —— 人不会因为没日程就不吃饭
      expected: dailyAvg * (busyDates.length || (/(下周)/.test(t) ? 7 : 3)),
      dailyAvg,
      perDay,
    };
  }

  /* ---- 「有哪些账单该记了」「待确认的账单」 ---- */
  if (/(待确认|该记了|要交|要付|该付|到期|自动扣|固定支出|周期账单|定期|账单)/.test(t)) {
    const rules = snap.rules ?? [];
    const bills = pendingBills(rules, snap.today);
    const fixed = fixedTotals(rules);
    return {
      kind: 'bills',
      items: bills.slice(0, 8).map((b) => ({
        title: b.rule.title,
        date: b.date,
        amount: b.rule.amount,
        overdueDays: b.overdueDays,
      })),
      fixedExpense: fixed.expense,
      fixedIncome: fixed.income,
    };
  }

  /* ---- 「这周怎么样」「来个周报」 ---- */
  if (/(这周|本周|这一周|周报|上周).*(怎么样|如何|情况|总结|花了|花了多少)|(周报)/.test(t)) {
    const range = weekRangeOf(snap.today);
    const stats = weekStats(snap.transactions, range);
    const sched = weekSchedule(snap.events ?? [], range);
    const top = stats.topCategory
      ? snap.categories.find((c) => c.id === stats.topCategory!.categoryId)?.name ?? null
      : null;
    return {
      kind: 'weekly',
      from: stats.from,
      to: stats.to,
      expense: stats.expense,
      income: stats.income,
      lastExpense: stats.lastExpense,
      delta: stats.delta,
      deltaPct: stats.deltaPct,
      eventCount: sched.total,
      topCategoryName: top,
      topCategoryAmount: stats.topCategory?.amount ?? 0,
    };
  }

  /* ---- 收入 ---- */
  if (/(收入|赚了|进账|发了多少工资)/.test(t)) {
    const list = txsInPeriod(snap.transactions, period).filter((tx) => tx.type === 'income');
    return {
      kind: 'income',
      period,
      amount: list.reduce((s, tx) => s + tx.amount, 0),
      count: list.length,
    };
  }

  /* ---- 支出（含「某分类花了多少」） ---- */
  if (/(花|支出|消费|用了|开销|多少钱)/.test(t)) {
    const cat = matchCategory(t, snap.categories, 'expense');
    const list = txsInPeriod(snap.transactions, period).filter(
      (tx) => tx.type === 'expense' && (!cat || tx.categoryId === cat.id),
    );
    return {
      kind: 'spend',
      period,
      amount: list.reduce((s, tx) => s + tx.amount, 0),
      count: list.length,
      categoryName: cat?.name ?? null,
    };
  }

  return { kind: 'unknown', mode: 'ledger', hints: ['spend', 'top', 'budget', 'net'] };
}

/* ------------------------------------------------------------- 「记一笔」解析 */

/**
 * 从一句话里抠出一条账目。
 *
 * 支持的形状（中文）：
 *   记一笔午饭 25          → 支出 25 元，分类按「午饭」匹配到餐饮
 *   午饭25支付宝            → 支出 25 元，账户支付宝
 *   昨天打车 30             → 日期昨天
 *   收入 5000 工资          → 收入
 *
 * 数字必须带「元/块/￥」或者紧跟在分类词后面，否则像「记一笔3」这种
 * 分不清是金额还是别的，宁可让用户去表单里填。
 */
export function parseRecordCommand(text: string, snap: LedgerSnapshot): ProposedTransaction | null {
  if (!/(记一笔|记一下|记账|记个|帮我记|记录一下)/.test(text)) return null;

  const body = text
    .replace(/^(帮我)?(记一笔|记一下|记个账|记账|记个|帮我记|记录一下)[:：,，\s]*/, '')
    .trim();
  if (!body) return null;

  const amountMatch = body.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱|￥|¥)?/);
  if (!amountMatch) return null;
  const yuan = Number(amountMatch[1]);
  if (!Number.isFinite(yuan) || yuan <= 0) return null;
  const amount = Math.round(yuan * 100);

  const isIncome = /(收入|收到|进账|发了)/.test(text);
  const type: TxType = isIncome ? 'income' : 'expense';

  const period = parsePeriod(text, snap.today);
  const date = period && (period.kind === 'today' || period.kind === 'yesterday') ? period.from : snap.today;

  const cat = matchCategory(body, snap.categories, type);
  const account = snap.accounts.find((a) => body.includes(a.name)) ?? null;

  // 备注：把「记一笔」、金额、账户名、日期词都去掉，剩下的是人话
  let note = body
    .replace(amountMatch[0], '')
    .replace(/(今天|昨天|前天|元|块|块钱)/g, '')
    .trim();
  if (account) note = note.replace(account.name, '').trim();
  note = note.replace(/^[，,。.\s]+|[，,。.\s]+$/g, '');

  return {
    type,
    amount,
    categoryName: cat?.name ?? null,
    accountName: account?.name ?? null,
    date,
    note: note || cat?.name || '',
  };
}

/* --------------------------------------------------------------- 日程类问答 */

function occInPeriod(events: EventItem[], p: Period): Occurrence[] {
  return expandRange(events, p.from, p.to);
}

/** 「周五」「下周三」这种 → 具体日期 */
export function parseWeekday(text: string, today: string): string | null {
  const t = text.replace(/\s+/g, '');
  const map: Record<string, number> = {
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0,
  };
  const m = t.match(/(这|本|下|上)?(?:周|星期)([一二三四五六日天])/);
  if (!m) return null;
  const target = map[m[2]];
  const base = new Date(`${today}T00:00:00`);
  const cur = base.getDay();
  let delta = (target - cur + 7) % 7;
  if (m[1] === '下') delta += 7;
  if (m[1] === '上') delta -= 7;
  base.setDate(base.getDate() + delta);
  return toDateKey(base);
}

/** 「下午三点」「14:30」「早上9点」→ 'HH:mm' */
export function parseTimeOfDay(text: string): string | null {
  const t = text.replace(/\s+/g, '');
  const hhmm = t.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h < 24 && m < 60) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const cn = t.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:点|时)(半|(\d{1,2})分)?/);
  if (!cn) return null;
  let h = toNum(cn[2]);
  if (!h && h !== 0) return null;
  const prefix = cn[1] ?? '';
  if ((prefix === '下午' || prefix === '傍晚' || prefix === '晚上' || prefix === '夜里') && h < 12) h += 12;
  if (prefix === '中午' && h < 12) h += 12;
  if (h >= 24) return null;
  const minute = cn[3] === '半' ? 30 : cn[4] ? Number(cn[4]) : 0;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 一天里的空闲时段：9:00–22:00 减去已占用的 */
export function freeSlots(
  events: EventItem[],
  date: string,
  dayStart = '09:00',
  dayEnd = '22:00',
): { busy: Array<{ title: string; start: string; end: string }>; free: Array<[string, string]> } {
  const busy = events
    .filter((ev) => ev.date === date && !ev.allDay && ev.startTime && ev.endTime)
    .map((ev) => ({ title: ev.title, start: ev.startTime, end: ev.endTime }))
    .sort((a, b) => minutesOf(a.start) - minutesOf(b.start));

  const free: Array<[string, string]> = [];
  let cursor = minutesOf(dayStart);
  const end = minutesOf(dayEnd);
  for (const b of busy) {
    const s = minutesOf(b.start);
    const e = Math.min(end, minutesOf(b.end));
    if (s - cursor >= 30) free.push([fmtMinutes(cursor), fmtMinutes(s)]);
    cursor = Math.max(cursor, e);
  }
  if (end - cursor >= 30) free.push([fmtMinutes(cursor), fmtMinutes(end)]);
  return { busy, free };
}

function fmtMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * 从一句话里抠出一条日程。
 * 「提醒我周三交报告」「明天下午三点开会」「周五 14:00-15:30 评审」
 */
export function parseEventCommand(text: string, snap: ScheduleSnapshot): ProposedEvent | null {
  if (!/(提醒我|加个?日程|新建日程|建个日程|安排|schedule|记得)/.test(text)) return null;

  let body = text
    .replace(/^(帮我)?(提醒我|加个日程|加一个日程|新建日程|建个日程|安排一下|安排)/, '')
    .replace(/^[，,。.:：\s]+/, '')
    .trim();
  if (!body) return null;

  // 时间
  const times: string[] = [];
  const rangeMatch = body.match(/(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})/);
  if (rangeMatch) {
    times.push(rangeMatch[1], rangeMatch[2]);
    body = body.replace(rangeMatch[0], '');
  } else {
    const t1 = parseTimeOfDay(body);
    if (t1) {
      times.push(t1);
      body = body.replace(/(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:点|时)(半|(\d{1,2})分)?/, '');
    }
  }

  // 日期
  let date = snap.today;
  const weekday = parseWeekday(body, snap.today);
  const period = parsePeriod(body, snap.today);
  if (weekday) date = weekday;
  else if (period && period.kind !== 'all') date = period.from;

  // 标题：去掉时间/日期词之后剩下的
  const title = body
    .replace(/(今天|明天|后天|昨天|下周|这周|本周|周[一二三四五六日天]|星期[一二三四五六日天])/g, '')
    .replace(/(上午|下午|中午|早上|晚上|凌晨|傍晚)/g, '')
    .replace(/[，,。.\s]+/g, ' ')
    .trim();

  if (!title) return null;

  const allDay = times.length === 0;
  const start = times[0] ?? '09:00';
  const end = times[1] ?? (allDay ? '' : fmtMinutes(Math.min(minutesOf(start) + 60, 23 * 60 + 59)));

  return { title, date, startTime: start, endTime: end, allDay };
}

export function answerSchedule(text: string, snap: ScheduleSnapshot): Answer {
  const raw = text.trim();
  const t = raw.replace(/\s+/g, '');

  /* ---- 先看是不是「建日程」 ---- */
  const cmd = parseEventCommand(raw, snap);
  if (cmd) return { kind: 'proposeEvent', action: cmd, note: raw };

  /* ---- 空闲时间 ---- */
  if (/(有空|空着|空闲|有没有时间|空出来)/.test(t)) {
    const weekday = parseWeekday(t, snap.today);
    const period = parsePeriod(t, snap.today);
    const date = weekday ?? (period && period.kind !== 'all' ? period.from : snap.today);
    const { busy, free } = freeSlots(snap.events, date);
    return { kind: 'freeTime', date, busy, freeSlots: free };
  }

  /* ---- 下一个 / 最近 ---- */
  if (/(下一个|接下来|最近|马上|下一场)/.test(t) && !/(这周|本周|明天|今天)/.test(t)) {
    const from = snap.today;
    const to = (() => {
      const d = new Date(`${from}T00:00:00`);
      d.setDate(d.getDate() + 30);
      return toDateKey(d);
    })();
    const items = expandRange(snap.events, from, to)
      .filter((o) => !o.done)
      .slice(0, 5)
      .map((o) => ({
        title: o.event.title,
        date: o.date,
        time: o.event.allDay ? '' : o.event.startTime,
      }));
    return { kind: 'nextEvents', items };
  }

  /* ---- 某个区间有几个 / 有哪些 ---- */
  const period = parsePeriod(t, snap.today) ?? resolvePeriod('thisWeek', 1, snap.today);
  const occs = occInPeriod(snap.events, period);
  return {
    kind: 'eventsInPeriod',
    period,
    items: occs.map((o) => ({
      title: o.event.title,
      date: o.date,
      time: o.event.allDay ? '' : o.event.startTime,
      allDay: o.event.allDay,
      done: o.done,
    })),
  };
}

/* ------------------------------------------------------------------ 统一入口 */

export function ask(
  text: string,
  mode: 'ledger' | 'schedule',
  snap: LedgerSnapshot | ScheduleSnapshot,
): Answer {
  if (mode === 'ledger') return answerLedger(text, snap as LedgerSnapshot);
  return answerSchedule(text, snap as ScheduleSnapshot);
}

/* ------------------------------------------------------- 给云端用的数据摘要 */

/**
 * 把账本压成一段紧凑的文本，塞进 system prompt。
 *
 * 只给「能算出来而且模型真用得上」的：本月收支、分类占比、预算、最近几条账目。
 * 不把全部流水丢上去 —— 一个是 token 太贵，另一个是没必要把一年前的每一笔
 * 都发给第三方服务器。
 */
export function buildLedgerContext(snap: LedgerSnapshot, lang: string): string {
  const month = monthKeyOf(snap.today);
  const totals = monthTotals(snap.transactions, month);
  const cats = expenseByCategory(snap.transactions, month).slice(0, 8);
  const worth = netWorth(snap.accounts, snap.transactions);
  const budgets = budgetStatus(snap.budgets, snap.transactions, month);
  const recent = snap.transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  const lines: string[] = [];
  lines.push(`[当前语言] ${lang}`);
  lines.push(`[今天] ${snap.today}`);
  lines.push(`[本月 ${month}] 支出 ${formatCents(totals.expense)}，收入 ${formatCents(totals.income)}`);
  lines.push(`[净资产] ${formatCents(worth)}`);
  if (cats.length) {
    lines.push(
      '[本月分类支出] ' +
        cats
          .map((c) => `${snap.categories.find((x) => x.id === c.categoryId)?.name ?? '未分类'} ${formatCents(c.amount)}`)
          .join('；'),
    );
  }
  if (budgets.length) {
    lines.push(
      '[预算] ' +
        budgets
          .map((b) => {
            const name = b.budget.categoryId
              ? snap.categories.find((c) => c.id === b.budget.categoryId)?.name ?? '—'
              : '总预算';
            return `${name} ${formatCents(b.spent)}/${formatCents(b.budget.amount)}${b.over ? '（超支）' : ''}`;
          })
          .join('；'),
    );
  }
  if (recent.length) {
    lines.push(
      '[最近账目] ' +
        recent
          .map((tx) => {
            const cat = snap.categories.find((c) => c.id === tx.categoryId)?.name ?? '';
            return `${tx.date} ${tx.type === 'income' ? '收' : '支'}${formatCents(tx.amount)}${cat ? ' ' + cat : ''}${tx.note ? ' ' + tx.note : ''}`;
          })
          .join('；'),
    );
  }
  lines.push(`[账户] ${snap.accounts.filter((a) => !a.archived).map((a) => `${a.name} ${formatCents(accountBalance(a, snap.transactions))}`).join('；')}`);

  // v0.8.0：把日程和周期账单也塞进上下文，
  // 否则云端模型只能看见钱，看不见「下周三有个事」这种前提。
  const events = snap.events ?? [];
  const rules = snap.rules ?? [];
  const week = weekRangeOf(snap.today);
  const ws = weekStats(snap.transactions, week);
  const wsch = weekSchedule(events, week);
  lines.push(
    `[本周 ${week.from}~${week.to}] 支出 ${formatCents(ws.expense)}，日程 ${wsch.total} 项（完成 ${wsch.done}）`,
  );
  if (events.length) {
    const upcoming = expandRange(events, snap.today, addDays(snap.today, 14)).slice(0, 10);
    if (upcoming.length) {
      lines.push(
        '[未来两周日程] ' +
          upcoming
            .map((o) => `${o.date} ${o.event.allDay ? '全天' : o.event.startTime} ${o.event.title}`)
            .join('；'),
      );
    }
  }
  if (rules.length) {
    const fixed = fixedTotals(rules);
    const bills = pendingBills(rules, snap.today);
    lines.push(`[固定支出] 每月 ${formatCents(fixed.expense)}，每月固定收入 ${formatCents(fixed.income)}`);
    if (bills.length) {
      lines.push(
        '[待确认账单] ' +
          bills
            .slice(0, 6)
            .map((b) => `${b.date} ${b.rule.title} ${formatCents(b.rule.amount)}${b.overdueDays > 0 ? `（逾期 ${b.overdueDays} 天）` : ''}`)
            .join('；'),
      );
    }
  }
  return lines.join('\n');
}

export function buildScheduleContext(snap: ScheduleSnapshot, lang: string): string {
  const grid = monthGrid(monthKeyOf(snap.today));
  const occs = expandRange(snap.events, grid[0], grid[41]);
  const lines: string[] = [];
  lines.push(`[当前语言] ${lang}`);
  lines.push(`[今天] ${snap.today}`);
  lines.push(
    '[本月日程] ' +
      (occs.length
        ? occs
            .map((o) => `${o.date} ${o.event.allDay ? '全天' : o.event.startTime} ${o.event.title}${o.event.location ? '@' + o.event.location : ''}`)
            .join('；')
        : '（无）'),
  );
  return lines.join('\n');
}
