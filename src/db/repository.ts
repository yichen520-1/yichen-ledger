import { db, seedIfEmpty } from './index';
import {
  newId,
  parseAmountToCents,
  parseCsv,
  parseTags,
  toCsv,
  txsToCsvRows,
  type Account,
  type Budget,
  type Category,
  type Transaction,
  type TxType,
} from '../domain/model';
import { newEvent, type EventItem } from '../domain/schedule';
import {
  billToDraft,
  newRule,
  pendingBills,
  ruleDatesBetween,
  ruleFromEvent,
  ruleFromTransaction,
  type PendingBill,
  type RecurringRule,
} from '../domain/recurring';
import { templateFromTransaction, upsertTemplate, type QuickTemplate } from '../domain/quick';
import {
  clampWeek,
  defaultTimetableMeta,
  newCourse,
  type Course,
  type CourseSession,
  type TimetableMeta,
} from '../domain/timetable';

/** 新建账目时用户真正需要填的东西 */
export interface TransactionDraft {
  type: TxType;
  amountText: string;
  categoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  date: string;
  note: string;
  tagsText: string;
}

/**
 * 数据层能抛出的错误码。
 *
 * 这里只放「键」，不放中文句子：错误最终会弹成 toast，而界面语言可能是
 * 中文/英文/日文。把翻译留在界面层（useErrorText），数据层就不用关心
 * 用户在看哪种语言，也避免 en/ja 界面里突然冒出中文。
 */
export type ErrorCode =
  | 'errors.amountInvalid'
  | 'errors.accountRequired'
  | 'errors.toAccountRequired'
  | 'errors.sameAccount'
  | 'errors.categoryRequired'
  | 'errors.dateInvalid'
  | 'errors.notFound'
  | 'errors.accountInUse'
  | 'errors.categoryInUse'
  | 'errors.builtinCategory'
  | 'errors.backupInvalid'
  | 'errors.csvEmpty'
  | 'errors.csvHeader'
  | 'errors.eventTitleRequired'
  | 'errors.timeInvalid'
  | 'errors.timeOrder'
  | 'errors.courseNameRequired'
  | 'errors.courseSessionRequired'
  | 'errors.courseTimeInvalid'
  | 'errors.ruleTitleRequired'
  | 'errors.ruleAmountInvalid'
  | 'errors.ruleStartInvalid';

export class ValidationError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = 'ValidationError';
    this.code = code;
  }
}

/** 校验草稿，返回可入库的对象（不含 id / 时间戳） */
export function validateDraft(
  draft: TransactionDraft,
): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  const amount = parseAmountToCents(draft.amountText);
  if (amount === null || amount <= 0) throw new ValidationError('errors.amountInvalid');
  if (!draft.accountId) throw new ValidationError('errors.accountRequired');
  if (draft.type === 'transfer') {
    if (!draft.toAccountId) throw new ValidationError('errors.toAccountRequired');
    if (draft.toAccountId === draft.accountId) throw new ValidationError('errors.sameAccount');
  } else if (!draft.categoryId) {
    throw new ValidationError('errors.categoryRequired');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new ValidationError('errors.dateInvalid');
  return {
    type: draft.type,
    amount,
    categoryId: draft.type === 'transfer' ? null : draft.categoryId,
    accountId: draft.accountId,
    toAccountId: draft.type === 'transfer' ? draft.toAccountId : null,
    date: draft.date,
    note: draft.note.trim(),
    tags: parseTags(draft.tagsText),
  };
}

export async function initDb(): Promise<void> {
  await seedIfEmpty();
}

export async function listAccounts(): Promise<Account[]> {
  const all = await db.accounts.toArray();
  return all.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN'));
}

export async function listCategories(): Promise<Category[]> {
  const all = await db.categories.toArray();
  return all.sort((a, b) => a.type.localeCompare(b.type) || a.sort - b.sort);
}

export async function listTransactions(): Promise<Transaction[]> {
  const all = await db.transactions.toArray();
  return all.sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : b.date.localeCompare(a.date)));
}

export async function createTransaction(draft: TransactionDraft): Promise<Transaction> {
  const base = validateDraft(draft);
  const now = new Date().toISOString();
  const tx: Transaction = { id: newId('tx-'), createdAt: now, updatedAt: now, ...base };
  await db.transactions.add(tx);
  return tx;
}

export async function updateTransaction(id: string, draft: TransactionDraft): Promise<Transaction> {
  const base = validateDraft(draft);
  const existing = await db.transactions.get(id);
  if (!existing) throw new ValidationError('errors.notFound');
  const tx: Transaction = { ...existing, ...base, updatedAt: new Date().toISOString() };
  await db.transactions.put(tx);
  return tx;
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id);
}

export async function saveAccount(input: Omit<Account, 'createdAt'> & { createdAt?: string }): Promise<Account> {
  const account: Account = { createdAt: new Date().toISOString(), ...input };
  await db.accounts.put(account);
  return account;
}

export async function deleteAccount(id: string): Promise<void> {
  const used = await db.transactions.where('accountId').equals(id).count();
  const usedAsTarget = await db.transactions.where('toAccountId').equals(id).count();
  if (used + usedAsTarget > 0) throw new ValidationError('errors.accountInUse');
  await db.accounts.delete(id);
}

export async function saveCategory(input: Category): Promise<Category> {
  await db.categories.put(input);
  return input;
}

export async function deleteCategory(id: string): Promise<void> {
  const used = await db.transactions.where('categoryId').equals(id).count();
  if (used > 0) throw new ValidationError('errors.categoryInUse');
  const cat = await db.categories.get(id);
  if (cat?.builtin) throw new ValidationError('errors.builtinCategory');
  await db.categories.delete(id);
}

export async function saveBudget(budget: Budget): Promise<Budget> {
  await db.budgets.put(budget);
  return budget;
}

export async function deleteBudget(id: string): Promise<void> {
  await db.budgets.delete(id);
}

export async function listBudgets(): Promise<Budget[]> {
  return db.budgets.toArray();
}

/* ---------------------------------------------------------------- 忆笺 · 日程 */

/** 日程草稿：新建/编辑时表单填的东西 */
export interface EventDraft {
  title: string;
  notes: string;
  location: string;
  date: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  color: string;
  tag: string;
  recurrence: EventItem['recurrence'];
  reminders: number[];
}

/** 校验日程草稿 */
export function validateEventDraft(draft: EventDraft): void {
  if (!draft.title.trim()) throw new ValidationError('errors.eventTitleRequired');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) throw new ValidationError('errors.dateInvalid');
  if (!draft.allDay) {
    if (!/^\d{2}:\d{2}$/.test(draft.startTime)) throw new ValidationError('errors.timeInvalid');
    if (!/^\d{2}:\d{2}$/.test(draft.endTime)) throw new ValidationError('errors.timeInvalid');
    if (draft.endTime < draft.startTime) throw new ValidationError('errors.timeOrder');
  }
}

export async function listEvents(): Promise<EventItem[]> {
  return db.events.toArray();
}

export async function createEvent(draft: EventDraft): Promise<EventItem> {
  validateEventDraft(draft);
  const now = new Date().toISOString();
  const ev: EventItem = {
    ...newEvent(),
    ...draft,
    title: draft.title.trim(),
    id: newId('ev'),
    done: false,
    doneDates: [],
    createdAt: now,
    updatedAt: now,
  };
  await db.events.put(ev);
  return ev;
}

export async function updateEvent(id: string, draft: EventDraft): Promise<EventItem> {
  validateEventDraft(draft);
  const old = await db.events.get(id);
  if (!old) throw new ValidationError('errors.notFound');
  const ev: EventItem = {
    ...old,
    ...draft,
    title: draft.title.trim(),
    updatedAt: new Date().toISOString(),
  };
  await db.events.put(ev);
  return ev;
}

export async function deleteEvent(id: string): Promise<void> {
  await db.events.delete(id);
}

/** 勾掉一次发生：单次日程改 done，重复日程把日期记进 doneDates */
export async function toggleEventDone(ev: EventItem, date: string): Promise<void> {
  const fresh = await db.events.get(ev.id);
  if (!fresh) return;
  if ((fresh.recurrence?.freq ?? 'none') === 'none') {
    fresh.done = !fresh.done;
  } else {
    const set = new Set(fresh.doneDates);
    if (set.has(date)) set.delete(date);
    else set.add(date);
    fresh.doneDates = [...set].sort();
  }
  fresh.updatedAt = new Date().toISOString();
  await db.events.put(fresh);
}

/** 导出全部数据为 JSON（备份用） */
export async function exportBackup(): Promise<string> {
  const [accounts, categories, transactions, budgets, events, courses, recurring, quick, settings] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.events.toArray(),
    db.courses.toArray(),
    db.recurring.toArray(),
    db.quick.toArray(),
    db.settings.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'yichen-ledger',
      // 备份格式版本：2 起多了 events 字段，3 起多了 courses，4 起多了 recurring，
      // 5 起多了 quick（快捷记账模板）。老备份仍然能导入，缺的字段就当空。
      version: 5,
      exportedAt: new Date().toISOString(),
      accounts,
      categories,
      transactions,
      budgets,
      events,
      courses,
      recurring,
      quick,
      // 设置也一起带走：主题、语言、AI 配置、课表开学日期都在这里。
      // 备份的本意是「换设备能接着用」，少了设置就得重配一遍。
      settings: settings.filter((s) => s.key !== 'ai.config'),
    },
    null,
    2,
  );
}

/** 从 JSON 备份恢复（覆盖式） */
export async function importBackup(json: string): Promise<void> {
  const data = JSON.parse(json) as {
    accounts?: Account[];
    categories?: Category[];
    transactions?: Transaction[];
    budgets?: Budget[];
    events?: EventItem[];
    courses?: Course[];
    recurring?: RecurringRule[];
    quick?: QuickTemplate[];
    settings?: Array<{ key: string; value: string }>;
  };
  if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
    throw new ValidationError('errors.backupInvalid');
  }
  await db.transaction(
    'rw',
    [db.accounts, db.categories, db.transactions, db.budgets, db.events, db.courses, db.recurring, db.quick, db.settings],
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.budgets.clear(),
        db.events.clear(),
        db.courses.clear(),
        db.recurring.clear(),
        db.quick.clear(),
      ]);
      await db.accounts.bulkPut(data.accounts ?? []);
      await db.categories.bulkPut(data.categories ?? []);
      await db.transactions.bulkPut(data.transactions ?? []);
      await db.budgets.bulkPut(data.budgets ?? []);
      await db.events.bulkPut(data.events ?? []);
      await db.courses.bulkPut(data.courses ?? []);
      await db.recurring.bulkPut(data.recurring ?? []);
      await db.quick.bulkPut(data.quick ?? []);
      // 设置不清空：AI 的 API Key 是本机的，不该被一份别处导出的备份覆盖掉。
      for (const s of data.settings ?? []) {
        if (s?.key && s.key !== 'ai.config') await db.settings.put(s);
      }
    },
  );
}

/** 导出 CSV 文本（可用 Excel 打开） */
export async function exportCsvText(): Promise<string> {
  const [accounts, categories, transactions] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
  ]);
  const sorted = transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
  return toCsv(txsToCsvRows(sorted, categories, accounts));
}

/** 导入 CSV：按名称匹配分类/账户，缺失时自动新建 */
export async function importCsvText(text: string): Promise<{ imported: number; skipped: number }> {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ValidationError('errors.csvEmpty');
  const header = rows[0];
  const idx = (name: string) => header.findIndex((h) => h.trim() === name);
  const iDate = idx('日期');
  const iType = idx('类型');
  const iAmount = idx('金额');
  const iCat = idx('分类');
  const iAcc = idx('账户');
  const iTo = idx('转入账户');
  const iNote = idx('备注');
  const iTags = idx('标签');
  if (iDate < 0 || iType < 0 || iAmount < 0) {
    throw new ValidationError('errors.csvHeader');
  }

  const accounts = await db.accounts.toArray();
  const categories = await db.categories.toArray();
  const accountByName = new Map(accounts.map((a) => [a.name, a]));
  const categoryByName = new Map(categories.map((c) => [`${c.type}:${c.name}`, c]));
  const typeMap: Record<string, TxType> = { 支出: 'expense', 收入: 'income', 转账: 'transfer' };

  let imported = 0;
  let skipped = 0;
  const now = new Date().toISOString();
  const toAdd: Transaction[] = [];

  for (const row of rows.slice(1)) {
    const type = typeMap[(row[iType] ?? '').trim()];
    const amount = parseAmountToCents(row[iAmount] ?? '');
    const date = (row[iDate] ?? '').trim();
    if (!type || amount === null || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      skipped++;
      continue;
    }
    const accName = (row[iAcc] ?? '').trim() || '现金';
    let account = accountByName.get(accName);
    if (!account) {
      account = {
        id: newId('acc-'),
        name: accName,
        kind: 'cash',
        initialBalance: 0,
        currency: 'CNY',
        includeInTotal: true,
        archived: false,
        sort: 99,
        createdAt: now,
      };
      await db.accounts.put(account);
      accountByName.set(accName, account);
    }
    let toAccountId: string | null = null;
    if (type === 'transfer') {
      const toName = (row[iTo] ?? '').trim();
      if (!toName) {
        skipped++;
        continue;
      }
      let to = accountByName.get(toName);
      if (!to) {
        to = {
          id: newId('acc-'),
          name: toName,
          kind: 'cash',
          initialBalance: 0,
          currency: 'CNY',
          includeInTotal: true,
          archived: false,
          sort: 99,
          createdAt: now,
        };
        await db.accounts.put(to);
        accountByName.set(toName, to);
      }
      toAccountId = to.id;
    }
    let categoryId: string | null = null;
    if (type !== 'transfer') {
      const catName = (row[iCat] ?? '').trim() || '未分类';
      const key = `${type}:${catName}`;
      let category = categoryByName.get(key);
      if (!category) {
        category = {
          id: newId('cat-'),
          name: catName,
          type,
          icon: '🏷️',
          color: '#8d8d8d',
          builtin: false,
          sort: 99,
        };
        await db.categories.put(category);
        categoryByName.set(key, category);
      }
      categoryId = category.id;
    }
    toAdd.push({
      id: newId('tx-'),
      type,
      amount,
      categoryId,
      accountId: account.id,
      toAccountId,
      date,
      note: iNote >= 0 ? (row[iNote] ?? '').trim() : '',
      tags: iTags >= 0 ? parseTags(row[iTags] ?? '') : [],
      createdAt: now,
      updatedAt: now,
    });
    imported++;
  }

  if (toAdd.length > 0) await db.transactions.bulkAdd(toAdd);
  return { imported, skipped };
}

/* ---------------------------------------------------------------- 课表 */

/** 课表的全局设置存在 settings 表里，键名固定 */
const TIMETABLE_META_KEY = 'timetable.meta';

/** 课表草稿：课程编辑表单填的东西（id 为空表示新建） */
export interface CourseDraft {
  id?: string;
  name: string;
  teacher: string;
  location: string;
  color: string;
  note: string;
  sessions: CourseSession[];
}

/** 校验课表草稿 */
export function validateCourseDraft(draft: CourseDraft): void {
  if (!draft.name.trim()) throw new ValidationError('errors.courseNameRequired');
  const sessions = (draft.sessions ?? []).filter((s) => s.weekday >= 1 && s.weekday <= 7);
  if (!sessions.length) throw new ValidationError('errors.courseSessionRequired');
  for (const s of sessions) {
    // 节次必须是正整数且起止有序 —— 界面上是下拉框，理论上填不错，
    // 但导入/粘贴进来的数据不走下拉框，所以这里兜一道。
    if (!Number.isInteger(s.startPeriod) || !Number.isInteger(s.endPeriod)) {
      throw new ValidationError('errors.courseTimeInvalid');
    }
    if (s.startPeriod < 1 || s.endPeriod < s.startPeriod || s.endPeriod > 20) {
      throw new ValidationError('errors.courseTimeInvalid');
    }
    if (!Number.isInteger(s.weekFrom) || !Number.isInteger(s.weekTo) || s.weekFrom < 1 || s.weekTo < s.weekFrom) {
      throw new ValidationError('errors.courseTimeInvalid');
    }
  }
}

export async function listCourses(): Promise<Course[]> {
  const all = await db.courses.toArray();
  return all.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function createCourse(draft: CourseDraft): Promise<Course> {
  validateCourseDraft(draft);
  const base = newCourse();
  const course: Course = {
    ...base,
    id: draft.id || base.id,
    name: draft.name.trim(),
    teacher: draft.teacher.trim(),
    location: draft.location.trim(),
    color: draft.color || base.color,
    note: draft.note.trim(),
    sessions: draft.sessions,
    createdAt: base.createdAt,
    updatedAt: base.createdAt,
  };
  await db.courses.put(course);
  return course;
}

export async function updateCourse(id: string, draft: CourseDraft): Promise<Course> {
  validateCourseDraft(draft);
  const old = await db.courses.get(id);
  if (!old) throw new ValidationError('errors.notFound');
  const course: Course = {
    ...old,
    name: draft.name.trim(),
    teacher: draft.teacher.trim(),
    location: draft.location.trim(),
    color: draft.color || old.color,
    note: draft.note.trim(),
    sessions: draft.sessions,
    updatedAt: new Date().toISOString(),
  };
  await db.courses.put(course);
  return course;
}

export async function deleteCourse(id: string): Promise<void> {
  await db.courses.delete(id);
}

/** 读课表设置；没存过就返回默认值（开学日 = 本周一） */
export async function loadTimetableMeta(): Promise<TimetableMeta> {
  const row = await db.settings.get(TIMETABLE_META_KEY);
  // settings.value 是 unknown（同一张表还存语言、外观等），先确认是字符串
  if (typeof row?.value !== 'string' || !row.value) return defaultTimetableMeta();
  try {
    const parsed = JSON.parse(row.value) as Partial<TimetableMeta>;
    const fallback = defaultTimetableMeta();
    const periods = Array.isArray(parsed.periods) && parsed.periods.length ? parsed.periods : fallback.periods;
    return {
      termStart: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.termStart)) ? String(parsed.termStart) : fallback.termStart,
      totalWeeks: Math.max(1, Math.min(30, Number(parsed.totalWeeks) || fallback.totalWeeks)),
      periods: periods
        .filter((p) => p && Number.isFinite(Number(p.index)))
        .map((p) => ({ index: Number(p.index), start: String(p.start), end: String(p.end) }))
        .sort((a, b) => a.index - b.index),
    };
  } catch {
    // 设置项坏了不该让整个课表页打不开 —— 退回默认值，用户重设一次即可。
    return defaultTimetableMeta();
  }
}

export async function saveTimetableMeta(meta: TimetableMeta): Promise<void> {
  const clean: TimetableMeta = {
    termStart: meta.termStart,
    totalWeeks: clampWeek(meta, meta.totalWeeks) >= 1 ? Math.max(1, Math.min(30, meta.totalWeeks)) : 20,
    periods: meta.periods,
  };
  await db.settings.put({ key: TIMETABLE_META_KEY, value: JSON.stringify(clean) });
}

/** 批量写入课程（导入课表用）；同名的先删后加，避免重复导入出一堆重名课 */
export async function importCourses(courses: Course[], replaceSameName = true): Promise<number> {
  if (!courses.length) return 0;
  await db.transaction('rw', db.courses, async () => {
    if (replaceSameName) {
      const names = new Set(courses.map((c) => c.name));
      const existing = await db.courses.toArray();
      const doomed = existing.filter((c) => names.has(c.name)).map((c) => c.id);
      if (doomed.length) await db.courses.bulkDelete(doomed);
    }
    await db.courses.bulkPut(courses);
  });
  return courses.length;
}

/* -------------------------------------------------------------- 周期账单 */

/** 周期账单草稿（新建 / 编辑规则时表单填的东西） */
export interface RuleDraft {
  title: string;
  type: Exclude<TxType, 'transfer'>;
  amountText: string;
  categoryId: string | null;
  accountId: string;
  freq: RecurringRule['freq'];
  intervalText: string;
  startDate: string;
  endDate: string | null;
  dayOfMonth: number | null;
  weekday: number | null;
  monthOfYear: number | null;
  note: string;
  tagsText: string;
}

/** 校验规则草稿 */
export function validateRuleDraft(draft: RuleDraft): {
  amount: number;
  interval: number;
} {
  if (!draft.title.trim()) throw new ValidationError('errors.ruleTitleRequired');
  const amount = parseAmountToCents(draft.amountText);
  if (amount === null || amount <= 0) throw new ValidationError('errors.ruleAmountInvalid');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDate)) throw new ValidationError('errors.ruleStartInvalid');
  if (draft.endDate && draft.endDate < draft.startDate) throw new ValidationError('errors.ruleStartInvalid');
  if (!draft.accountId) throw new ValidationError('errors.accountRequired');
  if (!draft.categoryId) throw new ValidationError('errors.categoryRequired');
  const interval = Math.max(1, Math.min(99, Number(draft.intervalText) || 1));
  return { amount, interval };
}

export async function listRules(): Promise<RecurringRule[]> {
  const all = await db.recurring.toArray();
  // 没归档的排前面，然后按下次到期日由近到远
  return all.sort((a, b) => {
    if (a.archived !== b.archived) return a.archived ? 1 : -1;
    return a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title, 'zh-CN');
  });
}

export async function saveRule(draft: RuleDraft, id?: string): Promise<RecurringRule> {
  const { amount, interval } = validateRuleDraft(draft);
  const now = new Date().toISOString();
  if (id) {
    const old = await db.recurring.get(id);
    if (!old) throw new ValidationError('errors.notFound');
    const rule: RecurringRule = {
      ...old,
      title: draft.title.trim(),
      type: draft.type,
      amount,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      freq: draft.freq,
      interval,
      startDate: draft.startDate,
      endDate: draft.endDate,
      dayOfMonth: draft.dayOfMonth,
      weekday: draft.weekday,
      monthOfYear: draft.monthOfYear,
      note: draft.note.trim(),
      tags: parseTags(draft.tagsText),
      updatedAt: now,
    };
    await db.recurring.put(rule);
    return rule;
  }
  const rule: RecurringRule = {
    ...newRule(),
    id: newId('rec-'),
    title: draft.title.trim(),
    type: draft.type,
    amount,
    categoryId: draft.categoryId,
    accountId: draft.accountId,
    freq: draft.freq,
    interval,
    startDate: draft.startDate,
    endDate: draft.endDate,
    dayOfMonth: draft.dayOfMonth,
    weekday: draft.weekday,
    monthOfYear: draft.monthOfYear,
    note: draft.note.trim(),
    tags: parseTags(draft.tagsText),
    confirmedDates: [],
    skippedDates: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.recurring.put(rule);
  return rule;
}

/** 直接从一条已有账目生成规则（总览里「这笔要不要每月提醒」那个动作） */
export async function createRuleFromTransaction(tx: Transaction): Promise<RecurringRule> {
  const rule = ruleFromTransaction(tx, newId('rec-'));
  // 已经记过的这一天不该再提醒一次，直接标成已确认
  rule.confirmedDates = [tx.date];
  await db.recurring.put(rule);
  return rule;
}

/**
 * 从一条日程生成周期账单。
 *
 * 只搬能确定的字段：标题、起始日（决定每月的哪一天）、备注、标签。
 * 金额日程里没有，所以规则金额留 0，让用户到周期账单页去填 ——
 * 猜一个金额比留空更糟：用户会以为记的是对的。
 */
export async function createRuleFromEvent(event: EventItem): Promise<RecurringRule> {
  const rule = ruleFromEvent(event, newId('rec-'));
  await db.recurring.put(rule);
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  await db.recurring.delete(id);
}

/** 归档 / 取消归档一条规则 */
export async function setRuleArchived(id: string, archived: boolean): Promise<void> {
  const rule = await db.recurring.get(id);
  if (!rule) return;
  rule.archived = archived;
  rule.updatedAt = new Date().toISOString();
  await db.recurring.put(rule);
}

/**
 * 确认一条待确认账单：写进账本 + 在这一天打上「已确认」。
 *
 * 两件事放在一个事务里 —— 只写账目不标记，下次打开还会再提醒一遍；
 * 只标记不写账，这笔账就永远丢了。中途出错必须一起回滚。
 */
export async function confirmBill(bill: PendingBill): Promise<Transaction> {
  const draft = billToDraft(bill);
  const now = new Date().toISOString();
  const base = validateDraft(draft);
  const tx: Transaction = { id: newId('tx-'), createdAt: now, updatedAt: now, ...base };
  await db.transaction('rw', [db.transactions, db.recurring], async () => {
    await db.transactions.add(tx);
    const rule = await db.recurring.get(bill.rule.id);
    if (rule) {
      if (!rule.confirmedDates.includes(bill.date)) rule.confirmedDates = [...rule.confirmedDates, bill.date].sort();
      rule.updatedAt = now;
      await db.recurring.put(rule);
    }
  });
  return tx;
}

/** 跳过一条待确认账单：不写账本，只记下这一天不用再提醒 */
export async function skipBill(bill: PendingBill): Promise<void> {
  const rule = await db.recurring.get(bill.rule.id);
  if (!rule) return;
  if (!rule.skippedDates.includes(bill.date)) rule.skippedDates = [...rule.skippedDates, bill.date].sort();
  rule.updatedAt = new Date().toISOString();
  await db.recurring.put(rule);
}

/** 当前所有待确认账单 */
export async function listPendingBills(today: string): Promise<PendingBill[]> {
  const rules = await db.recurring.toArray();
  return pendingBills(rules, today);
}

/**
 * 某条规则在某个区间里的出账日（详情页「接下来几次」用）。
 * 这里不查库，交给调用方传规则，方便在测试里直接调。
 */
export function ruleDates(rule: RecurringRule, from: string, to: string): string[] {
  return ruleDatesBetween(rule, from, to);
}

/* ---------------- 快捷记账模板（v0.8.0） ---------------- */

export async function listQuickTemplates(): Promise<QuickTemplate[]> {
  const all = await db.quick.toArray();
  // 新存的排前面 —— 用户刚存完就想在列表顶部看见它
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 存一个模板；同名的会被替换掉（避免列表里堆一堆「午饭」） */
export async function saveQuickTemplate(tx: Transaction, name: string): Promise<QuickTemplate> {
  const tpl = templateFromTransaction(tx, name, newId('qt-'));
  const all = await db.quick.toArray();
  const next = upsertTemplate(all, tpl);
  // 被替换掉的那些真的删掉，否则同名旧模板会一直留在库里
  const keep = new Set(next.map((t) => t.id));
  const drop = all.filter((t) => !keep.has(t.id)).map((t) => t.id);
  await db.transaction('rw', db.quick, async () => {
    if (drop.length) await db.quick.bulkDelete(drop);
    await db.quick.put(tpl);
  });
  return tpl;
}

export async function deleteQuickTemplate(id: string): Promise<void> {
  await db.quick.delete(id);
}

/**
 * 记完一笔后自动问「要不要每月提醒」的触发条件。
 *
 * 为什么只对「支出 + 有备注 + 金额不小」问：
 *   如果每记一笔都弹一句，它就从「贴心的提示」变成了「烦人的弹窗」。
 *   房租、话费、会员这类固定支出有三个特征：是支出、备注写了是什么、
 *   金额比零钱大。三个都满足才值得问一句。
 */
export function shouldOfferRecurring(tx: Transaction): boolean {
  // 门槛定在 100 元：30 块的一顿午饭不该被问「要不要每月提醒」，
  // 但房租、宽带、会员年费这类一定过线。宁可不问，也别问得让人烦。
  return tx.type === 'expense' && tx.note.trim().length > 0 && tx.amount >= 10000;
}
