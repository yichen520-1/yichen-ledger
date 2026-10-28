/**
 * 闲聊层
 * ------------------------------------------------------------------
 * 和 src/domain/assistant.ts 一样是纯领域层：不依赖 React、不碰网络。
 *
 * 为什么需要单独一层：
 *   assistant.ts 里的规则引擎只回答「账本和日程的事实」，用户说「你好」
 *   它只能回一句「没太听懂」——那不是助手，那是查询框。一个叫「忆小尘」
 *   的东西，首先得能好好说人话。
 *
 * 这一层负责「不涉及数据的对话」：打招呼、自我介绍、道谢、道别、情绪、
 * 问时间、算个数。它返回的是**意图 + 数据**，具体说成哪句话交给 i18n
 * （见 src/state/assistant.tsx 的 renderSmallTalk），和规则引擎同一套分工。
 *
 * 调用时机很关键：**只在规则引擎返回 unknown 之后**才走这里。
 * 这样「这个月花了多少」永远不会被闲聊层抢走，而「你好」也终于有人接。
 */

export type SmallTalkKind =
  | 'greeting'
  | 'identity'
  | 'capability'
  | 'thanks'
  | 'farewell'
  | 'praise'
  | 'apology'
  | 'mood'
  | 'clock'
  | 'date'
  | 'math'
  | 'weather'
  | 'joke'
  /** 「嗯」「好的」这类应答，别让它掉进「没听懂」 */
  | 'ack'
  /** 「随便聊聊」「陪我聊会儿」——用户明确要聊天，不该被推回去记账 */
  | 'chatInvite'
  /** 「你在干嘛」「你累不累」——问助手自己的状态 */
  | 'selfState';

/** 打招呼时的时段，界面按它换一句更贴切的话 */
export type DayPart = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';
/** 情绪的种类，「累」和「难过」不该用同一句话安慰 */
export type MoodKind = 'tired' | 'sad' | 'angry' | 'anxious' | 'happy' | 'bored' | 'lonely';

export interface SmallTalk {
  kind: SmallTalkKind;
  /** math 的表达式、clock 的时间、date 的日期、greeting 的时段、mood 的情绪 */
  detail?: string;
  /** date 用：0=周日 … 6=周六，由界面层查当前语言的星期名 */
  weekday?: number;
  /** math 用：算出来的结果 */
  value?: string;
}

/**
 * 上一轮问的是什么，用来接「那上个月呢」这种追问。
 * keywords 存的是「能重新触发同一条规则」的短句，
 * 比如上一轮问「这个月吃饭花了多少」，这里就是「吃饭花了多少」。
 */
export interface LastQuery {
  kind: string;
  keywords: string;
}

/* ------------------------------------------------------------------ 小工具 */

/** 全角数字/符号转半角，用户从中文输入法打出来的「１＋２」也要认 */
function toHalfWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 是不是一句「追问」。
 * 「那上个月呢」「还有呢」「继续」——这些话本身没有动词，
 * 光靠规则匹配不出来，但它显然在问上一轮那件事。
 */
export function isFollowUp(text: string): boolean {
  const t = toHalfWidth(text).replace(/\s+/g, '');
  if (t.length > 14) return false;
  return /^(那|那么|还有|再|继续|然后|换成|改成|呢)/.test(t);
}

/**
 * 整句就是一道算术题才算，避免把「记一笔 25+30」当成计算器。
 * 只支持两个数的四则运算——真要算复杂的，用户会自己去用计算器。
 */
export function evalArithmetic(text: string): { expr: string; value: string } | null {
  const t = toHalfWidth(text).replace(/\s+/g, '');
  // 尾巴上可能跟「等于多少」「是多少」「是几」「=?」这些问法，
  // 拆成两段可选：「(等于|是|=)?」+「(多少|几)?」，两段都能单独出现。
  const m = t.match(
    /^(-?\d+(?:\.\d+)?)([+\-*/×÷])(-?\d+(?:\.\d+)?)(?:=|等于|是)?(?:多少|几)?(?:呢)?[?？]?$/,
  );
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[3]);
  const op = m[2];
  let v: number;
  switch (op) {
    case '+':
      v = a + b;
      break;
    case '-':
      v = a - b;
      break;
    case '*':
    case '×':
      v = a * b;
      break;
    case '/':
    case '÷':
      if (b === 0) return null;
      v = a / b;
      break;
    default:
      return null;
  }
  if (!Number.isFinite(v)) return null;

  // 去掉浮点尾巴：0.1+0.2 要显示 0.3 而不是 0.30000000000000004
  const clean = Number(v.toFixed(10));
  return { expr: `${m[1]} ${op} ${m[3]}`, value: String(clean) };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 按小时切时段，问候语才不会在半夜说「早上好」 */
export function dayPartOf(now: Date): DayPart {
  const h = now.getHours();
  if (h < 5) return 'night';
  if (h < 11) return 'morning';
  if (h < 14) return 'noon';
  if (h < 18) return 'afternoon';
  if (h < 23) return 'evening';
  return 'night';
}

/** 从一句话里认出是哪一种情绪，认不出就当「有点低落」 */
function moodOf(lower: string): MoodKind {
  if (/(烦死|好烦|生气|气死|火大|讨厌|angry|annoyed|腹立つ)/.test(lower)) return 'angry';
  if (/(焦虑|紧张|压力|崩溃|慌|stress|anxious|nervous|不安)/.test(lower)) return 'anxious';
  if (/(好累|很累|太累|累了|困|疲|tired|exhausted|つかれ)/.test(lower)) return 'tired';
  if (/(难过|伤心|想哭|失落|委屈|sad|upset|down|悲しい|つらい)/.test(lower)) return 'sad';
  if (/(孤单|孤独|寂寞|一个人|lonely|alone|さびしい)/.test(lower)) return 'lonely';
  if (/(无聊|没意思|好闲|bored|退屈)/.test(lower)) return 'bored';
  if (/(开心|高兴|好棒|太好了|爽|happy|glad|great|うれしい|楽しい)/.test(lower)) return 'happy';
  return 'sad';
}

/* ---------------------------------------------------------------- 意图识别 */

export function detectSmallTalk(text: string, now: Date = new Date()): SmallTalk | null {
  const raw = text.trim();
  if (!raw) return null;
  const t = toHalfWidth(raw).replace(/\s+/g, '');
  const lower = t.toLowerCase();

  // 算术题先试：它要求整句匹配，不会误伤别的话
  const math = evalArithmetic(raw);
  if (math) return { kind: 'math', detail: math.expr, value: math.value };

  // 夸人放在打招呼前面，否则「你好厉害」会被当成「你好」
  if (/(你真|你太|你好|好)(厉害|棒|牛|聪明|可爱)|厉害了|真牛|すごい|awesome|amazing|goodjob|greatjob|welldone/i.test(lower)) {
    return { kind: 'praise' };
  }

  if (/^(谢谢|多谢|感谢|谢啦|thanks|thankyou|thx|ありがとう|どうも)/i.test(lower)) {
    return { kind: 'thanks' };
  }

  if (/^(对不起|抱歉|不好意思|sorry|ごめん)/i.test(lower)) {
    return { kind: 'apology' };
  }

  if (/^(再见|拜拜|晚安|先这样|bye|goodbye|seeyou|おやすみ|またね)/i.test(lower)) {
    return { kind: 'farewell' };
  }

  if (/(你是谁|你叫什么|你的名字|介绍.{0,2}你自己|你是什么|whoareyou|whatsyourname|what'syourname|你是谁です|名前は)/i.test(lower)) {
    return { kind: 'identity' };
  }

  if (/(你能做什么|你会什么|能干什么|可以干什么|有什么功能|怎么用你|帮我做什么|whatcanyoudo|何ができる)/i.test(lower)) {
    return { kind: 'capability' };
  }

  if (/^(你好|您好|哈喽|哈啰|嗨|在吗|在不在|早上好|早安|中午好|下午好|晚上好|hello|hi|hey|yo|こんにちは|こんばんは|おはよう|もしもし)/i.test(lower)) {
    // 用户自己说了「早上好」就按他说的回，没说的话按时钟猜
    const explicit = /^(早上好|早安|おはよう)/.test(lower)
      ? 'morning'
      : /^中午好/.test(lower)
        ? 'noon'
        : /^下午好/.test(lower)
          ? 'afternoon'
          : /^(晚上好|こんばんは)/.test(lower)
            ? 'evening'
            : null;
    return { kind: 'greeting', detail: explicit ?? dayPartOf(now) };
  }

  if (/(心情不好|压力.{0,2}大|好累|很累|太累|烦死|好烦|难过|伤心|焦虑|崩溃|郁闷|开心|高兴|无聊|孤单|i'?m(sad|tired|happy|bored|lonely|stressed)|つかれた|悲しい|うれしい)/i.test(lower)) {
    return { kind: 'mood', detail: moodOf(lower) };
  }

  if (/(几点了|几点|现在.{0,3}时间|什么时间了|whattime|何時)/i.test(lower)) {
    return { kind: 'clock', detail: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
  }

  if (/(今天几号|今天.{0,2}星期几|今天.{0,2}周几|今天是什么日子|几月几号|whatsthedate|what'?sthedate|今日は何日|何曜日)/i.test(lower)) {
    return {
      kind: 'date',
      detail: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
      weekday: now.getDay(),
    };
  }

  if (/(天气|下雨|下雪|气温|外面冷不冷|weather|天気)/i.test(lower)) {
    return { kind: 'weather' };
  }

  if (/(讲个?笑话|说个?笑话|逗我|来点乐子|tellmeajoke|冗談|笑わせて)/i.test(lower)) {
    return { kind: 'joke' };
  }

  // 「随便聊聊」「陪我聊会儿」——用户明说要聊天，最不该被推回去记账
  if (/(随便聊|陪我聊|聊会|聊聊天|说说话|无聊想聊|聊点什么|justchat|let'?stalk|talktome|話そう)/i.test(lower)) {
    return { kind: 'chatInvite' };
  }

  // 「你在干嘛」「你在吗」之外的「你自己怎么样」
  if (/(你在干嘛|你在干什么|你在做什么|你干嘛呢|你怎么样|你还好吗|你累不累|你困不困|你忙吗|你在不在忙|whatareyoudoing|howareyou)/i.test(lower)) {
    return { kind: 'selfState' };
  }

  // 「嗯」「好的」「原来如此」——接话用的，别当成听不懂。
  // 必须整句就是一个应答：只写开头的话，「好，记一笔午饭 25」会被抢走。
  if (/^(嗯+|哦+|噢+|好的?|好嘞|行|可以|收到|明白|知道了|原来如此|是这样啊|有道理|对|是的|没错|ok|okay|sure|gotit|right|なるほど|はい)[。！!.…~]*$/.test(lower)) {
    return { kind: 'ack' };
  }

  return null;
}
