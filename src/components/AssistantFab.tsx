import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot } from 'lucide-react';
import { db } from '../db';
import { useI18n } from '../i18n';

/**
 * 忆小尘的入口按钮
 * ------------------------------------------------------------------
 * 这颗按钮可以拖着走：按住拖到任意位置，松手吸附到最近的那一侧边缘。
 *
 * 为什么吸附、不做完全自由：
 *   停在屏幕正中间会一直压着账目和图表。贴边之后它只占一条边，
 *   内容区永远是完整的 —— 这是 iOS 悬浮球、微信悬浮窗共同的选择。
 *
 * 位置存哪里：
 *   和外观设置一样进 IndexedDB（settings 表）。清库时一起清掉，
 *   不会出现「账没了但按钮还飘在奇怪的地方」。
 *   纵坐标存的是**比例**而不是像素：换个屏幕尺寸、转个屏，
 *   按钮还在相对高度差不多的位置，不会跑到屏幕外。
 */

const KEY = 'ui.fab.pos';

export type FabSide = 'left' | 'right';

export interface FabPos {
  side: FabSide;
  /** 0~1，按钮中心距屏幕顶部的比例 */
  y: number;
}

/** 出厂位置：右下角，略高于底部导航 */
export const DEFAULT_FAB: FabPos = { side: 'right', y: 0.88 };

const DRAG_THRESHOLD = 6; // px，超过这个距离才算「拖」，否则算「点」

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** 按钮允许的纵向范围（px，按钮中心的 top 值） */
function verticalBounds() {
  const h = window.innerHeight;
  const wide = window.matchMedia('(min-width: 900px)').matches;
  // 手机上底部有导航条（约 64px）和刘海屏的安全区，留得比桌面多
  const bottomReserve = wide ? 84 : 132;
  return { min: 64, max: h - bottomReserve };
}

function toPxY(ratio: number) {
  const { min, max } = verticalBounds();
  return clamp(ratio * window.innerHeight, min, max);
}

function toRatio(pxY: number) {
  const { min, max } = verticalBounds();
  const safe = clamp(pxY, min, max);
  return safe / window.innerHeight;
}

export function useFabPosition() {
  const [pos, setPos] = useState<FabPos>(DEFAULT_FAB);

  useEffect(() => {
    let alive = true;
    db.settings
      .get(KEY)
      .then((row) => {
        if (!alive || !row) return;
        const v = row.value as Partial<FabPos> | undefined;
        if (!v) return;
        setPos({
          side: v.side === 'left' ? 'left' : 'right',
          y: typeof v.y === 'number' ? clamp(v.y, 0, 1) : DEFAULT_FAB.y,
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback((next: FabPos) => {
    setPos(next);
    void db.settings.put({ key: KEY, value: next });
  }, []);

  return { pos, save };
}

/**
 * 拖拽手势。
 *
 * 用 Pointer Events 而不是 mouse/touch 两套：一套代码同时覆盖鼠标、手指和笔，
 * 而且 setPointerCapture 之后即使手指滑出按钮，move 事件也还发到这个元素上 ——
 * 不然拖快了指针一离开按钮，拖动就断了。
 */
export function useDrag(onDrop: (side: FabSide, ratioY: number) => void) {
  const [dragging, setDragging] = useState(false);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const start = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const moved = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      start.current = { x: e.clientX, y: e.clientY, px: r.left + r.width / 2, py: r.top + r.height / 2 };
      moved.current = false;
      el.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!moved.current) {
      moved.current = true;
      setDragging(true);
    }
    const { min, max } = verticalBounds();
    setGhost({
      x: clamp(start.current.px + dx, 28, window.innerWidth - 28),
      y: clamp(start.current.py + dy, min, max),
    });
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const el = e.currentTarget;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!moved.current) {
        setGhost(null);
        setDragging(false);
        return;
      }
      const { min, max } = verticalBounds();
      const y = clamp((ghost?.y ?? start.current.py), min, max);
      const side: FabSide = (ghost?.x ?? start.current.px) < window.innerWidth / 2 ? 'left' : 'right';
      setGhost(null);
      setDragging(false);
      onDrop(side, toRatio(y));
    },
    [ghost, onDrop],
  );

  /** 真正的点击：只有没拖动过才算 */
  const onClick = useCallback((e: React.MouseEvent, open: () => void) => {
    if (moved.current) {
      e.preventDefault();
      e.stopPropagation();
      moved.current = false;
      return;
    }
    open();
  }, []);

  return { dragging, ghost, onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onClick };
}

export function AssistantFab({
  pos,
  onOpen,
  onDrop,
}: {
  pos: FabPos;
  onOpen: () => void;
  onDrop: (side: FabSide, y: number) => void;
}) {
  const { t } = useI18n();
  const drag = useDrag(onDrop);

  const y = drag.ghost ? drag.ghost.y : toPxY(pos.y);
  const side = drag.ghost ? null : pos.side;

  // 拖动时跟着指针走（left 直接给坐标），松手后回到按边贴的写法
  const style: React.CSSProperties = drag.ghost
    ? { left: drag.ghost.x - 26, top: drag.ghost.y - 26, right: 'auto', bottom: 'auto' }
    : side === 'left'
      ? { left: 18, top: y - 26, right: 'auto', bottom: 'auto' }
      : { right: 18, top: y - 26, left: 'auto', bottom: 'auto' };

  return (
    <button
      className={`assistant-fab${drag.dragging ? ' dragging' : ''}`}
      style={style}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.onPointerUp}
      onPointerCancel={drag.onPointerCancel}
      onClick={(e) => drag.onClick(e, onOpen)}
      aria-label={t('assistant.open')}
      title={t('assistant.open')}
    >
      <Bot size={20} />
    </button>
  );
}
