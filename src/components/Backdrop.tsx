import { backdropStyle, useAppearance, type RegionKey } from '../state/AppearanceContext';

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
