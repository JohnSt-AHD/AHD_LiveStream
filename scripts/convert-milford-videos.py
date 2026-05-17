"""Convert Milford ProRes 4444 (alpha) .mov to transparent VP9 WebM for vMix."""
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

# VP9 + alpha (yuva420p) — required for transparent vMix browser overlays.
# Standard H.264 MP4 cannot preserve alpha.
FFMPEG_WEBM = [
    "-y",
    "-c:v",
    "libvpx-vp9",
    "-pix_fmt",
    "yuva420p",
    "-auto-alt-ref",
    "0",
    "-b:v",
    "0",
    "-crf",
    "30",
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
        out = DST / f"{key}.webm"
        print(f"  {key} <- {fname}")
        subprocess.run(
            ["ffmpeg", "-i", str(src), *FFMPEG_WEBM, str(out)],
            check=True,
        )
        mb = out.stat().st_size / (1024 * 1024)
        print(f"    -> {out.name} ({mb:.2f} MB, alpha)")


if __name__ == "__main__":
    if not SRC.is_dir():
        raise SystemExit(f"Source folder not found: {SRC}")
    print("Milford backgrounds (WebM + alpha):")
    convert()
