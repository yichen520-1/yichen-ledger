import { useRef, useState } from 'react';
import { AlertTriangle, ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useI18n, useErrorText } from '../../i18n';
import { importCourses } from '../../db/repository';
import {
  candidateToCourse,
  candidatesFromJson,
  parseTimetableText,
  type CourseCandidate,
} from '../../domain/timetableOcr';
import { COURSE_COLORS, totalWeeksOf, type TimetableMeta } from '../../domain/timetable';
import { chatCompletion, hasKey, PROVIDER_PRESETS, splitDataUrl, useAiConfig } from '../../state/ai';

/**
 * 从图片导入课表。
 *
 * 和「从图片建日程」是两套逻辑，所以是两个组件（解析规则也分在
 * domain/ocr.ts 与 domain/timetableOcr.ts）。但界面的骨架是一样的：
 * 选图 → 识别 → 候选列表勾选 → 写入。
 *
 * 云端优先走 JSON：课表是「一门课有多个时段」的一对多结构，
 * 让模型吐一行一门课的纯文本会把多时段压平，只能靠它自己编格式；
 * 直接要 JSON 更稳。本地 tesseract 拿不到 JSON，就走纯文本规则。
 */

const CLOUD_PROMPT = `你是课表识别助手。请从这张图片里提取课程表。
只输出一个 JSON 数组，不要输出任何解释、不要 markdown 代码块：
[{"name":"高等数学","teacher":"张三","location":"A101",
  "sessions":[{"weekday":1,"startPeriod":1,"endPeriod":2,"parity":"all","weekFrom":1,"weekTo":16}]}]
规则：
- weekday：1=周一 … 7=周日
- startPeriod / endPeriod：第几节课，整数
- parity："all" 每周 / "odd" 单周 / "even" 双周
- weekFrom / weekTo：第几周到第几周；没写周次就填 1 和 20
- 同一门课有多个时段时，放在同一个 sessions 数组里
- 认不出的字段填空字符串，不要编`;

export function TimetableOcrDialog({
  open,
  meta,
  onClose,
  onImported,
}: {
  open: boolean;
  meta: TimetableMeta;
  onClose: () => void;
  onImported: (n: number) => void;
}) {
  const { t, dict } = useI18n();
  const errorText = useErrorText();
  const toast = useToast();
  const { config } = useAiConfig();
  const fileRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [candidates, setCandidates] = useState<CourseCandidate[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);

  const cloudReady = hasKey(config) && (PROVIDER_PRESETS[config.provider].vision || config.provider === 'custom');
  const total = totalWeeksOf(meta);

  function reset() {
    setImage('');
    setRunning(false);
    setProgress('');
    setCandidates([]);
    setPicked(new Set());
    setEmpty(false);
    setFailed(false);
  }

  async function pick(file: File) {
    reset();
    const dataUrl = await readAsDataUrl(file);
    setImage(dataUrl);
    await recognize(dataUrl);
  }

  async function recognize(dataUrl: string) {
    setRunning(true);
    setProgress('');
    try {
      let found: CourseCandidate[] = [];
      if (cloudReady) {
        const { mime, base64 } = splitDataUrl(dataUrl);
        const text = await chatCompletion(
          config,
          [
            { role: 'system', content: CLOUD_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: '这是课表截图，请按格式输出 JSON。' },
                { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
              ],
            },
          ],
          { maxTokens: 2048 },
        );
        found = candidatesFromJson(text, { totalWeeks: total });
        // 模型没按 JSON 吐（比如吐成了「周一 1-2 节 高数」那种行），再退回文本规则
        if (!found.length) found = parseTimetableText(text, { totalWeeks: total });
      } else {
        setProgress(t('schedule.ocrRunning'));
        const text = await localOcr(dataUrl, (p) => setProgress(`${t('schedule.ocrRunning')} ${p}%`));
        found = parseTimetableText(text, { totalWeeks: total });
      }
      setCandidates(found);
      setPicked(new Set(found.map((_, i) => i)));
      setEmpty(found.length === 0);
    } catch (e) {
      setFailed(true);
      toast(errorText(e));
    } finally {
      setRunning(false);
      setProgress('');
    }
  }

  async function doImport() {
    const chosen = candidates.filter((_, i) => picked.has(i));
    // 每门课换一个颜色，导入进来一眼能分清；按顺序循环取
    const courses = chosen.map((c, i) => candidateToCourse(c, COURSE_COLORS[i % COURSE_COLORS.length]));
    try {
      const n = await importCourses(courses);
      if (n > 0) onImported(n);
    } catch (e) {
      toast(errorText(e));
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('timetable.ocrTitle')}
    >
      <div className="ocr-body">
        <div className="muted ocr-hint">{t('timetable.ocrHint')}</div>

        <div className="ocr-mode">
          {cloudReady ? (
            <span className="chip on">
              <Sparkles size={12} /> {t('schedule.ocrCloud')}
            </span>
          ) : (
            <span className="chip on">{t('schedule.ocrLocal')}</span>
          )}
          {!cloudReady ? <span className="muted ocr-needkey">{t('schedule.ocrNeedKey')}</span> : null}
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pick(f);
            e.target.value = '';
          }}
        />

        {image ? <img className="ocr-preview" src={image} alt="" /> : null}

        <button className="btn primary block" onClick={() => fileRef.current?.click()} disabled={running}>
          {running ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />}
          {running ? progress || t('schedule.ocrRunning') : t('timetable.ocrPick')}
        </button>

        {empty && !running ? <div className="empty">{t('timetable.ocrEmpty')}</div> : null}
        {failed && !running ? <div className="empty">{t('schedule.ocrFail')}</div> : null}

        {candidates.length ? (
          <>
            <div className="section-title">{t('schedule.ocrFound', { n: candidates.length })}</div>
            <div className="ocr-list">
              {candidates.map((c, i) => (
                <button
                  key={`${c.name}-${i}`}
                  className={`ocr-item${picked.has(i) ? ' on' : ''}`}
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                >
                  <span className="ocr-dot">{picked.has(i) ? '✓' : ''}</span>
                  <span className="ocr-main">
                    <span className="ocr-title">
                      {c.name}
                      {/* 低置信度的行标一下，让人核对 —— 猜错老师名比不猜更麻烦 */}
                      {c.confidence < 0.7 ? (
                        <span className="ocr-warn" title={t('timetable.ocrLowConf')}>
                          <AlertTriangle size={12} />
                        </span>
                      ) : null}
                    </span>
                    <span className="ocr-meta">
                      {c.sessions
                        .map((s) =>
                          t('timetable.ocrSessionLine', {
                            wd: dict.weekShort[s.weekday % 7],
                            from: s.startPeriod,
                            to: s.endPeriod,
                          }),
                        )
                        .join('；')}
                      {c.location ? ` · ${c.location}` : ''}
                      {c.teacher ? ` · ${c.teacher}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row gap sheet-actions">
              <button
                className="btn grow"
                onClick={() => {
                  reset();
                  onClose();
                }}
              >
                {t('common.cancel')}
              </button>
              <button className="btn primary grow" onClick={() => void doImport()} disabled={!picked.size}>
                {t('timetable.ocrImport')}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/** 读成 dataURL，顺便压一下尺寸：OCR 和视觉模型都不需要原图那么大 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1600;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve('');
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/**
 * 本地 OCR。
 *
 * tesseract.js 有十几 MB 的 wasm + 语言包，所以**动态 import**：
 * 没点这个按钮的用户永远不下载它，首屏体积不受影响。
 */
async function localOcr(dataUrl: string, onProgress: (p: number) => void): Promise<string> {
  const mod = (await import('tesseract.js')) as unknown as {
    recognize: (
      img: string,
      lang: string,
      opts?: { logger?: (m: { status: string; progress: number }) => void },
    ) => Promise<{ data: { text: string } }>;
  };
  const res = await mod.recognize(dataUrl, 'chi_sim+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
    },
  });
  return res.data.text;
}

export default TimetableOcrDialog;
