import { newId } from './model';
import type { CourseSession, WeekParity } from './timetable';

/**
 * 从一段文字里认出课表。
 *
 * 和 ocr.ts（日程）分开写，因为课表的版式和日程完全不是一回事：
 *   日程是「10月28日 周三 14:00-15:00 和设计对稿」—— 一行一件事、带日期；
 *   课表是「高等数学 张三 A101 周一 1-2节 1-16周」—— 一行一门课、
 *   带的是「星期几 + 第几节 + 第几周」，没有具体日期。
 * 用同一套规则硬解只会两边都解不好，所以单独一层。
 *
 * 这里的输入可能来自两条路：
 *   - 云端多模态直接读图，让它按行输出；
 *   - 本地 tesseract 读图，出来的是带表格残渣的散字。
 * 两条路的产物都是「一段文字」，所以规则写在这里、两端共用，也方便单测。
 */

export interface CourseCandidate {
  /** 课程名 */
  name: string;
  teacher: string;
  location: string;
  sessions: CourseSession[];
  /** 原始那一行，界面上给用户对照 */
  raw: string;
  /**
   * 0~1 的把握程度。规则只能从版式上猜，猜不准的地方（比如老师名）
   * 就扣分，界面上把低分的行标出来让人核对 —— 比默默写错强。
   */
  confidence: number;
}

/** 全角转半角：OCR 出来的数字、冒号、连字符经常是全角的 */
function normalize(line: string): string {
  return line
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[～~﹣－—–]/g, '-')
    .replace(/[（(]\s*/g, '(')
    .replace(/\s*[）)]/g, ')')
    .replace(/[，、]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const WEEKDAY_CHARS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 5,
  6: 6,
  7: 7,
};

/** 一行里出现的所有星期几（可能多个：周一、周三） */
export function findWeekdays(line: string): number[] {
  const out: number[] = [];
  const re = /(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const wd = WEEKDAY_CHARS[m[1]];
    if (wd && !out.includes(wd)) out.push(wd);
  }
  return out.sort((a, b) => a - b);
}

/**
 * 第几节到第几节。
 * 认这些写法：第1-2节 / 1-2节 / 第3,4节 / 5节 / 第1大节
 * 返回 null 表示这行没写节次（可能只写了时间）。
 */
export function findPeriods(line: string): { from: number; to: number } | null {
  // 先试区间：1-2节、第3~4节、5,6节
  // 波浪号也要认：老师排课表时写「3~4节」的不少，而 normalize 只在
  // parseTimetableText 里跑，直接调这个函数的地方拿到的可能还是原字符。
  let m = line.match(/第?\s*(\d{1,2})\s*(?:[-~至到,])\s*(\d{1,2})\s*大?节/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && b >= 1 && a <= 20 && b <= 20) {
      return { from: Math.min(a, b), to: Math.max(a, b) };
    }
  }
  // 再试单节
  m = line.match(/第?\s*(\d{1,2})\s*大?节/);
  if (m) {
    const a = Number(m[1]);
    if (a >= 1 && a <= 20) return { from: a, to: a };
  }
  return null;
}

/**
 * 周次范围与单双周。
 * 认这些写法：1-16周 / 第1-16周 / 1~8周 / 第3周 / 单周 / 双周 / 1-16周(单)
 */
export function findWeeks(line: string): { from: number; to: number; parity: WeekParity } | null {
  const parity: WeekParity = /单周|单数周|\(单\)/.test(line)
    ? 'odd'
    : /双周|双数周|\(双\)/.test(line)
      ? 'even'
      : 'all';

  // 区间：1-16周
  let m = line.match(/第?\s*(\d{1,2})\s*-\s*(\d{1,2})\s*周/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a >= 1 && b >= 1 && a <= 30 && b <= 30) {
      return { from: Math.min(a, b), to: Math.max(a, b), parity };
    }
  }
  // 单周：第3周
  m = line.match(/第?\s*(\d{1,2})\s*周(?!\d)/);
  if (m) {
    const a = Number(m[1]);
    if (a >= 1 && a <= 30) return { from: a, to: a, parity };
  }
  // 只写了单双周，没写周次 → 整学期
  if (parity !== 'all') return { from: 1, to: 30, parity };
  return null;
}

const LOCATION_HINT = /楼|室|馆|场|机房|实验|中心|校区|号|教[一二三四五六七八九十\d]|[A-Z]\d{2,4}/;
const TEACHER_HINT = /老师|教师|任课|教授|讲师/;

/**
 * 从「去掉结构字段之后剩下的碎块」里猜课程名 / 老师 / 地点。
 *
 * 三样东西在版式上没有固定顺序（有的表是「课程 老师 地点」，有的是「地点 课程 老师」），
 * 所以不按位置猜，按**形状**猜：
 *   - 带「楼/室/馆/301/A101」这种字样的 → 地点
 *   - 2~4 个汉字、且前面有「老师」标记的 → 老师
 *   - 剩下的最长一段 → 课程名
 */
export function splitFields(chunks: string[]): { name: string; teacher: string; location: string; confidence: number } {
  let name = '';
  let teacher = '';
  let location = '';
  let confidence = 0.85;

  // 有些来源只用**单个空格**分隔字段（云端模型按行吐纯文本时就是这样），
  // 于是「高等数学 张三 A101」会整块进来。整块里带地点特征时，下面的
  // 地点判断会把这整块当成地点、连课程名一起吞掉 —— 先按空格拆开再看。
  // 只拆「看着像地点」的长块：英文课名（Advanced Mathematics）保持完整。
  const expanded: string[] = [];
  for (const raw of chunks) {
    const c = raw.trim();
    if (!c) continue;
    if (/\s/.test(c) && c.length <= 24 && LOCATION_HINT.test(c)) {
      expanded.push(...c.split(/\s+/).filter(Boolean));
    } else {
      expanded.push(c);
    }
  }

  const rest: string[] = [];
  for (const c of expanded) {
    if (!location && LOCATION_HINT.test(c) && c.length <= 16) {
      location = c.replace(/^(?:地点|教室|上课地点)[:：]?/, '').trim();
      continue;
    }
    if (!teacher && TEACHER_HINT.test(c)) {
      teacher = c.replace(TEACHER_HINT, '').replace(/[:：]/g, '').trim();
      continue;
    }
    rest.push(c);
  }

  // 没标记老师时：如果有两段中文，短的那段（2~4 字）大概率是姓名
  if (!teacher && rest.length >= 2) {
    const cn = rest.filter((c) => /^[\u4e00-\u9fa5·]{2,4}$/.test(c));
    if (cn.length) {
      const cand = cn[cn.length - 1];
      // 「高数」这种两字课程名也很常见，所以只有在还有别的更长中文段时才当人名
      if (rest.some((c) => c !== cand && /^[\u4e00-\u9fa5]/.test(c) && c.length > cand.length)) {
        teacher = cand;
        rest.splice(rest.indexOf(cand), 1);
        confidence -= 0.15;
      }
    }
  }

  name = rest.sort((a, b) => b.length - a.length)[0] ?? '';
  if (!name) confidence = 0;
  else if (name.length < 2) confidence -= 0.3;
  if (!location) confidence -= 0.05;

  return { name, teacher, location, confidence };
}

/** 一行是不是表头（星期 / 节次 / 时间 / 课程表 这类），是就跳过 */
function isHeader(line: string): boolean {
  if (/^(?:星期|周一|周二)[\s\S]{0,40}$/.test(line) && !/\d/.test(line)) return true;
  const headWords = ['课程表', '课表', '节次', '时间段', '上课时间', '作息时间', '备注'];
  const hasWord = headWords.some((w) => line.includes(w));
  // 「节次」出现在表头，但也可能出现在「第3节」这种数据里 —— 有星期或节次数字就不当表头
  if (hasWord && !findWeekdays(line).length && !findPeriods(line)) return true;
  return false;
}

/**
 * 把识别出来的整段文字拆成课程候选。
 *
 * 一行一门课；同一门课有多行（不同时段）会按课程名合并成一个 Course，
 * 多个 session 挂在一起 —— 这正是课表需要的形状。
 */
export function parseTimetableText(text: string, opts: { totalWeeks?: number } = {}): CourseCandidate[] {
  const totalWeeks = Math.max(1, Math.min(30, opts.totalWeeks ?? 20));

  const lines = text
    .split(/\r?\n/)
    .map(normalize)
    .filter((s) => s.length > 0 && s.length < 160);

  const byName = new Map<string, CourseCandidate>();

  for (const line of lines) {
    if (isHeader(line)) continue;

    const weekdays = findWeekdays(line);
    const periods = findPeriods(line);
    if (!weekdays.length || !periods) continue;

    const weeks = findWeeks(line) ?? { from: 1, to: totalWeeks, parity: 'all' as WeekParity };

    // 把已经认出来的结构字段从行里抠掉，剩下的才是名字/老师/地点
    const stripped = line
      .replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, ' ')
      .replace(/第?\s*\d{1,2}\s*(?:[-至到,])\s*\d{1,2}\s*大?节/g, ' ')
      .replace(/第?\s*\d{1,2}\s*大?节/g, ' ')
      .replace(/第?\s*\d{1,2}\s*-\s*\d{1,2}\s*周/g, ' ')
      .replace(/第?\s*\d{1,2}\s*周(?!\d)/g, ' ')
      .replace(/单周|双周|单数周|双数周|\(单\)|\(双\)/g, ' ');

    // 剩下的按「两个以上空格 / 制表符 / 竖线 / 逗号」切成块
    const chunks = stripped
      .split(/\s{2,}|\t|\||,|;/)
      .map((s) => s.trim())
      .filter(Boolean);

    const fields = splitFields(chunks);
    if (!fields.name) continue;

    const session: CourseSession = {
      weekday: weekdays[0],
      startPeriod: periods.from,
      endPeriod: periods.to,
      parity: weeks.parity,
      weekFrom: Math.min(weeks.from, totalWeeks),
      weekTo: Math.min(weeks.to, totalWeeks),
    };

    const key = fields.name;
    const existing = byName.get(key);
    if (existing) {
      // 同一门课的另一个时段：把每个星期几都补上
      for (const wd of weekdays) {
        const dup = existing.sessions.some(
          (s) =>
            s.weekday === wd &&
            s.startPeriod === session.startPeriod &&
            s.endPeriod === session.endPeriod &&
            s.parity === session.parity,
        );
        if (!dup) existing.sessions.push({ ...session, weekday: wd });
      }
      if (!existing.teacher && fields.teacher) existing.teacher = fields.teacher;
      if (!existing.location && fields.location) existing.location = fields.location;
      existing.confidence = Math.max(existing.confidence, fields.confidence);
      existing.raw = `${existing.raw}\n${line}`;
    } else {
      byName.set(key, {
        name: fields.name,
        teacher: fields.teacher,
        location: fields.location,
        sessions: weekdays.map((wd) => ({ ...session, weekday: wd })),
        raw: line,
        confidence: fields.confidence,
      });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 云端模型返回的 JSON → 候选。
 *
 * 让模型直接吐 JSON 比让它吐「一行一门课」可靠得多：课程有几个时段是
 * 一对多的结构，纯文本一行表达不了，模型就会自己编格式。
 * 但模型也可能吐坏，所以这里逐条校验，坏一条丢一条，不让整批失败。
 */
export function candidatesFromJson(raw: string, opts: { totalWeeks?: number } = {}): CourseCandidate[] {
  const totalWeeks = Math.max(1, Math.min(30, opts.totalWeeks ?? 20));

  // 模型常把 JSON 包在 ```json 里，或者前后带一句解释
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];

  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const out: CourseCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    if (!name) continue;

    const sessions: CourseSession[] = [];
    const rawSessions = Array.isArray(o.sessions) ? o.sessions : [];
    for (const s of rawSessions) {
      if (!s || typeof s !== 'object') continue;
      const r = s as Record<string, unknown>;
      const weekday = clampInt(r.weekday, 1, 7, 1);
      const from = clampInt(r.startPeriod ?? r.from, 1, 20, 1);
      const to = clampInt(r.endPeriod ?? r.to, from, 20, from);
      const parityRaw = String(r.parity ?? 'all');
      const parity: WeekParity = parityRaw === 'odd' ? 'odd' : parityRaw === 'even' ? 'even' : 'all';
      const wf = clampInt(r.weekFrom ?? r.fromWeek, 1, totalWeeks, 1);
      const wt = clampInt(r.weekTo ?? r.toWeek, wf, totalWeeks, totalWeeks);
      sessions.push({ weekday, startPeriod: from, endPeriod: to, parity, weekFrom: wf, weekTo: wt });
    }
    if (!sessions.length) continue;

    out.push({
      name,
      teacher: typeof o.teacher === 'string' ? o.teacher.trim() : '',
      location: typeof o.location === 'string' ? o.location.trim() : '',
      sessions,
      raw: JSON.stringify(item),
      confidence: 0.95,
    });
  }
  return out;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** 候选 → 可写库的 Course（id 由这里发，界面不用管） */
export function candidateToCourse(c: CourseCandidate, color: string) {
  const now = new Date().toISOString();
  return {
    id: newId('co'),
    name: c.name,
    teacher: c.teacher,
    location: c.location,
    color,
    note: '',
    sessions: c.sessions,
    createdAt: now,
    updatedAt: now,
  };
}
