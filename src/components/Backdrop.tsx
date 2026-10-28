import {
  backdropStyle,
  hasCustomBackdrop,
  useAppearance,
  type RegionKey,
} from '../state/AppearanceContext';

/**
 * 环境底
 * ------------------------------------------------------------------
 * 玻璃要有东西可透，否则「毛玻璃」透出来的还是同一块黑，看起来就是灰板。
 * 这层水墨渐变铺在最底下（position: fixed，不参与滚动），
 * 玻璃面板盖上去才有颜色可折射。
 *
 * 用户给任意一个区域设了自定义壁纸时把它收起来：壁纸本身已经提供了色彩，
 * 再垫一层渐变会在半透明的壁纸边缘混出脏色。
 */
export function Ambient() {
  const { appearance } = useAppearance();
  const hidden = hasCustomBackdrop(appearance);
  return <div className={`ambient${hidden ? ' is-hidden' : ''}`} aria-hidden="true" />;
}

/**
 * 区域背景层
 * ------------------------------------------------------------------
 * 为什么单独做一个组件：CSS 的 filter 会连子元素一起过滤，
 * 所以背景图必须画在独立的一层绝对定位元素上，内容层叠在它上面（z-index）。
 * 父元素只需要 position: relative 与 overflow: hidden（见 styles.css 的 .has-backdrop）。
 */
export function Backdrop({ region }: { region: RegionKey }) {
  const { appearance } = useAppearance();
  const style = appearance.regions[region];
  const { layer, dim } = backdropStyle(style);

  if (!style.image) {
    // 没设壁纸：只保留暗化层，纯色底也能被压暗一点
    return style.dim > 0 ? (
      <div className="backdrop" aria-hidden="true">
        <div className="backdrop-dim" style={dim} />
      </div>
    ) : null;
  }

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-layer" style={layer} />
      {style.dim > 0 ? <div className="backdrop-dim" style={dim} /> : null}
    </div>
  );
}
