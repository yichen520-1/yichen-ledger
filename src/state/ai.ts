import { useEffect, useState } from 'react';
import { db } from '../db';

/**
 * AI 配置。
 *
 * 设计上的取舍：默认**不填也能用**。
 * - 没填 Key：日程图片走本地 OCR（tesseract.js），忆小尘走本地规则引擎；
 * - 填了 Key：同一批功能自动升级成云端多模态 / 云端对话，界面无感切换。
 * Key 只存在这台设备的 IndexedDB 里，不上传任何地方，也不进备份文件。
 */

export type AiProvider = 'openai' | 'deepseek' | 'custom';

export interface AiConfig {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export const AI_SETTING_KEY = 'ai.config';

export const DEFAULT_AI: AiConfig = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
};

export const PROVIDER_PRESETS: Record<AiProvider, { baseUrl: string; model: string; vision: boolean }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', vision: true },
  deepseek: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', vision: false },
  custom: { baseUrl: '', model: '', vision: true },
};

/** 读配置（不订阅，一次性） */
export async function loadAiConfig(): Promise<AiConfig> {
  try {
    const row = await db.settings.get(AI_SETTING_KEY);
    if (!row || typeof row.value !== 'object' || row.value === null) return DEFAULT_AI;
    const v = row.value as Partial<AiConfig>;
    return {
      provider: v.provider ?? DEFAULT_AI.provider,
      baseUrl: (v.baseUrl ?? DEFAULT_AI.baseUrl).replace(/\/+$/, ''),
      apiKey: v.apiKey ?? '',
      model: v.model ?? DEFAULT_AI.model,
    };
  } catch {
    return DEFAULT_AI;
  }
}

export async function saveAiConfig(next: AiConfig): Promise<void> {
  await db.settings.put({ key: AI_SETTING_KEY, value: next });
}

/** 组件里用：配置 + 保存 */
export function useAiConfig() {
  const [config, setConfig] = useState<AiConfig>(DEFAULT_AI);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    loadAiConfig()
      .then((c) => {
        if (alive) setConfig(c);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function save(next: AiConfig) {
    setConfig(next);
    await saveAiConfig(next);
  }

  return { config, loaded, save };
}

export function hasKey(c: AiConfig): boolean {
  return c.apiKey.trim().length > 0;
}

/**
 * 调用 OpenAI 兼容的 /chat/completions。
 *
 * 走这个通用形状而不是各家 SDK：DeepSeek、OpenAI、以及绝大多数自建网关都兼容，
 * 用户填个 baseUrl 就能接自己的模型。
 */
export async function chatCompletion(
  config: AiConfig,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: unknown }>,
  opts: { temperature?: number; maxTokens?: number; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  /**
   * 必须有个兜底的超时。
   * 没有它，网络半死不活时 fetch 会一直挂着，对话框上的「正在输入」
   * 三个点会转到天荒地老 —— 用户只能以为助手卡死了。
   */
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? '';
}

/** 把图片 dataURL 拆成 base64 与 mime（多模态接口要的格式） */
export function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!m) return { mime: 'image/png', base64: dataUrl };
  return { mime: m[1], base64: m[2] };
}
