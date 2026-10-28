r"""把 .shots/ 里的自检截图拼成 README 用的预览图。

自检脚本 (smoke.mjs / flows.mjs / sched-shots.mjs) 生成的原始截图体积大、
尺寸也不统一，直接塞进仓库既费流量、在 GitHub 上排版也难看。这里把它们拼成一张
`docs/screenshots/preview.png` —— 上方桌面版、下方四张手机版（总览 / 记一笔 /
统计 / 日程），圆角 + 描边，背景透明，深浅色主题下都不违和。

用 harness 自带的 python 跑（系统 python 没有 Pillow）：

    $env:PYTHONPATH="$PWD\scripts"
    & "C:\\Users\\yichen\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe" scripts/make-screenshots.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / ".shots"
OUT = ROOT / "docs" / "screenshots"

# 圆角半径占短边的比例，和界面上卡片的圆角观感接近
RADIUS_RATIO = 0.045
BORDER = (255, 255, 255, 26)  # 半透明白色描边，深色主题下是一道细高光

# 预览图里从左到右的手机截图
PHONES = [
    ("m-01-home.png", "总览"),
    ("m-02b-add-filled.png", "记一笔"),
    ("m-04-stats.png", "统计"),
    ("m-schedule-month.png", "日程"),
    ("assistant-chat.png", "忆小尘"),
]
DESKTOP = ("d-01-home.png", "桌面版")

PANEL_W = 232          # 每张手机图缩放后的宽度
DESKTOP_W = 1220       # 桌面图缩放后的宽度
GAP = 18
PAD = 0                # 画布外边距，0 = 让圆角贴边，README 里更好排


def rounded(img: Image.Image, radius_ratio: float = RADIUS_RATIO) -> Image.Image:
    """给截图切圆角，并压一道 1px 半透明描边。"""
    w, h = img.size
    r = max(2, int(min(w, h) * radius_ratio))

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=r, fill=255)

    out = img.convert("RGBA")
    out.putalpha(mask)

    # 描边：先画一个圆角矩形轮廓，再用原图 alpha 裁一次，避免描边溢出圆角
    border = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(border).rounded_rectangle(
        [0, 0, w - 1, h - 1], radius=r, outline=BORDER, width=2
    )
    out = Image.alpha_composite(out, border)
    out.putalpha(mask)
    return out


def scaled(name: str, width: int) -> Image.Image:
    src = Image.open(SRC / name).convert("RGB")
    w, h = src.size
    height = round(h * width / w)
    return rounded(src.resize((width, height), Image.LANCZOS))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    panels = [scaled(name, PANEL_W) for name, _ in PHONES]
    desk = scaled(DESKTOP[0], DESKTOP_W)

    row_w = len(panels) * PANEL_W + (len(panels) - 1) * GAP
    canvas_w = max(desk.width, row_w) + PAD * 2
    canvas_h = desk.height + GAP + panels[0].height + PAD * 2

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))

    # 桌面图居中放上面
    canvas.alpha_composite(desk, ((canvas_w - desk.width) // 2, PAD))

    # 手机图并排放下方，整体居中
    x = (canvas_w - row_w) // 2
    y = PAD + desk.height + GAP
    for panel in panels:
        canvas.alpha_composite(panel, (x, y))
        x += PANEL_W + GAP

    preview = OUT / "preview.png"
    canvas.save(preview, optimize=True)
    print(f"preview  {canvas.width}x{canvas.height}  {preview.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
