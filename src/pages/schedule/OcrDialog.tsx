import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Sparkles } from 'lucide-react';
import { Sheet } from '../../components/Sheet';
import { useToast } from '../../components/Toast';
import { useI18n, useErrorText } from '../../i18n';
import { createEvent } from '../../db/repository';
import { parseScheduleText, type OcrCandidate } from '../../domain/ocr';
import { toDateKey } from '../../domain/model';
import { chatCompletion, hasKey, PROVIDER_PRESETS, splitDataUrl, useAiConfig } from '../../state/ai';

/**
 * 从图片建日程。
 *
 * 两条路，共用同一个「候选列表 → 勾选 → 加入」的界面：
 * - 填了 API Key 且模型支持看图：云端多模态，直接把图丢过去，让它按行输出；
 * - 没填 Key：tesseract.js 在本机做 OCR（首次要下几十 MB 的语言包，会慢）。
 * 两条路的产物都是一段纯文本，再交给 domain/ocr.ts 的规则切成候选。
 */

const CLOUD_PROMPT = `你是日程识别助手。请从这张图片里提取所有日程/课程/会议安排。
严格按下面格式，一行一条，不要输出任何其它文字、不要编号、不要 markdown：
YYYY-MM-DD HH:MM-HH:MM 标题 @地点
没有地点的省略 @地点；没有具体时间的写成 YYYY-MM-DD 全天 标题。
如果图里只有「周三」「10月28日」这类相对日期，按今天往前最近的那个日期换算成 YYYY-MM-DD。`;

export function OcrDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (n: number) => void;
}) {
  const { t } = useI18n();
  const errorText = useErrorText();
  const toast = useToast();
  const { config } = useAiConfig();
  const fileRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<string>('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [candidates, setCandidates] = useState<OcrCandidate[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [empty, setEmpty] = useState(false);
  const [failed, setFailed] = useState(false);

  const cloudReady = hasKey(config) && (PROVIDER_PRESETS[config.provider].vision || config.provider === 'custom');

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
    const today = toDateKey(new Date());
    try {
      let text = '';
      if (cloudReady) {
        const { mime, base64 } = splitDataUrl(dataUrl);
        text = await chatCompletion(config, [
          { role: 'system', content: CLOUD_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `今天是 ${today}。请提取图中的日程。` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ]);
      } else {
        setProgress(t('schedule.ocrRunning'));
        text = await localOcr(dataUrl, (p) => setProgress(`${t('schedule.ocrRunning')} ${p}%`));
      }

      const found = parseScheduleText(text, today);
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

  async function importPicked() {
    const chosen = candidates.filter((_, i) => picked.has(i));
    let n = 0;
    for (const c of chosen) {
      try {
        await createEvent({
          title: c.title || t('schedule.untitled'),
          notes: '',
          location: c.location,
          date: c.date,
          startTime: c.startTime,
          endTime: c.endTime,
          allDay: c.allDay,
          color: '#5aa9f0',
          tag: '',
          recurrence: { freq: 'none', interval: 1, weekdays: [], until: null },
          reminders: [],
        });
        n += 1;
      } catch {
        // 单条失败不影响其它条
      }
    }
    if (n > 0) onImported(n);
  }

  return (
    <Sheet open={open} onClose={() => { reset(); onClose(); }} title={t('schedule.ocrTitle')}>
      <div className="ocr-body">
        <div className="muted ocr-hint">{t('schedule.ocrHint')}</div>

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
          {running ? progress || t('schedule.ocrRunning') : t('schedule.ocrPick')}
        </button>

        {empty && !running ? <div className="empty">{t('schedule.ocrEmpty')}</div> : null}
        {failed && !running ? <div className="empty">{t('schedule.ocrFail')}</div> : null}

        {candidates.length ? (
          <>
            <div className="section-title">{t('schedule.ocrFound', { n: candidates.length })}</div>
            <div className="ocr-list">
              {candidates.map((c, i) => (
                <button
                  key={`${c.raw}-${i}`}
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
                    <span className="ocr-title">{c.title || t('schedule.untitled')}</span>
                    <span className="ocr-meta">
                      {c.date} · {c.allDay ? t('schedule.allDayLabel') : `${c.startTime}-${c.endTime}`}
                      {c.location ? ` · ${c.location}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <div className="row gap sheet-actions">
              <button className="btn grow" onClick={() => { reset(); onClose(); }}>
                {t('common.cancel')}
              </button>
              <button className="btn primary grow" onClick={() => void importPicked()} disabled={!picked.size}>
                {t('schedule.ocrImport')}
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

export default OcrDialog;
