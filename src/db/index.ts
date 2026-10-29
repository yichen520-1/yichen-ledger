import Dexie, { type Table } from 'dexie';
import type { Account, Budget, Category, Settings, Transaction } from '../domain/model';
import type { RecurringRule } from '../domain/recurring';
import type { EventItem } from '../domain/schedule';
import type { Course } from '../domain/timetable';
import type { QuickTemplate } from '../domain/quick';

/**
 * 本地数据库（IndexedDB）。
 * 用 Dexie 是因为同一套代码在浏览器 / Android WebView / iOS WKWebView / Electron 里都能跑，
 * 数据 100% 留在用户设备上，不需要服务器。
 */
export class LedgerDB extends Dexie {
  accounts!: Table<Account, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  budgets!: Table<Budget, string>;
  settings!: Table<Settings, string>;
  events!: Table<EventItem, string>;
  courses!: Table<Course, string>;
  recurring!: Table<RecurringRule, string>;
  quick!: Table<QuickTemplate, string>;

  constructor(name = 'yichen-ledger') {
    super(name);
    this.version(1).stores({
      accounts: 'id, kind, archived, sort',
      categories: 'id, type, sort',
      transactions: 'id, date, type, categoryId, accountId, toAccountId',
      budgets: 'id, categoryId, month',
      settings: 'key',
    });
    // v2 只新增一张 events 表，不动原有四张表的索引。
    // Dexie 的版本升级是「增量的」：老用户的账目、账户、分类、预算原样保留，
    // 只是多出一张空表；新用户则一次性建好全部表。
    this.version(2).stores({
      accounts: 'id, kind, archived, sort',
      categories: 'id, type, sort',
      transactions: 'id, date, type, categoryId, accountId, toAccountId',
      budgets: 'id, categoryId, month',
      settings: 'key',
      events: 'id, date, done',
    });
    // v3 加课表。同样只加表不改表：老用户的账本和日程一条不动。
    // 课表的「开学日期 / 节次时间表」不单独建表，塞进 settings —— 它是全局单例，
    // 一个键一个值就够，为它建表反而要写一堆「只有一行」的读写代码。
    this.version(3).stores({
      accounts: 'id, kind, archived, sort',
      categories: 'id, type, sort',
      transactions: 'id, date, type, categoryId, accountId, toAccountId',
      budgets: 'id, categoryId, month',
      settings: 'key',
      events: 'id, date, done',
      courses: 'id, name',
    });
    // v4 加周期账单。还是只加表不改表 —— 老用户的账目一条不动。
    // 索引只留 type 和 archived：规则最多几十条，全表读出来在内存里筛更快，
    // 不需要为 freq / startDate 建索引。
    this.version(4).stores({
      accounts: 'id, kind, archived, sort',
      categories: 'id, type, sort',
      transactions: 'id, date, type, categoryId, accountId, toAccountId',
      budgets: 'id, categoryId, month',
      settings: 'key',
      events: 'id, date, done',
      courses: 'id, name',
      recurring: 'id, type, archived',
    });
    // v5 加「快捷记账模板」。依旧只加表：老用户的数据一条不动。
    // 模板只有几条，不建索引也行，但主键 id 必须留着（Dexie 要求有主键）。
    this.version(5).stores({
      accounts: 'id, kind, archived, sort',
      categories: 'id, type, sort',
      transactions: 'id, date, type, categoryId, accountId, toAccountId',
      budgets: 'id, categoryId, month',
      settings: 'key',
      events: 'id, date, done',
      courses: 'id, name',
      recurring: 'id, type, archived',
      quick: 'id, name',
    });
  }
}

export const db = new LedgerDB();

/** 内置账户：第一次打开时创建 */
export function defaultAccounts(): Account[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'acc-cash',
      name: '现金',
      kind: 'cash',
      initialBalance: 0,
      currency: 'CNY',
      includeInTotal: true,
      archived: false,
      sort: 0,
      createdAt: now,
    },
    {
      id: 'acc-wechat',
      name: '微信零钱',
      kind: 'wallet',
      initialBalance: 0,
      currency: 'CNY',
      includeInTotal: true,
      archived: false,
      sort: 1,
      createdAt: now,
    },
    {
      id: 'acc-alipay',
      name: '支付宝',
      kind: 'wallet',
      initialBalance: 0,
      currency: 'CNY',
      includeInTotal: true,
      archived: false,
      sort: 2,
      createdAt: now,
    },
    {
      id: 'acc-bank',
      name: '银行卡',
      kind: 'bank',
      initialBalance: 0,
      currency: 'CNY',
      includeInTotal: true,
      archived: false,
      sort: 3,
      createdAt: now,
    },
  ];
}

/** 内置分类：覆盖中国人最常见的记账场景 */
export function defaultCategories(): Category[] {
  const expense: Array<[string, string, string]> = [
    ['餐饮', '🍜', '#ef6f4d'],
    ['买菜', '🥬', '#69a84f'],
    ['交通', '🚌', '#4a90d9'],
    ['购物', '🛍️', '#c96fb7'],
    ['居住', '🏠', '#8a7cd6'],
    ['水电燃气', '💡', '#e0a83a'],
    ['通讯', '📱', '#3aa7a0'],
    ['娱乐', '🎮', '#d95f6c'],
    ['医疗', '💊', '#4fa3a5'],
    ['教育', '📚', '#7f8cae'],
    ['人情', '🎁', '#d1729a'],
    ['宠物', '🐾', '#b5854b'],
    ['旅行', '✈️', '#4aa0c7'],
    ['其他支出', '🧾', '#8d8d8d'],
  ];
  const income: Array<[string, string, string]> = [
    ['工资', '💰', '#4caf7d'],
    ['奖金', '🏆', '#3f9e73'],
    ['兼职', '🧰', '#57a86f'],
    ['理财', '📈', '#2f9e8f'],
    ['红包', '🧧', '#d95555'],
    ['报销', '🧾', '#6d9e7a'],
    ['其他收入', '➕', '#8d8d8d'],
  ];
  const out: Category[] = [];
  expense.forEach(([name, icon, color], i) => {
    out.push({
      id: `cat-e-${i}`,
      name,
      type: 'expense',
      icon,
      color,
      builtin: true,
      sort: i,
    });
  });
  income.forEach(([name, icon, color], i) => {
    out.push({
      id: `cat-i-${i}`,
      name,
      type: 'income',
      icon,
      color,
      builtin: true,
      sort: i,
    });
  });
  return out;
}

/** 表为空时写入默认数据（幂等） */
export async function seedIfEmpty(): Promise<void> {
  await db.transaction('rw', db.accounts, db.categories, async () => {
    if ((await db.accounts.count()) === 0) await db.accounts.bulkAdd(defaultAccounts());
    if ((await db.categories.count()) === 0) await db.categories.bulkAdd(defaultCategories());
  });
}
