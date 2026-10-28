import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { db } from '../db';

/** 两种模式：记账（默认）与日程。整站的导航会跟着切。 */
export type AppMode = 'ledger' | 'schedule';

const SETTING_KEY = 'ui.mode';

interface ModeState {
  mode: AppMode;
  setMode: (m: AppMode) => void;
  /** 首次从库里读完之前为 true，避免闪一下再跳 */
  loading: boolean;
}

const Ctx = createContext<ModeState | null>(null);

/**
 * 模式切换。
 *
 * 为什么不放在路由里：用户希望这是一个「整站切换」的开关，而不是一个页面 ——
 * 切到日程模式后，侧边栏和底部导航换成一整套日程导航，记账那几个入口先收起，
 * 再切回来又是原来的样子。所以它更像一个全局状态，而不是 URL。
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppMode>('ledger');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    db.settings
      .get(SETTING_KEY)
      .then((row) => {
        if (!alive) return;
        if (row?.value === 'schedule' || row?.value === 'ledger') setModeState(row.value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((m: AppMode) => {
    setModeState(m);
    void db.settings.put({ key: SETTING_KEY, value: m });
  }, []);

  const value = useMemo<ModeState>(() => ({ mode, setMode, loading }), [mode, setMode, loading]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMode(): ModeState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useMode 必须在 <ModeProvider> 内使用');
  return v;
}
