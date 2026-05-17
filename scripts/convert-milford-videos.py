"""Convert Milford ProRes .mov backgrounds to web H.264 MP4."""
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "Milford"
DST = ROOT / "public" / "assets" / "vmix" / "milford"

FILES = {
    "title": "01 Title BLANK.mov",
    "draw": "02 Race Draw PROD.mov",
    "lower": "LowerT.mov",
    "results": "Milford_Results.mov",
    "on-hold": "On_hold.mov",
}

FFMPEG = [
    "-y",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
]


def convert():
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg not found on PATH")

    DST.mkdir(parents=True, exist_ok=True)
    for key, fname in FILES.items():
        src = SRC / fname
        if not src.is_file():
            print(f"  skip {key}: missing {fname}")
            continue
        out = DST / f"{key}.mp4"
        print(f"  {key} <- {fname}")
        subprocess.run(
            ["ffmpeg", "-i", str(src), *FFMPEG, str(out)],
            check=True,
        )
        mb = out.stat().st_size / (1024 * 1024)
        print(f"    -> {out.name} ({mb:.1f} MB)")


if __name__ == "__main__":
    if not SRC.is_dir():
        raise SystemExit(f"Source folder not found: {SRC}")
    print("Milford backgrounds:")
    convert()
