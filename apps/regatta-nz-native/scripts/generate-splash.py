#!/usr/bin/env python3
"""Generate Android splash assets for Regatta NZ.

Solid lake teal (#0b3d4a) only — no logo plate. The web cold-start intro
owns the mark + wordmark animation. Android 12+ splash_icon is solid teal
(same as background) so Theme.SplashScreen shows no square/circular badge.
"""
from __future__ import annotations

import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
NATIVE = os.path.abspath(os.path.join(HERE, ".."))
RES = os.path.join(NATIVE, "android", "app", "src", "main", "res")

LAKE = (11, 61, 74, 255)  # #0b3d4a

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


def solid(w: int, h: int) -> Image.Image:
    return Image.new("RGB", (w, h), LAKE[:3])


def invisible_icon(size: int = 1152) -> Image.Image:
    """Solid teal matching splash bg — Android 12+ icon slot stays invisible
    even when the system applies a circular mask / icon background."""
    return Image.new("RGBA", (size, size), LAKE)


def save(path: str, img: Image.Image) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, "PNG")
    print(f"OK {os.path.relpath(path, NATIVE)} {img.size} {img.mode}")


def main() -> None:
    save(os.path.join(RES, "drawable", "splash.png"), solid(480, 320))

    for folder, size in {**PORT, **LAND}.items():
        save(os.path.join(RES, folder, "splash.png"), solid(size[0], size[1]))

    save(os.path.join(RES, "drawable", "splash_icon.png"), invisible_icon(1152))

    preview_dir = os.path.join(NATIVE, "install")
    os.makedirs(preview_dir, exist_ok=True)
    save(os.path.join(preview_dir, "splash-preview-port.png"), solid(1080, 1920))


if __name__ == "__main__":
    main()
