"""Split LowerT.mov hold frame into editable PNG layers and print intro timing."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\JohnSt\Desktop\RNZ\25 Vmix\LowerT.mov")
HOLD_ALPHA = ROOT / "probe-out" / "lowert" / "hold-alpha.png"
DST = ROOT / "public" / "assets" / "vmix" / "milford"
FRAME_DIR = ROOT / "probe-out" / "lowert" / "rgba-frames"


def is_orange(r, g, b, a) -> bool:
    return a > 40 and r > 160 and g > 40 and g < 190 and b < 90 and r > g + 40


def is_whiteish(r, g, b, a) -> bool:
    return a > 40 and r > 200 and g > 200 and b > 200


def is_navy(r, g, b, a) -> bool:
    if a < 40:
        return False
    if is_orange(r, g, b, a) or is_whiteish(r, g, b, a):
        return False
    return b >= r and b >= g and r < 90 and g < 90 and b < 140


def extract_frames() -> list[Path]:
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    existing = sorted(FRAME_DIR.glob("frame-*.png"))
    if len(existing) >= 60:
        return existing
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found")
    if not SRC.is_file():
        raise SystemExit(f"missing {SRC}")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(SRC),
            "-vsync",
            "0",
            str(FRAME_DIR / "frame-%02d.png"),
        ],
        check=True,
    )
    return sorted(FRAME_DIR.glob("frame-*.png"))


def load_hold() -> Image.Image:
    if HOLD_ALPHA.is_file():
        im = Image.open(HOLD_ALPHA).convert("RGBA")
        if im.size == (1920, 1080):
            return im
    frames = extract_frames()
    # 1.5s at 30fps = frame 46 (1-based)
    return Image.open(frames[min(45, len(frames) - 1)]).convert("RGBA")


def split_layers(hold: Image.Image) -> dict[str, Image.Image]:
    arr = np.array(hold)
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    h, w = a.shape
    opaque = a >= 40
    orange = opaque & (r > 160) & (g > 40) & (g < 190) & (b < 90) & (r > (g + 40))
    white = opaque & (r > 200) & (g > 200) & (b > 200)
    navy = opaque & ~orange & ~white & (b >= r) & (b >= g) & (r < 90) & (g < 90) & (b < 140)

    yy, xx = np.ogrid[:h, :w]
    corner_mask = opaque & (yy < 420) & (xx > 1400)
    lower = opaque & (yy >= 760) & ~corner_mask
    bar_band = lower & (yy >= 932) & (yy <= 1008) & (xx >= 290)
    bars_mask = bar_band & (orange | white)
    for y in range(932, 1009):
        xs = np.where(bars_mask[y])[0]
        if xs.size == 0:
            continue
        x0, x1 = int(xs.min()), int(xs.max())
        bars_mask[y, x0 : x1 + 1] = lower[y, x0 : x1 + 1]

    logo_box = lower & (xx < 282) & ~bars_mask
    logo_art_mask = logo_box & ~navy
    dock_shape = logo_box
    navy_px = arr[logo_box & navy]
    if len(navy_px):
        fill = np.median(navy_px, axis=0).astype(np.uint8)
    else:
        fill = np.array([12, 18, 32, 255], dtype=np.uint8)
    dock_arr = np.zeros_like(arr)
    dock_arr[dock_shape] = fill
    mountains_mask = lower & ~logo_box & ~bars_mask

    def layer(mask: np.ndarray) -> Image.Image:
        out = np.zeros_like(arr)
        out[mask] = arr[mask]
        return Image.fromarray(out, "RGBA")

    return {
        "mountains": layer(mountains_mask),
        "logo-dock": Image.fromarray(dock_arr, "RGBA"),
        "logo-art": layer(logo_art_mask),
        "bars": layer(bars_mask),
        "plate": hold,
    }


def crop_opaque(im: Image.Image, pad: int = 2) -> tuple[Image.Image, tuple[int, int, int, int]]:
    bbox = im.getbbox()
    if not bbox:
        return im, (0, 0, im.size[0], im.size[1])
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(im.size[0], r + pad)
    b = min(im.size[1], b + pad)
    return im.crop((l, t, r, b)), (l, t, r, b)


def analyze_frames(paths: list[Path]) -> list[dict]:
    rows = []
    xs = None
    for i, p in enumerate(paths):
        arr = np.array(Image.open(p).convert("RGBA"))
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
        h, w = a.shape
        if xs is None:
            xs = np.arange(w)[None, :]
        opaque = a >= 16
        orange = opaque & (r > 160) & (g > 40) & (g < 190) & (b < 90) & (r > g + 40)
        white = opaque & (r > 200) & (g > 200) & (b > 200)
        navy = (
            opaque
            & ~orange
            & ~white
            & (b >= r)
            & (b >= g)
            & (r < 90)
            & (g < 90)
            & (b < 140)
        )
        bar_orange = orange[920:, :]
        bar_white = white[920:, 270:]
        max_x = int(xs[:, opaque.any(axis=0)].max()) if opaque.any() else 0
        t = i / 30.0
        row = {
            "i": i + 1,
            "t": round(t, 3),
            "opaque": int(opaque.sum()),
            "max_x": max_x,
            "orange": int(orange.sum()),
            "white": int(white.sum()),
            "navy": int(navy.sum()),
            "bar_orange": int(bar_orange.sum()),
            "bar_white": int(bar_white.sum()),
        }
        rows.append(row)
        print(
            f"t={t:4.2f}s  opaque={row['opaque']:6d}  max_x={row['max_x']:4d}  "
            f"navy={row['navy']:6d}  orange={row['orange']:5d}  "
            f"bar_or={row['bar_orange']:4d}  bar_wh={row['bar_white']:4d}",
            flush=True,
        )
    return rows


def build_intro_sprite(paths: list[Path]) -> None:
    """Vertical sprite of the 1.5s intro (45 frames @ 30fps) cropped to the plate."""
    if len(paths) < 46:
        raise SystemExit(f"need 46 frames, got {len(paths)}")
    intro = paths[:45]
    xs0 = ys0 = 9999
    xs1 = ys1 = 0
    arrays = []
    for p in intro:
        arr = np.array(Image.open(p).convert("RGBA"))
        arrays.append(arr)
        opaque = arr[:, :, 3] >= 40
        if not opaque.any():
            continue
        ys, xs = np.where(opaque)
        xs0 = min(xs0, int(xs.min()))
        ys0 = min(ys0, int(ys.min()))
        xs1 = max(xs1, int(xs.max()) + 1)
        ys1 = max(ys1, int(ys.max()) + 1)
    pad = 4
    left = max(0, xs0 - pad)
    top = max(0, ys0 - pad)
    right = min(1920, xs1 + pad)
    bottom = min(1080, ys1 + pad)
    # snap to even sizes for webp
    width = right - left
    height = bottom - top
    if width % 2:
        right = min(1920, right + 1)
        width += 1
    if height % 2:
        bottom = min(1080, bottom + 1)
        height += 1
    n = len(arrays)
    sprite = Image.new("RGBA", (width, height * n), (0, 0, 0, 0))
    for i, arr in enumerate(arrays):
        tile = Image.fromarray(arr[top:bottom, left:right], "RGBA")
        sprite.paste(tile, (0, i * height))
    png_path = DST / "lower-intro-sprite.png"
    webp_path = DST / "lower-intro-sprite.webp"
    sprite.save(png_path, optimize=True)
    sprite.save(webp_path, "WEBP", lossless=True, quality=100, method=6)
    meta = {
        "filePng": png_path.name,
        "fileWebp": webp_path.name,
        "left": left,
        "top": top,
        "width": width,
        "height": height,
        "frames": n,
        "fps": 30,
        "durationMs": round(n / 30 * 1000),
        "pngBytes": png_path.stat().st_size,
        "webpBytes": webp_path.stat().st_size,
    }
    (ROOT / "probe-out" / "lowert" / "intro-sprite.json").write_text(
        json.dumps(meta, indent=2),
        encoding="utf-8",
    )
    print(f"sprite: {meta}", flush=True)


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    if "--sprite" in sys.argv:
        build_intro_sprite(extract_frames())
        return
    hold = load_hold()
    hold.save(DST / "lower-plate.png")
    layers = split_layers(hold)
    meta = {}
    for name in ("mountains", "logo-dock", "logo-art", "bars"):
        cropped, box = crop_opaque(layers[name])
        out = DST / f"lower-{name}.png"
        cropped.save(out)
        meta[name] = {
            "file": out.name,
            "left": box[0],
            "top": box[1],
            "width": box[2] - box[0],
            "height": box[3] - box[1],
            "bytes": out.stat().st_size,
        }
        print(f"{name}: {meta[name]}", flush=True)

    skip_timing = "--layers-only" in sys.argv
    frames = []
    if not skip_timing:
        try:
            frames = extract_frames()
        except Exception as e:
            print(f"frame extract skipped: {e}", file=sys.stderr)
    timing = analyze_frames(frames) if frames else []
    payload = {"layers": meta, "timing": timing}
    out_json = ROOT / "probe-out" / "lowert" / "layer-timing.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {DST}")
    print(f"wrote {out_json}")


if __name__ == "__main__":
    main()
