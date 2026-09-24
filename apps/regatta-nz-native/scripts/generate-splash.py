#!/usr/bin/env python3
"""Generate Android splash + splash-icon assets for Regatta NZ.

Uses store app-icon mark on lake teal (#0b3d4a) so launch matches the web UI.
Requires Pillow. Run from repo or any cwd.
"""
from __future__ import annotations

import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.abspath(os.path.join(HERE, ".."))
RES = os.path.join(NATIVE, "android", "app", "src", "main", "res")
REPO = os.path.abspath(os.path.join(NATIVE, "..", ".."))
ICON_SRC = os.path.join(REPO, "public", "regatta-nz", "store", "assets", "app-icon-512.png")
MARK_SRC = os.path.join(REPO, "public", "regatta-nz", "assets", "crewsight-mark-bw-512.png")

LAKE = (11, 61, 74, 255)  # #0b3d4a
WHITE = (255, 255, 255, 255)

# Capacitor / Android legacy density splash sizes
PORT = {
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}
LAND = {
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}


def mark_on_transparent(path: str) -> Image.Image:
    im = Image.open(path).convert("RGBA")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, _a = px[x, y]
            lum = (r + g + b) / 3
            if lum > 240:
                px[x, y] = (0, 0, 0, 0)
            else:
                alpha = int(min(255, (255 - lum) * 1.15))
                px[x, y] = (17, 17, 17, alpha)
    return im


def fit(im: Image.Image, box: tuple[int, int]) -> Image.Image:
    mw, mh = im.size
    bw, bh = box
    scale = min(bw / mw, bh / mh)
    nw, nh = max(1, int(mw * scale)), max(1, int(mh * scale))
    return im.resize((nw, nh), Image.Resampling.LANCZOS)


def plate_mark(mark: Image.Image, plate: int) -> Image.Image:
    """White circular plate with dark mark — matches store app icon."""
    out = Image.new("RGBA", (plate, plate), (0, 0, 0, 0))
    d = Image.new("RGBA", (plate, plate), (0, 0, 0, 0))
    from PIL import ImageDraw

    draw = ImageDraw.Draw(d)
    draw.ellipse([0, 0, plate - 1, plate - 1], fill=WHITE)
    inner = int(plate * 0.78)
    fitted = fit(mark, (inner, inner))
    d.paste(fitted, ((plate - fitted.width) // 2, (plate - fitted.height) // 2), fitted)
    return d


def build_fullscreen(w: int, h: int, plate_img: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), LAKE)
    # ~38% of short side — readable but not cramped on phones
    target = int(min(w, h) * 0.38)
    logo = fit(plate_img, (target, target))
    canvas.paste(logo, ((w - logo.width) // 2, (h - logo.height) // 2), logo)
    return canvas.convert("RGB")


def build_splash_icon(plate_img: Image.Image, size: int = 1152) -> Image.Image:
    """Android 12+ animated splash icon (transparent canvas, centered mark)."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Safe zone ~66% of icon (Android 12 splash icon guidelines)
    inner = int(size * 0.66)
    logo = fit(plate_img, (inner, inner))
    canvas.paste(logo, ((size - logo.width) // 2, (size - logo.height) // 2), logo)
    return canvas


def save(path: str, img: Image.Image) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    print(f"OK {os.path.relpath(path, NATIVE)} {img.size} {img.mode}")


def main() -> None:
    if os.path.isfile(ICON_SRC):
        # Prefer store icon: crop to circular content by using full icon on teal
        # (already branded). For plate we rebuild from mark for transparency.
        pass
    if not os.path.isfile(MARK_SRC):
        raise SystemExit(f"Missing mark: {MARK_SRC}")

    mark = mark_on_transparent(MARK_SRC)
    plate = plate_mark(mark, 512)

    # Default / legacy drawable
    save(os.path.join(RES, "drawable", "splash.png"), build_fullscreen(480, 320, plate))

    for folder, size in {**PORT, **LAND}.items():
        save(os.path.join(RES, folder, "splash.png"), build_fullscreen(size[0], size[1], plate))

    # Android 12+ splash icon (single density; system scales)
    icon = build_splash_icon(plate, 1152)
    save(os.path.join(RES, "drawable", "splash_icon.png"), icon)

    # Optional preview next to script outputs
    preview_dir = os.path.join(NATIVE, "install")
    os.makedirs(preview_dir, exist_ok=True)
    save(os.path.join(preview_dir, "splash-preview-port.png"), build_fullscreen(1080, 1920, plate))


if __name__ == "__main__":
    main()
