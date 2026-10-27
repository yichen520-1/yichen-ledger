import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { db } from '../db';
import { zh, type Dict } from './zh';
import { en } from './en';
import { ja } from './ja';

/**
 * 三语支持
 * ------------------------------------------------------------------
 * 设计取舍：
 *   - 词典是「扁平查找」而不是引入 i18next 之类的库。项目只有三种语言、
 *     几百个词条，包一层 20 行的查找函数比多一个 40KB 的依赖划算；
 *   - 键用点号路径（t('settings.language')），类型由 zh.ts 反推，
 *     写错键名在 tsc 阶段就会报错，不会等到运行时才发现漏翻译；
 *   - 首次启动跟随系统语言，之后以用户的选择为准（存在 IndexedDB 的
 *     settings 表里，和账本同生共死）。
 */

export type Lang = 'zh' | 'en' | 'ja';
/** 用户可选「跟随系统」 */
export type LangSetting = Lang | 'system';

const DICTS: Record<Lang, Dict> = { zh, en, ja };

/** 把嵌套的词典结构摊成 'a.b.c' 这样的键联合类型 */
type Join<K extends string, P extends string> = `${K}.${P}`;
type Leaves<T> = T extends readonly unknown[]
  ? never
  : T extends object
    ? {
        [K in keyof T & string]: T[K] extends readonly unknown[]
          ? never
          : T[K] extends object
            ? Join<K, Leaves<T[K]>>
            : K;
      }[keyof T & string]
    : never;

export type DictKey = Leaves<Dict>;

const SETTING_KEY = 'ui.lang';

/** 按系统语言猜一个默认值：中文→zh，日文→ja，其余一律英文 */
export function detectLang(): Lang {
  const raw =
    typeof navigator !== 'undefined' ? (navigator.language || '').toLowerCase() : '';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('ja')) return 'ja';
  return 'en';
}

function lookup(dict: Dict, key: string): string {
  const parts = key.split('.');
  let node: unknown = dict;
  for (const part of parts) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }
  return typeof node === 'string' ? node : key;
}

/** {name} 形式的占位符替换 */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole: string, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface I18nState {
  /** 实际生效的语言 */
  lang: Lang;
  /** 用户的设置（可能是 'system'） */
  setting: LangSetting;
  setLang: (next: LangSetting) => void;
  /** 取词条 */
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  /** 当前语言的完整词典（拿 weekShort / weekLong 这类数组用） */
  dict: Dict;
}

const I18nCtx = createContext<I18nState | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [setting, setSetting] = useState<LangSetting>('system');
  const [loaded, setLoaded] = useState(false);

  // 读取已保存的选择。读失败也不要挡住界面——退回跟随系统。
  useEffect(() => {
    let alive = true;
    db.settings
      .get(SETTING_KEY)
      .then((row) => {
        if (!alive) return;
        const value = row?.value;
        if (value === 'zh' || value === 'en' || value === 'ja' || value === 'system') {
          setSetting(value);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const lang: Lang = setting === 'system' ? detectLang() : setting;

  const setLang = useCallback((next: LangSetting) => {
    setSetting(next);
    db.settings.put({ key: SETTING_KEY, value: next }).catch(() => undefined);
  }, []);

  // 同步 <html lang>，让朗读器、断词、字体回退都跟着变
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    }
  }, [lang]);

  const value = useMemo<I18nState>(() => {
    const dict = DICTS[lang];
    return {
      lang,
      setting,
      setLang,
      dict,
      t: (key, vars) => interpolate(lookup(dict, key), vars),
    };
  }, [lang, setting, setLang]);

  // 词典还没读出来时也先渲染：默认跟随系统，不会出现空白页
  void loaded;
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export function useI18n(): I18nState {
  const ctx = useContext(I18nCtx);
  if (!ctx) throw new Error('useI18n 必须在 <I18nProvider> 内使用');
  return ctx;
}

/**
 * 把任意 catch 到的错误翻成当前语言的句子。
 * 数据层抛的是错误码（见 repository 的 ErrorCode），普通 Error 就退回它的
 * message，完全看不出类型时用 errors.unknown 兜底。
 */
export function useErrorText(): (err: unknown) => string {
  const { t } = useI18n();
  return useCallback(
    (err: unknown) => {
      const code = (err as { code?: string } | null)?.code;
      if (typeof code === 'string' && code.startsWith('errors.')) {
        return t(code as DictKey);
      }
      if (err instanceof Error && err.message) return err.message;
      return t('errors.unknown');
    },
    [t],
  );
}
