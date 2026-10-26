"""生成 electron-builder / Capacitor 用的应用图标。

用 Windows 自带的微软雅黑渲染「忆」字，比手绘几何形状更像真正的字。
输出：
  build/icon.png        512x512（electron-builder 会自动从这里找）
  build/icon-256.png    256x256
  build/icon.ico        Windows 安装包图标（内含 16/32/48/64/128/256）
  android/.../mipmap-*/ic_launcher.png 等 Android 各密度启动图标
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
BG = (15, 18, 22)        # #0f1216
ACCENT = (255, 180, 84)  # #ffb454
FONT_PATH = r"C:\Windows\Fonts\msyhbd.ttc"

ROOT = Path(__file__).resolve().parent.parent


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


img = draw_icon()

img.resize((512, 512), Image.LANCZOS).save(ROOT / "build/icon.png")
img.resize((256, 256), Image.LANCZOS).save(ROOT / "build/icon-256.png")

# ico 里塞多个尺寸，任务栏/资源管理器/安装包各取所需
sizes = [16, 32, 48, 64, 128, 256]
frames = [img.resize((s, s), Image.LANCZOS) for s in sizes]
frames[-1].save(ROOT / "build/icon.ico", format="ICO", sizes=[(s, s) for s in sizes])

print("wrote build/icon.png (512), build/icon-256.png (256), build/icon.ico")

# ---- Android 启动图标 ----
# 各密度对应的 launcher 尺寸（含 legacy 方形图和 108dp 的前景层）
MIPMAPS = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

android_res = ROOT / "android/app/src/main/res"
if android_res.is_dir():
    for folder, px in MIPMAPS.items():
        target = android_res / f"mipmap-{folder}"
        if not target.is_dir():
            continue
        # 方形图标（Android 7 及以下、以及桌面快捷方式会用它）
        draw_icon(px, full_bleed=True).save(target / "ic_launcher.png")
        # 圆形图标：外面一圈透明、里面是圆的，系统直接当圆形用
        round_icon = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        mask = Image.new("L", (px * 4, px * 4), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, px * 4 - 1, px * 4 - 1], fill=255)
        mask = mask.resize((px, px), Image.LANCZOS)
        round_icon.paste(draw_icon(px, full_bleed=True), (0, 0), mask)
        round_icon.save(target / "ic_launcher_round.png")
        # 前景层：108dp 画布里内容只占中间约 61%，四周留白给系统做各种形状的遮罩
        fg_px = int(px * 108 / 48)
        canvas = Image.new("RGBA", (fg_px, fg_px), (0, 0, 0, 0))
        inner = draw_icon(int(fg_px * 0.62), transparent=True)
        off = (fg_px - inner.width) // 2
        canvas.alpha_composite(inner, (off, off))
        canvas.save(target / "ic_launcher_foreground.png")
    print(f"wrote Android launcher icons to {android_res}")
else:
    print("skip Android icons: android/ not present")

# ---- iOS 图标与启动图 ----
# iOS 的 AppIcon 必须是 1024x1024 不透明 PNG（不能带 alpha，否则上传 App Store 会被拒）
ios_icon = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
if ios_icon.parent.is_dir():
    flat = Image.new("RGB", (SIZE, SIZE), BG)
    flat.paste(img, (0, 0), img)
    flat.resize((1024, 1024), Image.LANCZOS).save(ios_icon)
    print(f"wrote iOS app icon to {ios_icon}")

    splash_dir = ROOT / "ios/App/App/Assets.xcassets/Splash.imageset"
    if splash_dir.is_dir():
        for splash in splash_dir.glob("splash-*.png"):
            canvas = Image.new("RGB", (2732, 2732), BG)
            logo = draw_icon(560)
            canvas.paste(logo, ((2732 - 560) // 2, (2732 - 560) // 2), logo)
            canvas.save(splash)
        print(f"wrote iOS splash screens to {splash_dir}")
else:
    print("skip iOS icons: ios/ not present")

