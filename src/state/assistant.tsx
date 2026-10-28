import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ask as askLocal,
  buildLedgerContext,
  buildScheduleContext,
  type Answer,
  type LedgerSnapshot,
  type Period,
  type ScheduleSnapshot,
} from '../domain/assistant';
import { formatCents, monthKeyOf } from '../domain/model';
import { useLedger } from './LedgerContext';
import { useMode } from './ModeContext';
import { useI18n, type DictKey } from '../i18n';
import { chatCompletion, hasKey, loadAiConfig, type AiConfig } from './ai';
import { createTransaction } from '../db/repository';
import { createEvent } from '../db/repository';

/**
 * 忆小尘的运行时
 * ------------------------------------------------------------------
 * 一条消息从「用户点发送」到「屏幕上出现一句话」，走的是：
 *
 *   1. 先本地跑一遍规则引擎（src/domain/assistant.ts），几十毫秒，离线可用；
 *   2. 如果配置了 API Key，同时把这句话连同账本摘要发给云端；
 *      云端答得出来就用云端的话，答不出来（网络、额度、格式）就退回第 1 步的结果；
 *   3. 本地规则如果判定成「要记一笔 / 要加日程」，会带上一个待确认的动作，
 *      用户在气泡里点一下才真正写库 —— 助手不替用户按下保存键。
 *
 * 为什么先本地再云端而不是「有 Key 就只走云端」：
 *   常见问题（这个月花了多少）本地算得更准也更快，云端还会编；
 *   而且用户断网时不该整块功能变成一块砖。
 */

export interface ChatAction {
  kind: 'transaction' | 'event';
  /** 已经落库了没有 */
  applied: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** 云端答的会带这个标记，界面用不同的小标签区分 */
  source?: 'local' | 'cloud';
  /** 本地规则算出的结构化答案，用来渲染「就这样记」按钮 */
  answer?: Answer;
  action?: ChatAction;
  pending?: boolean;
}

export interface AssistantState {
  messages: ChatMessage[];
  busy: boolean;
  mode: 'ledger' | 'schedule';
  /** 当前是否走云端（有 Key 且配置完整） */
  cloud: AiConfig | null;
  send: (text: string) => Promise<void>;
  reset: () => void;
  applyAnswer: (messageId: string) => Promise<void>;
}

let seq = 0;
function nextId(): string {
  seq += 1;
  return `m${Date.now().toString(36)}-${seq}`;
}

/** 把 Period 说成人话 */
function periodLabel(p: Period, t: (k: DictKey, v?: Record<string, string | number>) => string): string {
  switch (p.kind) {
    case 'today':
      return t('assistant.period.today');
    case 'yesterday':
      return t('assistant.period.yesterday');
    case 'thisWeek':
      return t('assistant.period.thisWeek');
    case 'lastWeek':
      return t('assistant.period.lastWeek');
    case 'thisMonth':
      return t('assistant.period.thisMonth');
    case 'lastMonth':
      return t('assistant.period.lastMonth');
    case 'thisYear':
      return t('assistant.period.thisYear');
    case 'lastYear':
      return t('assistant.period.lastYear');
    case 'recentDays':
      return t('assistant.period.recentDays', { n: p.n });
    case 'recentMonths':
      return t('assistant.period.recentMonths', { n: p.n });
    case 'month': {
      const mk = p.month ?? monthKeyOf(p.from);
      return t('assistant.period.month', { y: mk.slice(0, 4), m: String(Number(mk.slice(5, 7))) });
    }
    default:
      return t('assistant.period.all');
  }
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * 把结构化答案说成当前语言的一句话。
 * 所有文案都在 i18n 里，这里只负责选句子、填数字。
 */
export function renderAnswer(
  answer: Answer,
  t: (k: DictKey, v?: Record<string, string | number>) => string,
  lang: string,
): string {
  const p = (period: Period) => periodLabel(period, t);

  switch (answer.kind) {
    case 'spend':
      if (answer.amount === 0 && answer.count === 0) return t('assistant.ans.spendEmpty', { period: p(answer.period) });
      return answer.categoryName
        ? t('assistant.ans.spendCat', {
            period: p(answer.period),
            cat: answer.categoryName,
            amount: formatCents(answer.amount),
            n: answer.count,
          })
        : t('assistant.ans.spend', {
            period: p(answer.period),
            amount: formatCents(answer.amount),
            n: answer.count,
          });

    case 'income':
      if (answer.amount === 0) return t('assistant.ans.incomeEmpty', { period: p(answer.period) });
      return t('assistant.ans.income', {
        period: p(answer.period),
        amount: formatCents(answer.amount),
        n: answer.count,
      });

    case 'netWorth': {
      const head = t('assistant.ans.netWorth', { amount: formatCents(answer.amount) });
      if (!answer.top.length) return head;
      const list = answer.top.map((x) => `${x.name} ${formatCents(x.amount)}`).join('、');
      return `${head}\n${t('assistant.ans.netWorthTop', { list })}`;
    }

    case 'accountBalance':
      return t('assistant.ans.account', { name: answer.name, amount: formatCents(answer.amount) });

    case 'topCategory': {
      if (!answer.total) return t('assistant.ans.topEmpty', { period: p(answer.period) });
      const head = t('assistant.ans.top', {
        period: p(answer.period),
        name: answer.name,
        amount: formatCents(answer.amount),
        share: pct(answer.share),
      });
      if (!answer.rest.length) return head;
      return `${head}\n${t('assistant.ans.topRest', {
        list: answer.rest.map((x) => `${x.name} ${formatCents(x.amount)}`).join('、'),
      })}`;
    }

    case 'rising': {
      if (!answer.items.length) return t('assistant.ans.risingEmpty');
      const prev = t('assistant.period.month', {
        y: answer.prevMonth.slice(0, 4),
        m: String(Number(answer.prevMonth.slice(5, 7))),
      });
      return t('assistant.ans.rising', {
        prev,
        list: answer.items
          .map((x) => `${x.name} ${formatCents(x.before)} → ${formatCents(x.now)}`)
          .join('、'),
      });
    }

    case 'budgetStatus': {
      if (!answer.items.length) return t('assistant.ans.budgetEmpty');
      const mk = answer.month;
      return t('assistant.ans.budget', {
        month: t('assistant.period.month', { y: mk.slice(0, 4), m: String(Number(mk.slice(5, 7))) }),
        list: answer.items
          .map(
            (x) =>
              `${x.name === '*' ? (lang === 'en' ? 'Total' : lang === 'ja' ? '全体' : '总预算') : x.name} ${formatCents(x.spent)}/${formatCents(x.limit)}${x.ratio > 1 ? t('assistant.ans.budgetOver') : ''}`,
          )
          .join('；'),
      });
    }

    case 'budgetSuggest':
      if (!answer.amount) return t('assistant.ans.budgetSuggestEmpty');
      return t('assistant.ans.budgetSuggest', { n: answer.basisMonths, amount: formatCents(answer.amount) });

    case 'trend':
      return t('assistant.ans.trend', {
        n: answer.points.length,
        list: answer.points.map((x) => `${x.month.slice(5)} ${formatCents(x.expense)}`).join('、'),
      });

    case 'eventsInPeriod':
      if (!answer.items.length) return t('assistant.ans.eventsEmpty', { period: p(answer.period) });
      return `${t('assistant.ans.events', { period: p(answer.period), n: answer.items.length })}\n${answer.items
        .slice(0, 8)
        .map((x) => `· ${x.date.slice(5)} ${x.allDay ? '' : x.time} ${x.title}${x.done ? ' ✓' : ''}`)
        .join('\n')}`;

    case 'freeTime': {
      const head =
        answer.freeSlots.length > 0
          ? t('assistant.ans.free', {
              date: answer.date,
              list: answer.freeSlots.map(([a, b]) => `${a}–${b}`).join('、'),
            })
          : t('assistant.ans.freeNone', { date: answer.date });
      if (!answer.busy.length) return head;
      return `${head}\n${t('assistant.ans.freeBusy', {
        list: answer.busy.map((b) => `${b.start}–${b.end} ${b.title}`).join('、'),
      })}`;
    }

    case 'nextEvents':
      if (!answer.items.length) return t('assistant.ans.nextEmpty');
      return t('assistant.ans.next', {
        list: answer.items.map((x) => `${x.date.slice(5)} ${x.time} ${x.title}`).join('、'),
      });

    case 'proposeTransaction': {
      const a = answer.action;
      const summary = [
        a.type === 'income' ? '＋' : '－',
        formatCents(a.amount),
        a.categoryName ? `「${a.categoryName}」` : '',
        a.accountName ?? '',
        a.date,
        a.note ? ` ${a.note}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      return t('assistant.ans.proposeTx', { summary });
    }

    case 'proposeEvent': {
      const a = answer.action;
      const summary = `${a.date} ${a.allDay ? '' : `${a.startTime}${a.endTime ? '–' + a.endTime : ''}`} ${a.title}`;
      return t('assistant.ans.proposeEvent', { summary });
    }

    case 'unknown':
      return answer.mode === 'ledger' ? t('assistant.ans.unknownLedger') : t('assistant.ans.unknownSchedule');
  }
}

export function useAssistant(): AssistantState {
  const { accounts, categories, transactions, budgets, events } = useLedger();
  const { mode } = useMode();
  const { t, lang } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const cloudRef = useRef<AiConfig | null>(null);

  const ledgerSnap = useMemo<LedgerSnapshot>(
    () => ({ today: new Date().toISOString().slice(0, 10), accounts, categories, transactions, budgets }),
    [accounts, categories, transactions, budgets],
  );
  const scheduleSnap = useMemo<ScheduleSnapshot>(
    () => ({ today: new Date().toISOString().slice(0, 10), events }),
    [events],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setBusy(true);

      const userMsg: ChatMessage = { id: nextId(), role: 'user', text: trimmed };
      const pendingMsg: ChatMessage = { id: nextId(), role: 'assistant', text: '', pending: true };
      setMessages((prev) => [...prev, userMsg, pendingMsg]);

      // 1) 本地先算
      const snap = mode === 'ledger' ? ledgerSnap : scheduleSnap;
      let answer: Answer;
      try {
        answer = askLocal(trimmed, mode, snap);
      } catch {
        answer = { kind: 'unknown', mode, hints: [] };
      }
      let text2 = renderAnswer(answer, t, lang);
      let source: 'local' | 'cloud' = 'local';

      // 2) 有 Key 就问云端；失败退回本地
      try {
        const cfg = cloudRef.current ?? (await loadAiConfig());
        cloudRef.current = cfg;
        if (hasKey(cfg)) {
          const context =
            mode === 'ledger' ? buildLedgerContext(ledgerSnap, lang) : buildScheduleContext(scheduleSnap, lang);
          const system = [
            mode === 'ledger'
              ? '你叫忆小尘，是一个记账 App 里的助手，说话简短、像朋友。你只能根据下面的数据回答，算不准就说不知道，不要编数字。金额已经格式化好了，直接引用。'
              : '你叫忆小尘，是一个日程 App 里的助手，说话简短、像朋友。你只能根据下面的日程回答，不确定就说不知道。',
            '',
            context,
          ].join('\n');
          const reply = await chatCompletion(cfg, [
            { role: 'system', content: system },
            { role: 'user', content: trimmed },
          ]);
          if (reply.trim()) {
            text2 = reply.trim();
            source = 'cloud';
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message.slice(0, 80) : String(e).slice(0, 80);
        text2 = `${t('assistant.cloudFail', { msg })}\n\n${text2}`;
      }

      const action: ChatAction | undefined =
        answer.kind === 'proposeTransaction'
          ? { kind: 'transaction', applied: false }
          : answer.kind === 'proposeEvent'
            ? { kind: 'event', applied: false }
            : undefined;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id ? { ...m, text: text2, source, answer, action, pending: false } : m,
        ),
      );
      setBusy(false);
    },
    [busy, ledgerSnap, scheduleSnap, mode, t, lang],
  );

  const reset = useCallback(() => setMessages([]), []);

  /**
   * 「就这样记」：把气泡里的待确认动作真正写进库。
   * 分类 / 账户按名字找；找不到分类就留空（转账之外分类必填，所以这里
   * 退回到「其他支出 / 其他收入」这个内置分类）。
   */
  const applyAnswer = useCallback(
    async (messageId: string) => {
      const msg = messages.find((m) => m.id === messageId);
      if (!msg || !msg.answer) return;
      if (msg.answer.kind === 'proposeTransaction') {
        const a = msg.answer.action;
        const cat =
          categories.find((c) => c.name === a.categoryName && c.type === (a.type === 'income' ? 'income' : 'expense')) ??
          categories.find((c) => c.id === (a.type === 'income' ? 'cat-i-6' : 'cat-e-13')) ??
          categories.find((c) => c.type === (a.type === 'income' ? 'income' : 'expense'));
        const acc = accounts.find((x) => x.name === a.accountName) ?? accounts[0];
        await createTransaction({
          type: a.type,
          amountText: (a.amount / 100).toFixed(2),
          categoryId: cat?.id ?? null,
          accountId: acc?.id ?? '',
          toAccountId: null,
          date: a.date,
          note: a.note,
          tagsText: '',
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneTx'), action: { kind: 'transaction', applied: true } } : m)),
        );
        return;
      }

      if (msg.answer.kind === 'proposeEvent') {
        const a = msg.answer.action;
        await createEvent({
          title: a.title,
          notes: '',
          location: '',
          date: a.date,
          startTime: a.allDay ? '09:00' : a.startTime,
          endTime: a.allDay ? '10:00' : a.endTime || a.startTime,
          allDay: a.allDay,
          color: '#5aa9f0',
          tag: '',
          recurrence: { freq: 'none', interval: 1, weekdays: [], until: null },
          reminders: [15],
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneEvent'), action: { kind: 'event', applied: true } } : m)),
        );
      }
    },
    [messages, categories, accounts, t],
  );

  const cloud = cloudRef.current;

  return { messages, busy, mode, cloud, send, reset, applyAnswer };
}
