"""水墨风图标的公共画法。

四端图标与网页图标共用这一份，保证长得一模一样：
Windows 的 .ico / macOS 的 .icns 源图 / Android 的 mipmap / iOS 的 AppIcon
/ PWA 的 pwa-*.png，全部从 draw_icon() 出来。

画法要点（改之前先读这里的说明，几处参数都是踩过坑才定下来的）：

  1. 骨架：真毛笔字体（志莽行书），笔画本身有提按 —— 印刷体怎么叠纹理都不像。
  2. 墨色：一处浓一处淡，不是均匀的纯黑。
  3. 边缘：既有渗出的淡晕，也有枯笔扫过留下的飞白。
  4. 构图：米白宣纸 + 三层远山（越近越浓）+ 山腰云气 + 右上角飞雁，
     焦墨行书「忆」压在中间，右下角盖一枚朱红「记」印。

字体放在 assets/fonts/（OFL 授权，见那里的 README）。
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"

BRUSH = FONTS / "MaShanZheng-Regular.ttf"
BRUSH_XING = FONTS / "ZhiMangXing-Regular.ttf"
# 印章上的字要用「刻」的，不能用毛笔的提按。本机没有篆书字体（篆书是传统印章的正体），
# 退而求其次用宋体：横细竖粗、横画起笔带顿角，加粗之后最接近凿刻的痕迹。
CARVED = Path(r"C:\Windows\Fonts\simsun.ttc")

SIZE = 1024
INK = (16, 15, 14)
PAPER = (246, 241, 231)
PAPER_WARM = (243, 236, 222)
VERMILION = (196, 44, 34)
DEEP = (13, 17, 21)
BG = PAPER          # 兼容旧名字：出包脚本里用它当底板色

def _noise(size: int, scale: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    h = max(2, int(size * scale))
    small = rng.random((h, h)).astype(np.float32)
    up = Image.fromarray((small * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
    return np.asarray(up, dtype=np.float32) / 255.0


def _fbm(size: int, seed: int, octaves=(0.012, 0.03, 0.08, 0.2)) -> np.ndarray:
    """几个尺度的噪声叠起来，像纸张/宣纸的不均匀吸水。"""
    total = np.zeros((size, size), dtype=np.float32)
    weight = 1.0
    norm = 0.0
    for i, s in enumerate(octaves):
        total += _noise(size, s, seed + i) * weight
        norm += weight
        weight *= 0.55
    return total / norm


# ---------------------------------------------------------------- 纸


def _paper(size: int, base: tuple[int, int, int], seed: int = 7, grain: float = 13.0) -> Image.Image:
    n1 = _fbm(size, seed)
    n2 = _noise(size, 0.5, seed + 90)
    tex = (n1 - 0.5) * grain + (n2 - 0.5) * 4.0

    # 几缕极淡的纤维纹
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    fibers = np.sin(yy * 0.09 + n1 * 26.0) * 0.9 + np.sin(xx * 0.11 - n1 * 21.0) * 0.7

    arr = np.zeros((size, size, 3), dtype=np.float32)
    for i in range(3):
        arr[:, :, i] = base[i] + tex + fibers
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def _vignette(img: Image.Image, strength: float = 0.18) -> Image.Image:
    size = img.size[0]
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    r = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2) / (size * 0.72)
    k = np.clip(1.0 - strength * np.clip(r, 0, 1.6) ** 2, 0, 1)
    return Image.fromarray(np.clip(np.asarray(img, np.float32) * k[:, :, None], 0, 255).astype(np.uint8), "RGB")


# ---------------------------------------------------------------- 字


def _glyph_mask(
    size: int,
    char: str,
    ratio: float,
    dx: float = 0.0,
    dy: float = 0.0,
    font_path: Path | None = None,
) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    font = ImageFont.truetype(str(font_path or BRUSH), int(size * ratio))
    box = d.textbbox((0, 0), char, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(
        ((size - tw) / 2 - box[0] + size * dx, (size - th) / 2 - box[1] + size * dy),
        char,
        font=font,
        fill=255,
    )
    return mask


def _streaks(size: int, seed: int) -> np.ndarray:
    """方向性噪声：拉长的条纹，模拟笔肚扫过纸面留下的枯笔走向。

    条纹必须「断断续续」：如果一路拉到底，会像木纹/划痕，不像墨。
    所以先用条状噪声和一块中频噪声相乘，把长条的连续性打断。
    """
    rng = np.random.default_rng(seed)
    h = max(2, size // 30)
    w = max(2, size // 26)
    small = rng.random((h, w)).astype(np.float32)
    up = Image.fromarray((small * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC)
    streak = np.asarray(up, dtype=np.float32) / 255.0

    # 打断：和一块中频噪声相乘，长条被切成一小段一小段
    breaker = _fbm(size, seed + 5, octaves=(0.05, 0.14, 0.32))
    breaker = (breaker - breaker.min()) / max(float(np.ptp(breaker)), 1e-6)
    streak = streak * (0.35 + breaker * 0.85)
    return np.clip(streak, 0, 1)


def _ink_alpha(mask: Image.Image, *, seed: int, wet: float = 0.55, dry: float = 0.30) -> Image.Image:
    """把笔画实心遮罩变成「有浓淡、有飞白、有渗晕」的墨迹 alpha。

    尺度是这里唯一的重点：
      · 边缘带要够宽（几十像素），窄了只会显得「描了条细边」；
      · 飞白只吃边缘，笔肚要实 —— 吃进笔肚就成了划痕；
      · 浓淡用很低频的场，高频的只会显脏。
    """
    size = mask.size[0]
    base = np.asarray(mask, dtype=np.float32) / 255.0

    # 边缘带：内缩 ~18px。这是「笔锋能吃掉多少」的物理宽度。
    inner = np.asarray(mask.filter(ImageFilter.MinFilter(37)), dtype=np.float32) / 255.0
    inner = np.asarray(
        Image.fromarray((np.clip(inner, 0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(size * 0.006)
        ),
        dtype=np.float32,
    ) / 255.0
    rim = np.clip(base - inner, 0, 1)

    # 1) 飞白：只在边缘带里按方向性噪声挖，越往里越不吃
    #    幅度压得很低：这笔字本身已经是毛笔字，飞白只是「收笔略毛」，
    #    挖多了就成了拓片/石头，不是墨。
    streak = _streaks(size, seed + 3)
    dry_map = np.clip((streak - (1.0 - dry)) / max(dry, 1e-3), 0, 1)
    eat = rim * dry_map * 0.40
    base = base - eat

    # 2) 墨色浓淡：极低频「含水量」，1.0 ↔ 0.74
    wet_field = _fbm(size, seed + 31, octaves=(0.006, 0.014, 0.032))
    wet_field = (wet_field - wet_field.min()) / max(float(np.ptp(wet_field)), 1e-6)
    density = 1.0 - wet * 0.26 * (1.0 - wet_field)

    # 3) 纸张颗粒（很轻，只为防止死平）
    fine = _noise(size, 0.6, seed + 77)
    density *= 1.0 - 0.035 * (fine - 0.5)

    alpha = np.clip(base, 0, 1) * np.clip(density, 0, 1)

    # 3.5) 字心保底：笔画内部（内缩 12px 以上）不许被飞白/颗粒打穿。
    #      没有这一步，噪声会在字面上留下孤立的小黑点，看着像脏东西而不是墨。
    core = np.asarray(mask.filter(ImageFilter.MinFilter(25)), dtype=np.float32) / 255.0
    core = np.asarray(
        Image.fromarray((core * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(size * 0.008)),
        dtype=np.float32,
    ) / 255.0
    alpha = np.maximum(alpha, core * 0.93)

    # 4) 渗晕：向外扩一圈很淡的墨（宣纸吸墨往纤维里走）
    out = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8))
    bleed = out.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(size * 0.010))
    bleed_a = np.asarray(bleed, dtype=np.float32) * 0.20
    merged = np.maximum(np.clip(alpha, 0, 1) * 255, bleed_a)

    # 5) 毛边：让边缘的 alpha 抖一下（不是整体模糊）
    #    幅度别太大：抖动太狠会在字面上留下孤立的小黑点，看着像脏东西。
    jitter = (_noise(size, 0.22, seed + 131) - 0.5) * 16.0
    merged = np.clip(merged + jitter * np.clip(rim + bleed_a / 255.0, 0, 1), 0, 255)

    soft = Image.fromarray(merged.astype(np.uint8)).filter(ImageFilter.GaussianBlur(size * 0.0022))
    return soft


def _ink_layer(
    size: int,
    char: str,
    *,
    ratio: float,
    color,
    dx=0.0,
    dy=0.0,
    seed=3,
    wet=0.55,
    dry=0.30,
    font_path: Path | None = None,
) -> Image.Image:
    mask = _glyph_mask(size, char, ratio, dx, dy, font_path)
    alpha = _ink_alpha(mask, seed=seed, wet=wet, dry=dry)
    solid = Image.new("RGBA", (size, size), tuple(color) + (255,))
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    layer.paste(solid, (0, 0), alpha)
    return layer


# ---------------------------------------------------------------- 印

def _seal(
    size: int,
    char: str = "记",
    *,
    style: str = "baiwen",
    angle: float = -3.2,
    scale: float = 0.20,
    seed: int = 71,
) -> Image.Image:
    """一枚「盖」出来的印章。

    真印和矢量图形的区别全在这四件事上，缺一件就假：

      1. **边不是直线** —— 石头是刀刻的，边口有崩、粗细也不匀；
      2. **印泥不是纯色** —— 有浓有淡，但底子必须够浓（0.5 的底会变成水彩）；
      3. **字是刻出来的** —— 宋体横细竖粗、起笔有顿，缩小后反而最认得出；
      4. **白文的字是纸色，不是透明** —— 挖空会让字跟着底图走。

    实现顺序：先在 3 倍画布上把「框 + 字」画成干净的二值形状，
    缩回来得到干净的抗锯齿边，**再用噪声去破坏它** ——
    这个顺序反过来（先画粗糙形状再缩放）只会得到一团模糊。
    """
    s = int(size * scale)
    if s < 8:
        # 太小的尺寸（16px 图标里的印章只有几像素）画细节没意义，给个红方块
        return Image.new("RGBA", (s, s), VERMILION + (235,))

    ss = 3
    w = s * ss

    m = int(w * 0.070)                        # 印面到纸边的留白
    box = [m, m, w - 1 - m, w - 1 - m]
    r = int(w * 0.030)                        # 圆角很小 —— 印章基本是方的
    frame_w = max(2, int(w * 0.030))          # 朱文的框：细而残破才像石头，粗而匀就成了矢量图

    # 印面（白文是实心的一块，朱文只有框）
    face = Image.new("L", (w, w), 0)
    fd = ImageDraw.Draw(face)
    if style == "baiwen":
        fd.rounded_rectangle(box, radius=r, fill=255)
    else:
        # 四条边分别画、各自有粗细差 —— 石头不会磨得四边一样齐
        jit = np.random.default_rng(seed + 3).uniform(-0.22, 0.22, 4)
        top = max(2, int(frame_w * (1 + jit[0])))
        bot = max(2, int(frame_w * (1 + jit[1])))
        lft = max(2, int(frame_w * (1 + jit[2])))
        rgt = max(2, int(frame_w * (1 + jit[3])))
        fd.rectangle([box[0], box[1], box[2], box[1] + top], fill=255)
        fd.rectangle([box[0], box[3] - bot, box[2], box[3]], fill=255)
        fd.rectangle([box[0], box[1], box[0] + lft, box[3]], fill=255)
        fd.rectangle([box[2] - rgt, box[1], box[2], box[3]], fill=255)

    # 字：刀刻的。宋体横细竖粗，横画起笔带顿角，正是凿刻留下的样子；
    # 黑体横竖等粗，在小尺寸下「横」会糊成一片，而且太像印刷品。
    glyph_ratio = 0.50 if style == "baiwen" else 0.58
    font = ImageFont.truetype(str(CARVED), int(w * glyph_ratio))
    bbox = fd.textbbox((0, 0), char, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    glyph = Image.new("L", (w, w), 0)
    ImageDraw.Draw(glyph).text(
        ((w - tw) / 2 - bbox[0], (w - th) / 2 - bbox[1]), char, font=font, fill=255
    )
    glyph = glyph.filter(ImageFilter.MaxFilter(max(3, int(w * 0.016) | 1)))

    # 刀刻的边：只在笔画边缘的过渡带上崩一点，笔画的芯必须保持实心
    ga = np.asarray(glyph, dtype=np.float32) / 255.0
    gblur = np.asarray(
        glyph.filter(ImageFilter.GaussianBlur(max(1.0, w * 0.004))), dtype=np.float32
    ) / 255.0
    gedge = np.clip(gblur * (1.0 - gblur) * 4.0, 0, 1)
    for gscale, gamp in ((0.30, 0.42), (0.12, 0.40), (0.05, 0.32)):
        gn = _noise(w, gscale, seed + 61 + int(gscale * 1000))
        ga = np.clip(ga + (gn - 0.5) * gamp * gedge, 0, 1)
    glyph = Image.fromarray((np.clip(ga, 0, 1) * 255).astype(np.uint8))

    # 缩回目标尺寸：face 与 glyph 都在超采样尺度，一起缩小才对得齐
    face_s = np.asarray(face.resize((s, s), Image.LANCZOS), dtype=np.float32) / 255.0
    glyph_s = np.asarray(glyph.resize((s, s), Image.LANCZOS), dtype=np.float32) / 255.0

    # 朱文的框细，缩回来会变成一条干净的红线 —— 用一层噪声先啃掉一部分，
    # 让边口有断有续，这是「石头刻的」和「画了个矩形」的唯一区别。
    if style != "baiwen":
        fb = np.asarray(
            Image.fromarray((face_s * 255).astype(np.uint8)).filter(
                ImageFilter.GaussianBlur(max(0.8, s * 0.010))
            ),
            dtype=np.float32,
        ) / 255.0
        fband = np.clip(fb * (1.0 - fb) * 5.0, 0, 1)
        # 低频大块：真印的边大体是连续的，只在几处纸没吸到墨的地方断开。
        # 频率一高就成了虚线，反而不像石头。
        cheat = np.clip((_fbm(s, seed + 23, octaves=(0.05, 0.11, 0.24)) - 0.46) / 0.30, 0, 1)
        face_s = np.clip(face_s - cheat * fband * 0.95, 0, 1)

    # 印面的墨量：白文是**一整块实心**（字不是挖掉的，是凸起的字不沾泥，
    # 所以纸色要在下面单独补回来）；朱文是「框 + 字」。
    # 千万别在这里做 face - glyph —— 那会让字的 alpha 变 0，
    # 露出来的是底图而不是纸，深色底上字就成黑的了。
    a = np.clip(face_s if style == "baiwen" else face_s + glyph_s, 0, 1)

    # ---------------------------------------------------------- 破坏它
    rng = np.random.default_rng(seed)

    # 1) 边口崩裂：只在边界过渡带上让噪声决定去留，内部必须保持实心。
    #    幅度很小 —— 真印的边基本是直的，只是纸纤维吸墨不匀让它略微毛一点。
    fine = _noise(s, 0.9, seed + 5)
    mid = _noise(s, 0.35, seed + 6)
    fuzzy = np.asarray(
        Image.fromarray((a * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(1.0, s * 0.014))
        ),
        dtype=np.float32,
    ) / 255.0
    band = np.clip(fuzzy * (1.0 - fuzzy) * 4.2, 0, 1)          # 边界处最大
    a = np.clip(a + ((fine - 0.5) * 0.34 + (mid - 0.5) * 0.18) * band, 0, 1)

    # 2) 崩口：在边上啃掉两小块，像石头缺了角（多了一定像破布）
    chip = Image.new("L", (s, s), 0)
    cd = ImageDraw.Draw(chip)
    for _ in range(2):
        cx = rng.uniform(0.10, 0.90) * s
        cy = rng.choice([rng.uniform(0.00, 0.05), rng.uniform(0.95, 1.00)]) * s
        rx = rng.uniform(0.018, 0.040) * s
        cd.ellipse([cx - rx, cy - rx * 0.7, cx + rx * 1.2, cy + rx * 0.8], fill=255)
    chip_a = np.asarray(
        chip.filter(ImageFilter.GaussianBlur(max(1.0, s * 0.006))), dtype=np.float32
    ) / 255.0
    a = np.clip(a - chip_a * 0.90, 0, 1)

    # 3) 印泥不匀：大块的浓淡。**底子必须够浓**，真印盖在纸上几乎是实心的红
    blot = _fbm(s, seed + 11, octaves=(0.06, 0.16, 0.40))
    blot = (blot - blot.min()) / max(float(np.ptp(blot)), 1e-6)
    a = np.clip(a * (0.92 + 0.08 * blot), 0, 1)

    # 4) 纸纤维透白：极细的小白点，比例很小，多了就成砂纸
    speck = _noise(s, 0.95, seed + 17)
    a *= 1.0 - np.clip((speck - 0.86) / 0.14, 0, 1) * 0.55

    # 5) 按压不匀：左下轻、右上重
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float32) / max(s - 1, 1)
    a *= 1.0 - 0.12 * (0.55 * xx + 0.45 * (1.0 - yy))

    # 6) 印泥在纸上微微洇开
    a = np.asarray(
        Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(0.6, s * 0.004))
        ),
        dtype=np.float32,
    ) / 255.0

    # 合成：红泥 + 纸色的字（白文的字必须是纸色，挖空会让字跟着底图变黑）
    ink = np.clip(a, 0, 1)
    rgb = np.zeros((s, s, 3), dtype=np.float32)
    if style == "baiwen":
        # 字的位置 = 纸（凸起的字不沾泥）。乘 ink 是为了跟着印面的缺角一起消失。
        g = np.clip(glyph_s, 0, 1) * np.clip(face_s, 0, 1)
        for i in range(3):
            rgb[:, :, i] = VERMILION[i] * (1.0 - g) + PAPER_WARM[i] * g
    else:
        for i in range(3):
            rgb[:, :, i] = VERMILION[i]
    out = Image.fromarray(rgb.astype(np.uint8)).convert("RGBA")
    out.putalpha(Image.fromarray((ink * 255).astype(np.uint8)))

    # 旋转要留余量，否则四个角会被裁掉（以前就是这么裁的，所以看着像贴纸）
    pad = int(s * 0.12)
    canvas = Image.new("RGBA", (s + pad * 2, s + pad * 2), (0, 0, 0, 0))
    canvas.alpha_composite(out, (pad, pad))
    canvas = canvas.rotate(
        angle, resample=Image.BICUBIC, center=(pad + s / 2.0, pad + s / 2.0)
    )
    return canvas.crop((pad, pad, pad + s, pad + s))



# ---------------------------------------------------------------- 山水


def _ridge(size: int, rng: np.random.Generator, base_y: float, amp: float, peaks: int) -> list[tuple[float, float]]:
    """一条山脊线：若干个主峰 + 一点抖动，从左边一直画到右边。

    base_y / amp 传的是「占画布的比例」（0.86 / 0.26），这里换成像素。
    """
    xs = np.linspace(0, size, 240)
    ys = np.full(xs.shape, base_y * size, dtype=np.float32)
    for _ in range(peaks):
        cx = rng.uniform(-0.05, 1.05) * size
        w = rng.uniform(0.10, 0.26) * size
        h = rng.uniform(0.45, 1.0) * amp * size
        ys -= h * np.exp(-(((xs - cx) / w) ** 2))
    # 一点手绘的抖
    ys += np.cumsum(rng.normal(0, size * 0.0016, xs.shape)).astype(np.float32)
    return list(zip(xs.tolist(), ys.tolist()))


def _mountain_layer(
    size: int,
    *,
    seed: int,
    base_y: float,
    amp: float,
    peaks: int,
    color: tuple[int, int, int],
    alpha: float,
    fade: float = 0.14,
    dry: float = 0.5,
) -> Image.Image:
    """一层远山。

    水墨的山不是一块实心三角，是「沿山脊最浓、往下迅速化开」：
      · 山脊那条线是落笔处，墨最重；
      · 往下 depth 越大墨越淡，fade 控制化开的快慢；
      · 山体里再用飞白留几条空，像石缝和树影。
    """
    rng = np.random.default_rng(seed)
    pts = _ridge(size, rng, base_y, amp, peaks)
    xs = np.array([p[0] for p in pts], dtype=np.float32)
    ys = np.array([p[1] for p in pts], dtype=np.float32)

    # 把稀疏的采样点插值成「每列一个脊线高度」
    grid = np.arange(size, dtype=np.float32)
    ridge = np.interp(grid, xs, ys).astype(np.float32)

    yy = np.mgrid[0:size, 0:size][0].astype(np.float32)
    depth = (yy - ridge[None, :]) / size          # 脊线处 0，往下为正
    body = np.clip(depth, 0, None)
    inside = (depth >= 0).astype(np.float32)

    # 山体：从山脊往下化开的一团墨
    wash = np.exp(-body / max(fade, 1e-6)) * inside

    # 皴法：山体内部要有纹理，不能是一块均匀的渐变。
    # 用两层不同频率的噪声叠出山石的块面，再横向拉长一点，像斧劈皴。
    tex = _fbm(size, seed + 19, octaves=(0.008, 0.022, 0.06))
    tex = np.clip((tex - 0.35) * 1.6, 0, 1)
    wash = wash * (0.55 + 0.75 * tex)

    # 干笔：山体里留几道空，像石缝。量要小，多了就成麻点。
    streak = _streaks(size, seed + 13)
    dry_mask = np.clip((streak - (1.0 - dry)) / max(dry, 1e-3), 0, 1)
    wash *= 1.0 - dry_mask * 0.42

    # 山脊：落笔那条线最浓，只有几个像素宽。
    # 没有这一道，山只有一个柔软的大渐变，看不出轮廓 —— 这是第一版最失败的地方。
    line_w = 0.0045
    ridge_line = np.exp(-((body / line_w) ** 2)) * inside
    ridge_line *= 0.62 + 0.55 * _fbm(size, seed + 41, octaves=(0.01, 0.03))

    arr = np.clip(wash * 0.78 + ridge_line * 0.85, 0, 1)

    # 左右淡出，免得贴边
    xx = np.mgrid[0:size, 0:size][1].astype(np.float32) / size
    edge = np.clip(np.minimum(xx, 1 - xx) / 0.05, 0, 1)
    arr *= 0.25 + 0.75 * edge

    layer = Image.new("RGBA", (size, size), color + (0,))
    a = Image.fromarray((np.clip(arr, 0, 1) * 255 * alpha).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(size * 0.0016)
    )
    layer.putalpha(a)
    return layer


def _mist_layer(size: int, *, seed: int, y: float, height: float, color: tuple[int, int, int], alpha: float) -> Image.Image:
    """一条横着的云气：中间实、上下散开。"""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    band = np.exp(-(((yy - y * size) / (height * size)) ** 2))
    n = _fbm(size, seed, octaves=(0.01, 0.03, 0.08))
    a = np.clip(band * (0.45 + n * 1.1), 0, 1) * alpha * 255

    layer = Image.new("RGBA", (size, size), color + (0,))
    layer.putalpha(Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(size * 0.012)))
    return layer


def _taper(
    draw: ImageDraw.ImageDraw,
    p0: tuple[float, float],
    p1: tuple[float, float],
    w0: float,
    w1: float,
    *,
    bow: float = 0.0,
    steps: int = 24,
) -> None:
    """一笔两头带尖的毛笔。从 p0 到 p1，起笔宽 w0、收笔宽 w1，bow 让它拱起来。"""
    x0, y0 = p0
    x1, y1 = p1
    dx, dy = x1 - x0, y1 - y0
    length = max((dx * dx + dy * dy) ** 0.5, 1e-6)
    nx, ny = -dy / length, dx / length      # 法线

    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    for i in range(steps + 1):
        t = i / steps
        # 二次贝塞尔：中段被 bow 顶出去
        bend = bow * (4.0 * t * (1.0 - t))
        cx = x0 + dx * t + nx * bend
        cy = y0 + dy * t + ny * bend
        # 笔锋：起笔略细、中段最粗、收笔尖（两侧都是 sin 包络）
        w = (w0 + (w1 - w0) * t) * (0.55 + 0.75 * (1.0 - abs(2.0 * t - 1.0)))
        left.append((cx + nx * w * 0.5, cy + ny * w * 0.5))
        right.append((cx - nx * w * 0.5, cy - ny * w * 0.5))
    draw.polygon(left + right[::-1], fill=255)


def _birds(
    size: int,
    *,
    seed: int,
    cx: float,
    cy: float,
    span: float,
    count: int,
    color,
    alpha: int = 210,
) -> Image.Image:
    """远处的水墨飞鸟：一笔身子、两笔翅膀，笔画自带提按。

    **span 是「一只鸟的翼展」占画布的比例**（不是半翼展）。
    以前这里算的是半翼展，span=0.042 时整只鸟只有 21 像素，远看就是纸上一道划痕，
    所以用户连着两轮问「有鸟吗」。现在按翼展算，0.10 的翼展在 1024 图里有 100 像素，
    整张图一眼就能看见。

    真画里的鸟远看只有几笔，但每一笔都有粗有细：
      · 身子一笔短而重；
      · 两翼从肩部甩出去，起笔实、收笔尖，翼尖上挑；
      · 头是很小的一点，不能画成圆球。
    """
    if span * size < 12:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))

    rng = np.random.default_rng(seed)
    big = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(big)

    for _ in range(count):
        # 半翼展。每只大小略有差别，一组鸟才有远近
        r = span * size * 0.5 * rng.uniform(0.80, 1.0)
        x = cx * size + rng.uniform(-0.15, 0.15) * size
        y = cy * size + rng.uniform(-0.07, 0.07) * size
        tilt = rng.uniform(-0.22, 0.22)          # 整体姿态：有的平飞，有的侧身
        lift = rng.uniform(0.70, 1.25)           # 翅膀张开的角度

        cos_t, sin_t = np.cos(tilt), np.sin(tilt)

        def tp(px: float, py: float) -> tuple[float, float]:
            """以鸟的中心为原点做局部旋转，再平移回画面。"""
            return (x + px * cos_t - py * sin_t, y + px * sin_t + py * cos_t)

        # 一笔背：从尾根到胸，短而重、微拱。
        # 没有这一笔，两只翅膀交在一个点上，就成了「>」符号，不是活物。
        _taper(d, tp(-0.34 * r, 0.10 * r), tp(0.30 * r, -0.05 * r), r * 0.26, r * 0.20, bow=0.07 * r)
        # 头：很小的一点
        hx, hy = tp(0.34 * r, -0.09 * r)
        hr = r * 0.10
        d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=255)
        # 两翼：从肩部甩出去，长而尖，翼尖上挑 —— 这是国画里雁的笔意。
        # 翼长必须接近整个翼展的一半，短了就变成小翅膀的家雀。
        _taper(
            d,
            tp(0.08 * r, -0.02 * r),
            tp(-0.92 * r, (-0.50 * lift) * r),
            r * 0.24,
            r * 0.015,
            bow=0.20 * r,
        )
        _taper(
            d,
            tp(0.08 * r, 0.02 * r),
            tp(-0.88 * r, (0.46 * lift) * r),
            r * 0.22,
            r * 0.015,
            bow=-0.18 * r,
        )

    big = big.resize((size, size), Image.LANCZOS)

    # 给笔画上墨色：鸟很小，纹理要跟着缩小，所以噪声频率设在「笔身尺度」上
    a = np.asarray(big, dtype=np.float32) / 255.0
    if a.max() <= 1e-6:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grain = _fbm(size, seed + 23, octaves=(0.05, 0.14, 0.35))
    a = a * (0.82 + 0.30 * grain)
    # 极淡的洇：鸟在远处，本来就该虚一点
    a = np.asarray(
        Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(max(0.5, size * 0.0012))
        ),
        dtype=np.float32,
    ) / 255.0
    a = np.clip(a, 0, 1) * alpha

    layer = Image.new("RGBA", (size, size), color + (0,))
    layer.putalpha(Image.fromarray(a.astype(np.uint8)))
    return layer

# ---------------------------------------------------------------- 出图


def draw_icon(size: int = SIZE, *, full_bleed: bool = False, transparent: bool = False) -> Image.Image:
    """画一张水墨风图标。

    full_bleed=True  铺满整块画布，不切圆角 —— 给 Android 用
                     （Android 8+ 的 adaptive icon 会自己裁形状，圆角底板会露黑边）。
    transparent=True 只留字和印，底板透明 —— 给 adaptive icon 的前景层。

    默认（两者都 False）是带圆角的整块图标，给 Windows / macOS / iOS / PWA 用。
    """
    if transparent:
        # 前景层：山会跟底板撞在一起，去掉；只留「忆」和那枚印。
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        # 字往左上让一点，把右下角腾给印章：前景层是抠空的，
        # 印章一旦压在「忆」的末笔上，两层颜色叠起来就糊成一团红。
        glyph = _ink_layer(
            size, "忆", ratio=0.58, color=INK, dx=-0.052, dy=-0.068,
            seed=17, wet=0.55, dry=0.34, font_path=BRUSH_XING,
        )
        img = Image.alpha_composite(img, glyph)
        # 印章缩到字的六成、落在右下外角；位置留在 Android 的 66% 安全圆内
        seal_px = int(size * 0.148)
        seal = _seal(seal_px, style="zhuwen", angle=-3.2, scale=0.94)
        img.alpha_composite(seal, (int(size * 0.545), int(size * 0.548)))
        return img

    img = _vignette(_paper(size, PAPER, seed=13), 0.24).convert("RGBA")

    # 远山三层，越近越浓 —— 这是山水画的「三远」叠法。
    # fade 不能太小，小了墨还没化开就没了，山会变成一条细线。
    img = Image.alpha_composite(
        img,
        _mountain_layer(size, seed=83, base_y=0.735, amp=0.115, peaks=3,
                        color=(104, 112, 124), alpha=0.34, fade=0.20, dry=0.5),
    )
    img = Image.alpha_composite(
        img,
        _mountain_layer(size, seed=89, base_y=0.830, amp=0.090, peaks=4,
                        color=(60, 68, 78), alpha=0.48, fade=0.16, dry=0.44),
    )
    img = Image.alpha_composite(
        img,
        _mountain_layer(size, seed=93, base_y=0.930, amp=0.060, peaks=5,
                        color=(24, 28, 34), alpha=0.72, fade=0.11, dry=0.40),
    )
    # 云气：横在山腰，把远山和近山分开
    img = Image.alpha_composite(
        img, _mist_layer(size, seed=97, y=0.795, height=0.026, color=(252, 249, 242), alpha=0.72)
    )
    # 飞鸟放在右上角的留白里 —— 压在字的偏旁上会显得挤。
    # span 是整只鸟的翼展：0.042 时只有 43 像素，看整图根本找不到，所以给到 0.10。
    img = Image.alpha_composite(
        img, _birds(size, seed=101, cx=0.760, cy=0.170, span=0.100, count=3,
                    color=(26, 30, 36), alpha=228),
    )

    glyph = _ink_layer(
        size, "忆", ratio=0.74, color=INK, dx=-0.005, dy=-0.125,
        seed=17, wet=0.55, dry=0.34, font_path=BRUSH_XING,
    )
    img = Image.alpha_composite(img, glyph)
    # 印章用朱文（红框红字）：白文的实心红块在这个尺寸下太抢眼，会压住山。
    img.alpha_composite(_seal(size, style="zhuwen", angle=-3.2, scale=0.252),
                        (int(size * 0.656), int(size * 0.624)))

    if full_bleed:
        # 圆角换直角：把四角露出来的透明补成纸色
        flat = Image.new("RGBA", (size, size), PAPER + (255,))
        flat.alpha_composite(img)
        return flat

    # 圆角：和原来一致，直径 22% 的大圆角
    radius = int(size * 0.22)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=radius * 4, fill=255
    )
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out
