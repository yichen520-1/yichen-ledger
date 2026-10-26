import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, seedIfEmpty } from '../db';
import type { Account, Budget, Category, Transaction } from '../domain/model';

interface LedgerState {
  ready: boolean;
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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedIfEmpty()
      .then(() => setReady(true))
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setReady(true);
      });
  }, []);

  const accounts = useLiveQuery(() => db.accounts.toArray(), [], []);
  const categories = useLiveQuery(() => db.categories.toArray(), [], []);
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], []);
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], []);

  const value = useMemo<LedgerState>(() => {
    const accMap = new Map(accounts.map((a) => [a.id, a.name]));
    const catMap = new Map(categories.map((c) => [c.id, c]));
    return {
      ready,
      error,
      accounts: accounts.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'zh-CN')),
      categories: categories.slice().sort((a, b) => a.sort - b.sort),
      transactions,
      budgets,
      accountName: (id) => (id ? accMap.get(id) ?? '已删除账户' : ''),
      categoryOf: (id) => (id ? catMap.get(id) : undefined),
    };
  }, [ready, error, accounts, categories, transactions, budgets]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLedger(): LedgerState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLedger 必须在 <LedgerProvider> 内使用');
  return v;
}
