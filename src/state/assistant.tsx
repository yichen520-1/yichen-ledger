import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ask as askLocal,
  buildLedgerContext,
  buildScheduleContext,
  type Answer,
  type LedgerSnapshot,
  type Period,
  type ScheduleSnapshot,
} from '../domain/assistant';
import { detectSmallTalk, isFollowUp, type LastQuery, type SmallTalk } from '../domain/chat';
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

/**
 * 把闲聊意图说成一句话。
 * 和数据类回答分开是因为它不需要任何账本数据，也不该在云端失败时被覆盖。
 * weekdays 传当前语言的星期名，因为「今天星期三」的「星期三」是随语言变的。
 */
export function renderSmallTalk(
  talk: SmallTalk,
  t: (k: DictKey, v?: Record<string, string | number>) => string,
  weekdays: readonly string[],
): string {
  switch (talk.kind) {
    case 'greeting': {
      // 早上七点说「晚上好」比说「没太听懂」更伤人，所以问候要跟着时段走
      const key = `assistant.talk.greeting${(talk.detail ?? 'evening')[0].toUpperCase()}${(talk.detail ?? 'evening').slice(1)}` as DictKey;
      const text = t(key);
      // 词条缺失时 t() 会原样返回键名，这时退回通用问候
      return text.startsWith('assistant.') ? t('assistant.talk.greeting') : text;
    }
    case 'identity':
      return t('assistant.talk.identity');
    case 'capability':
      return t('assistant.talk.capability');
    case 'thanks':
      return t('assistant.talk.thanks');
    case 'farewell':
      return t('assistant.talk.farewell');
    case 'praise':
      return t('assistant.talk.praise');
    case 'apology':
      return t('assistant.talk.apology');
    case 'mood': {
      // 「累」和「难过」不该用同一句话安慰，认不出情绪时才走通用那句
      const mood = talk.detail ?? 'sad';
      const key = `assistant.talk.mood${mood[0].toUpperCase()}${mood.slice(1)}` as DictKey;
      const text = t(key);
      return text.startsWith('assistant.') ? t('assistant.talk.moodSad') : text;
    }
    case 'clock':
      return t('assistant.talk.clock', { time: talk.detail ?? '' });
    case 'date':
      return t('assistant.talk.date', {
        date: talk.detail ?? '',
        week: weekdays[talk.weekday ?? 0] ?? '',
      });
    case 'math':
      return t('assistant.talk.math', { expr: talk.detail ?? '', value: talk.value ?? '' });
    case 'weather':
      return t('assistant.talk.weather');
    case 'joke':
      return t('assistant.talk.joke');
    case 'ack':
      return t('assistant.talk.ack');
    case 'chatInvite':
      return t('assistant.talk.chatInvite');
    case 'selfState':
      return t('assistant.talk.selfState');
  }
}

export function useAssistant(): AssistantState {
  const { accounts, categories, transactions, budgets, events } = useLedger();
  const { mode } = useMode();
  const { t, lang, dict } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const cloudRef = useRef<AiConfig | null>(null);
  /** 界面上的「云端 / 本地」徽章用：只有真配了 Key 才非空 */
  const [cloudCfg, setCloudCfg] = useState<AiConfig | null>(null);
  /** 上一轮问了什么，用来接「那上个月呢」 */
  const lastQueryRef = useRef<LastQuery | null>(null);

  // 一进来就读一次配置，徽章不必等到第一条消息才变对
  useEffect(() => {
    let alive = true;
    void loadAiConfig().then((cfg) => {
      if (!alive) return;
      cloudRef.current = cfg;
      setCloudCfg(hasKey(cfg) ? cfg : null);
    });
    return () => {
      alive = false;
    };
  }, []);

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

      const snap = mode === 'ledger' ? ledgerSnap : scheduleSnap;

      /**
       * 1) 本地规则先算。
       *
       * 追问要先「补全」再算：「那上个月呢」本身没有动词，规则引擎认不出。
       * 做法是把上一轮的动词短语接回来 —— 上一轮是「这个月吃饭花了多少」，
       * 就把它改写成「上个月吃饭花了多少」。这一句只用于本地计算，
       * 界面上显示的仍然是用户原话。
       */
      let effective = trimmed;
      const last = lastQueryRef.current;
      if (last && isFollowUp(trimmed)) {
        const period = trimmed.replace(/^(那|那么|还有|再|继续|然后|换成|改成|呢)+/, '').replace(/呢$/, '');
        const carry = period.length >= 2 ? period : '上个月';
        effective = `${carry}${last.keywords}`;
      }

      let answer: Answer;
      try {
        answer = askLocal(effective, mode, snap);
      } catch {
        answer = { kind: 'unknown', mode, hints: [] };
      }

      // 记下这一轮问的是哪类事，供下一句追问复用
      if (answer.kind === 'spend') {
        lastQueryRef.current = {
          kind: 'spend',
          keywords: `${answer.categoryName ? answer.categoryName : ''}花了多少`,
        };
      } else if (answer.kind === 'income') {
        lastQueryRef.current = { kind: 'income', keywords: '收入是多少' };
      } else if (answer.kind === 'topCategory') {
        lastQueryRef.current = { kind: 'topCategory', keywords: '哪一类花得最多' };
      } else if (answer.kind === 'trend') {
        lastQueryRef.current = { kind: 'trend', keywords: '的趋势' };
      }

      let text2 = renderAnswer(answer, t, lang);
      let source: 'local' | 'cloud' = 'local';
      /** 闲聊命中时，云端失败也不该拿「没听懂」盖掉它 */
      let smallTalk: SmallTalk | null = null;

      // 规则引擎认不出 → 先看看是不是一句普通的聊天
      if (answer.kind === 'unknown') {
        smallTalk = detectSmallTalk(trimmed);
        if (smallTalk) text2 = renderSmallTalk(smallTalk, t, dict.weekLong);
      }

      /**
       * 2) 有 Key 就问云端。
       *
       * 三种情况不问云端：
       *   - 没填 Key；
       *   - 本地已经认出了「要记一笔 / 要加日程」，这类写操作必须走确认按钮，
       *     让模型用自然语言插一脚只会把按钮搞丢；
       *   - 本地算出了确切数字（花了多少、净资产…），这些本地比模型准。
       * 其余（闲聊、开放问题、闲聊层也认不出的）交给云端。
       */
      const localIsFact =
        answer.kind !== 'unknown' && answer.kind !== 'proposeTransaction' && answer.kind !== 'proposeEvent';
      try {
        const cfg = cloudRef.current ?? (await loadAiConfig());
        cloudRef.current = cfg;
        if (hasKey(cfg) && !localIsFact) {
          // 徽章要跟着实际走：填了 Key 之后第一条消息就该显示「云端」
          setCloudCfg(cfg);
          const context =
            mode === 'ledger' ? buildLedgerContext(ledgerSnap, lang) : buildScheduleContext(scheduleSnap, lang);
          const system = [
            '你叫忆小尘，是「忆笺记账」App 里的助手。说话简短、自然、像朋友聊天，不要端着。',
            '',
            '关于聊天：用户跟你打招呼、闲聊、说心情、问你是谁，就正常回应，别硬拉回记账。',
            '关于数据：下面给了账本/日程摘要。问到数字时严格按摘要说，算不准或摘要里没有就说不知道，绝不编。金额已经格式化好，直接引用。',
            mode === 'ledger'
              ? '关于记账：用户想记一笔时，提示他去「记一笔」页，或者直接说「记一笔午饭 25」由我来拆。'
              : '关于日程：用户想加日程时，提示他说「提醒我周三下午三点开会」这类话。',
            '',
            context,
          ].join('\n');

          // 带上最近几轮对话，模型才知道「那上个月呢」在问什么。
          // 只取最近 6 条（3 轮），再多既费 token 又容易跑题。
          const history = messages
            .filter((m) => !m.pending && m.text.trim())
            .slice(-6)
            .map((m) => ({ role: m.role, content: m.text }));

          const reply = await chatCompletion(cfg, [
            { role: 'system', content: system },
            ...history,
            { role: 'user', content: trimmed },
          ]);
          if (reply.trim()) {
            text2 = reply.trim();
            source = 'cloud';
          }
        }
      } catch (e) {
        // 超时和断网都走到这里。闲聊已经答上了就别再叠一句报错，
        // 那只会让人莫名其妙 —— 说「你好」不该收到一段技术错误。
        const raw = e instanceof Error ? e.message : String(e);
        const msg = /timeout|abort/i.test(raw) ? t('assistant.cloudTimeout') : raw.slice(0, 80);
        if (!smallTalk) text2 = `${t('assistant.cloudFail', { msg })}\n\n${text2}`;
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
    [busy, ledgerSnap, scheduleSnap, mode, t, lang, messages, dict],
  );

  const reset = useCallback(() => {
    setMessages([]);
    lastQueryRef.current = null;
  }, []);

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

  /**
   * 只有真配了 Key 才算「云端」。
   * cloudRef 是「读过配置了」的标记，不等于「能调云端」—— 直接把它交给界面，
   * 没填 Key 的人也会看到「云端 · deepseek-chat」，然后以为自己在用云端。
   */
  const cloud = cloudCfg;

  return { messages, busy, mode, cloud, send, reset, applyAnswer };
}
