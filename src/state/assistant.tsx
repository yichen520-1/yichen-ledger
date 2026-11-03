import {useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { formatCents, monthKeyOf, toDateKey } from '../domain/model';
import { useLedger } from './LedgerContext';
import { useMode } from './ModeContext';
import { useI18n, type DictKey } from '../i18n';
import { chatCompletion, hasKey, loadAiConfig, type AiConfig } from './ai';
import {
  addPersonaNote,
  clearChatRecords,
  createEvent,
  createTransaction,
  deleteTransaction,
  listChatRecords,
  loadPersonaName,
  loadPersonaNotes,
  saveChatRecord,
  saveBudget,
  updateTransaction,
} from '../db/repository';
import { makeRecord, type ChatRecord } from '../domain/chatlog';
import { nameToContext, notesToContext, parseRememberCommand, type PersonaNote, withName } from '../domain/persona';

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
  /**
   * v0.10.0 从 2 种扩到 7 种。
   * 全部都是「点了才写库」—— 助手从不替用户按下保存键。
   */
  kind: 'transaction' | 'event' | 'edit' | 'delete' | 'bulk' | 'budget' | 'remember';
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
  /** 「记住…」命令解析出来的内容，点确认才写库 */
  remember?: { key: string; value: string };
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
  /** 称呼（设置页填的），没填是空串 */
  personaName: string;
  /** 助手笔记 */
  personaNotes: PersonaNote[];
  /** 改完称呼/笔记后刷新运行时，不用重启 App */
  refreshPersona: () => void;
  /** 清空对话（含库里的） */
  clearHistory: () => Promise<void>;
  /** 历史记录是否已经读回来了 */
  historyReady: boolean;
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

      /**
       * v0.10.0：多笔时逐条列出来，让用户能一行一行核对再点确认。
       * 只报一个合计是不负责任的 —— 拆错了人根本看不出来。
       */
      if (a.items && a.items.length > 1) {
        const list = a.items
          .map((x) => {
            const sign = x.type === 'income' ? '＋' : x.type === 'transfer' ? '⇄' : '－';
            const cat = x.type === 'transfer' ? `${x.accountName ?? ''} → ${x.toAccountName ?? ''}` : (x.categoryName ?? '');
            return `· ${sign}${formatCents(x.amount)} ${x.note || cat}`;
          })
          .join('\n');
        return t('assistant.ans.proposeTxMany', { n: a.items.length, list, total: formatCents(a.amount) });
      }

      const summary = [
        a.type === 'income' ? '＋' : a.type === 'transfer' ? '⇄' : '－',
        formatCents(a.amount),
        a.type === 'transfer'
          ? `${a.accountName ?? ''} → ${a.toAccountName ?? ''}`
          : a.categoryName
            ? `「${a.categoryName}」`
            : '',
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

    case 'txList': {
      if (answer.count === 0) return t('assistant.ans.txListEmpty', { period: p(answer.period) });
      // 每笔一行：日期 + 标题 + 金额。超过 12 笔只报前 12 笔，正文里说清总数。
      const list = answer.items
        .map((x) => `· ${x.date.slice(5)} ${x.title} ${formatCents(x.amount)}`)
        .join('\n');
      return answer.categoryName
        ? t('assistant.ans.txList', {
            period: p(answer.period),
            cat: answer.categoryName,
            n: answer.count,
            list,
          })
        : t('assistant.ans.txListNoCat', { period: p(answer.period), n: answer.count, list });
    }

    case 'forecast': {
      // 没有日程也要把钱说完 —— 人不会因为没安排就不吃饭，
      // 只回一句「没有日程」等于没回答问题。
      if (answer.eventCount === 0 && answer.busyDates.length === 0) {
        return t('assistant.ans.forecastNoEvents', {
          from: answer.from,
          to: answer.to,
          avg: formatCents(answer.dailyAvg),
          total: formatCents(answer.expected),
        });
      }
      return t('assistant.ans.forecast', {
        from: answer.from,
        to: answer.to,
        n: answer.eventCount,
        days: 30,
        avg: formatCents(answer.dailyAvg),
        total: formatCents(answer.expected),
      });
    }

    case 'bills': {
      if (answer.items.length === 0 && answer.fixedExpense === 0) return t('assistant.ans.billsEmpty');
      const list = answer.items
        .map(
          (x) =>
            `· ${x.date.slice(5)} ${x.title} ${x.amount > 0 ? formatCents(x.amount) : t('recurring.amountUnset')}`,
        )
        .join('\n');
      // 从日程生成的规则没有金额。这时说「合计 ¥0.00」会让人以为真的不花钱，
      // 所以换一句话，把「金额待填」明说出来。
      if (answer.items.length > 0 && answer.items.every((x) => x.amount === 0)) {
        return t('assistant.ans.billsNoAmount', { n: answer.items.length, list });
      }
      return t('assistant.ans.bills', {
        n: answer.items.length,
        total: formatCents(answer.fixedExpense),
        list,
      });
    }

    case 'weekly':
      return t('assistant.ans.weekly', {
        range: `${answer.from.slice(5)} – ${answer.to.slice(5)}`,
        spend: formatCents(answer.expense),
        income: formatCents(answer.income),
        events: answer.eventCount,
      });

    case 'proposeEdit': {
      const { before, after, changes } = answer.target;
      const parts: string[] = [];
      if (changes.includes('amount')) {
        parts.push(t('assistant.ans.editAmount', { before: formatCents(before.amount), after: formatCents(after.amount) }));
      }
      if (changes.includes('category')) {
        parts.push(
          t('assistant.ans.editCategory', { before: before.categoryName ?? '—', after: after.categoryName ?? '—' }),
        );
      }
      if (changes.includes('note')) {
        parts.push(t('assistant.ans.editNote', { before: before.note || '—', after: after.note || '—' }));
      }
      if (changes.includes('date')) {
        parts.push(t('assistant.ans.editDate', { before: before.date, after: after.date }));
      }
      if (changes.includes('account')) {
        parts.push(t('assistant.ans.editAccount', { after: after.accountName ?? '—' }));
      }
      return t('assistant.ans.proposeEdit', {
        summary: before.date + ' ' + (before.note || before.categoryName || '—') + ' ' + formatCents(before.amount),
        changes: parts.join('；'),
      });
    }

    case 'proposeDelete':
      return t('assistant.ans.proposeDelete', {
        summary:
          answer.target.date +
          ' ' +
          (answer.target.note || answer.target.categoryName || '—') +
          ' ' +
          formatCents(answer.target.amount),
      });

    case 'proposeBulk':
      // 命中的那几笔本来就全是目标分类 —— 这件事已经成立了，
      // 不该让用户点一个「确认改这 0 笔」的按钮。
      if (answer.bulk.already) {
        return t('assistant.ans.bulkAlready', {
          cat: answer.bulk.categoryName,
          from: answer.bulk.periodLabel.from.slice(5),
          to: answer.bulk.periodLabel.to.slice(5),
        });
      }
      return t('assistant.ans.proposeBulk', {
        n: answer.bulk.txIds.length,
        cat: answer.bulk.categoryName,
        from: answer.bulk.periodLabel.from.slice(5),
        to: answer.bulk.periodLabel.to.slice(5),
      });

    case 'proposeBudget':
      return answer.draft.basis.amount > 0
        ? t('assistant.ans.proposeBudgetBasis', {
            cat: answer.draft.categoryName ?? t('assistant.ans.budgetOverall'),
            amount: formatCents(answer.draft.amount),
            month: answer.draft.basis.month,
            spent: formatCents(answer.draft.basis.amount),
          })
        : t('assistant.ans.proposeBudget', {
            cat: answer.draft.categoryName ?? t('assistant.ans.budgetOverall'),
            amount: formatCents(answer.draft.amount),
          });

    case 'eventSpend': {
      if (answer.count === 0) {
        return t('assistant.ans.eventSpendEmpty', { title: answer.eventTitle, date: answer.eventDate });
      }
      const list = answer.items
        .map((x) => '· ' + x.date.slice(5) + ' ' + x.title + ' ' + formatCents(x.amount))
        .join('\n');
      return t('assistant.ans.eventSpend', {
        title: answer.eventTitle,
        date: answer.eventDate,
        n: answer.count,
        total: formatCents(answer.net),
        list,
      });
    }

    case 'vague':
      // 兜底：说清「我没完全听懂」，但给出方向 + 可以点的示例，
      // 而不是干巴巴一句「没听懂」把用户推回去重说一遍。
      return answer.guess === 'money'
        ? t('assistant.ans.vagueMoney')
        : answer.guess === 'schedule'
          ? t('assistant.ans.vagueSchedule')
          : t('assistant.ans.vagueAny');

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
  const { accounts, categories, transactions, budgets, events, rules } = useLedger();
  const { mode } = useMode();
  const { t, lang, dict } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const cloudRef = useRef<AiConfig | null>(null);
  /** 界面上的「云端 / 本地」徽章用：只有真配了 Key 才非空 */
  const [cloudCfg, setCloudCfg] = useState<AiConfig | null>(null);
  /** 上一轮问了什么，用来接「那上个月呢」 */
  const lastQueryRef = useRef<LastQuery | null>(null);

  /* ---- v0.10.0：称呼与笔记 ---- */
  const [personaName, setPersonaName] = useState('');
  const [personaNotes, setPersonaNotes] = useState<PersonaNote[]>([]);
  /** 设置页改完之后调它，不用重启 App */
  const [personaTick, setPersonaTick] = useState(0);
  const refreshPersona = useCallback(() => setPersonaTick((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadPersonaName(), loadPersonaNotes()]).then(([name, notes]) => {
      if (!alive) return;
      setPersonaName(name);
      setPersonaNotes(notes);
    });
    return () => {
      alive = false;
    };
  }, [personaTick]);

  /* ---- v0.10.0：把上次的对话读回来 ---- */
  const [historyReady, setHistoryReady] = useState(false);
  /**
   * 只在第一次挂载时读库，之后 messages 就是唯一的真相。
   * 如果每次都跟着 messages 重新读，刚发出去那条会因为「还没写进库」
   * 被覆盖掉，界面会闪一下。
   */
  useEffect(() => {
    let alive = true;
    void listChatRecords().then((rows) => {
      if (!alive) return;
      if (rows.length > 0) {
        setMessages(
          rows.map((r) => ({
            id: r.id,
            role: r.role,
            text: r.text,
            ...(r.source ? { source: r.source } : {}),
          })),
        );
      }
      setHistoryReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 落库。只存文本，不存 answer（answer 里带的是当时的账目明细，
   * 之后那些账目被改了就会显示成「已经不存在的账」）。
   */
  const persist = useCallback((record: ChatRecord) => {
    void saveChatRecord(record).catch(() => {
      // 存历史失败不该影响对话本身 —— 顶多下次打开看不到这条
    });
  }, []);

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
    () => ({
      today: toDateKey(new Date()),
      accounts,
      categories,
      transactions,
      budgets,
      // v0.8.0：跨模块问答（「那几天大概要花多少」「有哪些账单该记了」）要用日程和规则
      events,
      rules,
    }),
    [accounts, categories, transactions, budgets, events, rules],
  );
  const scheduleSnap = useMemo<ScheduleSnapshot>(
    () => ({ today: toDateKey(new Date()), events }),
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
      persist(makeRecord('user', trimmed, undefined, new Date().toISOString()));

      /**
       * v0.10.0：「记住我不吃香菜」这类话不进规则引擎，也不该问云端。
       * 它是一条本地命令 —— 解析出来就是一个待确认的写操作，
       * 用户点了才真的存进笔记。
       */
      const remember = parseRememberCommand(trimmed);
      if (remember) {
        const a = { key: remember.key, value: remember.value };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingMsg.id
              ? {
                  ...m,
                  text: t('assistant.ans.proposeRemember', { key: a.key, value: a.value }),
                  source: 'local',
                  action: { kind: 'remember', applied: false },
                  pending: false,
                  remember: a,
                }
              : m,
          ),
        );
        setBusy(false);
        return;
      }

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

      /**
       * 规则引擎认不出 → 先看看是不是一句普通的聊天。
       *
       * v0.10.0 的坑：这里原来只判 `kind === 'unknown'`，而这一版在
       * unknown 之前加了一层 vague 兜底 —— 结果「你好」「谢谢」「今天几号」
       * 全都被判成 vague，闲聊彻底失效。vague 本来就等于「没听懂」，
       * 所以两个都要走进来。顺序很重要：**先试闲聊，再退回 vague**，
       * 因为「你好」比「这句话我没太听懂」是好得多的回答。
       */
      if (answer.kind === 'unknown' || answer.kind === 'vague') {
        smallTalk = detectSmallTalk(trimmed);
        if (smallTalk) {
          /*
           * 闲聊也要带称呼。
           *
           * v0.10.0 加了称呼之后，只有开场白那两句用了它 —— 用户填完名字，
           * 问「你好」还是回「晚上好。今天累不累？」，名字像没生效。
           * 这里套一层 withName，模板里没有 {name} 占位符时它什么都不做。
           */
          const raw = renderSmallTalk(smallTalk, t, dict.weekLong);
          text2 = personaName ? withName(`{name}，${raw}`, personaName) : raw;
        } else if (answer.kind === 'vague') {
          /*
           * 闲聊表也认不出，但规则引擎猜到了方向（钱 / 日程）。
           *
           * 日程模式下这个方向尤其重要：用户说「记一笔午饭 25」时，
           * 他说的完全清楚，只是说错了地方 —— 该告诉他「记账在另一边」，
           * 而不是「这句我没太听懂」让他重说一遍。
           */
          const crossMode =
            mode === 'schedule' && answer.guess === 'money'
              ? t('assistant.ans.wrongSideLedger')
              : mode === 'ledger' && answer.guess === 'schedule'
                ? t('assistant.ans.wrongSideSchedule')
                : null;
          if (crossMode) text2 = crossMode;
        }
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
      /*
       * 本地算出来的「确定答案」才不需要问云端。
       *
       * v0.10.1 修：vague 原来被算进 localIsFact 了 —— 但 vague 的意思
       * 恰恰是「我没听懂」，这正是最该交给云端的场景。结果就是填了 Key
       * 也永远走不到云端，因为规则引擎现在几乎不返回 unknown 了。
       */
      const localIsFact =
        answer.kind !== 'unknown' &&
        answer.kind !== 'vague' &&
        answer.kind !== 'proposeTransaction' &&
        answer.kind !== 'proposeEvent';
      try {
        const cfg = cloudRef.current ?? (await loadAiConfig());
        cloudRef.current = cfg;
        if (hasKey(cfg) && !localIsFact) {
          // 徽章要跟着实际走：填了 Key 之后第一条消息就该显示「云端」
          setCloudCfg(cfg);
          const context =
            mode === 'ledger' ? buildLedgerContext(ledgerSnap, lang) : buildScheduleContext(scheduleSnap, lang);
          const persona = [nameToContext(personaName), notesToContext(personaNotes)].filter(Boolean);
          const system = [
            '你叫忆小尘，是「忆笺」App 里的助手。忆笺里有记账和日程两块，你都管。说话简短、自然、像朋友聊天，不要端着。',
            '',
            '关于聊天：用户跟你打招呼、闲聊、说心情、问你是谁，就正常回应，别硬拉回记账。',
            '关于数据：下面给了账本/日程摘要。问到数字时严格按摘要说，算不准或摘要里没有就说不知道，绝不编。金额已经格式化好，直接引用。',
            mode === 'ledger'
              ? '关于记账：用户想记一笔时，提示他去「记一笔」页，或者直接说「记一笔午饭 25」由我来拆。'
              : '关于日程：用户想加日程时，提示他说「提醒我周三下午三点开会」这类话。',
            ...(persona.length > 0
              ? ['', ...persona, '关于称呼：上面有称呼就用它开头，但不要每句都用，那样很腻。']
              : []),
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

      /**
       * 只有「写操作」才带按钮。七种写操作全都要用户点一下才落库 ——
       * 助手可以提议，但不能替人按下保存键。
       *
       * 批量归类有个例外：如果命中的那几笔本来就已经全是目标分类，
       * 那就没有要写的库，也就没有按钮 —— 否则会出现一个
       * 「确认改这 0 笔」的按钮，点了什么都不会变。
       */
      const action: ChatAction | undefined =
        answer.kind === 'proposeTransaction'
          ? { kind: 'transaction', applied: false }
          : answer.kind === 'proposeEvent'
            ? { kind: 'event', applied: false }
            : answer.kind === 'proposeEdit'
              ? { kind: 'edit', applied: false }
              : answer.kind === 'proposeDelete'
                ? { kind: 'delete', applied: false }
                : answer.kind === 'proposeBulk' && !answer.bulk.already
                  ? { kind: 'bulk', applied: false }
                  : answer.kind === 'proposeBudget'
                    ? { kind: 'budget', applied: false }
                    : undefined;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id ? { ...m, text: text2, source, answer, action, pending: false } : m,
        ),
      );
      persist(makeRecord('assistant', text2, source, new Date().toISOString()));
      setBusy(false);
    },
    /*
     * personaName / personaNotes 必须进依赖数组。
     *
     * 这是 v0.10.0 抓到的一个真实缺陷：useCallback 的依赖里漏了 personaName，
     * 于是 send 一直闭包着第一次渲染时的空串 —— 设置页填了称呼、开场白也显示
     * 「老陈，我是忆小尘」，可一旦真的问它话，回答里还是不带名字。
     * 依赖数组写漏的症状就是这样：界面上看得到，但逻辑里读不到。
     */
    [busy, ledgerSnap, scheduleSnap, mode, t, lang, messages, dict, personaName, personaNotes],
  );

  const reset = useCallback(() => {
    setMessages([]);
    lastQueryRef.current = null;
  }, []);

  /** 清空对话：界面和库里一起清，不然下次打开又回来了 */
  const clearHistory = useCallback(async () => {
    setMessages([]);
    lastQueryRef.current = null;
    await clearChatRecords();
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
        /**
         * v0.10.0：一句话可能带好几笔（「早饭12，打车28」），也可能是转账。
         * items 有值就逐条写；没值就是原来那一条。
         */
        const rows = a.items && a.items.length > 0 ? a.items : [a];

        for (const row of rows) {
          const acc = accounts.find((x) => x.name === row.accountName) ?? accounts[0];

          // 转账：分类留空，目标账户必须找得到，否则宁可跳过也不乱记
          if (row.type === 'transfer') {
            const to = accounts.find((x) => x.name === row.toAccountName);
            if (!to || !acc) continue;
            await createTransaction({
              type: 'transfer',
              amountText: (row.amount / 100).toFixed(2),
              categoryId: null,
              accountId: acc.id,
              toAccountId: to.id,
              date: row.date,
              note: row.note,
              tagsText: '',
            });
            continue;
          }

          const cat =
            categories.find((c) => c.name === row.categoryName && c.type === (row.type === 'income' ? 'income' : 'expense')) ??
            categories.find((c) => c.id === (row.type === 'income' ? 'cat-i-6' : 'cat-e-13')) ??
            categories.find((c) => c.type === (row.type === 'income' ? 'income' : 'expense'));
          await createTransaction({
            type: row.type,
            amountText: (row.amount / 100).toFixed(2),
            categoryId: cat?.id ?? null,
            accountId: acc?.id ?? '',
            toAccountId: null,
            date: row.date,
            note: row.note,
            tagsText: '',
          });
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  text: rows.length > 1 ? t('assistant.ans.doneTxMany', { n: rows.length }) : t('assistant.ans.doneTx'),
                  action: { kind: 'transaction', applied: true },
                }
              : m,
          ),
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
        return;
      }

      /* ---- 改一笔 ---- */
      if (msg.answer.kind === 'proposeEdit') {
        const tg = msg.answer.target;
        const orig = transactions.find((x) => x.id === tg.txId);
        if (!orig) {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.failed'), action: { kind: 'edit', applied: false } } : m)),
          );
          return;
        }
        const cat =
          categories.find((c) => c.name === tg.after.categoryName && c.type === orig.type) ??
          categories.find((c) => c.id === orig.categoryId);
        const acc = accounts.find((x) => x.name === tg.after.accountName) ?? accounts.find((x) => x.id === orig.accountId);
        await updateTransaction(orig.id, {
          type: orig.type,
          amountText: (tg.after.amount / 100).toFixed(2),
          categoryId: cat?.id ?? orig.categoryId,
          accountId: acc?.id ?? orig.accountId,
          toAccountId: orig.toAccountId,
          date: tg.after.date,
          note: tg.after.note,
          tagsText: orig.tags.join(' '),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneEdit'), action: { kind: 'edit', applied: true } } : m)),
        );
        return;
      }

      /* ---- 删一笔 ---- */
      if (msg.answer.kind === 'proposeDelete') {
        await deleteTransaction(msg.answer.target.txId);
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneDelete'), action: { kind: 'delete', applied: true } } : m)),
        );
        return;
      }

      /* ---- 批量归类 ---- */
      if (msg.answer.kind === 'proposeBulk') {
        const bulk = msg.answer.bulk;
        const cat = categories.find((c) => c.name === bulk.categoryName);
        if (cat) {
          for (const id of bulk.txIds) {
            const orig = transactions.find((x) => x.id === id);
            if (!orig) continue;
            await updateTransaction(orig.id, {
              type: orig.type,
              amountText: (orig.amount / 100).toFixed(2),
              categoryId: cat.id,
              accountId: orig.accountId,
              toAccountId: orig.toAccountId,
              date: orig.date,
              note: orig.note,
              tagsText: orig.tags.join(' '),
            });
          }
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneBulk', { n: bulk.txIds.length }), action: { kind: 'bulk', applied: true } } : m)),
        );
        return;
      }

      /* ---- 建预算 ---- */
      if (msg.answer.kind === 'proposeBudget') {
        const d = msg.answer.draft;
        const cat = d.categoryName ? categories.find((c) => c.name === d.categoryName) : null;
        await saveBudget({
          id: `bud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          categoryId: cat?.id ?? null,
          amount: d.amount,
          month: d.month,
          createdAt: new Date().toISOString(),
        });
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneBudget'), action: { kind: 'budget', applied: true } } : m)),
        );
        return;
      }

      /* ---- 记住一件事 ---- */
      if (msg.remember) {
        const next = await addPersonaNote(msg.remember.key, msg.remember.value);
        setPersonaNotes(next);
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? { ...m, text: t('assistant.ans.doneRemember'), action: { kind: 'remember', applied: true } } : m)),
        );
      }
    },
    [messages, categories, accounts, transactions, t],
  );

  /**
   * 只有真配了 Key 才算「云端」。
   * cloudRef 是「读过配置了」的标记，不等于「能调云端」—— 直接把它交给界面，
   * 没填 Key 的人也会看到「云端 · deepseek-chat」，然后以为自己在用云端。
   */
  const cloud = cloudCfg;

  return {
    messages,
    busy,
    mode,
    cloud,
    send,
    reset,
    applyAnswer,
    personaName,
    personaNotes,
    refreshPersona,
    clearHistory,
    historyReady,
  };
}
