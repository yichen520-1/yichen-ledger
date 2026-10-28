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
  | 'errors.timeOrder';

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

/* ---------------------------------------------------------------- 忆尘日程 */

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
  const [accounts, categories, transactions, budgets, events] = await Promise.all([
    db.accounts.toArray(),
    db.categories.toArray(),
    db.transactions.toArray(),
    db.budgets.toArray(),
    db.events.toArray(),
  ]);
  return JSON.stringify(
    {
      app: 'yichen-ledger',
      // 备份格式版本：2 起多了 events 字段。
      // 老备份（version 1，没有 events）仍然能导入，只是日程为空。
      version: 2,
      exportedAt: new Date().toISOString(),
      accounts,
      categories,
      transactions,
      budgets,
      events,
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
  };
  if (!Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
    throw new ValidationError('errors.backupInvalid');
  }
  await db.transaction(
    'rw',
    db.accounts,
    db.categories,
    db.transactions,
    db.budgets,
    db.events,
    async () => {
      await Promise.all([
        db.accounts.clear(),
        db.categories.clear(),
        db.transactions.clear(),
        db.budgets.clear(),
        db.events.clear(),
      ]);
      await db.accounts.bulkPut(data.accounts ?? []);
      await db.categories.bulkPut(data.categories ?? []);
      await db.transactions.bulkPut(data.transactions ?? []);
      await db.budgets.bulkPut(data.budgets ?? []);
      await db.events.bulkPut(data.events ?? []);
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
