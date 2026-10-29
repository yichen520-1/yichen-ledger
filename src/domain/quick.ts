/**
 * 快捷记账（纯领域层）
 * ------------------------------------------------------------------
 * 「懒得记」是记账 App 最大的失败原因。真正高频的账只有那么几种：
 * 早饭、通勤、午饭、咖啡。这里提供两条捷径：
 *
 *   1. 和上次一样 —— 一键把上一笔的类型 / 金额 / 分类 / 账户全填好
 *   2. 常用模板 —— 用户自己把「午饭 25 餐饮 微信」存下来，下次一点就填好
 *
 * 为什么「和上次一样」不直接算「最近记过的组合」：
 *   用户的心理模型是「我刚才记的那笔」，而不是「我最近常记哪几类」。
 *   所以这里严格取**最新的一笔**，不做任何聚合 —— 聚合出来的东西
 *   看起来聪明，实际上经常填一个用户没想记的数。
 *
 * 为什么模板单独存、不从账目里推：
 *   模板是「我打算以后常记的」，账目是「我已经记过的」。两者会分叉：
 *   用户可能删掉那笔账，但模板还要留着；也可能改了模板金额，
 *   而历史账目不该跟着变。所以模板是一份独立的数据。
 */

import type { Transaction, TxType } from './model';

/** 一条用户自己存的常用模板 */
export interface QuickTemplate {
  id: string;
  /** 模板名，比如「午饭」 */
  name: string;
  type: TxType;
  /** 金额，单位：分 */
  amount: number;
  categoryId: string | null;
  accountId: string;
  toAccountId: string | null;
  note: string;
  tags: string[];
  createdAt: string;
}

/** 从账目里挑出「上一笔」（日期最新，同一天按创建时间最新） */
export function lastTransaction(txs: Transaction[]): Transaction | null {
  if (txs.length === 0) return null;
  return txs.reduce((best, tx) => {
    if (tx.date !== best.date) return tx.date > best.date ? tx : best;
    return tx.createdAt > best.createdAt ? tx : best;
  });
}

/**
 * 「最近记过的」：按 (类型, 分类, 金额) 去重，取最近出现的那些。
 *
 * 为什么按这三样去重而不是按备注：
 *   同一笔午饭备注可能写「午饭」「和同事吃饭」「楼下那家」，
 *   但它们其实是同一件事。金额和分类才是「这一笔是什么」的骨架。
 */
export function recentShapes(txs: Transaction[], limit = 4): Transaction[] {
  const seen = new Set<string>();
  const out: Transaction[] = [];
  const sorted = txs.slice().sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.createdAt.localeCompare(a.createdAt);
  });
  for (const tx of sorted) {
    if (tx.type === 'transfer') continue;
    const key = `${tx.type}|${tx.categoryId ?? ''}|${tx.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tx);
    if (out.length >= limit) break;
  }
  return out;
}

/** 从一笔账目生成模板（「存成模板」那个动作） */
export function templateFromTransaction(
  tx: Transaction,
  name: string,
  id: string,
  now: string = new Date().toISOString(),
): QuickTemplate {
  return {
    id,
    name: name.trim() || tx.note || '',
    type: tx.type,
    amount: tx.amount,
    categoryId: tx.categoryId,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    note: tx.note,
    tags: tx.tags.slice(),
    createdAt: now,
  };
}

/** 模板去重：同一个名字只留最新存的那个 */
export function upsertTemplate(list: QuickTemplate[], tpl: QuickTemplate): QuickTemplate[] {
  const rest = list.filter((t) => t.name !== tpl.name);
  return [...rest, tpl];
}
