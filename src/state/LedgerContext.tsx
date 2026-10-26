import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedIfEmpty } from '../db';
import type { Account, Budget, Category, Transaction } from '../domain/model';

interface LedgerState {
  ready: boolean;
  /** 首次从 IndexedDB 读到数据的阶段（ready=false 且没有 error，就是这一种情况） */
  loading: boolean;
  error: string | null;
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgets: Budget[];
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

  const loading = accounts === undefined || categories === undefined || transactions === undefined || budgets === undefined;
  const ready = seeded && !loading;

  const value = useMemo<LedgerState>(() => {
    const accList = accounts ?? [];
    const catList = categories ?? [];
    const accMap = new Map(accList.map((a) => [a.id, a.name]));
    const catMap = new Map(catList.map((c) => [c.id, c]));
    return {
      ready,
      loading,
      error,
      accounts: accList.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN')),
      categories: catList.slice().sort((a, b) => a.sort - b.sort),
      transactions: transactions ?? [],
      budgets: budgets ?? [],
      accountName: (id) => (id ? accMap.get(id) ?? '已删除账户' : ''),
      categoryOf: (id) => (id ? catMap.get(id) : undefined),
    };
  }, [ready, loading, error, accounts, categories, transactions, budgets]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger 必须在 <LedgerProvider> 内使用');
  return v;
}
