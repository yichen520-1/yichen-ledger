/**
 * 忆小尘的「个人记忆」（v0.10.0）
 * ------------------------------------------------------------------
 * 三件事：
 *   1. 称呼 —— 用户希望被怎么叫
 *   2. 助手笔记 —— 用户让它记住的零散事实（「我不吃香菜」「公司在国贸」）
 *   3. 语音能力检测 —— 这个浏览器到底能不能语音输入
 *
 * 为什么笔记是「键值对列表」而不是一段自由文本：
 *   自由文本要模型去解析，没 Key 的时候就废了；键值对本地规则也能用
 *   （「我住哪」→ 查 key 含「住」的那条）。而且用户能一条一条删掉，
 *   不用为了改一句去编辑一大段。
 *
 * 为什么这些不进备份：
 *   备份是「账本」，笔记是「这台设备上的对话习惯」。换设备时
 *   把前一个人的称呼带过去很奇怪。所以它们存 settings 表但不进 exportBackup。
 */

/* ---------------------------------------------------------------- 称呼 */

/** 称呼存在 settings 表里的键 */
export const PERSONA_NAME_KEY = 'persona.name';

/** 称呼最长几个字。太长会破坏文案的节奏（「你好，我叫张三丰的大学同学小李」） */
export const PERSONA_NAME_MAX = 12;

/** 规整用户填的称呼：去空白、截断、去掉会破坏句子的标点 */
export function normalizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[，。！？、；：""''（）《》]/g, '')
    .trim()
    .slice(0, PERSONA_NAME_MAX);
}

/**
 * 把称呼填进一句话。
 *
 * 没填称呼时**什么都不做** —— 不能变成「你好，」这种多一个逗号的句子。
 * 所以模板里用 `{name}` 的时候，没名字就把整个占位符连同它后面的标点一起处理掉。
 */
export function withName(template: string, name: string): string {
  if (!name) {
    // 「{name}，今天花了…」没名字时应该变成「今天花了…」而不是「，今天花了…」
    return template.replace(/\{name\}，?/g, '').replace(/\{name\}/g, '');
  }
  return template.replace(/\{name\}/g, name);
}

/* ---------------------------------------------------------------- 笔记 */

/** 一条助手笔记 */
export interface PersonaNote {
  id: string;
  /** 关于什么（用户自己起，比如「饮食」「住址」） */
  key: string;
  /** 记下什么 */
  value: string;
  createdAt: string;
}

/** 存在 settings 表里的键 */
export const PERSONA_NOTES_KEY = 'persona.notes';

/** 最多存几条。再多就不是「记住几件事」，而是要建知识库了 */
export const NOTES_MAX = 40;

export const NOTE_KEY_MAX = 20;
export const NOTE_VALUE_MAX = 120;

/** 规整一条笔记，非法返回 null */
export function normalizeNote(raw: unknown, now: string): PersonaNote | null {
  const v = (raw ?? {}) as Partial<PersonaNote>;
  const key = typeof v.key === 'string' ? v.key.replace(/[\r\n\t]/g, ' ').trim().slice(0, NOTE_KEY_MAX) : '';
  const value = typeof v.value === 'string' ? v.value.replace(/[\r\n\t]/g, ' ').trim().slice(0, NOTE_VALUE_MAX) : '';
  if (!key || !value) return null;
  return {
    id: typeof v.id === 'string' && v.id ? v.id : `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
    key,
    value,
    createdAt: typeof v.createdAt === 'string' && v.createdAt ? v.createdAt : now,
  };
}

/** 从存储里读出来的东西可能是任意形状，统一规整成数组 */
export function normalizeNotes(raw: unknown, now: string): PersonaNote[] {
  if (!Array.isArray(raw)) return [];
  const out: PersonaNote[] = [];
  for (const item of raw) {
    const n = normalizeNote(item, now);
    if (n) out.push(n);
    if (out.length >= NOTES_MAX) break;
  }
  return out;
}

/** 加一条；同 key 的替换掉（「住址」改了就应该是新的那条） */
export function upsertNote(notes: PersonaNote[], key: string, value: string, now: string): PersonaNote[] {
  const clean = normalizeNote({ key, value }, now);
  if (!clean) return notes;
  const rest = notes.filter((n) => n.key !== clean.key);
  return [clean, ...rest].slice(0, NOTES_MAX);
}

/** 「记住：我不吃香菜」→ { key, value } */
export function parseRememberCommand(text: string): { key: string; value: string } | null {
  const m = text.match(/^(?:请)?(?:记住|记一下|记着|帮我记住)[:：,，\s]*(.+)$/);
  if (!m) return null;
  const body = m[1].trim();
  if (!body) return null;

  // 「饮食：不吃香菜」→ 冒号前是 key
  const colon = body.match(/^([^:：]{1,20})[:：](.+)$/);
  if (colon) {
    return { key: colon[1].trim(), value: colon[2].trim() };
  }

  // 「我不吃香菜」→ 没有 key，按开头几个字猜一个
  const guess: Array<[RegExp, string]> = [
    [/^(我)?(住|家)(在|是)/, '住址'],
    [/^(我)?(吃|不吃|爱吃|忌口)/, '饮食'],
    [/^(我)?(生日|出生)/, '生日'],
    [/^(我)?(在|于)(.+?)(工作|上班|公司)/, '工作'],
    [/^(我)?(喜欢|不喜欢|讨厌)/, '喜好'],
    [/^(我)?(有|养)/, '其他'],
  ];
  for (const [re, key] of guess) {
    if (re.test(body)) return { key, value: body };
  }
  return { key: '其他', value: body };
}

/**
 * 把笔记压缩成给云端系统提示词用的一行。
 * 没笔记就返回空串 —— 不能返回「[关于用户] 」这种只有标题的空段落。
 */
export function notesToContext(notes: PersonaNote[]): string {
  if (notes.length === 0) return '';
  return '[关于用户] ' + notes.map((n) => `${n.key}：${n.value}`).join('；');
}

/** 称呼也要进系统提示词 */
export function nameToContext(name: string): string {
  return name ? `[用户称呼] ${name}` : '';
}

/* ---------------------------------------------------------------- 语音 */

/** 浏览器到底有没有语音识别。有这个才显示麦克风按钮 */
export function hasSpeechSupport(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

/** 语音识别的语言标签，跟界面语言走 */
export function speechLangOf(lang: string): string {
  if (lang === 'en') return 'en-US';
  if (lang === 'ja') return 'ja-JP';
  return 'zh-CN';
}

/**
 * 语音识别的运行时接口。
 * 不用 lib.dom 里的类型，因为 SpeechRecognition 到现在也不是标准 API，
 * TS 的 dom 类型里没有它，用 any 会比到处写 @ts-expect-error 干净。
 */
export interface SpeechLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}

/** 造一个识别器；不支持就返回 null */
export function createSpeech(lang: string): SpeechLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechLike) | undefined;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = speechLangOf(lang);
  // 不连续：说一句就停，用户可以看着结果再点发送。
  // 连续模式在中文里会把句号也念进来，识别质量反而更差。
  rec.continuous = false;
  rec.interimResults = true;
  return rec;
}

/** 把识别事件里的结果拼成一句 */
export function transcriptOf(ev: {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
  resultIndex: number;
}): string {
  let out = '';
  for (let i = 0; i < ev.results.length; i += 1) {
    const alt = ev.results[i][0];
    if (alt?.transcript) out += alt.transcript;
  }
  return out.trim();
}
