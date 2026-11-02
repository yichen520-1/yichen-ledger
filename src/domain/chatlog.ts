/**
 * 对话记录（v0.10.0）
 * ------------------------------------------------------------------
 * 以前 messages 是 useState，关掉面板就清空 —— 用户问过的问题、看到过的
 * 回答都留不下。这一版把最近 50 条存进 IndexedDB，再打开面板能接着看。
 *
 * 只存「能重新渲染出来的最小信息」，不存整个 Answer 对象：
 *   Answer 里带的是**当时的**账目明细（哪些笔、各多少钱）。存下来再读，
 *   如果那几笔后来被改了或删了，界面上就出现了「已经不存在的账目」。
 *   所以只存文本和角色，历史消息按「当时说的话」原样显示，不重新计算。
 *
 * 这也意味着：历史里的「就这样记」按钮不可点（已经记过了）。
 */

/** 一条存下来的对话 */
export interface ChatRecord {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 云端答的会带这个标记，界面用不同的小标签区分 */
  source?: 'local' | 'cloud';
  createdAt: string;
}

/** 最多留多少条。再多也没人会往回翻，还白占空间 */
export const CHAT_KEEP = 50;

/** 存 settings 表里的键（只放一个「已迁移」标记） */
export const CHAT_MIGRATED_KEY = 'chat.migrated';

/** 新的一条 */
export function makeRecord(
  role: 'user' | 'assistant',
  text: string,
  source: 'local' | 'cloud' | undefined,
  now: string,
): ChatRecord {
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 10)}`,
    role,
    text,
    ...(source ? { source } : {}),
    createdAt: now,
  };
}

/**
 * 只留最近 CHAT_KEEP 条。
 * 注意排序键是 createdAt 字符串 —— ISO 时间戳的字典序就是时间序，
 * 不用真的 parse 成 Date 再比。
 */
export function trimRecords(records: ChatRecord[]): ChatRecord[] {
  if (records.length <= CHAT_KEEP) return records;
  return records.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-CHAT_KEEP);
}

/** 读出来之后按时间正序排好（IndexedDB 的游标顺序不保证，这里再兜一次） */
export function sortRecords(records: ChatRecord[]): ChatRecord[] {
  return records.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
