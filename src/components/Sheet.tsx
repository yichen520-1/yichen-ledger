import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}

/**
 * 底部弹出层。
 *
 * 这里必须用 portal 挂到 document.body 上，不能就地渲染：
 * 主内容区在切页时会跑一段 transform 动画（.page-swap），
 * 而带 transform 的祖先会变成 position: fixed 的包含块，
 * 弹层就会被关进 .main-inner 这一层里 —— 结果 z-index 只在里面比较，
 * 外面 z-index: 30 的底部导航条反而盖在弹层上面，
 * 点弹层时会点到「预算」之类的 tab 上。
 *
 * 另外 Esc 关闭、打开时锁滚动，都是弹层该有的基本行为。
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {title ? <h3>{title}</h3> : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
