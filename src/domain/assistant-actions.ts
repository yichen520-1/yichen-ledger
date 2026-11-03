import {parseAmount, matchCategory, parseDayOffset, DAY_WORDS, CATEGORY_SYNONYMS } from './parse';
import type { LedgerSnapshot } from './snapshot';
import type { TxType } from './model';

/**
 * 助手能「动手」的那几件事
 * ------------------------------------------------------------------
 * 这里只负责**解析意图**，不写库。写库一律要用户在气泡里点一下确认
 * （见 src/state/assistant.tsx 的 applyAnswer）。
 *
 * 为什么改账 / 删账也要先解析成结构化对象而不是直接执行：
 *   「刚才那笔记错了」这句话有歧义 —— 是刚才那一笔，还是刚才那条消息
 *   提到的那一笔？把「猜中的那一笔」摊开给用户看，点一下才动手，
 *   猜错了他能取消。删账尤其如此：账本里少一笔，用户往往几个月后才发现。
 */

/* ------------------------------------------------------------- 记账（多笔） */

export interface ProposedTransaction {
  type: TxType;
  /** 分。多笔时是所有条目的合计 */
  amount: number;
  categoryName: string | null;
  accountName: string | null;
  date: string;
  note: string;
  /** 转账才有 */
  toAccountName?: string | null;
  /**
   * 一次说多笔时，这里是逐条明细。
   * 只有一条时留空 —— 界面据此决定是画「就这样记」还是画一列清单。
   */
  items?: Array<{
    type: TxType;
    amount: number;
    categoryName: string | null;
    accountName: string | null;
    toAccountName: string | null;
    date: string;
    note: string;
  }>;
}

/** 一句话里的一条待记账目 */
export interface ParsedRecord {
  type: TxType;
  amount: number;
  categoryName: string | null;
  accountName: string | null;
  toAccountName: string | null;
  date: string;
  note: string;
}

/**
 * 从一句话里抠出**多条**账目。
 *
 * 支持：
 *   记一笔午饭 25                      → 1 条
 *   早饭12，打车28                     → 2 条
 *   记一笔：早饭12 打车28 咖啡15        → 3 条
 *   昨天打车 30                        → 日期昨天
 *   收入 5000 工资                     → 收入
 *
 * 为什么按「逗号 / 空格 / 顿号」切而不是做完整的中文分词：
 *   人报账的时候天然会断开（「早饭12，打车28」），切完每段里
 *   一定有一个金额。切不出来的段落直接丢掉，不会记错账。
 */
export function parseRecordCommands(text: string, snap: LedgerSnapshot): ParsedRecord[] {
  if (!/(记一笔|记一下|记账|记个|帮我记|记录一下)/.test(text)) return [];

  let body = text
    .replace(/^(帮我)?(记一笔|记一下|记个账|记账|记个|帮我记|记录一下)[:：,，\s]*/, '')
    .trim();
  if (!body) return [];

  const isIncome = /(收入|收到|进账|发了)/.test(text);
  const offset = parseDayOffset(text);
  const date =
    offset === null ? snap.today : shiftKey(snap.today, offset);

  // 先按分隔符切成若干段，每段至少要有一个金额才算一笔
  const chunks = body
    .split(/[，,、;；\n]+|\s{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);

  // 「早饭12 打车28」中间只有一个空格的情况：如果整段里有多于一个金额，
  // 就按「金额后面跟着下一个非数字」的位置再切一次。
  const expanded: string[] = [];
  for (const chunk of chunks) {
    const amounts = [...chunk.matchAll(/\d+(?:\.\d{1,2})?/g)];
    if (amounts.length <= 1) {
      expanded.push(chunk);
      continue;
    }
    let start = 0;
    for (let i = 0; i < amounts.length; i += 1) {
      const end = i === amounts.length - 1 ? chunk.length : (amounts[i + 1].index ?? chunk.length);
      expanded.push(chunk.slice(start, end).trim());
      start = end;
    }
  }

  const out: ParsedRecord[] = [];
  for (const chunk of expanded) {
    const amt = parseAmount(chunk);
    if (!amt) continue;
    // 段里只有金额、没有任何描述词，且这一段不是唯一一段 —— 多半是上一条的尾巴
    const cat = matchCategory(chunk, snap.categories, isIncome ? 'income' : 'expense');
    const account = snap.accounts.find((a) => chunk.includes(a.name)) ?? null;

    let note = amt.rest
      .replace(DAY_WORDS, '')
      .replace(/(元|块|块钱)/g, '')
      .trim();
    if (account) note = note.replace(account.name, '').trim();
    note = note.replace(/^[，,。.\s:：]+|[，,。.\s:：]+$/g, '');

    out.push({
      type: isIncome ? 'income' : 'expense',
      amount: amt.amount,
      categoryName: cat?.name ?? null,
      accountName: account?.name ?? null,
      toAccountName: null,
      date,
      note: note || cat?.name || '',
    });
  }

  // 最多 9 条：再多就不是「顺手记一下」，应该去表单里慢慢填
  return out.slice(0, 9);
}

/* --------------------------------------------------------------- 改一笔 */

export interface EditTarget {
  /** 要改哪一笔 */
  txId: string;
  /** 那一笔现在的样子（给用户看一眼再确认） */
  before: { date: string; amount: number; note: string; categoryName: string | null };
  /** 改完之后 */
  after: { date: string; amount: number; note: string; categoryName: string | null; accountName: string | null };
  /** 说清楚改了什么，界面直接念 */
  changes: Array<'amount' | 'category' | 'note' | 'date' | 'account'>;
}

/**
 * 从一句话里解析「改刚才那笔」。
 *
 * 支持的形状：
 *   刚才那笔改成 35
 *   上一笔金额写错了，是 53
 *   把刚才那笔的备注改成「和同事吃饭」
 *   昨天那笔打车改成交通
 *
 * 定位目标靠 findRecentTarget()：默认取「今天最近的一笔」，
 * 说了「昨天」就取昨天最近的一笔。找不到就返回 null，让界面说「没找到」。
 */
export function parseEditCommand(text: string, snap: LedgerSnapshot): EditTarget | null {
  if (!/(改成|改为|写错|记错|应该是|更正|修正|改一下|不对)/.test(text)) return null;
  if (/(删|去掉|取消)/.test(text)) return null;

  const offset = parseDayOffset(text);
  const target = findRecentTarget(snap, offset ?? 0);
  if (!target) return null;

  const changes: EditTarget['changes'] = [];
  let amount = target.amount;
  let note = target.note;
  let date = target.date;
  let categoryName = target.categoryName;
  let accountName: string | null = null;

  // 新金额：「改成 35」「是 53」「应该是 35 元」
  const amountPart = text.match(/(?:改成|改为|应该是|是|更正为)\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱)?/);
  if (amountPart) {
    const yuan = Number(amountPart[1]);
    if (Number.isFinite(yuan) && yuan > 0) {
      amount = Math.round(yuan * 100);
      changes.push('amount');
    }
  }

  // 新分类
  const cat = matchCategory(text, snap.categories, target.type);
  if (cat && cat.name !== categoryName) {
    categoryName = cat.name;
    changes.push('category');
  }

  // 新备注：「备注改成 xxx」「写成 xxx」
  const notePart = text.match(/(?:备注|名字|写成|写成是|叫)\s*(?:改成|改为|是)?\s*[「"'']?([^」"'']+)[」"'']?/);
  if (notePart && notePart[1].trim()) {
    note = notePart[1].trim();
    changes.push('note');
  }

  // 新日期
  if (offset !== null && offset !== 0) {
    date = shiftKey(snap.today, offset);
    changes.push('date');
  }

  // 新账户
  const acc = snap.accounts.find((a) => text.includes(a.name));
  if (acc && acc.name !== target.accountName) {
    accountName = acc.name;
    changes.push('account');
  }

  if (changes.length === 0) return null;

  return {
    txId: target.id,
    before: { date: target.date, amount: target.amount, note: target.note, categoryName: target.categoryName },
    after: { date, amount, note, categoryName, accountName },
    changes,
  };
}

/* --------------------------------------------------------------- 删一笔 */

export interface DeleteTarget {
  txId: string;
  date: string;
  amount: number;
  note: string;
  categoryName: string | null;
}

/** 「把刚才那笔删了」「昨天打车那笔记多了，删掉」 */
export function parseDeleteCommand(text: string, snap: LedgerSnapshot): DeleteTarget | null {
  // 「删了」「删一下」也是人话，不能只认「删掉」「删除」
  if (!/(删掉|删除|删了|删一下|删|去掉|撤销|不要了|记多了|多记了|作废)/.test(text)) return null;

  const offset = parseDayOffset(text);
  // 有分类词就按分类缩小范围，没有就取当天最近一笔
  const cat = matchCategory(text, snap.categories, 'expense');
  const target = findRecentTarget(snap, offset ?? 0, cat?.id ?? null);
  if (!target) return null;

  return {
    txId: target.id,
    date: target.date,
    amount: target.amount,
    note: target.note,
    categoryName: target.categoryName,
  };
}

/** 找「最近的一笔」：默认今天，可以指定往前几天、限定分类 */
function findRecentTarget(
  snap: LedgerSnapshot,
  dayOffset: number,
  categoryId: string | null = null,
): {
  id: string;
  date: string;
  amount: number;
  note: string;
  type: TxType;
  accountName: string | null;
  categoryName: string | null;
} | null {
  const day = shiftKey(snap.today, dayOffset);
  const pool = snap.transactions
    .filter((tx) => tx.date === day)
    .filter((tx) => (categoryId ? tx.categoryId === categoryId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // 当天没有就往前找 7 天，免得「刚才那笔」在跨零点后失效
  const fallback =
    pool.length > 0
      ? pool
      : snap.transactions
          .filter((tx) => tx.date <= day && tx.date >= shiftKey(day, -7))
          .filter((tx) => (categoryId ? tx.categoryId === categoryId : true))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const tx = fallback[0];
  if (!tx) return null;
  const cat = snap.categories.find((c) => c.id === tx.categoryId);
  const acc = snap.accounts.find((a) => a.id === tx.accountId);
  return {
    id: tx.id,
    date: tx.date,
    amount: tx.amount,
    note: tx.note,
    type: tx.type,
    accountName: acc?.name ?? null,
    categoryName: cat?.name ?? null,
  };
}

/* --------------------------------------------------------------- 批量归类 */

export interface BulkRetarget {
  /** 要改的那一批 */
  txIds: string[];
  /**
   * 命中的账目本来就全是目标分类 —— 一笔都不用改。
   *
   * 为什么要有这个字段：用户说「这周打车那几笔都算交通」，如果那几笔
   * 记的时候就被「打车」这个词自动归到交通了，筛选后会一笔不剩。
   * 这时候不能当成「没听懂」—— 他说的完全清楚，只是这件事已经成立了。
   * 要回一句「本来就是交通，不用改」，而不是让他重说一遍。
   */
  already: boolean;
  /** 给用户看的样本（最多 5 条） */
  sample: Array<{ date: string; amount: number; note: string }>;
  categoryName: string;
  periodLabel: { from: string; to: string };
}

/**
 * 「这周打车那几笔都算交通」——把一批账目改成同一个分类。
 *
 * 为什么限定「必须同时说清时间范围 + 分类 + 目标分类」：
 * 三个条件少一个就会误伤。少时间范围可能改掉去年的账；
 * 少目标分类就不知道改成什么。宁可让用户说全一点。
 */
export function parseBulkRetarget(
  text: string,
  snap: LedgerSnapshot,
  period: { from: string; to: string } | null,
): BulkRetarget | null {
  if (!/(都算|都改成|都归到|全部改成|统一改成|都记成)/.test(text)) return null;
  if (!period) return null;

  // 「都算交通」——「都算」后面跟的就是目标分类
  const tail = text.split(/(?:都算|都改成|都归到|全部改成|统一改成|都记成)/)[1] ?? '';
  const target = matchCategory(tail, snap.categories, 'expense');
  if (!target) return null;

  // 「这周打车那几笔」——「那几笔」前面的是筛选词
  const head = text.split(/(?:都算|都改成|都归到|全部改成|统一改成|都记成)/)[0] ?? '';
  const sourceCat = matchCategory(head, snap.categories, 'expense');

  /*
   * 筛选条件是「分类对得上」或者「备注里提到那个词」。
   *
   * 为什么两条都要：用户说「这周打车那几笔都算交通」，那几笔很可能
   * 已经被记成「餐饮」了（不然他也不用改），只看 categoryId 会一条都筛不出来。
   * 反过来，只说「这周吃饭那几笔」时备注可能空着，就得靠分类。
   */
  const words = sourceWords(head, snap.categories);
  const matched = snap.transactions
    .filter((tx) => tx.type === 'expense')
    .filter((tx) => tx.date >= period.from && tx.date <= period.to)
    .filter((tx) => {
      if (words.length === 0 && !sourceCat) return true;
      const byCat = sourceCat ? tx.categoryId === sourceCat.id : false;
      const byNote = words.some((w) => tx.note.includes(w));
      return byCat || byNote;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // 一笔都没命中 → 真的没法改（用户说的东西在这个范围里不存在）
  if (matched.length === 0) return null;

  // 命中了，但已经全是目标分类 → 不用改，也不该说「没听懂」
  const pool = matched.filter((tx) => tx.categoryId !== target.id);
  if (pool.length === 0) {
    return {
      txIds: [],
      already: true,
      sample: matched.slice(0, 5).map((tx) => ({ date: tx.date, amount: tx.amount, note: tx.note })),
      categoryName: target.name,
      periodLabel: period,
    };
  }

  return {
    txIds: pool.map((tx) => tx.id),
    already: false,
    sample: pool.slice(0, 5).map((tx) => ({ date: tx.date, amount: tx.amount, note: tx.note })),
    categoryName: target.name,
    periodLabel: period,
  };
}

/**
 * 从一段话里收集「可能写在备注里」的词。
 * 只收同义词表里的词 —— 用户说「这周打车那几笔」，「打车」才是要匹配的备注词。
 */
function sourceWords(text: string, categories: LedgerSnapshot['categories']): string[] {
  const out: string[] = [];
  for (const cat of categories) {
    const syns = CATEGORY_SYNONYMS[cat.name];
    if (!syns) continue;
    for (const w of syns) {
      if (w.length >= 2 && text.includes(w) && !out.includes(w)) out.push(w);
    }
    if (text.includes(cat.name) && !out.includes(cat.name)) out.push(cat.name);
  }
  return out;
}

/* --------------------------------------------------------------- 建预算 */

export interface BudgetDraft {
  /** 哪个月；null 表示「每月都适用」的总预算 */
  month: string;
  categoryName: string | null;
  amount: number;
  /** 依据：上个月这一类实际花了多少 */
  basis: { month: string; amount: number; count: number };
}

/**
 * 「这个月吃饭预算定 1500」「按上个月的实际花销给我定个预算」
 *
 * 两种情况：
 *   说了具体金额 → 直接用；
 *   没说金额但说了「按上个月」 → 用上个月该类实际支出当额度。
 * 后者是有依据的：上个月真花了 1200，定 1200 是「维持现状」，
 * 不是拍脑袋。
 */
export function parseBudgetCommand(
  text: string,
  snap: LedgerSnapshot,
  lastMonthOf: (monthKey: string) => string,
): BudgetDraft | null {
  if (!/预算/.test(text)) return null;
  if (!/(定|设|建|做|给|加|要)/.test(text)) return null;

  const month = text.includes('下个月')
    ? shiftMonthKey(snap.today.slice(0, 7), 1)
    : snap.today.slice(0, 7);
  const basisMonth = lastMonthOf(month);
  const cat = matchCategory(text, snap.categories, 'expense');

  // 说了具体金额
  const amt = text.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱)?/);
  if (amt) {
    const yuan = Number(amt[1]);
    if (Number.isFinite(yuan) && yuan > 0) {
      const spent = snap.transactions
        .filter((tx) => tx.type === 'expense' && tx.date.slice(0, 7) === basisMonth)
        .filter((tx) => (cat ? tx.categoryId === cat.id : true));
      return {
        month,
        categoryName: cat?.name ?? null,
        amount: Math.round(yuan * 100),
        basis: {
          month: basisMonth,
          amount: spent.reduce((s, tx) => s + tx.amount, 0),
          count: spent.length,
        },
      };
    }
  }

  // 没说金额：按上个月实际支出
  if (/(上个月|上月|按实际|按上个月)/.test(text)) {
    const spent = snap.transactions
      .filter((tx) => tx.type === 'expense' && tx.date.slice(0, 7) === basisMonth)
      .filter((tx) => (cat ? tx.categoryId === cat.id : true));
    const total = spent.reduce((s, tx) => s + tx.amount, 0);
    if (total <= 0) return null;
    return {
      month,
      categoryName: cat?.name ?? null,
      amount: total,
      basis: { month: basisMonth, amount: total, count: spent.length },
    };
  }

  return null;
}

/* --------------------------------------------------------------- 小工具 */

/** 'YYYY-MM-DD' 加减天数 */
export function shiftKey(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM' 加减月份 */
export function shiftMonthKey(key: string, months: number): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
