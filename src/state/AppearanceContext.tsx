import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { db } from '../db';

/**
 * 外观设置
 * ------------------------------------------------------------------
 * 三个区域（侧边栏 / 主内容 / 底部导航）各自有独立的背景图与画面参数，
 * 全局共享一套字体、强调色、圆角与玻璃质感。
 *
 * 为什么参数存 IndexedDB 而不是 localStorage：
 *   - 这条记录跟账本同库，清库时一起清掉，不会留下「账没了但壁纸还在」
 *     的半截状态；
 *   - 壁纸是 data URL，localStorage 5MB 根本放不下。
 *
 * 渲染策略：浏览器不让我们直接给「背景图」套 filter（会把子元素也滤镜掉），
 * 所以每个区域都由 <Backdrop> 画一层绝对定位的底，父级只负责 position:relative
 * 与 overflow。真正的内容叠在 z-index 之上。
 */

export type RegionKey = 'sidebar' | 'main' | 'tabbar';
export type FitMode = 'cover' | 'contain' | 'fill' | 'center';
export type FontStyle = 'system' | 'serif' | 'kai' | 'rounded';
/** 深浅主题：system 跟随系统 */
export type ThemeMode = 'system' | 'dark' | 'light';

export const REGIONS: RegionKey[] = ['sidebar', 'main', 'tabbar'];

export interface RegionStyle {
  /** data URL；null 表示不设壁纸，用纯色 */
  image: string | null;
  /** 模糊 px */
  blur: number;
  /** 亮度 % */
  brightness: number;
  /** 对比度 % */
  contrast: number;
  /** 饱和度 % */
  saturation: number;
  /** 水平位置 %，50 为居中 */
  offsetX: number;
  /** 垂直位置 % */
  offsetY: number;
  /** 缩放 %，100 为原始大小 */
  scale: number;
  /** 壁纸不透明度 % */
  opacity: number;
  /** 暗化 %，压在壁纸上让文字可读 */
  dim: number;
  fit: FitMode;
  flipX: boolean;
}

export interface Appearance {
  fontStyle: FontStyle;
  /** 字号基准 %，100~140 */
  fontScale: number;
  /** null = 跟随主题 */
  textColor: string | null;
  /** null = 默认琥珀 */
  accentColor: string | null;
  /** 圆角 px */
  radius: number;
  /** 玻璃强度 %：0 = 实底（关闭玻璃），100 = 出厂的水晶感，150 = 更透 */
  glass: number;
  /** 深浅主题 */
  theme: ThemeMode;
  regions: Record<RegionKey, RegionStyle>;
}

export const DEFAULT_REGION: RegionStyle = {
  image: null,
  blur: 0,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  offsetX: 50,
  offsetY: 50,
  scale: 100,
  opacity: 100,
  dim: 0,
  fit: 'cover',
  flipX: false,
};

export const DEFAULT_APPEARANCE: Appearance = {
  fontStyle: 'system',
  fontScale: 100,
  textColor: null,
  accentColor: null,
  radius: 20,
  glass: 100,
  theme: 'system',
  regions: {
    sidebar: { ...DEFAULT_REGION },
    main: { ...DEFAULT_REGION },
    tabbar: { ...DEFAULT_REGION },
  },
};

const SETTING_KEY = 'ui.appearance';

/** 字体栈：中英文都要能落到合适的字形上 */
const FONT_STACKS: Record<FontStyle, string> = {
  system:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Hiragino Sans GB', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif:
    "'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', '宋体', Georgia, 'Times New Roman', serif",
  kai: "'Kaiti SC', 'STXingkai', '华文行楷', 'KaiTi', '楷体', 'Xingkai SC', serif",
  rounded:
    "'Yuanti SC', 'Hiragino Maru Gothic ProN', 'Quicksand', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 合并用户存的旧数据与默认值，避免升级后字段缺失导致 NaN */
function normalize(raw: unknown): Appearance {
  if (!raw || typeof raw !== 'object') return DEFAULT_APPEARANCE;
  const src = raw as Partial<Appearance> & { glassAlpha?: number; glassBlur?: number };
  const regions = {} as Record<RegionKey, RegionStyle>;
  for (const key of REGIONS) {
    const incoming = (src.regions?.[key] ?? {}) as Partial<RegionStyle>;
    regions[key] = { ...DEFAULT_REGION, ...incoming };
  }

  /*
   * 老版本（v0.2~v0.5）存的是 glassAlpha(40~100) + glassBlur(0~40)，
   * 而且默认是 glassAlpha=100 也就是「玻璃关着」。新版换成单一的 glass 强度。
   * 迁移规则：老用户如果确实开过玻璃（alpha<100），按「越透明 → 强度越高」折算；
   * 没开过（=100）就给新版默认值 100，让他们也能看到新质感。
   */
  let glass: number;
  if (typeof src.glass === 'number') {
    glass = src.glass;
  } else if (typeof src.glassAlpha === 'number' && src.glassAlpha < 100) {
    // alpha 40 → 强度 140，alpha 100 → 强度 100
    glass = 100 + Math.round((100 - src.glassAlpha) * (40 / 60));
  } else {
    glass = DEFAULT_APPEARANCE.glass;
  }

  const theme: ThemeMode =
    src.theme === 'dark' || src.theme === 'light' || src.theme === 'system'
      ? src.theme
      : DEFAULT_APPEARANCE.theme;

  return {
    fontStyle: src.fontStyle ?? DEFAULT_APPEARANCE.fontStyle,
    fontScale: clamp(Number(src.fontScale ?? 100) || 100, 100, 140),
    textColor: src.textColor ?? null,
    accentColor: src.accentColor ?? null,
    radius: clamp(Number(src.radius ?? 20) || 0, 0, 26),
    glass: clamp(Number(glass) || 0, 0, 150),
    theme,
    regions,
  };
}

/** 把图片压成壁纸用的 data URL：最长边 1600、JPEG 0.82，够用又不撑爆 IndexedDB */
export async function readImageAsDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const ratio = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * ratio));
  const h = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.82);
}

/** 按适配方式算出 background-size / background-position */
function fitToCss(region: RegionStyle): CSSProperties {
  const size =
    region.fit === 'contain'
      ? 'contain'
      : region.fit === 'fill'
        ? '100% 100%'
        : region.fit === 'center'
          ? 'auto'
          : 'cover';
  return {
    backgroundImage: region.image ? `url(${region.image})` : undefined,
    backgroundSize: size,
    backgroundPosition: `${region.offsetX}% ${region.offsetY}%`,
    backgroundRepeat: 'no-repeat',
  };
}

/** 壁纸层的完整内联样式（含 transform 缩放） */
export function backdropStyle(region: RegionStyle): {
  layer: CSSProperties;
  dim: CSSProperties;
} {
  const filters = [
    region.blur > 0 ? `blur(${region.blur}px)` : '',
    `brightness(${region.brightness}%)`,
    `contrast(${region.contrast}%)`,
    `saturate(${region.saturation}%)`,
  ]
    .filter(Boolean)
    .join(' ');

  const scale = region.scale / 100;
  const transforms = [region.flipX ? 'scaleX(-1)' : '', scale !== 1 ? `scale(${scale})` : '']
    .filter(Boolean)
    .join(' ');

  const base = fitToCss(region);

  return {
    layer: {
      ...base,
      transform: transforms || undefined,
      opacity: region.opacity / 100,
      filter: filters || undefined,
    },
    dim: { background: `rgba(6, 8, 11, ${region.dim / 100})` },
  };
}

export interface AppearanceState {
  appearance: Appearance;
  setAppearance: (next: Appearance) => void;
  patchRegion: (key: RegionKey, patch: Partial<RegionStyle>) => void;
  patch: (patch: Partial<Appearance>) => void;
  resetRegion: (key: RegionKey) => void;
  resetAll: () => void;
  copyToAll: (from: RegionKey) => void;
}

const AppearanceCtx = createContext<AppearanceState | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearanceState] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    let alive = true;
    db.settings
      .get(SETTING_KEY)
      .then((row) => {
        // value 的类型是 unknown（settings 表同时存语言等其它设置），先确认是字符串
        if (!alive || typeof row?.value !== 'string') return;
        try {
          setAppearanceState(normalize(JSON.parse(row.value)));
        } catch {
          // 存的不是合法 JSON（比如被手工改过），退回默认值即可
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: Appearance) => {
    setAppearanceState(next);
    db.settings.put({ key: SETTING_KEY, value: JSON.stringify(next) }).catch(() => undefined);
  }, []);

  const patch = useCallback(
    (p: Partial<Appearance>) => {
      setAppearanceState((prev) => {
        const next = normalize({ ...prev, ...p });
        db.settings.put({ key: SETTING_KEY, value: JSON.stringify(next) }).catch(() => undefined);
        return next;
      });
    },
    [],
  );

  const patchRegion = useCallback((key: RegionKey, p: Partial<RegionStyle>) => {
    setAppearanceState((prev) => {
      const next: Appearance = {
        ...prev,
        regions: { ...prev.regions, [key]: { ...prev.regions[key], ...p } },
      };
      db.settings.put({ key: SETTING_KEY, value: JSON.stringify(next) }).catch(() => undefined);
      return next;
    });
  }, []);

  const resetRegion = useCallback((key: RegionKey) => {
    setAppearanceState((prev) => {
      const next: Appearance = {
        ...prev,
        regions: { ...prev.regions, [key]: { ...DEFAULT_REGION } },
      };
      db.settings.put({ key: SETTING_KEY, value: JSON.stringify(next) }).catch(() => undefined);
      return next;
    });
  }, []);

  const copyToAll = useCallback((from: RegionKey) => {
    setAppearanceState((prev) => {
      const source = prev.regions[from];
      const next: Appearance = {
        ...prev,
        regions: { sidebar: { ...source }, main: { ...source }, tabbar: { ...source } },
      };
      db.settings.put({ key: SETTING_KEY, value: JSON.stringify(next) }).catch(() => undefined);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => persist(normalize(DEFAULT_APPEARANCE)), [persist]);

  // 全局 CSS 变量：字体、字号、强调色、圆角、玻璃
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--font-stack', FONT_STACKS[appearance.fontStyle]);
    root.style.setProperty('--font-scale', String(appearance.fontScale / 100));
    root.style.setProperty('--radius', `${appearance.radius}px`);
    root.style.setProperty('--radius-sm', `${Math.max(4, appearance.radius - 6)}px`);
    if (appearance.accentColor) {
      root.style.setProperty('--accent', appearance.accentColor);
      root.style.setProperty('--accent-soft', `${appearance.accentColor}24`);
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-soft');
    }
    if (appearance.textColor) {
      root.style.setProperty('--text', appearance.textColor);
    } else {
      root.style.removeProperty('--text');
    }
    root.setAttribute('data-font', appearance.fontStyle);
  }, [appearance]);

  /*
   * 玻璃强度
   * ------------------------------------------------------------------
   * 一个 0~150 的滑块，映射到 CSS 变量：
   *   --glass-k       强度系数 0~1.5，填充不透明度在 CSS 里用 calc() 由它算
   *   --glass-blur-px 模糊半径 —— 封顶 26px，再高移动端开始掉帧
   *   --glass-saturate 饱和度  —— iOS 的玻璃会让背后的颜色更艳
   *
   * 0 表示关掉玻璃：一个 backdrop-filter 都不留，直接实底。
   * 不透明度不在这里算 —— 深浅两套的公式方向相反（深色越透越好看、
   * 浅色越透越糊），写在 CSS 里各用各的 calc()，JS 只给强度。
   */
  useEffect(() => {
    const root = document.documentElement;
    const k = clamp(appearance.glass, 0, 150) / 100;
    if (k <= 0) {
      root.setAttribute('data-glass', 'off');
      root.style.setProperty('--glass-k', '0');
      root.style.setProperty('--glass-blur-px', '0px');
      root.style.setProperty('--glass-saturate', '100%');
      return;
    }
    root.setAttribute('data-glass', 'on');
    root.style.setProperty('--glass-k', String(k));
    root.style.setProperty('--glass-blur-px', `${Math.round(clamp(26 * k, 8, 26))}px`);
    root.style.setProperty('--glass-saturate', `${Math.round(clamp(175 * k, 110, 200))}%`);
  }, [appearance.glass]);

  /*
   * 深浅主题
   * ------------------------------------------------------------------
   * 'system' 跟着系统走，但用户手动选了就必须压过系统 —— 所以监听
   * matchMedia 只在 system 模式下挂。写 data-theme 而不是 data-theme="dark"，
   * 是因为 :root 的默认值就是深色，少一次属性变更。
   */
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const wantLight =
        appearance.theme === 'light' || (appearance.theme === 'system' && mq.matches);
      if (wantLight) root.setAttribute('data-theme', 'light');
      else root.removeAttribute('data-theme');
    };
    apply();
    if (appearance.theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [appearance.theme]);

  const value = useMemo<AppearanceState>(
    () => ({
      appearance,
      setAppearance: persist,
      patchRegion,
      patch,
      resetRegion,
      resetAll,
      copyToAll,
    }),
    [appearance, persist, patchRegion, patch, resetRegion, resetAll, copyToAll],
  );

  return <AppearanceCtx.Provider value={value}>{children}</AppearanceCtx.Provider>;
}

export function useAppearance(): AppearanceState {
  const ctx = useContext(AppearanceCtx);
  if (!ctx) throw new Error('useAppearance 必须在 <AppearanceProvider> 内使用');
  return ctx;
}

/**
 * 是否有任何区域设了自定义壁纸。
 * 用来决定环境底要不要收起来 —— 壁纸已经铺满时再垫一层渐变，
 * 会在壁纸半透明的地方混出一层不该有的颜色。
 */
export function hasCustomBackdrop(appearance: Appearance): boolean {
  return REGIONS.some((key) => Boolean(appearance.regions[key].image));
}
