import type { Category, TxType } from './model';

/**
 * 口语词表：时间、分类、账户、金额
 * ------------------------------------------------------------------
 * 从 assistant.ts 里抽出来的。v0.10.0 之后有三个地方要用同一套解析：
 *   1. 问句（这个月花了多少）
 *   2. 记账（记一笔午饭 25）
 *   3. 改账 / 删账 / 转账号（刚才那笔改成 35、把昨天的打车删了）
 * 如果各写一份，「昨天」在三个地方会有三种解释，改一处漏两处。
 */

/* ------------------------------------------------------------------ 数字 */

/** 中文数字 → 阿拉伯数字，只处理 1~12，够用了 */
const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
  十一: 11,
  十二: 12,
};

export function toNum(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  return CN_NUM[raw] ?? 0;
}

/* ------------------------------------------------------------------ 金额 */

/**
 * 从一段话里抠金额（分）。
 *
 * 只认「25」「25.5」「25元」「25块」「￥25」这几种。
 * 刻意不认「二十五」——中文金额的口语说法太杂（两百五、一千二），
 * 猜错的代价是记错账，不如让用户去表单里填。
 */
export function parseAmount(raw: string): { amount: number; rest: string } | null {
  const m = raw.match(/(\d+(?:\.\d{1,2})?)\s*(?:元|块|块钱|￥|¥)?/);
  if (!m) return null;
  const yuan = Number(m[1]);
  if (!Number.isFinite(yuan) || yuan <= 0) return null;
  return { amount: Math.round(yuan * 100), rest: raw.replace(m[0], '') };
}

/* ------------------------------------------------------------------ 分类 */

/**
 * 口语 → 分类名的映射。
 * 用户不会说「我餐饮花了多少」，他会说「吃饭」「点外卖」「打车」。
 * 这里只放最常见的，匹配不到就退回「按分类名包含」的模糊匹配。
 */
export const CATEGORY_SYNONYMS: Record<string, string[]> = {
  餐饮: ['吃饭', '吃饭钱', '吃', '外卖', '餐厅', '下馆子', '伙食', '餐费', '咖啡', '奶茶', '早餐', '早饭', '午饭', '晚饭', '夜宵'],
  买菜: ['菜', '超市', '生鲜', '菜钱'],
  交通: ['打车', '地铁', '公交', '车费', '加油', '高铁', '火车票', '机票', '滴滴', '出租车'],
  购物: ['买东西', '网购', '衣服', '鞋', '购物', '淘宝', '京东'],
  居住: ['房租', '房贷', '租房', '物业'],
  水电燃气: ['水费', '电费', '燃气', '煤气', '水电'],
  通讯: ['话费', '流量', '网费', '宽带'],
  娱乐: ['玩', '游戏', '电影', '演出', '娱乐', 'KTV', '唱歌'],
  医疗: ['看病', '药', '医院', '体检'],
  教育: ['学费', '书', '课程', '培训'],
  人情: ['红包', '礼金', '随礼', '份子'],
  宠物: ['猫', '狗', '宠物'],
  旅行: ['旅游', '出行', '酒店', '住宿'],
  工资: ['薪水', '工资', '奖金'],
};

/** 在文本里找分类，返回分类（找不到返回 null） */
export function matchCategory(text: string, categories: Category[], type: TxType = 'expense'): Category | null {
  const pool = categories.filter((c) => c.type === (type === 'income' ? 'income' : 'expense'));
  // 1. 分类名直接出现
  const direct = pool.find((c) => text.includes(c.name));
  if (direct) return direct;
  // 2. 同义词
  for (const cat of pool) {
    const syns = CATEGORY_SYNONYMS[cat.name];
    if (!syns) continue;
    if (syns.some((s) => text.includes(s))) return cat;
  }
  return null;
}

/* ------------------------------------------------------------------ 账户 */

/** 从文本里认账户名。只认完整名字，不做模糊 —— 认错了会把钱记到别的卡上 */
export function matchAccounts(text: string, accounts: { id: string; name: string }[]): { id: string; name: string }[] {
  return accounts.filter((a) => text.includes(a.name));
}

/* ------------------------------------------------------------------ 转账意图 */

/** 转账动词。这几种说法在人话里都表示「钱从 A 挪到 B」 */
const TRANSFER_VERBS = /(转账|转给|转到|转进|转出|挪到|挪去|提到|提现到|存到|充值到|转)/;

/**
 * 识别「转一笔」。
 *
 * 只在同时出现**两个账户名**时才认 —— 只说「转 500」没有目标，
 * 猜哪个账户都可能错，不如不认。这和金额不猜「两百五」是同一个原则。
 */
export function parseTransferIntent(
  text: string,
  accounts: { id: string; name: string }[],
): { amount: number; from: { id: string; name: string }; to: { id: string; name: string }; note: string } | null {
  if (!TRANSFER_VERBS.test(text)) return null;
  const hit = matchAccounts(text, accounts);
  if (hit.length < 2) return null;
  const amt = parseAmount(text.replace(TRANSFER_VERBS, ' '));
  if (!amt) return null;
  // 出现顺序就是方向：「现金转到银行卡」里现金在前
  const first = text.indexOf(hit[0].name);
  const second = text.indexOf(hit[1].name);
  const [from, to] = first <= second ? [hit[0], hit[1]] : [hit[1], hit[0]];
  return { amount: amt.amount, from, to, note: amt.rest.replace(/[，,。.\s]+/g, ' ').trim() };
}

/* ------------------------------------------------------------------ 日期词 */

/** 日期偏移词。返回相对今天的天数差 */
export function parseDayOffset(text: string): number | null {
  const t = text.replace(/\s+/g, '');
  if (/大前天/.test(t)) return -3;
  if (/前天/.test(t)) return -2;
  if (/昨天|昨日/.test(t)) return -1;
  if (/今天|今日/.test(t)) return 0;
  if (/大后天/.test(t)) return 3;
  if (/明天|明日/.test(t)) return 1;
  // 「后天」要放在「大后天」之后 —— 否则「大后天」永远先命中「后天」，差一天
  if (/后天/.test(t)) return 2;
  return null;
}

/** 相对日期词的正则（去掉备注里的日期时要一起剥掉） */
export const DAY_WORDS = /(大前天|前天|昨天|昨日|今天|今日|明天|明日|后天|大后天)/g;

/* ------------------------------------------------------------------ 时间点 */

/** 「下午三点」「14:30」「早上9点」→ 'HH:mm' */
export function parseTimeOfDay(text: string): string | null {
  const t = text.replace(/\s+/g, '');
  const hhmm = t.match(/(\d{1,2}):(\d{2})/);
  if (hhmm) {
    const h = Number(hhmm[1]);
    const m = Number(hhmm[2]);
    if (h < 24 && m < 60) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const cn = t.match(/(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:点|时)(半|(\d{1,2})分)?/);
  if (!cn) return null;
  let h = toNum(cn[2]);
  if (!h && h !== 0) return null;
  const prefix = cn[1] ?? '';
  if ((prefix === '下午' || prefix === '傍晚' || prefix === '晚上' || prefix === '夜里') && h < 12) h += 12;
  if (prefix === '中午' && h < 12) h += 12;
  if (h >= 24) return null;
  const minute = cn[3] === '半' ? 30 : cn[4] ? Number(cn[4]) : 0;
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function fmtMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** 时间词正则（去掉标题里的时间时要一起剥掉） */
export const TIME_WORDS =
  /(凌晨|早上|上午|中午|下午|傍晚|晚上|夜里)?(\d{1,2}|[一二三四五六七八九十]{1,3})(?:点|时)(半|(\d{1,2})分)?/;
