import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedIfEmpty } from '../db';
import type { Account, Budget, Category, Transaction } from '../domain/model';
import type { PendingBill, RecurringRule } from '../domain/recurring';
import { pendingBills } from '../domain/recurring';
import { toDateKey } from '../domain/model';
import type { EventItem } from '../domain/schedule';
import { defaultTimetableMeta, type Course, type TimetableMeta } from '../domain/timetable';
import type { QuickTemplate } from '../domain/quick';
import { useI18n } from '../i18n';

interface LedgerState {
  ready: boolean;
  /** 首次从 IndexedDB 读到数据的阶段（ready=false 且没有 error，就是这一种情况） */
  loading: boolean;
  error: string | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
  events: EventItem[];
  courses: Course[];
  /** 周期账单规则 */
  rules: RecurringRule[];
  /** 到日子了、还没确认的账单（按逾期天数倒序） */
  pending: PendingBill[];
  /** 快捷记账模板（新的在前） */
  quickTemplates: QuickTemplate[];
  /** 课表的开学日期 / 总周数 / 节次时间表 */
  timetable: TimetableMeta;
  accountName: (id: string | null | undefined) => string;
  categoryOf: (id: string | null | undefined) => Category | undefined;
}

const Ctx = createContext<LedgerState | null>(null);

/**
 * 全局数据层：
 * - 首次启动时写入内置账户/分类
 * - 之后所有页面都通过 useLiveQuery 订阅同一份 IndexedDB 数据，
 *   任何一处写库，所有页面自动刷新（无需手动刷新/Redux）。
 */
export function LedgerProvider({ children }: { children: ReactNode }) {
  // 账户被删掉以后，账目上还留着它的 id；这时显示的名字也要跟着界面语言变
  const { t } = useI18n();
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedIfEmpty()
      .then(() => setSeeded(true))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setSeeded(true);
      });
  }, []);

  // 不传默认值：查询完成前返回 undefined，用来区分「还没读出来」和「确实是空的」
  const accounts = useLiveQuery(() => db.accounts.toArray());
  const categories = useLiveQuery(() => db.categories.toArray());
  const transactions = useLiveQuery(() => db.transactions.toArray());
  const budgets = useLiveQuery(() => db.budgets.toArray());
  const events = useLiveQuery(() => db.events.toArray());
  const courses = useLiveQuery(() => db.courses.toArray());
  const rules = useLiveQuery(() => db.recurring.toArray());
  const quickRows = useLiveQuery(() => db.quick.toArray());
  // 课表设置只有一个键，但它是 JSON —— 和课程一起在这里订阅，
  // 这样课表页改了开学日期，别的页面（首页「今天几节课」）立刻跟着变。
  //
  // 注意这里的 `?? null`：useLiveQuery 用 undefined 表示「还没查出来」，
  // 而 db.settings.get() 在没存过设置时**本来就返回 undefined**。
  // 两者混在一起会让 metaRow 永远是 undefined —— loading 恒为真，
  // 整个 App 卡在「正在准备账本…」。包一层 null 把两种状态分开。
  const metaRow = useLiveQuery(async () => (await db.settings.get('timetable.meta')) ?? null);

  const loading =
    accounts === undefined ||
    categories === undefined ||
    transactions === undefined ||
    budgets === undefined ||
    events === undefined ||
    courses === undefined ||
    rules === undefined ||
    quickRows === undefined ||
    metaRow === undefined;
  const ready = seeded && !loading;

  const value = useMemo<LedgerState>(() => {
    const accList = accounts ?? [];
    const catList = categories ?? [];
    const accMap = new Map(accList.map((a) => [a.id, a.name]));
    const catMap = new Map(catList.map((c) => [c.id, c]));
    let timetable: TimetableMeta;
    try {
      // settings.value 是 unknown（这张表也存别的设置），先确认是字符串再解析
      const raw = typeof metaRow?.value === 'string' ? metaRow.value : null;
      const parsed = raw ? (JSON.parse(raw) as Partial<TimetableMeta>) : null;
      const fallback = defaultTimetableMeta();
      timetable = parsed
        ? {
            termStart: /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.termStart)) ? String(parsed.termStart) : fallback.termStart,
            totalWeeks: Math.max(1, Math.min(30, Number(parsed.totalWeeks) || fallback.totalWeeks)),
            periods:
              Array.isArray(parsed.periods) && parsed.periods.length ? parsed.periods : fallback.periods,
          }
        : fallback;
    } catch {
      timetable = defaultTimetableMeta();
    }
    return {
      ready,
      loading,
      error,
      accounts: accList.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN')),
      categories: catList.slice().sort((a, b) => a.sort - b.sort),
      transactions: transactions ?? [],
      budgets: budgets ?? [],
      events: events ?? [],
      courses: courses ?? [],
      rules: rules ?? [],
      // 待确认账单是纯计算出来的：规则表一变，这里立刻跟着重算。
      // 放在 context 里而不是每个页面各算一遍，是因为总览和预算页都要用它。
      pending: pendingBills(rules ?? [], toDateKey(new Date())),
      quickTemplates: (quickRows ?? []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      timetable,
      accountName: (id) => (id ? accMap.get(id) ?? t('common.deletedAccount') : ''),
      categoryOf: (id) => (id ? catMap.get(id) : undefined),
    };
  }, [
    ready,
    loading,
    error,
    accounts,
    categories,
    transactions,
    budgets,
    events,
    courses,
    rules,
    quickRows,
    metaRow,
    t,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger 必须在 <LedgerProvider> 内使用');
  return v;
}
