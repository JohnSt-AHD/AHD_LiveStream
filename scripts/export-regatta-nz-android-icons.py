"""
Build Regatta NZ Android launcher icons from the B&W CrewSight mark
(same asset / crop as the app topbar).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public/regatta-nz/assets/crewsight-mark-bw-512.png"
RES = ROOT / "apps/regatta-nz-native/android/app/src/main/res"

# Legacy launcher / round sizes (px)
LEGACY = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive foreground canvas (px)
FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}

# Mark diameter as a fraction of the icon canvas (0.5 = half previous full-bleed size).
MARK_SCALE = 0.5


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def centered_mark(
    src: Image.Image,
    canvas: int,
    *,
    bg: tuple[int, int, int, int] | None,
) -> Image.Image:
    """Place the mark at MARK_SCALE of canvas, centered on bg (or transparent)."""
    mark_px = max(1, int(round(canvas * MARK_SCALE)))
    logo = src.resize((mark_px, mark_px), Image.Resampling.LANCZOS)
    if bg is None:
        out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    else:
        out = Image.new("RGBA", (canvas, canvas), bg)
    x = (canvas - mark_px) // 2
    y = (canvas - mark_px) // 2
    out.paste(logo, (x, y), logo)
    return out


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source mark: {SRC}")

    mark = Image.open(SRC).convert("RGBA")
    print(f"source {SRC.name} {mark.size} scale={MARK_SCALE}")

    white = (255, 255, 255, 255)
    for folder, size in LEGACY.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        icon = centered_mark(mark, size, bg=white)
        icon.save(out_dir / "ic_launcher.png", optimize=True)

        round_icon = icon.copy()
        round_icon.putalpha(circle_mask(size))
        plate = Image.new("RGBA", (size, size), white)
        plate = Image.alpha_composite(plate, round_icon)
        plate.save(out_dir / "ic_launcher_round.png", optimize=True)

    for folder, size in FOREGROUND.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        # Transparent canvas; white adaptive background shows around the mark
        fg = centered_mark(mark, size, bg=None)
        fg.save(out_dir / "ic_launcher_foreground.png", optimize=True)

    print("wrote launcher icons under", RES)
    print("adaptive background remains #FFFFFF")


if __name__ == "__main__":
    main()
