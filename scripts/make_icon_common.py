"""图标绘制的公共部分。

`make-icon.py` 是给 electron-builder / 原生工程用的，一次生成全部尺寸；
`make-pwa-assets.py` 只生成 Web 版要的那几张。两边共用这里的画法，
保证四端图标长得一模一样。
"""

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (15, 18, 22)        # #0f1216
ACCENT = (255, 180, 84)  # #ffb454
FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"


def draw_icon(size: int = SIZE, *, full_bleed: bool = False, transparent: bool = False) -> Image.Image:
    """画一张图标。

    full_bleed=True 时铺满整块画布不切圆角，给 Android 用 ——
    Android 8+ 的 adaptive icon 会自己裁形状，圆角底板会露出黑边。
    transparent=True 时不画底板，只留圆环和字（adaptive icon 的前景层）。
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if transparent:
        pass
    elif full_bleed:
        d.rectangle([0, 0, size - 1, size - 1], fill=BG)
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=BG)

    d.ellipse(
        [int(size * 0.115), int(size * 0.115), int(size * 0.885), int(size * 0.885)],
        outline=ACCENT,
        width=int(size * 0.042),
    )

    font = ImageFont.truetype(FONT_PATH, int(size * 0.40))
    text = "忆"
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pos = ((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1] - int(size * 0.008))
    d.text(pos, text, font=font, fill=ACCENT)
    return img
