"""Extract intro sprites + hold plates for Milford CSS overlays (not lower third)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
VMIX = Path(r"C:\Users\JohnSt\Desktop\RNZ\25 Vmix")
DST = ROOT / "public" / "assets" / "vmix" / "milford"
PROBE = ROOT / "probe-out" / "milford-css"

GRAPHICS = [
    {
        "id": "draw",
        "src": VMIX / "02 Race Draw PROD.mov",
        "intro_s": 4.5,
        "hold_s": 5.5,
        "fps": 12,
    },
    {
        "id": "results",
        "src": VMIX / "05 Race Result BLANK_2.mov",
        "intro_s": 6.0,
        "hold_s": 8.0,
        "fps": 12,
    },
    {
        "id": "leader",
        "src": VMIX / "03 Race Leader 01 RT.mov",
        "intro_s": 3.0,
        "hold_s": 3.5,
        "fps": 30,
    },
    {
        "id": "title",
        "src": VMIX / "01 Title BLANK.mov",
        "intro_s": 5.0,
        "hold_s": 7.0,
        "fps": 12,
    },
    {
        "id": "tracker",
        "src": VMIX / "Milford_Tracker.mov",
        "intro_s": 3.0,
        "hold_s": 3.0,
        "fps": 30,
    },
]


def run_ffmpeg(args: list[str]) -> None:
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], check=True)


def extract_intro_frames(src: Path, out_dir: Path, intro_s: float, fps: int) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    existing = sorted(out_dir.glob("f-*.png"))
    expect = int(round(intro_s * fps))
    if len(existing) >= max(expect - 1, 1):
        return existing[:expect] if expect else existing
    for p in existing:
        p.unlink()
    run_ffmpeg(
        [
            "-i",
            str(src),
            "-vf",
            f"fps={fps}",
            "-t",
            str(intro_s),
            str(out_dir / "f-%03d.png"),
        ]
    )
    return sorted(out_dir.glob("f-*.png"))


def extract_hold(src: Path, out_path: Path, hold_s: float) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    run_ffmpeg(["-ss", str(hold_s), "-i", str(src), "-frames:v", "1", "-update", "1", str(out_path)])


def union_bbox(paths: list[Path], alpha=40) -> tuple[int, int, int, int]:
    xs0 = ys0 = 10_000
    xs1 = ys1 = 0
    for p in paths:
        arr = np.array(Image.open(p).convert("RGBA"))
        opaque = arr[:, :, 3] >= alpha
        if not opaque.any():
            continue
        ys, xs = np.where(opaque)
        xs0 = min(xs0, int(xs.min()))
        ys0 = min(ys0, int(ys.min()))
        xs1 = max(xs1, int(xs.max()) + 1)
        ys1 = max(ys1, int(ys.max()) + 1)
    if xs1 <= xs0:
        return (0, 0, 1920, 1080)
    pad = 4
    left = max(0, xs0 - pad)
    top = max(0, ys0 - pad)
    right = min(1920, xs1 + pad)
    bottom = min(1080, ys1 + pad)
    if (right - left) % 2:
        right = min(1920, right + 1)
    if (bottom - top) % 2:
        bottom = min(1080, bottom + 1)
    return left, top, right, bottom


def build_animated_webp(paths: list[Path], box: tuple[int, int, int, int], webp_path: Path, fps: int) -> dict:
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    tiles = []
    for p in paths:
        arr = np.array(Image.open(p).convert("RGBA"))
        tiles.append(Image.fromarray(arr[top:bottom, left:right], "RGBA"))
    duration = max(int(round(1000 / fps)), 1)
    webp_path.parent.mkdir(parents=True, exist_ok=True)
    tiles[0].save(
        webp_path,
        save_all=True,
        append_images=tiles[1:],
        duration=duration,
        loop=1,
        lossless=False,
        quality=82,
        method=4,
    )
    return {
        "kind": "anim",
        "file": webp_path.name,
        "left": left,
        "top": top,
        "width": width,
        "height": height,
        "frames": len(tiles),
        "durationMs": duration * len(tiles),
        "bytes": webp_path.stat().st_size,
    }


def build_sprite(paths: list[Path], box: tuple[int, int, int, int], webp_path: Path) -> dict:
    left, top, right, bottom = box
    width, height = right - left, bottom - top
    n = len(paths)
    if height * n > 16383 or width > 16383:
        return None
    sprite = Image.new("RGBA", (width, height * n), (0, 0, 0, 0))
    for i, p in enumerate(paths):
        arr = np.array(Image.open(p).convert("RGBA"))
        tile = Image.fromarray(arr[top:bottom, left:right], "RGBA")
        sprite.paste(tile, (0, i * height))
    webp_path.parent.mkdir(parents=True, exist_ok=True)
    sprite.save(webp_path, "WEBP", lossless=False, quality=82, method=4)
    last_y = (n - 1) * height
    return {
        "kind": "sprite",
        "file": webp_path.name,
        "left": left,
        "top": top,
        "width": width,
        "height": height,
        "frames": n,
        "lastY": last_y,
        "spriteHeight": height * n,
        "bytes": webp_path.stat().st_size,
    }


def process(g: dict) -> dict:
    gid = g["id"]
    src = g["src"]
    if not src.is_file():
        raise SystemExit(f"missing {src}")
    print(f"== {gid} <- {src.name}", flush=True)
    frame_dir = PROBE / gid / "intro"
    frames = extract_intro_frames(src, frame_dir, g["intro_s"], g["fps"])
    print(f"  intro frames: {len(frames)}", flush=True)
    hold_raw = PROBE / gid / "hold-full.png"
    extract_hold(src, hold_raw, g["hold_s"])
    hold_dst = DST / f"{gid}-plate.png"
    Image.open(hold_raw).convert("RGBA").save(hold_dst, optimize=True)
    box = union_bbox(frames + ([hold_raw] if hold_raw.is_file() else []))
    webp_path = DST / f"{gid}-intro.webp"
    sprite_meta = build_sprite(frames, box, webp_path)
    if sprite_meta is None:
        sprite_meta = build_animated_webp(frames, box, webp_path, g["fps"])
    duration_ms = sprite_meta.get("durationMs") or round(len(frames) / g["fps"] * 1000)
    steps = max(len(frames) - 1, 1)
    meta = {
        "id": gid,
        "fps": g["fps"],
        "introMs": duration_ms,
        "steps": steps,
        "plate": hold_dst.name,
        "plateBytes": hold_dst.stat().st_size,
        "sprite": sprite_meta,
    }
    print(f"  {meta}", flush=True)
    return meta


def main() -> None:
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found")
    DST.mkdir(parents=True, exist_ok=True)
    wanted = [a for a in __import__("sys").argv[1:] if not a.startswith("-")]
    items = [g for g in GRAPHICS if not wanted or g["id"] in wanted]
    out = {}
    for g in items:
        out[g["id"]] = process(g)
    meta_path = DST / "css-graphics.json"
    existing = {}
    if meta_path.is_file() and wanted:
        existing = json.loads(meta_path.read_text(encoding="utf-8"))
    existing.update(out)
    meta_path.write_text(json.dumps(existing, indent=2), encoding="utf-8")
    print(f"wrote {meta_path}")


if __name__ == "__main__":
    main()
