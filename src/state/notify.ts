import type { EventItem, Occurrence } from '../domain/schedule';
import { expandRange, reminderTimes, addDays } from '../domain/schedule';

/**
 * 提醒。
 *
 * 四端情况不一样，所以分三条路：
 * - Android / iOS（Capacitor 原生壳）：用 @capacitor/local-notifications 排真正的系统通知，
 *   关掉 App 也会响。
 * - 网页版：没有「关掉页面还能提醒」这回事（浏览器不给这个权限），
 *   退化成「页面开着的时候到点弹一条」，并且显式告诉用户这个限制。
 * - Electron：同样走页面内的 setTimeout（桌面壳里页面一直活着，够用）。
 *
 * 所有路径都不联网、不上报，通知内容只在本机生成。
 */

export type NotifySupport = 'native' | 'web' | 'unsupported';

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

interface LocalNotificationsPlugin {
  requestPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' }>;
  checkPermissions: () => Promise<{ display: 'granted' | 'denied' | 'prompt' }>;
  schedule: (opts: {
    notifications: Array<{
      id: number;
      title: string;
      body: string;
      schedule: { at: Date };
      extra?: Record<string, unknown>;
    }>;
  }) => Promise<void>;
  cancel: (opts: { notifications: Array<{ id: number }> }) => Promise<void>;
  getPending: () => Promise<{ notifications: Array<{ id: number }> }>;
}

function capGlobal(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** 当前设备到底能不能排原生通知 */
export function notifySupport(): NotifySupport {
  const cap = capGlobal();
  if (cap?.isNativePlatform?.()) return 'native';
  if (typeof Notification !== 'undefined') return 'web';
  return 'unsupported';
}

async function loadPlugin(): Promise<LocalNotificationsPlugin | null> {
  if (notifySupport() !== 'native') return null;
  try {
    const mod = await import('@capacitor/local-notifications');
    return (mod as unknown as { LocalNotifications: LocalNotificationsPlugin }).LocalNotifications;
  } catch {
    return null;
  }
}

/** 申请通知权限；返回是否拿到 */
export async function ensureNotifyPermission(): Promise<boolean> {
  const support = notifySupport();
  if (support === 'native') {
    const plugin = await loadPlugin();
    if (!plugin) return false;
    try {
      let p = await plugin.checkPermissions();
      if (p.display !== 'granted') p = await plugin.requestPermissions();
      return p.display === 'granted';
    } catch {
      return false;
    }
  }
  if (support === 'web') {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    try {
      return (await Notification.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 通知 id 必须是一个 32 位整数，而日程 id 是字符串。
 * 用「字符串哈希 + 日期序号」凑一个稳定的整数，同一发生重复排不会重复建。
 */
function numericId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 2147483000;
}

/** 把未来 windowDays 天内的提醒全部重排（先清掉旧的，避免重复） */
export async function rescheduleAll(
  events: EventItem[],
  windowDays = 30,
  labels?: { title: (ev: EventItem) => string; body: (ev: EventItem, date: string) => string },
): Promise<number> {
  const support = notifySupport();
  if (support === 'unsupported') return 0;

  const today = new Date();
  const from = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  const to = addDays(from, windowDays);
  const occs = expandRange(events, from, to).filter((o) => !o.done);

  const titleOf = labels?.title ?? ((ev: EventItem) => ev.title);
  const bodyOf =
    labels?.body ?? ((ev: EventItem, date: string) => (ev.location ? `${date} · ${ev.location}` : date));

  if (support === 'native') {
    const plugin = await loadPlugin();
    if (!plugin) return 0;
    try {
      const pending = await plugin.getPending();
      if (pending.notifications.length) {
        await plugin.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      }
      const items: Array<{
        id: number;
        title: string;
        body: string;
        schedule: { at: Date };
      }> = [];
      for (const occ of occs) {
        for (const at of reminderTimes(occ)) {
          items.push({
            id: numericId(`${occ.key}@${at.getTime()}`),
            title: titleOf(occ.event),
            body: bodyOf(occ.event, occ.date),
            schedule: { at },
          });
        }
      }
      // 一次别塞太多，系统对 pending 数量有上限（iOS 64 条）
      for (let i = 0; i < items.length; i += 50) {
        await plugin.schedule({ notifications: items.slice(i, i + 50) });
      }
      return items.length;
    } catch {
      return 0;
    }
  }

  // 网页 / Electron：只排未来 12 小时内、还没到点的那些，靠页面里的定时器
  webTimers.length = 0;
  const now = Date.now();
  const horizon = now + 12 * 3600 * 1000;
  let count = 0;
  for (const occ of occs) {
    for (const at of reminderTimes(occ)) {
      if (at.getTime() > horizon) continue;
      const delay = at.getTime() - now;
      if (delay <= 0) continue;
      const timer = window.setTimeout(() => {
        try {
          if (notifySupport() === 'web' && Notification.permission === 'granted') {
            new Notification(titleOf(occ.event), { body: bodyOf(occ.event, occ.date), tag: occ.key });
          }
        } catch {
          // 通知失败不影响主流程
        }
      }, delay);
      webTimers.push(timer);
      count += 1;
    }
  }
  return count;
}

/** 网页版用到的定时器句柄，重排时统一清掉 */
const webTimers: number[] = [];

export function clearWebTimers(): void {
  for (const id of webTimers) window.clearTimeout(id);
  webTimers.length = 0;
}

/** 单条日程的下一次提醒时刻（列表里显示「明天 09:00 提醒」用） */
export function nextReminderOf(occ: Occurrence): Date | null {
  const times = reminderTimes(occ);
  return times.length ? times[0] : null;
}
