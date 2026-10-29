"""「忆笺 · 日程」的江南风图标。

和主图标（水墨「忆」字 + 远山飞雁）同一套纸、墨、印，但意象换成江南水乡：

    白墙黛瓦的马头墙  ·  一叶小舟  ·  烟雨

为什么是这三样：
    「忆笺」是旧纸与灯，所以主图标走的是山与雁；
    「日程」管的是日子，江南的日子是水边的日子 —— 墙是白的、瓦是黑的、
    雨是斜的、船是慢的。三样东西各自都是极简的剪影，缩到 48px 也还认得出。

构图上只画**一座**正屋（外加两座很矮的侧屋做纵深）：
    三座一样高的房子并排，屋顶连成一片黑，缩到 48px 就是一团墨。
    一座正屋 + 两侧压低的侧屋，中间的白墙和阶梯山墙才露得出来 ——
    这两样正是江南民居最认得出来的地方。

画法和主图标一样：超采样画形状，缩回来之后再上墨的纹理。
黛瓦不是纯黑 —— 走 _ink_alpha，边缘有飞白、笔肚有浓淡，
512px 上看是「墨画出来的屋顶」，不是「填充出来的多边形」。
"""

from __future__ import annotations

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from make_icon_common import (
    PAPER,
    _fbm,
    _ink_alpha,
    _mist_layer,
    _paper,
    _seal,
    _taper,
    _vignette,
)

SIZE = 1024
WALL = (251, 249, 244)          # 白墙：刷过石灰的暖白，比纸亮一点点
WALL_FOOT = (203, 199, 191)     # 墙根
TILE = (30, 33, 38)             # 黛瓦
WATER = (196, 204, 207)

WATER_Y = 0.700

# 三座房子的几何参数。
#   x0, x1    左右边界（占画布比例）
#   wall_top  平顶墙头的高度（不含山墙）
#   ridge     屋脊高度
#   steps     山墙的台阶数
#   gable     山墙占建筑宽度的比例
#
# 中间那座是正屋：最宽、最高、台阶最多（三级，是江南大户的样子）。
# 两侧的侧屋压得很低，只用来交代「这是一片房子」，不抢主体。
HOUSES = [
    # x0     x1     wall_top ridge  steps gable
    (0.030, 0.290, 0.545, 0.470, 2, 0.26),
    (0.230, 0.760, 0.430, 0.318, 3, 0.20),
    (0.700, 0.965, 0.560, 0.482, 2, 0.26),
]


def _roof_path(s: float, x0: float, x1: float, top: float, ridge: float):
    """一条江南屋顶的轮廓：檐口两端起翘，屋脊在中间平着走一小段。

    起翘是江南民居的灵魂 —— 直直的三角是别处的房子，不是江南的。
    """
    W, E = x0 * s, x1 * s
    t, rg = top * s, ridge * s
    mid = (W + E) / 2
    half = (E - W) / 2
    over = (E - W) * 0.075          # 屋檐出挑
    lift = (t - rg) * 0.42          # 檐角上翘的高度

    pts = []
    n = 24
    # 左檐口 → 左坡
    for i in range(n + 1):
        k = i / n
        x = mid - half - over + (half + over - half * 0.34) * k
        curve = lift * (1.0 - k) ** 2.4
        y = t + (rg - t) * k**0.80 - curve
        pts.append((x, y))
    # 屋脊：平的一小段（微微反弓，不是死平）
    for i in range(n + 1):
        k = i / n
        x = mid - half * 0.34 + half * 0.68 * k
        pts.append((x, rg - (t - rg) * 0.06 * np.sin(np.pi * k)))
    # 右坡 → 右檐口
    for i in range(n + 1):
        k = i / n
        x = mid + half * 0.34 + (half + over - half * 0.34) * k
        y = rg + (t - rg) * (k**1.25) - lift * k**2.4
        pts.append((x, y))
    return pts


def _gable_steps(s: float, x0: float, x1: float, wall_top: float, ridge: float, steps: int, gable: float):
    """两端马头墙的阶梯。

    返回 [(墙垛矩形, 瓦檐矩形), ...]。白墙层和黛瓦层都从这里取，
    保证两层的台阶严丝合缝。

    台阶是往上垒的：靠外檐那级最低，越靠屋脊越高，最高一级要明显越过
    屋脊线 —— 这是马头墙的轮廓。台阶只占建筑两端的一小段（gable 比例），
    要是横跨大半个屋顶，看起来就变成「屋顶上插了几根白条」了。
    """
    W, E = x0 * s, x1 * s
    top, rg = wall_top * s, ridge * s
    line = max(2.0, s * 0.005)
    gw = (E - W) * gable
    # 最高一级要比屋脊高出约四分之一个屋顶高度，台阶轮廓才立得住
    rise = (top - rg) * 1.30 + line * 2.5

    out = []
    for side in (-1, 1):
        for k in range(steps):
            if side < 0:
                xa = W + gw * k / steps
                xb = W + gw * (k + 1) / steps
            else:
                xa = E - gw * (k + 1) / steps
                xb = E - gw * k / steps
            y = top - rise * (k + 1) / steps
            cap = line * 2.0
            pad = gw / steps * 0.10
            out.append(
                (
                    (xa, y, xb, top + line),
                    (xa - pad, y - cap, xb + pad, y + cap * 0.40),
                )
            )
    return out


def _house(
    d: ImageDraw.ImageDraw,
    s: float,
    x0: float,
    x1: float,
    wall_top: float,
    ridge: float,
    *,
    steps: int,
    gable: float,
) -> None:
    """一座江南民居的实心剪影：白墙（含阶梯山墙）+ 屋顶 + 两扇小窗。"""
    W, E = x0 * s, x1 * s
    top = wall_top * s
    foot = s * WATER_Y

    # ---- 白墙：一段平顶 + 两端的阶梯 ----
    d.rectangle([W, top, E, foot], fill=255)
    for rect, _cap in _gable_steps(s, x0, x1, wall_top, ridge, steps, gable):
        d.rectangle(rect, fill=255)

    # ---- 屋顶 ----
    d.polygon(_roof_path(s, x0, x1, wall_top, ridge), fill=255)

    # ---- 窗：两扇小方窗（挖空，最后上成黛色） ----
    win_w = (E - W) * 0.115
    win_h = (foot - top) * 0.30
    wy = top + (foot - top) * 0.28
    for cx in (W + (E - W) * 0.36, W + (E - W) * 0.64):
        d.rectangle([cx - win_w / 2, wy, cx + win_w / 2, wy + win_h], fill=0)


def _roofs(d: ImageDraw.ImageDraw, s: float) -> None:
    """只画「黛瓦」那一层：屋顶 + 屋脊 + 每一级山墙顶上的瓦檐。

    参数必须和 _house 完全一致（都从 HOUSES 取），否则墙和瓦会错位。
    """
    for x0, x1, wall_top, ridge, steps, gable in HOUSES:
        W, E = x0 * s, x1 * s
        rg = ridge * s
        mid = (W + E) / 2
        half = (E - W) / 2
        line = max(2.0, s * 0.005)

        # 屋顶：比白墙那层往上收一点点，让白墙的边露出来当「墙头线」
        path = _roof_path(s, x0, x1, wall_top, ridge)
        d.polygon([(x, y - line * 0.4) for x, y in path], fill=255)
        # 屋脊
        d.rectangle([mid - half * 0.36, rg - line * 2.0, mid + half * 0.36, rg - line * 0.2], fill=255)

        for _rect, cap in _gable_steps(s, x0, x1, wall_top, ridge, steps, gable):
            d.rectangle(cap, fill=255)


def _windows(s: float) -> Image.Image:
    """窗洞单独一层：它们要从白墙里挖出来，不能跟着屋顶一起上墨。"""
    mask = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(mask)
    for x0, x1, wall_top, ridge, steps, gable in HOUSES:
        W, E = x0 * s, x1 * s
        top, foot = wall_top * s, s * WATER_Y
        win_w = (E - W) * 0.115
        win_h = (foot - top) * 0.30
        wy = top + (foot - top) * 0.28
        for cx in (W + (E - W) * 0.36, W + (E - W) * 0.64):
            d.rectangle([cx - win_w / 2, wy, cx + win_w / 2, wy + win_h], fill=255)
    return mask


def _boat(d: ImageDraw.ImageDraw, s: float, cx: float, cy: float, length: float) -> None:
    """一叶乌篷船：船身、船头翘角、乌篷、船尾摇橹的人。

    船身是两头翘起的月牙，不是梯形 —— 江南的摇橹船两头都是翘的。
    """
    L = length * s
    x0 = cx * s - L / 2
    x1 = cx * s + L / 2
    y = cy * s
    h = L * 0.15

    body = []
    n = 22
    for i in range(n + 1):
        k = i / n
        x = x0 + (x1 - x0) * k
        body.append((x, y - h * 0.34 * np.sin(np.pi * k) ** 0.6))
    for i in range(n + 1):
        k = 1 - i / n
        x = x0 + (x1 - x0) * k
        body.append((x, y + h * (0.62 + 0.38 * np.sin(np.pi * k) ** 0.5)))
    d.polygon(body, fill=255)

    _taper(d, (x0 + L * 0.05, y - h * 0.10), (x0 - L * 0.055, y - h * 0.78), L * 0.036, L * 0.008, bow=L * 0.02)
    _taper(d, (x1 - L * 0.05, y - h * 0.10), (x1 + L * 0.048, y - h * 0.72), L * 0.036, L * 0.008, bow=-L * 0.02)

    aw = L * 0.34
    ax = x0 + L * 0.34
    d.pieslice([ax - aw / 2, y - h * 1.55, ax + aw / 2, y + h * 0.45], 180, 360, fill=255)
    for k in (0.34, 0.66):
        bx = ax - aw / 2 + aw * k
        d.line([(bx, y - h * 1.28), (bx, y + h * 0.10)], fill=0, width=max(1, int(L * 0.008)))

    px = x0 + L * 0.80
    d.rectangle([px - L * 0.020, y - h * 1.28, px + L * 0.020, y + h * 0.18], fill=255)
    d.ellipse([px - L * 0.042, y - h * 1.76, px + L * 0.042, y - h * 1.26], fill=255)
    _taper(d, (px + L * 0.03, y - h * 1.05), (px + L * 0.28, y + h * 0.95), L * 0.014, L * 0.005, bow=L * 0.05)


# ---------------------------------------------------------------- 出图


def draw_schedule_icon(size: int = SIZE, *, full_bleed: bool = False, transparent: bool = False) -> Image.Image:
    """画「忆笺 · 日程」的图标。

    full_bleed / transparent 的语义和主图标的 draw_icon 一致：
      full_bleed=True  直角铺满，给 Android legacy 图标；
      transparent=True 只留剪影与印，给 adaptive icon 的前景层。
    """
    ss = 3
    S = size * ss

    # ---- 纸 ----
    img = _vignette(_paper(S, PAPER, seed=29), 0.20).convert("RGBA")

    # ---- 烟雨：整片斜着的细丝 ----
    rain = Image.new("L", (S, S), 0)
    rd = ImageDraw.Draw(rain)
    rng = np.random.default_rng(311)
    for _ in range(190):
        x = rng.uniform(-0.05, 1.05) * S
        y = rng.uniform(-0.04, 0.80) * S
        ln = rng.uniform(0.028, 0.070) * S
        rd.line(
            [(x, y), (x - ln * 0.34, y + ln)],
            fill=int(rng.uniform(22, 54)),
            width=max(1, int(S * 0.0014)),
        )
    rain = rain.filter(ImageFilter.GaussianBlur(S * 0.0011))
    img = Image.alpha_composite(
        img,
        Image.merge(
            "RGBA",
            (Image.new("L", (S, S), 88), Image.new("L", (S, S), 100),
             Image.new("L", (S, S), 112), rain),
        ),
    )

    # ---- 水面：一条横向的浅色带，把房子托在水上 ----
    yy = np.mgrid[0:S, 0:S][0].astype(np.float32) / S
    band = np.clip((yy - WATER_Y + 0.006) / 0.012, 0, 1) * np.clip((1.02 - yy) / 0.14, 0, 1)
    wash = _fbm(S, 401, octaves=(0.01, 0.03, 0.09))
    a = np.clip(band * (0.40 + wash * 0.55), 0, 1) * 225
    img = Image.alpha_composite(
        img,
        Image.merge(
            "RGBA",
            (Image.new("L", (S, S), WATER[0]), Image.new("L", (S, S), WATER[1]),
             Image.new("L", (S, S), WATER[2]),
             Image.fromarray(a.astype(np.uint8)).filter(ImageFilter.GaussianBlur(S * 0.004))),
        ),
    )

    # ---- 白墙 ----
    walls = Image.new("L", (S, S), 0)
    wd = ImageDraw.Draw(walls)
    for x0, x1, wall_top, ridge, steps, gable in HOUSES:
        _house(wd, S, x0, x1, wall_top, ridge, steps=steps, gable=gable)
    walls = walls.filter(ImageFilter.GaussianBlur(S * 0.0005))

    white = Image.new("RGBA", (S, S), WALL + (255,))
    img = Image.composite(white, img, walls)

    # 白墙压在浅色纸上，不描一道边就分不清哪是墙哪是背景 ——
    # 尤其阶梯山墙是白的、纸也是白的，远看只剩几个悬空的黑瓦檐。
    # 国画里白墙本来也是靠一道淡墨线勾出来的。
    edge = Image.fromarray(
        np.clip(
            np.asarray(walls.filter(ImageFilter.MaxFilter(max(3, int(S * 0.0045) | 1))), dtype=np.float32)
            - np.asarray(walls, dtype=np.float32),
            0,
            255,
        ).astype(np.uint8)
    )
    edge = edge.filter(ImageFilter.GaussianBlur(S * 0.0012))
    edge_a = np.asarray(edge, dtype=np.float32) / 255.0
    ink = Image.new("RGBA", (S, S), (58, 62, 68, 0))
    ink.putalpha(Image.fromarray((edge_a * 118).astype(np.uint8)))
    img = Image.alpha_composite(img, ink)

    # 墙根一道阴影：白墙直接压在纸上会像贴纸，加一道根部的灰就「站」住了
    foot = Image.new("L", (S, S), 0)
    fd = ImageDraw.Draw(foot)
    for x0, x1, *_ in HOUSES:
        fd.rectangle([x0 * S, S * (WATER_Y - 0.040), x1 * S, S * WATER_Y], fill=255)
    foot = foot.filter(ImageFilter.GaussianBlur(S * 0.004))
    foot_a = np.asarray(foot, dtype=np.float32) / 255.0 * 0.50
    shade = Image.new("RGBA", (S, S), WALL_FOOT + (0,))
    shade.putalpha(Image.fromarray((foot_a * 255).astype(np.uint8)))
    img = Image.alpha_composite(img, shade)

    # ---- 黛瓦：走 _ink_alpha，边缘有飞白、笔肚有浓淡 ----
    roofs = Image.new("L", (S, S), 0)
    _roofs(ImageDraw.Draw(roofs), S)
    roofs = roofs.filter(ImageFilter.GaussianBlur(S * 0.0004))
    tile_a = _ink_alpha(roofs, seed=613, wet=0.42, dry=0.30)
    tile = Image.new("RGBA", (S, S), TILE + (255,))
    tile.putalpha(tile_a)
    img = Image.alpha_composite(img, tile)

    # ---- 窗洞：挖出来上黛色（窗里是屋里，比瓦淡一点） ----
    win = _windows(S).filter(ImageFilter.GaussianBlur(S * 0.0004))
    win_a = np.asarray(win, dtype=np.float32) / 255.0
    win_layer = Image.new("RGBA", (S, S), (66, 70, 77, 0))
    win_layer.putalpha(Image.fromarray((win_a * 210).astype(np.uint8)))
    img = Image.alpha_composite(img, win_layer)

    # ---- 倒影：房子上下翻过来，压暗、糊开 ----
    top_px = int(S * 0.30)
    cut_px = int(S * WATER_Y)
    refl = img.crop((0, top_px, S, cut_px)).transpose(Image.FLIP_TOP_BOTTOM)
    refl = refl.filter(ImageFilter.GaussianBlur(S * 0.010))
    rh = refl.size[1]
    ry = np.mgrid[0:rh, 0:S][0].astype(np.float32) / max(rh - 1, 1)
    fade = np.clip(1.0 - ry / 0.55, 0, 1) * 0.26
    ra = np.asarray(refl.split()[3], dtype=np.float32) / 255.0
    refl.putalpha(Image.fromarray((ra * fade * 255).astype(np.uint8)))
    img.alpha_composite(refl, (0, cut_px))

    # ---- 小舟 ----
    boat = Image.new("L", (S, S), 0)
    _boat(ImageDraw.Draw(boat), S, cx=0.250, cy=0.830, length=0.260)
    boat = boat.filter(ImageFilter.GaussianBlur(S * 0.0004))
    boat_a = _ink_alpha(boat, seed=617, wet=0.40, dry=0.26)
    bl = Image.new("RGBA", (S, S), TILE + (255,))
    bl.putalpha(boat_a)
    img = Image.alpha_composite(img, bl)
    bimg = Image.new("RGBA", (S, S), TILE + (0,))
    bimg.putalpha(boat.filter(ImageFilter.GaussianBlur(S * 0.006)).point(lambda v: int(v * 0.18)))
    img.alpha_composite(bimg, (0, int(S * 0.046)))

    # ---- 云气：横在水线与房子之间，把「水」和「岸」分开 ----
    img = Image.alpha_composite(
        img, _mist_layer(S, seed=419, y=0.726, height=0.028, color=(252, 250, 245), alpha=0.70)
    )
    img = Image.alpha_composite(
        img, _mist_layer(S, seed=421, y=0.600, height=0.018, color=(252, 250, 245), alpha=0.34)
    )

    # ---- 印：右下角一枚「程」 ----
    seal_px = int(S * 0.150)
    img.alpha_composite(
        _seal(seal_px, "程", style="zhuwen", angle=-3.4, scale=0.96, seed=733),
        (int(S * 0.760), int(S * 0.760)),
    )

    img = img.resize((size, size), Image.LANCZOS)

    if transparent:
        fg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        mask = Image.new("L", (size, size), 0)
        md = ImageDraw.Draw(mask)
        for x0, x1, wall_top, ridge, steps, gable in HOUSES:
            _house(md, size, x0, x1, wall_top, ridge, steps=steps, gable=gable)
        _roofs(md, size)
        _boat(md, size, cx=0.250, cy=0.830, length=0.260)
        fg.paste(Image.new("RGBA", (size, size), TILE + (255,)), (0, 0), mask)
        fg.alpha_composite(
            _seal(int(size * 0.150), "程", style="zhuwen", angle=-3.4, scale=0.96, seed=733),
            (int(size * 0.760), int(size * 0.760)),
        )
        return fg

    if full_bleed:
        flat = Image.new("RGBA", (size, size), PAPER + (255,))
        flat.alpha_composite(img)
        return flat

    radius = int(size * 0.22)
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1], radius=radius * 4, fill=255
    )
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out
