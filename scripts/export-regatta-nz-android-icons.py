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

# Adaptive foreground canvas (px) — content fills like CrewSight mark
FOREGROUND = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def circle_mask(size: int) -> Image.Image:
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size - 1, size - 1), fill=255)
    return m


def resize_cover(src: Image.Image, size: int) -> Image.Image:
    return src.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    if not SRC.is_file():
        raise SystemExit(f"Missing source mark: {SRC}")

    mark = Image.open(SRC).convert("RGBA")
    print(f"source {SRC.name} {mark.size}")

    for folder, size in LEGACY.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        icon = resize_cover(mark, size)
        icon.save(out_dir / "ic_launcher.png", optimize=True)

        round_icon = icon.copy()
        round_icon.putalpha(circle_mask(size))
        # Composite onto white so round PNG stays opaque where needed
        plate = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        plate = Image.alpha_composite(plate, round_icon)
        plate.save(out_dir / "ic_launcher_round.png", optimize=True)

    for folder, size in FOREGROUND.items():
        out_dir = RES / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        # Full-bleed mark on transparent canvas (white adaptive bg behind)
        fg = resize_cover(mark, size)
        fg.save(out_dir / "ic_launcher_foreground.png", optimize=True)

    print("wrote launcher icons under", RES)
    print("adaptive background remains #FFFFFF")


if __name__ == "__main__":
    main()
