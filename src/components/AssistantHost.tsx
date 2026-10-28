import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AssistantPanel } from './AssistantPanel';

/**
 * 把「忆小尘开着没有」这个状态提到应用顶层。
 *
 * 为什么不放在每个页面自己身上：
 *   面板是 fixed 定位盖在整页上的，如果由页面持有 open，那么从总览跳到统计时
 *   页面一卸载，面板会先闪一下再关掉，正在打字的输入也会丢。
 *   提到这里之后，切页面时面板保持原样（这也符合「聊天不该被打断」的直觉）。
 */
interface AssistantUi {
  open: boolean;
  show: () => void;
  hide: () => void;
}

const Ctx = createContext<AssistantUi | null>(null);

export function AssistantHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const value = useMemo<AssistantUi>(() => ({ open, show, hide }), [open, show, hide]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AssistantPanel open={open} onClose={hide} />
    </Ctx.Provider>
  );
}

export function useAssistantUi(): AssistantUi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistantUi 必须在 <AssistantHost> 内使用');
  return v;
}
