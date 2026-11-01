import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useI18n } from '../i18n';

/**
 * 页面返回按钮
 * ------------------------------------------------------------------
 * 为什么需要它（v0.9.1）：
 *   手机上没有侧边栏。侧边栏专属的那些页（账户 / 分类 / 搜索 / 周期账单 /
 *   周报 / 回顾 / 待收）在手机上只能从总览点进去，进去之后页面里一个
 *   返回都没有 —— 只能靠底部导航条切到别的 tab，等于「回不去刚才那页」。
 *   更严重的是「记一笔」：那一页为了把键盘让出来，底部导航整条都不渲染，
 *   于是点进去就彻底没有出口，只能杀进程。
 *
 * 为什么放在页头左上、而不是悬浮在右下：
 *   这是「返回」，属于导航，不是操作。iOS / Android 的返回都在左上角，
 *   放在别处要重新学一遍。
 *
 * 为什么用 navigate(-1) 而不是 navigate('/')：
 *   用户可能是从统计页进周报的，返回到总览会莫名其妙。
 *   history 里没有上一页时（直接开链接、PWA 冷启动）才退回总览。
 */
export function BackButton({ fallback = '/' }: { fallback?: string }) {
  const navigate = useNavigate();
  const { t } = useI18n();

  function go() {
    // history.state.idx 是 react-router 记的栈深度，0 表示这是第一页
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }

  return (
    <button className="btn icon-btn back-btn" onClick={go} aria-label={t('common.back')} title={t('common.back')}>
      <ChevronLeft size={18} strokeWidth={2.2} />
    </button>
  );
}
