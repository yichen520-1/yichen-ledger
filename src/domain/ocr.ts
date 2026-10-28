/**
 * 从一段文本里认出日程。
 *
 * 之所以单独放在领域层：图片识别（云端多模态 / 本地 OCR）拿到的都是「一段文字」，
 * 真正决定能不能用的不是识别模型，而是这层把「10月28日 周三 14:00-15:00 和设计对稿」
 * 拆成 { 日期, 开始, 结束, 标题 } 的规则。规则写在这里，两端共用，也方便写单测。
 */

export interface OcrCandidate {
  title: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm */
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  /** 原始那一行，界面上给用户对照 */
  raw: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function ymd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 从一行里抠出日期；找不到返回 null */
export function findDate(line: string, baseDate: string): string | null {
  const baseYear = Number(baseDate.slice(0, 4));

  let m = line.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = line.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (m) return ymd(baseYear, Number(m[1]), Number(m[2]));

  m = line.match(/(?<![\d:])(\d{1,2})\s*[-/]\s*(\d{1,2})(?![\d:])/);
  if (m) return ymd(baseYear, Number(m[1]), Number(m[2]));

  return null;
}

/** 从一行里抠出时间段；返回 null 表示这行没有时间 */
export function findTimeRange(line: string): { start: string; end: string } | null {
  // 14:00-15:00 / 14:00~15:00 / 14:00 至 15:00
  let m = line.match(
    /(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:-|–|—|~|～|至|到)\s*(\d{1,2})\s*[:：]\s*(\d{2})/,
  );
  if (m) {
    return {
      start: `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`,
      end: `${pad2(Number(m[3]))}:${pad2(Number(m[4]))}`,
    };
  }

  // 下午 2:00 - 3:30（只有一侧带冒号）
  m = line.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) {
    const start = `${pad2(Number(m[1]))}:${pad2(Number(m[2]))}`;
    const [h, mi] = start.split(':').map(Number);
    const endH = Math.min(23, h + 1);
    return { start, end: `${pad2(endH)}:${pad2(mi)}` };
  }

  // 9点 / 9点30 / 上午九点这种中文写法
  m = line.match(/(上午|下午|晚上|中午|早上)?\s*(\d{1,2})\s*点\s*(?:(\d{1,2})\s*分?)?/);
  if (m) {
    let h = Number(m[2]);
    const mi = m[3] ? Number(m[3]) : 0;
    const noon = m[1];
    if ((noon === '下午' || noon === '晚上') && h < 12) h += 12;
    if (noon === '中午' && h < 12) h += 12;
    if (noon === '上午' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return { start: `${pad2(h)}:${pad2(mi)}`, end: `${pad2(Math.min(23, h + 1))}:${pad2(mi)}` };
  }

  return null;
}

/** 地点：@xxx、地点：xxx、在xxx */
function findLocation(line: string): string {
  let m = line.match(/[@＠]\s*([^\s,，。;；|]+)/);
  if (m) return m[1];
  m = line.match(/(?:地点|位置|会议室)\s*[:：]\s*([^\s,，。;；|]+)/);
  if (m) return m[1];
  return '';
}

/**
 * 把识别出来的整段文字拆成候选日程。
 *
 * 策略：一行一条，按「先找日期、再找时间、剩下的是标题」切；
 * 只有日期没有标题的行（比如「10月28日 周三」单独一行）会被当成「日期上下文」，
 * 下面几行的日程都算这一天 —— 课程表、会议通知基本都是这个版式。
 */
export function parseScheduleText(text: string, baseDate: string): OcrCandidate[] {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0 && s.length < 120);

  const out: OcrCandidate[] = [];
  let ctxDate = baseDate;
  let prevText = '';

  for (const line of lines) {
    // 整行只是日期（可能带星期），当上下文用
    const date = findDate(line, ctxDate);
    const time = findTimeRange(line);
    const loc = findLocation(line);

    let rest = line;
    if (date) {
      ctxDate = date;
      rest = rest
        .replace(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/, ' ')
        .replace(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/, ' ')
        .replace(/(?<![\d:])(\d{1,2})\s*[-/]\s*(\d{1,2})(?![\d:])/, ' ');
    }
    rest = rest
      .replace(
        /(\d{1,2})\s*[:：]\s*(\d{2})\s*(?:-|–|—|~|～|至|到)\s*(\d{1,2})\s*[:：]\s*(\d{2})/,
        ' ',
      )
      .replace(/(\d{1,2})\s*[:：]\s*(\d{2})/g, ' ')
      .replace(/(上午|下午|晚上|中午|早上)?\s*\d{1,2}\s*点\s*(?:\d{1,2}\s*分?)?/g, ' ')
      .replace(/(?:周|星期)[一二三四五六日天]/g, ' ')
      .replace(/[@＠]\s*[^\s,，。;；|]+/g, ' ')
      .replace(/(?:地点|位置|会议室)\s*[:：]\s*[^\s,，。;；|]+/g, ' ')
      .replace(/^[\s\-–—·•|:：,，、]+|[\s\-–—·•|:：,，、]+$/g, '')
      .trim();

    // 只有日期、没有时间和标题 → 记录上下文，跳过
    if (date && !time && rest.length === 0) {
      prevText = '';
      continue;
    }

    // 只有时间没有标题 → 用上一行当标题（常见于「和设计对稿」换行写时间）
    let title = rest;
    if (!title && time && prevText) title = prevText;
    if (!title && time) title = '';
    if (!time && !date && rest) {
      // 纯文本行：留给下一行当标题
      prevText = rest;
      continue;
    }
    if (!time && date) {
      // 有日期没有时间：当作全天日程
      out.push({
        title: title || '',
        date: ctxDate,
        startTime: '09:00',
        endTime: '10:00',
        allDay: true,
        location: loc,
        raw: line,
      });
      prevText = '';
      continue;
    }
    if (time) {
      out.push({
        title: title || '',
        date: ctxDate,
        startTime: time.start,
        endTime: time.end,
        allDay: false,
        location: loc,
        raw: line,
      });
      prevText = '';
    }
  }

  // 去掉没有标题又没时间的噪声
  return out.filter((c) => c.title.length > 0 || c.allDay);
}
