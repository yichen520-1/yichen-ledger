"""生成 Web 版（PWA）用的图标与启动图。

Web 版是 iOS / Android 上最省事的用法：打开网址 →「添加到主屏幕」，
之后就是一个全屏运行的 App，和装原生包体验几乎一致，还不用等签名审核。

输出到 public/：
  pwa-192.png / pwa-512.png         Android / Chrome 安装用的图标
  pwa-512-maskable.png              自适应图标（四周留安全带，系统自己裁形状）
  apple-touch-icon.png              180x180，iOS 添加到主屏幕用的图标
"""

from pathlib import Path

from PIL import Image

from make_icon_common import BG, draw_icon

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PUBLIC.mkdir(exist_ok=True)

SIZE = 1024
img = draw_icon(SIZE)

# 普通图标：保留圆角（PWA manifest 里 purpose 为 any）
img.resize((192, 192), Image.LANCZOS).save(PUBLIC / "pwa-192.png")
img.resize((512, 512), Image.LANCZOS).save(PUBLIC / "pwa-512.png")

# maskable：内容缩到中间 78%，四周填满底色，这样无论系统裁成圆形还是方形都不会切到字
maskable = Image.new("RGBA", (SIZE, SIZE), BG + (255,))
inner = int(SIZE * 0.78)
maskable.paste(img.resize((inner, inner), Image.LANCZOS), ((SIZE - inner) // 2, (SIZE - inner) // 2), img.resize((inner, inner), Image.LANCZOS))
maskable.resize((512, 512), Image.LANCZOS).save(PUBLIC / "pwa-512-maskable.png")

# iOS 的 apple-touch-icon 会被系统自动加圆角，所以必须是满幅方形不透明图
flat = Image.new("RGB", (SIZE, SIZE), BG)
flat.paste(img, (0, 0), img)
flat.resize((180, 180), Image.LANCZOS).save(PUBLIC / "apple-touch-icon.png")

print("wrote public/pwa-192.png, pwa-512.png, pwa-512-maskable.png, apple-touch-icon.png")
