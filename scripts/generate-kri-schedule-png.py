#!/usr/bin/env python3
"""Generate KRI vMix schedule background (1920×1080) from draw.png theme."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DRAW_PATH = ROOT / "public/assets/vmix/kri/draw.png"
OUT_PATH = ROOT / "public/assets/vmix/kri/schedule.png"

W, H = 1920, 1080

# Match vmix-graphics.css schedule grid (left 156, cols 88+108+flex+140, gap 14).
COL_LEFT = 156
COL_GAP = 14
COL_TIME_W = 88
COL_RACE_W = 108
COL_ROUND_W = 140
LIST_W = 980
COL_EVENT_W = LIST_W - COL_TIME_W - COL_RACE_W - COL_ROUND_W - (3 * COL_GAP)

COL_TIME_X = COL_LEFT
COL_RACE_X = COL_TIME_X + COL_TIME_W + COL_GAP
COL_EVENT_X = COL_RACE_X + COL_RACE_W + COL_GAP
COL_ROUND_X = COL_EVENT_X + COL_EVENT_W + COL_GAP

DIVIDER_Y = 349
HEADER_Y = 382
ROW_START_Y = 434
ROW_H = 48
ROW_COUNT = 10


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if bold:
        candidates += [
            "C:/Windows/Fonts/segoeuib.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        ]
    else:
        candidates += [
            "C:/Windows/Fonts/segoeui.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def sample_gradient_column(src: Image.Image, x: int, y0: int, y1: int) -> list[tuple[int, int, int, int]]:
    return [src.getpixel((x, y)) for y in range(y0, y1)]


def paint_gradient_rect(
    img: Image.Image,
    box: tuple[int, int, int, int],
    column: list[tuple[int, int, int, int]],
) -> None:
    x0, y0, x1, y1 = box
    if not column:
        return
    pixels = img.load()
    for y in range(y0, y1):
        idx = min(y - y0, len(column) - 1)
        color = column[idx]
        for x in range(x0, x1):
            pixels[x, y] = color


def draw_label(
    draw: ImageDraw.ImageDraw,
    text: str,
    x: int,
    y: int,
    font: ImageFont.ImageFont,
    fill: tuple[int, int, int, int] = (255, 255, 255, 191),
) -> None:
    draw.text((x, y), text, font=font, fill=fill)


def main() -> None:
    src = Image.open(DRAW_PATH).convert("RGBA")
    img = src.copy()
    draw = ImageDraw.Draw(img)

    # Restore panel gradient over lane numbers / circles (keep border + logo intact).
    gradient = sample_gradient_column(src, 400, ROW_START_Y, ROW_START_Y + ROW_COUNT * ROW_H + 20)
    paint_gradient_rect(img, (120, ROW_START_Y - 8, 1140, ROW_START_Y + ROW_COUNT * ROW_H + 12), gradient)

    # Replace START LIST kicker with SCHEDULE (same position).
    paint_gradient_rect(img, (120, 160, 560, 222), sample_gradient_column(src, 200, 160, 222))
    kicker_font = load_font(18, bold=True)
    draw_label(draw, "SCHEDULE", 156, 177, kicker_font)

    # Replace LANE label area with column headers.
    paint_gradient_rect(img, (120, 360, 1140, ROW_START_Y - 4), sample_gradient_column(src, 400, 360, ROW_START_Y - 4))
    header_font = load_font(16, bold=True)
    header_fill = (255, 255, 255, 170)
    draw_label(draw, "TIME", COL_TIME_X, HEADER_Y, header_font, header_fill)
    draw_label(draw, "RACE", COL_RACE_X, HEADER_Y, header_font, header_fill)
    draw_label(draw, "EVENT", COL_EVENT_X, HEADER_Y, header_font, header_fill)
    round_bbox = draw.textbbox((0, 0), "ROUND", font=header_font)
    round_w = round_bbox[2] - round_bbox[0]
    draw_label(draw, "ROUND", COL_ROUND_X + COL_ROUND_W - round_w, HEADER_Y, header_font, header_fill)

    # Subtle row guides (HTML rows sit on top; lines help alignment in dev).
    line_fill = (255, 255, 255, 36)
    for i in range(1, ROW_COUNT + 1):
        y = ROW_START_Y + i * ROW_H
        draw.line((COL_LEFT, y, COL_LEFT + LIST_W, y), fill=line_fill, width=1)

    img.save(OUT_PATH, optimize=True)
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
