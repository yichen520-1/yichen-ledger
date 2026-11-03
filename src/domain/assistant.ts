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
import { fixedTotals, pendingBills } from './recurring';
import { weekRangeOf, weekSchedule, weekStats } from './weekly';
import {
  CATEGORY_SYNONYMS,
  fmtMinutes,
  matchCategory,
  parseTimeOfDay,
  parseTransferIntent,
  toNum,
} from './parse';
import {
  parseBudgetCommand,
  parseBulkRetarget,
  parseDeleteCommand,
  parseEditCommand,
  parseRecordCommands,
  shiftMonthKey,
  type BudgetDraft,
  type BulkRetarget,
  type DeleteTarget,
  type EditTarget,
} from './assistant-actions';
import type { LedgerSnapshot, ScheduleSnapshot } from './snapshot';

// 类型从这里再导出一次，老的 import 路径（'../domain/assistant'）继续可用
export type { LedgerSnapshot, ScheduleSnapshot };
// 口语词表也一样：日程侧和单测还在从 assistant 里取
export { matchCategory, parseTimeOfDay, toNum, fmtMinutes, CATEGORY_SYNONYMS };

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
  /* ---- v0.10.0：一次可以记多笔 ---- */
  | { kind: 'proposeTransaction'; action: ProposedTransaction; note: string }
  /* ---- v0.10.0：改一笔、删一笔、批量归类、建预算 ---- */
  | { kind: 'proposeEdit'; target: EditTarget }
  | { kind: 'proposeDelete'; target: DeleteTarget }
  | { kind: 'proposeBulk'; bulk: BulkRetarget }
  | { kind: 'proposeBudget'; draft: BudgetDraft }
  | { kind: 'proposeEvent'; action: ProposedEvent; note: string }
  /* ---- v0.10.0：事件账本（一场活动一共花了多少） ---- */
  | {
      kind: 'eventSpend';
      /** 命中的日程 */
      eventTitle: string;
      eventDate: string;
      /** 挂在这场活动上的账目 */
      items: Array<{ id: string; title: string; date: string; amount: number; type: TxType; categoryName: string | null }>;
      expense: number;
      income: number;
      net: number;
      count: number;
      /** 同名/近似匹配到的其他日程，让用户知道认的是哪一场 */
      otherTitles: string[];
    }
  /* ---- v0.10.0：兜底。没认出来，但看得出大概想问什么 ---- */
  | {
      kind: 'vague';
      /** 猜的方向 */
      guess: 'money' | 'schedule' | 'smalltalk';
      /** 给界面显示的几个可点示例 */
      hints: string[];
      /** 原话，兜底话术里要引用 */
      said: string;
    }
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

// ProposedTransaction / ParsedRecord 在 assistant-actions.ts 里定义（解析逻辑在那儿）
export type { ProposedTransaction, ParsedRecord } from './assistant-actions';
import type { ProposedTransaction } from './assistant-actions';

export interface ProposedEvent {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
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

  /* ================================================================
   * v0.10.0：写操作优先
   * ----------------------------------------------------------------
   * 顺序有讲究：
   *   删 → 改 → 批量归类 → 建预算 → 记账 → 转账
   * 因为「把刚才那笔删了」里也含「那笔」，先认删才不会当成记账；
   * 「这周打车那几笔都算交通」含「打车」，先认批量才不会当成「查打车」。
   * ================================================================ */

  /* ---- 删一笔 ---- */
  const del = parseDeleteCommand(raw, snap);
  if (del) return { kind: 'proposeDelete', target: del };

  /* ---- 批量归类 ---- */
  const bulk = parseBulkRetarget(raw, snap, parsePeriod(t, snap.today));
  if (bulk) return { kind: 'proposeBulk', bulk };

  /* ---- 改一笔 ---- */
  const edit = parseEditCommand(raw, snap);
  if (edit) return { kind: 'proposeEdit', target: edit };


  /* ---- 建预算 ---- */
  const budgetDraft = parseBudgetCommand(raw, snap, (m) => shiftMonthKey(m, -1));
  if (budgetDraft) return { kind: 'proposeBudget', draft: budgetDraft };

  /* ---- 转账（必须先于记账：转账也带金额和账户名） ---- */
  const transfer = parseTransferIntent(raw, snap.accounts);
  if (transfer && /(记|转)/.test(raw)) {
    return {
      kind: 'proposeTransaction',
      action: {
        type: 'transfer',
        amount: transfer.amount,
        categoryName: null,
        accountName: transfer.from.name,
        toAccountName: transfer.to.name,
        date: snap.today,
        note: transfer.note,
      },
      note: raw,
    };
  }

  /* ---- 记一笔（可能不止一笔） ---- */
  const records = parseRecordCommands(raw, snap);
  if (records.length === 1) {
    const r = records[0];
    return {
      kind: 'proposeTransaction',
      action: {
        type: r.type,
        amount: r.amount,
        categoryName: r.categoryName,
        accountName: r.accountName,
        toAccountName: r.toAccountName,
        date: r.date,
        note: r.note,
      },
      note: raw,
    };
  }
  if (records.length > 1) {
    // 多笔：拼成一个「总动作」，界面按 items 逐条列，点一次全记
    return {
      kind: 'proposeTransaction',
      action: {
        type: records[0].type,
        amount: records.reduce((acc, r) => acc + r.amount, 0),
        categoryName: null,
        accountName: records[0].accountName,
        toAccountName: null,
        date: records[0].date,
        note: raw,
        items: records.map((r) => ({
          type: r.type,
          amount: r.amount,
          categoryName: r.categoryName,
          accountName: r.accountName,
          toAccountName: r.toAccountName,
          date: r.date,
          note: r.note,
        })),
      },
      note: raw,
    };
  }

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

  /* ---- 某个账户的余额 / 全部账户的余额 ---- */
  if (/(余额|还剩|剩下|还有多少|还有多少钱|剩多少)/.test(t) && !/(预算)/.test(t)) {
    const live = snap.accounts.filter((a) => !a.archived);
    const hit = live.filter((a) => t.includes(a.name));
    if (hit.length > 0) {
      return {
        kind: 'accountBalance',
        name: hit[0].name,
        amount: accountBalance(hit[0], snap.transactions),
        matched: hit.map((a) => a.name),
      };
    }
    // 没点名哪个账户（「账户余额」「各账户还有多少」）——
    // 这时候用户想看的是「每个账户分别多少」，不是一句「没听懂」。
    // 只有一个账户时才退回单账户形状，否则按净资产形状把明细列出来。
    if (/(账户|卡|钱包)/.test(t) && live.length > 0) {
      const list = live
        .map((a) => ({ name: a.name, amount: accountBalance(a, snap.transactions) }))
        .sort((a, b) => b.amount - a.amount);
      return { kind: 'netWorth', amount: netWorth(snap.accounts, snap.transactions), top: list.slice(0, 8) };
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

  /* ---- 「去杭州那趟一共花了多少」 ---- */
  // 关键词：一趟 / 那次 / 这场 / 那场 + 花钱。日程标题靠包含匹配认。
  // 「那趟」「这趟」比「一趟」更常说 —— 漏掉它，「杭州出差那趟花了多少」就被
  // 当成普通支出问题，「那趟」两个字完全没被利用。
  if (
    /(一趟|这趟|那趟|那次|这次|这场|那场|这个活动|那个活动|出行|旅行)/.test(t) &&
    /(花|支出|消费|花了多少|一共)/.test(t)
  ) {
    const events = snap.events ?? [];
    /*
     * 认日程标题，两条路：
     *
     *   1) 整标题原样出现在句子里 —— 最可靠。用户说「杭州出差那趟花了多少」
     *      时标题是完整出现的，这条路径既不会漏也不会误伤。
     *   2) 模糊匹配：标题的字在本句覆盖 60% 以上。用来兜「杭州出差」被说成
     *      「杭州那趟」这种情况。门槛从 50% 提到 60%，并且要求至少 2 个字，
     *      否则「开会」这种两个字里命中一个的也会被认成匹配。
     *
     * 为什么要两条：只做 1) 会漏掉简写，只做 2) 会在「这周开会花了多少」
     * 这种句子上把任何带「会」字的日程都算进去。
     */
    const hit = events
      .filter((ev) => {
        const title = ev.title.trim();
        if (!title) return false;
        if (t.includes(title)) return true;
        const chars = [...new Set(title.replace(/[\s\p{P}]/gu, '').split(''))];
        if (chars.length < 2) return false;
        const common = chars.filter((c) => t.includes(c));
        return common.length >= 2 && common.length / chars.length >= 0.6;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    if (hit.length > 0) {
      const ev = hit[0];
      const linked = snap.transactions.filter((tx) => tx.eventId === ev.id);
      const expense = linked.filter((tx) => tx.type === 'expense').reduce((acc, tx) => acc + tx.amount, 0);
      const income = linked.filter((tx) => tx.type === 'income').reduce((acc, tx) => acc + tx.amount, 0);
      return {
        kind: 'eventSpend',
        eventTitle: ev.title,
        eventDate: ev.date,
        items: linked
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((tx) => ({
            id: tx.id,
            title: tx.note || snap.categories.find((c) => c.id === tx.categoryId)?.name || '—',
            date: tx.date,
            amount: tx.amount,
            type: tx.type,
            categoryName: snap.categories.find((c) => c.id === tx.categoryId)?.name ?? null,
          })),
        expense,
        income,
        net: expense - income,
        count: linked.length,
        otherTitles: hit.slice(1, 3).map((e) => e.title),
      };
    }
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

  /* ================================================================
   * v0.10.0：模糊兜底
   * ----------------------------------------------------------------
   * 走到这里说明上面所有规则都没命中。但用户说的话往往不是「没意义」，
   * 只是没说到那几个关键词上：
   *   「这个月花得有点凶」——没有「多少」「支出」，但有「花」
   *   「最近是不是有点乱」——什么都没说，但语气在问状态
   * 直接回「没听懂」太生硬。所以再退一层，按弱信号猜个方向，
   * 给一句有方向的回应 + 几个可点的示例，让用户接着说下去。
   *
   * 为什么只猜三个方向（钱 / 日程 / 闲聊）：
   *   猜得更细就会猜错。三个方向是「他这句话大概在说哪一块」，
   *   猜错了用户也只需要换一句话，不会觉得被误导。
   * ================================================================ */
  const weakMoney = /(花|钱|支出|消费|开销|贵|便宜|省|浪费|超支|预算|余额|账户)/.test(t);
  const weakSchedule = /(日程|安排|时间|忙|空|会议|开会|约|提醒|截止|ddl|赶)/i.test(t);
  if (weakMoney) {
    return {
      kind: 'vague',
      guess: 'money',
      hints: ['spend', 'top', 'budget', 'trend'],
      said: raw,
    };
  }
  if (weakSchedule) {
    return {
      kind: 'vague',
      guess: 'schedule',
      hints: ['week', 'free', 'addEvent'],
      said: raw,
    };
  }
  return { kind: 'vague', guess: 'smalltalk', hints: ['spend', 'week'], said: raw };
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


/**
 * 从一句话里抠出一条日程。
 * 「提醒我周三交报告」「明天下午三点开会」「周五 14:00-15:30 评审」
 */
export function parseEventCommand(text: string, snap: ScheduleSnapshot): ProposedEvent | null {
  /*
   * 触发词。v0.10.1 修了两处：
   *   1) 「安排」原来是不带边界的 /安排/，于是「这周有什么安排」也会命中，
   *      然后被拆出一条标题叫「有什么安排」的日程。现在只认祈使句开头的
   *      「安排一下 / 安排个」。
   *   2) 加一条硬性排除：句子里带疑问词就是「问」而不是「让」。
   *      「这周有什么安排」「周末有安排吗」都不该变成新建日程。
   */
  if (/(什么|哪些|哪些个|多少|几个|几天|有没有|是不是|吗|呢|咋|怎么|如何)/.test(text)) return null;
  if (!/(提醒我|加个?日程|加一个日程|新建日程|建个日程|^安排|schedule|记得)/.test(text)) return null;

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
  //
  // 这里必须有个闸门。原来是无条件兜底成「这周有几个日程」，于是
  // 「你好」「谢谢」「今天几号」全被答成「这周没有日程」—— 用户看到的
  // 就是一个完全不接话的助手（v0.10.1 修）。
  //
  // 闸门怎么定：只有「问句里确实出现了时间词或日程词」才走日程清单，
  // 否则交给上层去试闲聊，试不出来再退回 vague。
  // 「今天几号」「今天星期几」「现在几点」问的是日历/时钟，不是日程 ——
  // 先让给闲聊表（chat.ts 的 date / clock），否则会被下面的时间词闸门抢走。
  if (/(今天几号|今天是什么日子|几月几号|今天.{0,2}(星期|周)几|现在几点|几点了|现在.{0,3}时间)/.test(t)) {
    return { kind: 'vague', guess: 'smalltalk', hints: ['week', 'addEvent'], said: raw };
  }

  const hasTimeWord = /(今天|今日|明天|明日|后天|昨天|昨日|前天|这周|本周|这一周|上周|下周|下星期|这个月|本月|上个月|下个月|今年|去年|明年|周末|星期[一二三四五六日天]|周[一二三四五六日天]|\d+月)/.test(t);
  const hasEventWord = /(日程|安排|行程|活动|会议|开会|约会|事|忙|空|计划|待办)/.test(t);

  /*
   * 钱味要压过时间词。
   *
   * 「这个月花了多少」里有时间词「这个月」，但它问的是钱 ——
   * 在日程模式下答「这个月有 5 个日程」是答非所问。
   * 所以先看有没有明确的记账词，有就交给上层提示「去记账那边」。
   *
   * 注意只在**没有日程词**时才这么做：「这周安排花了不少时间」这种
   * 混着说的句子仍然按日程处理，不然用户问日程反而被推走。
   */
  const strongMoney = /(花了多少|支出|收入|消费|开销|花了|记账|记一笔|转账|报销|预算|余额|账户)/.test(t);
  if (strongMoney && !hasEventWord) {
    return { kind: 'vague', guess: 'money', hints: ['spend', 'top', 'budget', 'net'], said: raw };
  }

  if (hasTimeWord || hasEventWord) {
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

  /*
   * 走到这里说明：不是建日程、不是问空闲、不是问接下来、也没有时间/日程词。
   * 和账本模式一样给一个 vague，让界面层先试闲聊（「你好」「谢谢」「今天几号」
   * 都在闲聊表里），试不出来再说「这句我没太听懂」。
   */
  const weakSchedule = /(日程|安排|时间|忙|空|会议|开会|约|提醒|截止|ddl|赶|计划)/i.test(t);
  // 「记一笔午饭25」在日程模式下说得完全清楚，只是说错了地方 ——
  // 该告诉他记账在另一边，而不是「这句我没太听懂」。
  const weakMoney = /(花|钱|支出|消费|开销|贵|便宜|省|浪费|超支|预算|余额|账户|记一笔|记账|收入|转账|报销)/.test(t);
  return {
    kind: 'vague',
    guess: weakSchedule ? 'schedule' : weakMoney ? 'money' : 'smalltalk',
    hints: weakSchedule ? ['week', 'free', 'addEvent'] : ['week', 'addEvent'],
    said: raw,
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
