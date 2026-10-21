#!/usr/bin/env python3
"""
Generates all brand icon, adaptive icon, splash screen, and media notification
album art assets for EnglishPod in both Light Mode and Dark Mode:
  - Light Mode: Light theme accent smiley (#CC785C) on White background (#FFFFFF)
  - Dark Mode:  Dark theme accent smiley  (#1ED760) on Black background (#000000)
"""

import math
import os
from collections import deque
from PIL import Image

# ⚠️ 不再硬编码本机绝对路径。全部改为环境变量可配置。
_PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_PIPELINE_DIR)

# 参考笑脸原图（必填）：通过环境变量 EP_REF_SMILEY 指定 jpg 路径
REF_CLEAN_IMAGE = os.environ.get("EP_REF_SMILEY", "")
FLUTTER_ROOT = os.environ.get("FLUTTER_ROOT", os.path.join(_REPO_ROOT, "flutter_app"))
ANDROID_RES = os.path.join(FLUTTER_ROOT, "android/app/src/main/res")
BRANDING_ASSETS_DIR = os.path.join(FLUTTER_ROOT, "assets/branding")
# 预览图输出目录：默认落在品牌素材目录下（不再指向本机 brain 目录）
ARTIFACT_DIR = os.environ.get("EP_ARTIFACT_DIR", BRANDING_ASSETS_DIR)

# Theme Colors from AppPalette in lib/main.dart
DARK_ACCENT = (0x1E, 0xD7, 0x60)   # #1ED760
DARK_BG = (0x00, 0x00, 0x00)       # #000000 (Pure Black)

LIGHT_ACCENT = (0xCC, 0x78, 0x5C)  # #CC785C
LIGHT_BG = (0xFF, 0xFF, 0xFF)      # #FFFFFF (Pure White)


def extract_clean_alpha_mask(img_path: str) -> Image.Image:
    """
    Converts the black-on-white reference smiley image into a clean, anti-aliased
    alpha mask (0 = background, 255 = full foreground ink).
    """
    im = Image.open(img_path).convert("L")
    w, h = im.size
    src = im.load()
    mask = Image.new("L", (w, h), 0)
    dst = mask.load()

    # Map grayscale [25..235] smoothly to alpha [255..0]
    low, high = 25.0, 235.0
    span = high - low
    for y in range(h):
        for x in range(w):
            v = src[x, y]
            if v <= low:
                dst[x, y] = 255
            elif v >= high:
                dst[x, y] = 0
            else:
                t = (high - v) / span
                # Slight S-curve for extra-crisp vector-like edge
                t = t * t * (3.0 - 2.0 * t)
                dst[x, y] = int(round(t * 255.0))
    return mask


def render_tinted_smiley(
    alpha_mask: Image.Image,
    canvas_size: int,
    fg_rgb: tuple[int, int, int],
    bg_rgba: tuple[int, int, int, int],
    smiley_scale: float = 0.72,
) -> Image.Image:
    """
    Renders the hand-drawn smiley centered on a square canvas of `canvas_size`
    where the smiley's height occupies `smiley_scale * canvas_size`.
    """
    # Crop alpha mask to tight ink bounding box first
    bbox = alpha_mask.getbbox()
    cropped = alpha_mask.crop(bbox) if bbox else alpha_mask
    cw, ch = cropped.size

    # Scale so max dimension (height) is smiley_scale * canvas_size
    target_h = max(1, int(round(canvas_size * smiley_scale)))
    target_w = max(1, int(round(cw * (target_h / float(ch)))))

    resized_mask = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (canvas_size, canvas_size), bg_rgba)
    fg_layer = Image.new("RGBA", (target_w, target_h), (*fg_rgb, 255))

    ox = (canvas_size - target_w) // 2
    oy = (canvas_size - target_h) // 2

    # Composite foreground using resized_mask
    fg_placed = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    fg_placed.paste(fg_layer, (ox, oy), resized_mask)
    return Image.alpha_composite(canvas, fg_placed)


def trace_contours_to_svg_path(
    alpha_mask: Image.Image,
    viewport_size: float = 108.0,
    smiley_scale: float = 0.50,
) -> str:
    """
    Traces all closed boundary contours of the binary mask using Moore-Neighbor /
    directed boundary edge walking, simplifies with Ramer-Douglas-Peucker, and
    fits smooth cubic Bezier curves in a `viewport_size x viewport_size` coordinate system.
    """
    grid_n = 360
    # Render mask onto grid_n x grid_n at desired smiley_scale
    bbox = alpha_mask.getbbox()
    cropped = alpha_mask.crop(bbox) if bbox else alpha_mask
    cw, ch = cropped.size
    target_h = int(round(grid_n * smiley_scale))
    target_w = int(round(cw * (target_h / float(ch))))
    resized = cropped.resize((target_w, target_h), Image.Resampling.LANCZOS)

    grid_img = Image.new("L", (grid_n, grid_n), 0)
    ox = (grid_n - target_w) // 2
    oy = (grid_n - target_h) // 2
    grid_img.paste(resized, (ox, oy))
    pix = grid_img.load()

    # Build binary grid (True = inside ink)
    inside = [[pix[x, y] >= 128 for x in range(grid_n)] for y in range(grid_n)]

    # Extract directed boundary edges between pixel cells:
    # A cell (y, x) occupies [x, x+1] x [y, y+1].
    # Directed edges keep "inside" on their right-hand / clockwise side:
    # - Top edge of (y,x) if inside[y][x] and not inside[y-1][x]: (x, y) -> (x+1, y)
    # - Right edge of (y,x) if inside[y][x] and not inside[y][x+1]: (x+1, y) -> (x+1, y+1)
    # - Bottom edge of (y,x) if inside[y][x] and not inside[y+1][x]: (x+1, y+1) -> (x, y+1)
    # - Left edge of (y,x) if inside[y][x] and not inside[y][x-1]: (x, y+1) -> (x, y)
    adj: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add_edge(p1: tuple[int, int], p2: tuple[int, int]):
        adj.setdefault(p1, []).append(p2)

    for y in range(grid_n):
        for x in range(grid_n):
            if not inside[y][x]:
                continue
            if y == 0 or not inside[y - 1][x]:
                add_edge((x, y), (x + 1, y))
            if x == grid_n - 1 or not inside[y][x + 1]:
                add_edge((x + 1, y), (x + 1, y + 1))
            if y == grid_n - 1 or not inside[y + 1][x]:
                add_edge((x + 1, y + 1), (x, y + 1))
            if x == 0 or not inside[y][x - 1]:
                add_edge((x, y + 1), (x, y))

    loops: list[list[tuple[float, float]]] = []
    while adj:
        start = next(iter(adj))
        loop = [start]
        curr = start
        while True:
            next_list = adj.get(curr)
            if not next_list:
                break
            nxt = next_list.pop()
            if not next_list:
                del adj[curr]
            if nxt == start:
                break
            loop.append(nxt)
            curr = nxt
        if len(loop) >= 16:
            loops.append([(float(p[0]), float(p[1])) for p in loop])

    def smooth_closed_loop(pts: list[tuple[float, float]], iterations: int = 3) -> list[tuple[float, float]]:
        cur = pts
        for _ in range(iterations):
            n = len(cur)
            nxt = []
            for i in range(n):
                p0 = cur[(i - 1) % n]
                p1 = cur[i]
                p2 = cur[(i + 1) % n]
                nxt.append((
                    0.25 * p0[0] + 0.5 * p1[0] + 0.25 * p2[0],
                    0.25 * p0[1] + 0.5 * p1[1] + 0.25 * p2[1],
                ))
            cur = nxt
        return cur

    def rdp_closed(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
        def rdp_open(segment: list[tuple[float, float]]) -> list[tuple[float, float]]:
            if len(segment) <= 2:
                return segment
            x1, y1 = segment[0]
            x2, y2 = segment[-1]
            dx, dy = x2 - x1, y2 - y1
            denom = math.hypot(dx, dy)
            max_d = -1.0
            max_i = 0
            for i in range(1, len(segment) - 1):
                px, py = segment[i]
                if denom < 1e-9:
                    d = math.hypot(px - x1, py - y1)
                else:
                    d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / denom
                if d > max_d:
                    max_d = d
                    max_i = i
            if max_d > eps:
                left = rdp_open(segment[: max_i + 1])
                right = rdp_open(segment[max_i:])
                return left[:-1] + right
            return [segment[0], segment[-1]]

        half = len(pts) // 2
        part1 = rdp_open(pts[: half + 1])
        part2 = rdp_open(pts[half:] + [pts[0]])
        return part1[:-1] + part2[:-1]

    scale = viewport_size / float(grid_n)
    path_parts: list[str] = []

    for raw_loop in loops:
        smoothed = smooth_closed_loop(raw_loop, iterations=4)
        simplified = rdp_closed(smoothed, eps=1.35)
        n = len(simplified)
        if n < 4:
            continue
        scaled = [(p[0] * scale, p[1] * scale) for p in simplified]
        cmds = [f"M{scaled[0][0]:.2f},{scaled[0][1]:.2f}"]
        # Catmull-Rom to Cubic Bezier conversion for smooth closed curve
        for i in range(n):
            p0 = scaled[(i - 1) % n]
            p1 = scaled[i]
            p2 = scaled[(i + 1) % n]
            p3 = scaled[(i + 2) % n]
            c1x = p1[0] + (p2[0] - p0[0]) / 6.0
            c1y = p1[1] + (p2[1] - p0[1]) / 6.0
            c2x = p2[0] - (p3[0] - p1[0]) / 6.0
            c2y = p2[1] - (p3[1] - p1[1]) / 6.0
            cmds.append(
                f"C{c1x:.2f},{c1y:.2f} {c2x:.2f},{c2y:.2f} {p2[0]:.2f},{p2[1]:.2f}"
            )
        cmds.append("Z")
        path_parts.append(" ".join(cmds))

    return " ".join(path_parts)


def main():
    if not REF_CLEAN_IMAGE or not os.path.isfile(REF_CLEAN_IMAGE):
        raise SystemExit(
            "❌ 未提供参考笑脸原图：请设置环境变量 EP_REF_SMILEY 指向该 jpg 文件。\n"
            f"   当前值：{REF_CLEAN_IMAGE!r}"
        )
    alpha_mask = extract_clean_alpha_mask(REF_CLEAN_IMAGE)
    os.makedirs(BRANDING_ASSETS_DIR, exist_ok=True)

    # 1. Generate 1024x1024 Dark & Light Brand Icons (for Notification Album Art & Preview)
    dark_icon_1024 = render_tinted_smiley(
        alpha_mask,
        canvas_size=1024,
        fg_rgb=DARK_ACCENT,
        bg_rgba=(*DARK_BG, 255),
        smiley_scale=0.72,
    )
    light_icon_1024 = render_tinted_smiley(
        alpha_mask,
        canvas_size=1024,
        fg_rgb=LIGHT_ACCENT,
        bg_rgba=(*LIGHT_BG, 255),
        smiley_scale=0.72,
    )

    dark_asset_path = os.path.join(BRANDING_ASSETS_DIR, "brand_icon_dark.png")
    light_asset_path = os.path.join(BRANDING_ASSETS_DIR, "brand_icon_light.png")
    dark_icon_1024.convert("RGB").save(dark_asset_path, "PNG", optimize=True)
    light_icon_1024.convert("RGB").save(light_asset_path, "PNG", optimize=True)

    # Also save preview copies in ARTIFACT_DIR for user review
    dark_icon_1024.convert("RGB").save(
        os.path.join(ARTIFACT_DIR, "brand_icon_dark_preview.png"), "PNG"
    )
    light_icon_1024.convert("RGB").save(
        os.path.join(ARTIFACT_DIR, "brand_icon_light_preview.png"), "PNG"
    )

    # 2. Generate Mipmap Launcher PNGs (Light & Dark)
    mipmap_sizes = {
        "mdpi": 48,
        "hdpi": 72,
        "xhdpi": 96,
        "xxhdpi": 144,
        "xxxhdpi": 192,
    }
    for density, px in mipmap_sizes.items():
        # Light mipmap-<density>
        light_dir = os.path.join(ANDROID_RES, f"mipmap-{density}")
        os.makedirs(light_dir, exist_ok=True)
        light_launcher = render_tinted_smiley(
            alpha_mask,
            canvas_size=px,
            fg_rgb=LIGHT_ACCENT,
            bg_rgba=(*LIGHT_BG, 255),
            smiley_scale=0.70,
        )
        light_launcher.convert("RGB").save(
            os.path.join(light_dir, "ic_launcher.png"), "PNG", optimize=True
        )

        # Dark mipmap-night-<density>
        dark_dir = os.path.join(ANDROID_RES, f"mipmap-night-{density}")
        os.makedirs(dark_dir, exist_ok=True)
        dark_launcher = render_tinted_smiley(
            alpha_mask,
            canvas_size=px,
            fg_rgb=DARK_ACCENT,
            bg_rgba=(*DARK_BG, 255),
            smiley_scale=0.70,
        )
        dark_launcher.convert("RGB").save(
            os.path.join(dark_dir, "ic_launcher.png"), "PNG", optimize=True
        )

    # 3. Generate Splash Screen centered smiley PNGs (Light & Dark) across densities
    # On screen, a 160dp centered splash logo looks balanced and crisp:
    splash_sizes = {
        "mdpi": 160,
        "hdpi": 240,
        "xhdpi": 320,
        "xxhdpi": 480,
        "xxxhdpi": 640,
    }
    for density, px in splash_sizes.items():
        d_light = os.path.join(ANDROID_RES, f"drawable-{density}")
        os.makedirs(d_light, exist_ok=True)
        splash_light = render_tinted_smiley(
            alpha_mask,
            canvas_size=px,
            fg_rgb=LIGHT_ACCENT,
            bg_rgba=(255, 255, 255, 0),
            smiley_scale=0.78,
        )
        splash_light.save(
            os.path.join(d_light, "splash_smiley_logo.png"), "PNG", optimize=True
        )

        d_dark = os.path.join(ANDROID_RES, f"drawable-night-{density}")
        os.makedirs(d_dark, exist_ok=True)
        splash_dark = render_tinted_smiley(
            alpha_mask,
            canvas_size=px,
            fg_rgb=DARK_ACCENT,
            bg_rgba=(0, 0, 0, 0),
            smiley_scale=0.78,
        )
        splash_dark.save(
            os.path.join(d_dark, "splash_smiley_logo.png"), "PNG", optimize=True
        )

    # 4. Trace VectorDrawable path for Adaptive Icon Foreground (108dp x 108dp)
    # and Android 12+ Splash Screen Animated Icon (108dp x 108dp)
    adaptive_path = trace_contours_to_svg_path(
        alpha_mask, viewport_size=108.0, smiley_scale=0.50
    )
    notif_path = trace_contours_to_svg_path(
        alpha_mask, viewport_size=24.0, smiley_scale=0.84
    )
    print(f"Adaptive SVG path length: {len(adaptive_path)} chars")
    print(f"Notification SVG path length: {len(notif_path)} chars")

    # Save Adaptive Icon Foreground VectorDrawable (uses @color/ic_launcher_fg which adapts to Light/Dark!)
    drawable_dir = os.path.join(ANDROID_RES, "drawable")
    drawable_night_dir = os.path.join(ANDROID_RES, "drawable-night")
    os.makedirs(drawable_dir, exist_ok=True)
    os.makedirs(drawable_night_dir, exist_ok=True)

    fg_xml_light = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="@color/ic_launcher_fg"
        android:fillType="evenOdd"
        android:pathData="{adaptive_path}" />
</vector>
"""
    fg_xml_dark = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#1ED760"
        android:fillType="evenOdd"
        android:pathData="{adaptive_path}" />
</vector>
"""
    mono_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
    <path
        android:fillColor="#FFFFFF"
        android:fillType="evenOdd"
        android:pathData="{adaptive_path}" />
</vector>
"""
    stat_xml = f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#FFFFFF"
        android:fillType="evenOdd"
        android:pathData="{notif_path}" />
</vector>
"""
    with open(os.path.join(drawable_dir, "ic_launcher_foreground.xml"), "w") as f:
        f.write(fg_xml_light)
    with open(os.path.join(drawable_night_dir, "ic_launcher_foreground.xml"), "w") as f:
        f.write(fg_xml_dark)
    with open(os.path.join(drawable_dir, "ic_launcher_monochrome.xml"), "w") as f:
        f.write(mono_xml)
    with open(os.path.join(drawable_dir, "ic_stat_smiley.xml"), "w") as f:
        f.write(stat_xml)

    # 5. Create mipmap-anydpi-v26 Adaptive Icon XMLs
    anydpi_dir = os.path.join(ANDROID_RES, "mipmap-anydpi-v26")
    os.makedirs(anydpi_dir, exist_ok=True)
    adaptive_icon_xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_bg" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
"""
    with open(os.path.join(anydpi_dir, "ic_launcher.xml"), "w") as f:
        f.write(adaptive_icon_xml)
    with open(os.path.join(anydpi_dir, "ic_launcher_round.xml"), "w") as f:
        f.write(adaptive_icon_xml)

    print("Successfully generated all brand assets!")


if __name__ == "__main__":
    main()
