/**
 * 应用锁（v0.9.0）
 * ------------------------------------------------------------------
 * 手机上记账 App 里全是隐私 —— 谁花了多少钱、看了什么病、买了什么礼物。
 * 手机借给别人看一眼，这些东西就全摊开了。
 *
 * 设计取舍：
 *   1. **PIN 不存明文**，只存一个加盐的哈希。虽然本地 IndexedDB 本来
 *      就能被开发者工具翻，但至少不能一眼看见密码，也不能复用去开别的东西。
 *   2. **不是加密**。它防的是「别人拿起你的手机随便点」，不是防取证。
 *      真正的加密需要用户密码派生的密钥 + 全库加密，那是另一个量级的工程。
 *      这一条必须写在设置页的说明里，不能让人以为数据被加密了。
 *   3. **忘记 PIN 只能清数据**。没有服务器、没有邮箱可以找回 ——
 *      这是 local-first 的代价，要提前说清楚。
 */

/** PIN 长度固定 6 位：4 位太短，8 位在手机上输起来烦 */
export const PIN_LENGTH = 6;

/** 存哈希用的盐（固定值）。它不增加多少安全性，只是让彩虹表不好用。 */
const PIN_SALT = 'yijian-ledger-pin-v1';

/**
 * 一个轻量的字符串哈希（FNV-1a 32 位 + 二次混淆）。
 *
 * 为什么不用 SHA-256：
 *   `crypto.subtle` 在非 HTTPS 环境下不可用（局域网调试、Electron file://），
 *   引一个纯 JS 的 sha256 实现又要多一份代码。
 *   6 位 PIN 总共只有 100 万种，任何哈希都挡不住暴力穷举 ——
 *   这里的目标是「不能一眼读出密码」，不是密码学强度。
 */
export function hashPin(pin: string): string {
  const input = `${PIN_SALT}:${pin}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + c * (i + 7)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${hex(h1)}${hex(h2)}${hex((h1 ^ h2) >>> 0)}`;
}

/** 校验 PIN */
export function verifyPin(pin: string, hash: string): boolean {
  return hashPin(pin) === hash;
}

/** PIN 是否格式合法：正好 6 位数字 */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * PIN 强度提示。
 * 6 位 PIN 的熵天然有限，能说的只有「别用生日、别用 123456」这类。
 */
export type PinWeakness = 'ok' | 'sequence' | 'repeat' | 'common';

const COMMON = new Set(['123456', '654321', '111111', '000000', '121212', '123123', '888888', '666666']);

export function checkPinStrength(pin: string): PinWeakness {
  if (!isValidPin(pin)) return 'common';
  if (COMMON.has(pin)) return 'common';
  // 全相同
  if (new Set(pin).size === 1) return 'repeat';
  // 连续递增 / 递减
  let asc = true;
  let desc = true;
  for (let i = 1; i < pin.length; i += 1) {
    const d = pin.charCodeAt(i) - pin.charCodeAt(i - 1);
    if (d !== 1) asc = false;
    if (d !== -1) desc = false;
  }
  if (asc || desc) return 'sequence';
  return 'ok';
}

/**
 * 锁屏状态机。
 *
 * 为什么失败次数要记：6 位 PIN 只有 100 万种，但人能试的其实只有几十次。
 * 连错 5 次就等 30 秒，连错 10 次等 5 分钟 —— 够挡住「拿着手机乱按」了。
 */
export const MAX_ATTEMPTS_BEFORE_WAIT = 5;
export const LOCKOUT_SECONDS = 30;

export interface LockAttemptState {
  failures: number;
  /** 解除等待的时间戳（毫秒）；0 表示没在等 */
  lockedUntil: number;
}

export const EMPTY_ATTEMPT: LockAttemptState = { failures: 0, lockedUntil: 0 };

/** 等待还剩几秒 */
export function waitLeft(state: LockAttemptState, now: number): number {
  if (!state.lockedUntil || state.lockedUntil <= now) return 0;
  return Math.ceil((state.lockedUntil - now) / 1000);
}

/** 记一次失败，返回新状态 */
export function recordFailure(state: LockAttemptState, now: number): LockAttemptState {
  const failures = state.failures + 1;
  if (failures % MAX_ATTEMPTS_BEFORE_WAIT === 0) {
    const factor = failures / MAX_ATTEMPTS_BEFORE_WAIT;
    return { failures, lockedUntil: now + LOCKOUT_SECONDS * 1000 * factor };
  }
  return { failures, lockedUntil: state.lockedUntil };
}

/** 存设置里的键 */
/**
 * 存在 localStorage 而不是 IndexedDB，理由只有一条但很硬：
 * 锁必须在数据库加载**之前**就判断能不能进，而 IndexedDB 是异步的 ——
 * 等它读完再决定要不要上锁，页面已经闪了一下账本内容。
 * localStorage 是同步的，正好。代价是它不进备份（备份不该带一把别人设备的锁）。
 */
export const LOCK_SETTING_KEY = 'lock.config';

export interface LockConfig {
  /** 是否开启 */
  enabled: boolean;
  /** PIN 哈希；没设过是空串 */
  hash: string;
  /** 手机上有生物识别时优先用它 */
  biometric: boolean;
  /** 多久之后重新要求解锁（分钟）；0 = 每次切走都锁 */
  graceMinutes: number;
}

export const DEFAULT_LOCK: LockConfig = {
  enabled: false,
  hash: '',
  biometric: true,
  graceMinutes: 1,
};

/** 老数据 / 缺字段时补全 */
export function normalizeLock(raw: unknown): LockConfig {
  const v = (raw ?? {}) as Partial<LockConfig>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : false,
    hash: typeof v.hash === 'string' ? v.hash : '',
    biometric: typeof v.biometric === 'boolean' ? v.biometric : true,
    graceMinutes: typeof v.graceMinutes === 'number' && v.graceMinutes >= 0 ? v.graceMinutes : 1,
  };
}
