"""生成 electron-builder / Capacitor 用的应用图标。

用 Windows 自带的微软雅黑渲染「忆」字，比手绘几何形状更像真正的字。
输出：
  build/icon.png        512x512（electron-builder 会自动从这里找）
  build/icon-256.png    256x256
  build/icon.ico        Windows 安装包图标（内含 16/32/48/64/128/256）
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (15, 18, 22)        # #0f1216
ACCENT = (255, 180, 84)  # #ffb454
FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底板
d.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.22), fill=BG)

# 琥珀色圆环
d.ellipse(
    [int(SIZE * 0.115), int(SIZE * 0.115), int(SIZE * 0.885), int(SIZE * 0.885)],
    outline=ACCENT,
    width=int(SIZE * 0.042),
)

# 中间的字
font = ImageFont.truetype(FONT_PATH, int(SIZE * 0.40))
text = "忆"
bbox = d.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
pos = ((SIZE - tw) / 2 - bbox[0], (SIZE - th) / 2 - bbox[1] - int(SIZE * 0.008))
d.text(pos, text, font=font, fill=ACCENT)

img.resize((512, 512), Image.LANCZOS).save("build/icon.png")
img.resize((256, 256), Image.LANCZOS).save("build/icon-256.png")

# ico 里塞多个尺寸，任务栏/资源管理器/安装包各取所需
sizes = [16, 32, 48, 64, 128, 256]
frames = [img.resize((s, s), Image.LANCZOS) for s in sizes]
frames[-1].save("build/icon.ico", format="ICO", sizes=[(s, s) for s in sizes])

print("wrote build/icon.png (512), build/icon-256.png (256), build/icon.ico")
