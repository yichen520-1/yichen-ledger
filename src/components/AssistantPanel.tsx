import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bot, CornerDownLeft, RotateCcw, Sparkles, X } from 'lucide-react';
import { useI18n, type DictKey } from '../i18n';
import { useAssistantState } from '../state/AssistantContext';
import type { ChatMessage } from '../state/assistant';
import { useToast } from './Toast';

/**
 * 忆小尘的对话面板
 * ------------------------------------------------------------------
 * 入口是各页面右下角那颗浮起的按钮（.assistant-fab）。点开后：
 *   - 手机上从底部升起，占大半个屏幕；
 *   - 桌面上是右下角的一张卡片，不会盖住整个界面。
 *
 * 用 portal 挂到 body，理由和 Sheet 一样：页面切场有 transform 动画，
 * 就地渲染会让 fixed 定位被关进 .main-inner 里。
 */
export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { messages, busy, mode, cloud, send, reset, applyAnswer } = useAssistantState();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const toast = useToast();

  // 新消息进来时滚到底部。用 requestAnimationFrame 等 DOM 排完版再滚，
  // 否则量到的 scrollHeight 还是旧值，会差最后一条。
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [messages, open]);

  // 打开时聚焦输入框；Esc 收起
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 260);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  const suggestions = useMemo<DictKey[]>(() => {
    if (mode === 'schedule') {
      return ['assistant.ask.week', 'assistant.ask.free', 'assistant.ask.add'];
    }
    return ['assistant.ask.spend', 'assistant.ask.top', 'assistant.ask.budget', 'assistant.ask.net', 'assistant.ask.add'];
  }, [mode]);

  async function submit(text: string) {
    const value = text.trim();
    if (!value || busy) return;
    setDraft('');
    await send(value);
  }

  async function onApply(msg: ChatMessage) {
    try {
      await applyAnswer(msg.id);
      toast(t('assistant.applied'));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="assistant-mask" onClick={onClose}>
      <div className="assistant-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('assistant.name')}>
        <header className="assistant-head">
          <div className="assistant-id">
            <span className="assistant-avatar" aria-hidden>
              尘
            </span>
            <div>
              <strong>{mode === 'schedule' ? t('assistant.schedule') : t('assistant.ledger')}</strong>
              <span className={`assistant-badge${cloud ? ' cloud' : ''}`}>
                {cloud ? t('assistant.cloudBadge', { model: cloud.model }) : t('assistant.localBadge')}
              </span>
            </div>
          </div>
          <div className="assistant-tools">
            <button className="btn icon-btn" onClick={reset} aria-label={t('assistant.reset')} title={t('assistant.reset')}>
              <RotateCcw size={16} />
            </button>
            <button className="btn icon-btn" onClick={onClose} aria-label={t('assistant.close')} title={t('assistant.close')}>
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="assistant-list" ref={listRef}>
          {messages.length === 0 ? (
            <div className="assistant-hello">
              <p className="assistant-greeting">
                <Sparkles size={15} />
                {mode === 'schedule' ? t('assistant.greetingSchedule') : t('assistant.greetingLedger')}
              </p>
              <p className="assistant-hint">
                {mode === 'schedule' ? t('assistant.hintSchedule') : t('assistant.hintLedger')}
              </p>
              <div className="assistant-sugs">
                <div className="assistant-sugs-label">{t('assistant.suggestions')}</div>
                {suggestions.map((k) => (
                  <button key={k} className="assistant-sug" onClick={() => void submit(t(k))}>
                    {t(k)}
                  </button>
                ))}
              </div>
              {cloud ? null : <p className="assistant-note">{t('assistant.noKey')}</p>}
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} onApply={() => void onApply(m)} />)
          )}
          {busy ? (
            <div className="assistant-row bot">
              <div className="assistant-bubble typing">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
        </div>

        <form
          className="assistant-input"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft);
          }}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder={t('assistant.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // 回车发送、Shift+回车换行 —— 桌面上的习惯
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit(draft);
              }
            }}
          />
          <button className="assistant-send" type="submit" disabled={busy || !draft.trim()} aria-label={t('assistant.send')}>
            <CornerDownLeft size={16} />
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/** 一条消息气泡。助手的气泡里如果带着「待确认的动作」，多渲染一个按钮。 */
function Bubble({ msg, onApply }: { msg: ChatMessage; onApply: () => void }) {
  const { t } = useI18n();

  if (msg.pending) {
    return (
      <div className="assistant-row bot">
        <div className="assistant-bubble typing">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const pendingAction = msg.action && !msg.action.applied;

  return (
    <div className={`assistant-row ${isUser ? 'user' : 'bot'}`}>
      <div className="assistant-bubble">
        <div className="assistant-text">{msg.text}</div>
        {!isUser && msg.source === 'cloud' ? <span className="assistant-src">{t('assistant.cloudBadge', { model: '' }).replace('· ', '')}</span> : null}
        {!isUser && pendingAction ? (
          <button className="assistant-apply" onClick={onApply}>
            {msg.action?.kind === 'event' ? t('assistant.addEvent') : t('assistant.apply')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 各页面右下角的「叫忆小尘」按钮。
 * 单独抽出来是因为三个页面都要放，且位置/动画要一致。
 */
export function AssistantFab({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button className="assistant-fab" onClick={onOpen} aria-label={t('assistant.open')} title={t('assistant.open')}>
      <Bot size={20} />
    </button>
  );
}
