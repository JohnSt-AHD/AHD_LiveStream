"""Tighten crop so the CrewSight circle fills the square (less white margin)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/assets/crewsight/crewsight-logo-icon-only-color.png"
OUT = ROOT / "public/regatta-nz/assets"


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img)
    rgb = arr[:, :, :3].astype(np.float32)
    bg = rgb[10, 10]
    dist = np.linalg.norm(rgb - bg, axis=2)
    mask = dist > 22
    ys, xs = np.where(mask)
    cx = (xs.min() + xs.max()) / 2.0
    cy = (ys.min() + ys.max()) / 2.0
    radii = np.sqrt((xs.astype(np.float64) - cx) ** 2 + (ys.astype(np.float64) - cy) ** 2)
    # Use 99.8 percentile so notches (outermost ink) are included
    r = float(np.percentile(radii, 99.8))
    # Very tight pad — circle nearly fills square
    pad = max(2, int(r * 0.012))
    half = int(np.ceil(r)) + pad
    left = int(round(cx)) - half
    top = int(round(cy)) - half
    crop = arr[top : top + 2 * half, left : left + 2 * half].copy()
    print("crop", crop.shape, "r", r, "pad", pad)

    soft = Image.fromarray(crop, "RGBA")
    soft = soft.filter(ImageFilter.MedianFilter(size=3))
    soft = soft.filter(ImageFilter.GaussianBlur(radius=0.35))
    srgb = np.array(soft)[:, :, :3].astype(np.float32)
    ink = np.linalg.norm(srgb - bg, axis=2)
    lo = np.percentile(ink, 2)
    hi = np.percentile(ink, 98)
    ink = np.clip((ink - lo) / max(1e-6, hi - lo), 0, 1)

    def render(size: int, hard: float = 0.30) -> Image.Image:
        a_lo, a_hi = hard - 0.09, hard + 0.09
        a = np.clip((ink - a_lo) / (a_hi - a_lo), 0, 1)
        a = a * a * (3 - 2 * a)
        g = (255 * (1 - a)).astype(np.uint8)
        im = Image.fromarray(g, "L").resize((size, size), Image.Resampling.LANCZOS)
        g2 = np.array(im).astype(np.float32)
        t = np.clip((g2 - 50) / 155, 0, 1)
        t = t * t * (3 - 2 * t)
        out = (255 * t).astype(np.uint8)
        # Pure white outside the circle (tiny margin)
        side = size
        yy, xx = np.ogrid[:side, :side]
        rr = np.sqrt((xx - (side - 1) / 2) ** 2 + (yy - (side - 1) / 2) ** 2)
        out[rr > side * 0.502] = 255
        return Image.fromarray(np.dstack([out, out, out]), "RGB")

    master = render(512)
    master.save(OUT / "crewsight-mark-bw-512.png", optimize=True)
    for s in (256, 128):
        render(s).save(OUT / f"crewsight-mark-bw-{s}.png", optimize=True)
    render(256).save(OUT / "crewsight-mark-bw.webp", "WEBP", quality=94, method=6)

    # Teal: white ink on #0b3d4a
    bw = render(256)
    g = np.array(bw.convert("L")).astype(np.float32) / 255.0
    ink_w = 1.0 - g
    teal = np.array([11.0, 61.0, 74.0])
    white = np.array([255.0, 255.0, 255.0])
    rgb_t = teal + (white - teal) * ink_w[..., None]
    Image.fromarray(np.clip(rgb_t, 0, 255).astype(np.uint8), "RGB").save(
        OUT / "crewsight-mark-teal-256.png", optimize=True
    )

    # Preview sheet
    sheet = Image.new("RGB", (560, 200), (11, 61, 74))
    a44 = render(256).resize((44, 44), Image.Resampling.LANCZOS)
    a52 = render(256).resize((52, 52), Image.Resampling.LANCZOS)
    teal44 = Image.open(OUT / "crewsight-mark-teal-256.png").resize((44, 44), Image.Resampling.LANCZOS)
    for im, x, y, plate in [
        (a44, 20, 40, True),
        (a52, 90, 36, True),
        (teal44, 170, 40, False),
        (render(256).resize((128, 128), Image.Resampling.LANCZOS), 250, 20, True),
    ]:
        if plate:
            from PIL import ImageDraw
            d = ImageDraw.Draw(sheet)
            d.rounded_rectangle((x - 2, y - 2, x + im.size[0] + 1, y + im.size[1] + 1), 10, fill=(255, 255, 255))
        sheet.paste(im, (x, y))
    sheet.save(OUT / "_mark-preview-tight.png")
    print("done")


if __name__ == "__main__":
    main()
