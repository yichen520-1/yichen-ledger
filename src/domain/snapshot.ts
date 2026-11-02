import type { Account, Budget, Category, Transaction } from './model';
import type { EventItem } from './schedule';
import type { RecurringRule } from './recurring';

/**
 * 助手要用的数据快照。
 * ------------------------------------------------------------------
 * 单独放一个文件，是为了让「动作解析」（assistant-actions.ts）和
 * 「问答引擎」（assistant.ts）都能引用它，而不用互相 import 成环。
 *
 * 为什么不直接传 useLedger() 的整个对象：
 *   规则引擎是纯函数，只该看见它算得出来的那几张表。
 *   传整个 context 会让它顺手依赖上 loading / error 这些界面状态。
 */
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
