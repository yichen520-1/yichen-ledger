import { createContext, useContext, type ReactNode } from 'react';
import { useAssistant, type AssistantState } from './assistant';

/**
 * 忆小尘的对话状态要跨页面活着。
 * ------------------------------------------------------------------
 * 如果直接把 useAssistant() 放在面板组件里，用户从「总览」切到「统计」时
 * 面板会被卸载，刚聊的几句就没了 —— 这不是聊天该有的样子。
 * 所以状态提到 Provider 上，面板只是它的一层皮。
 */
const Ctx = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const state = useAssistant();
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useAssistantState(): AssistantState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAssistantState 必须在 <AssistantProvider> 内使用');
  return v;
}
