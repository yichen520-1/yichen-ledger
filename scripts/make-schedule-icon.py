"""把「忆笺日程」的图标出成四端要的全套尺寸。

和 make-icon.py 的分工：
  make-icon.py           出「忆笺记账」的主图标（Windows/macOS/iOS/Android 的 App 图标）
  make-pwa-assets.py     出网页版的主图标（favicon / PWA）
  make_icon_schedule.py  只负责画（纯函数）
  make-schedule-icon.py  ← 本文件，负责落盘

日程是站内的第二个 App，不是独立的安装包 —— 所以它只需要
**网页/PWA 那一套尺寸**，加一份给侧边栏用的小图。
桌面安装包和手机 App 的图标仍然是「忆笺记账」那枚，因为装到系统里的
只有记账这一个 App，日程是它里面的一页。
"""

from pathlib import Path

from PIL import Image

from make_icon_schedule import draw_schedule_icon

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DOCS = ROOT / "docs" / "screenshots"


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)

    # 网页图标：192 / 512 两个尺寸，和 manifest 里的 sizes 对齐
    for px in (192, 512):
        draw_schedule_icon(px).save(PUBLIC / f"schedule-{px}.png")
        print(f"wrote public/schedule-{px}.png")

    # iOS 的 apple-touch-icon：180x180，不能带透明（iOS 会给它加黑底）
    flat = Image.new("RGB", (180, 180), (246, 241, 231))
    icon = draw_schedule_icon(180)
    flat.paste(icon, (0, 0), icon)
    flat.save(PUBLIC / "schedule-touch-icon.png")
    print("wrote public/schedule-touch-icon.png")

    # 侧边栏里那枚小图标：44 逻辑像素，2 倍屏给 88
    draw_schedule_icon(88).save(PUBLIC / "schedule-badge.png")
    print("wrote public/schedule-badge.png")

    # 文档用：和主图标的 docs/screenshots/icon.png 并排看
    DOCS.mkdir(parents=True, exist_ok=True)
    draw_schedule_icon(512).save(DOCS / "icon-schedule.png")
    print("wrote docs/screenshots/icon-schedule.png")


if __name__ == "__main__":
    main()
