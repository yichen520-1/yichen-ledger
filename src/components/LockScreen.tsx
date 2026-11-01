import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import {
  DEFAULT_LOCK,
  LOCK_SETTING_KEY,
  PIN_LENGTH,
  hashPin,
  isValidPin,
  normalizeLock,
  verifyPin,
  waitLeft,
  EMPTY_ATTEMPT,
  recordFailure,
  type LockAttemptState,
  type LockConfig,
} from '../domain/lock';

const SETTING_RAW = LOCK_SETTING_KEY; // 'lock.config'
const UNLOCKED_AT = 'lock.unlockedAt';

/**
 * 应用锁
 * ------------------------------------------------------------------
 * 这不是加密，是一道门帘。
 *
 * 为什么不用 SHA-256 这类正经哈希：
 *   crypto.subtle 只在 HTTPS（或 localhost）下可用。局域网调试、Electron 的
 *   file:// 页面都拿不到它，而那正是桌面版最常见的两种运行方式。
 *   而且 6 位数字只有一百万种，任何哈希都挡不住穷举 —— 目标不是密码学强度，
 *   是「别人拿起你的手机，不能一眼就看到账本」。这一点在设置页里写清楚了，
 *   不能让用户以为它是加密。
 *
 * 为什么忘了密码只能清数据：
 *   没有服务器，也就没有「找回密码」这条路。所以设置页会先劝你导出备份。
 */

function readStored(): LockConfig {
  try {
    const raw = localStorage.getItem(SETTING_RAW);
    if (!raw) return DEFAULT_LOCK;
    return normalizeLock(JSON.parse(raw));
  } catch {
    return DEFAULT_LOCK;
  }
}

export function useLockConfig(): {
  config: LockConfig;
  save: (next: LockConfig) => void;
  locked: boolean;
  unlock: () => void;
  relock: () => void;
} {
  const [config, setConfig] = useState<LockConfig>(() => readStored());
  const [locked, setLocked] = useState<boolean>(() => {
    const c = readStored();
    if (!c.enabled) return false;
    // 宽限期内不重新上锁：用户切出去看一眼消息再回来，不该被拦一次
    try {
      const at = Number(localStorage.getItem(UNLOCKED_AT) || 0);
      if (at && Date.now() - at < c.graceMinutes * 60_000) return false;
    } catch {
      /* 读不到就当作需要解锁 */
    }
    return true;
  });

  const save = useCallback((next: LockConfig) => {
    setConfig(next);
    try {
      localStorage.setItem(SETTING_RAW, JSON.stringify(next));
    } catch {
      /* 存不进去也不影响当前会话 */
    }
    if (!next.enabled) setLocked(false);
  }, []);

  const unlock = useCallback(() => {
    setLocked(false);
    try {
      localStorage.setItem(UNLOCKED_AT, String(Date.now()));
    } catch {
      /* ignore */
    }
  }, []);

  const relock = useCallback(() => {
    if (config.enabled) setLocked(true);
  }, [config.enabled]);

  // 切回页面时检查宽限期
  useEffect(() => {
    if (!config.enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const at = Number(localStorage.getItem(UNLOCKED_AT) || 0);
        if (!at || Date.now() - at >= config.graceMinutes * 60_000) setLocked(true);
      } catch {
        setLocked(true);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [config.enabled, config.graceMinutes]);

  return { config, save, locked, unlock, relock };
}

/**
 * 解锁界面。
 *
 * 键盘是自绘的而不是 <input type="password">：
 *   数字键盘在手机上比系统键盘大得多，也不会有输入法弹出来挡住界面；
 *   桌面上则可以用物理键盘（下面绑了 keydown）。
 */
export function LockScreen({ config, onUnlock }: { config: LockConfig; onUnlock: () => void }) {
  const { t } = useI18n();
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [attempt, setAttempt] = useState<LockAttemptState>(EMPTY_ATTEMPT);
  const [shake, setShake] = useState(false);
  const [tick, setTick] = useState(0);

  // 等待倒计时：每秒重算一次剩下的秒数
  useEffect(() => {
    if (attempt.lockedUntil <= Date.now()) return;
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [attempt.lockedUntil]);

  const left = useMemo(() => {
    void tick;
    return waitLeft(attempt, Date.now());
  }, [attempt, tick]);

  const trySubmit = useCallback(
    (value: string) => {
      if (left > 0) return;
      if (verifyPin(value, config.hash)) {
        onUnlock();
        return;
      }
      const next = recordFailure(attempt, Date.now());
      setAttempt(next);
      setPin('');
      setErr(
        next.lockedUntil > Date.now()
          ? t('lock.waitLeft', { seconds: String(Math.ceil((next.lockedUntil - Date.now()) / 1000)) })
          : t('lock.pinWrong'),
      );
      setShake(true);
      setTimeout(() => setShake(false), 360);
    },
    [attempt, config.hash, left, onUnlock, t],
  );

  const press = useCallback(
    (key: string) => {
      if (left > 0) return;
      if (key === 'DEL') {
        setPin((v) => v.slice(0, -1));
        setErr('');
        return;
      }
      if (key === 'OK') {
        if (pin.length === PIN_LENGTH) trySubmit(pin);
        return;
      }
      setErr('');
      setPin((v) => {
        const next = (v + key).slice(0, PIN_LENGTH);
        // 输满自动提交 —— 少按一次「确定」，而且不会忘
        if (next.length === PIN_LENGTH) setTimeout(() => trySubmit(next), 60);
        return next;
      });
    },
    [left, pin.length, trySubmit],
  );

  // 桌面端支持物理键盘
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('DEL');
      else if (e.key === 'Enter') press('OK');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="lock-screen" role="dialog" aria-modal="true" aria-label={t('lock.title')}>
      <div className="lock-panel">
        <div className="lock-mark" aria-hidden="true">
          🔒
        </div>
        <div className="lock-title">{t('lock.title')}</div>
        <div className="lock-sub">{t('lock.enableHint')}</div>

        <div className={`lock-dots${shake ? ' shake' : ''}`}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <span key={i} className={`lock-dot${i < pin.length ? ' on' : ''}`} />
          ))}
        </div>

        <div className="lock-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} className="lock-key" onClick={() => press(k)}>
              {k}
            </button>
          ))}
          <button className="lock-key fn" onClick={() => press('DEL')}>
            ⌫
          </button>
          <button className="lock-key" onClick={() => press('0')}>
            0
          </button>
          <button className="lock-key fn" onClick={() => press('OK')}>
            {t('lock.unlock')}
          </button>
        </div>

        <div className="lock-err">{err}</div>
        <button className="lock-forgot" onClick={() => alert(t('lock.forgotHint'))}>
          {t('lock.forgot')}
        </button>
      </div>
    </div>
  );
}

/** 设置页用：设置/修改密码的小表单 */
export function PinForm({
  onDone,
  onCancel,
}: {
  onDone: (hash: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');

  const submit = () => {
    if (!isValidPin(a)) {
      setErr(t('lock.pinLength'));
      return;
    }
    if (a !== b) {
      setErr(t('lock.pinMismatch'));
      return;
    }
    onDone(hashPin(a));
  };

  return (
    <>
      <div className="field">
        <label>{t('lock.pin')}</label>
        <input
          className="input mono"
          inputMode="numeric"
          maxLength={PIN_LENGTH}
          value={a}
          onChange={(e) => {
            setErr('');
            setA(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
          }}
          placeholder="••••••"
        />
      </div>
      <div className="field">
        <label>{t('lock.pinAgain')}</label>
        <input
          className="input mono"
          inputMode="numeric"
          maxLength={PIN_LENGTH}
          value={b}
          onChange={(e) => {
            setErr('');
            setB(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH));
          }}
          placeholder="••••••"
        />
      </div>
      {err ? <div className="alert">{err}</div> : null}
      <div className="sheet-actions">
        <button className="btn grow" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button className="btn primary grow" onClick={submit}>
          {t('common.save')}
        </button>
      </div>
    </>
  );
}
