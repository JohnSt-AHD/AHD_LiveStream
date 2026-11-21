"""Export the domestic premier 1X top-4 chart to PNG, SVG, PDF, and Excel."""

from __future__ import annotations

import csv
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter, MultipleLocator
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Font

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "public" / "data" / "nz-domestic-prm-1x-top4-history.csv"
OUT_DIR = ROOT / "public" / "data"
STEM = "nz-domestic-prm-1x-top4-chart"
XLSX = OUT_DIR / "nz-domestic-prm-1x-top4-history.xlsx"

MEN = "#d97706"
WOMEN = "#2563eb"
INK = "#1f2937"
MUTED = "#6b7280"
GRID = "#e5e7eb"
PAPER = "#ffffff"


def fmt_clock(seconds: float) -> str:
    m = int(seconds // 60)
    s = int(round(seconds - m * 60))
    if s == 60:
        m += 1
        s = 0
    return f"{m}:{s:02d}"


def load_series() -> dict[str, list[dict]]:
    by_g: dict[str, list[dict]] = {"Men": [], "Women": []}
    with CSV.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            by_g[row["gender"]].append(
                {
                    "year": int(row["year"]),
                    "mean": float(row["mean_s"]),
                    "sd": float(row["sd_s"]),
                }
            )
    for rows in by_g.values():
        rows.sort(key=lambda r: r["year"])
    return by_g


def draw(series: dict[str, list[dict]]) -> plt.Figure:
    plt.rcParams.update(
        {
            "font.family": "Segoe UI",
            "font.size": 11,
            "axes.edgecolor": GRID,
            "axes.labelcolor": INK,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "text.color": INK,
        }
    )
    fig, ax = plt.subplots(figsize=(12.5, 7.2), dpi=160, facecolor=PAPER)
    ax.set_facecolor(PAPER)

    styles = {
        "Men": MEN,
        "Women": WOMEN,
    }
    for gender, color in styles.items():
        rows = series[gender]
        years = [r["year"] for r in rows]
        means = [r["mean"] for r in rows]
        lo = [r["mean"] - r["sd"] for r in rows]
        hi = [r["mean"] + r["sd"] for r in rows]
        ax.fill_between(years, lo, hi, color=color, alpha=0.18, linewidth=0, zorder=2)
        ax.plot(years, means, color=color, linewidth=2.2, marker="o", markersize=5.5, zorder=3, label=gender)

    ax.plot([], [], color=MUTED, linewidth=8, alpha=0.25, label="±1 sample SD of the top 4")

    ax.set_title(
        "NZ domestic premier singles, top-4 mean",
        loc="left",
        fontsize=16,
        fontweight="semibold",
        color=INK,
        pad=10,
    )
    ax.set_xlabel("Season (NZ champs year)")
    ax.set_ylabel("Time (min:sec)")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _p: fmt_clock(v)))
    ax.yaxis.set_major_locator(MultipleLocator(20))
    ax.set_xticks(list(range(2007, 2027, 1)))
    ax.set_xlim(2006.6, 2026.4)
    ax.tick_params(axis="x", labelrotation=60, labelsize=9)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.grid(axis="x", color=GRID, linewidth=0.5, alpha=0.7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, loc="upper left", ncol=3, fontsize=10)
    fig.text(
        0.01,
        0.015,
        "Fastest 2000 m per sculler across NZ champs, Town Cup, NICC, and Christmas. Band is ±1 sample SD of the top 4. Source: rowit.nz  ·  Open M/W Prm 1X  ·  Lower is faster  ·  2022 is NZ champs only",
        fontsize=8.5,
        color=MUTED,
    )
    fig.tight_layout(rect=(0, 0.04, 1, 0.96))
    return fig


def main() -> None:
    series = load_series()
    fig = draw(series)
    png = OUT_DIR / f"{STEM}.png"
    svg = OUT_DIR / f"{STEM}.svg"
    pdf = OUT_DIR / f"{STEM}.pdf"
    fig.savefig(png, dpi=200)
    fig.savefig(svg)
    fig.savefig(pdf)
    plt.close(fig)

    if XLSX.exists():
        wb = load_workbook(XLSX)
        if "Chart" in wb.sheetnames:
            del wb["Chart"]
        ws = wb.create_sheet("Chart", 0)
        ws["A1"] = "NZ domestic premier singles, top-4 mean"
        ws["A1"].font = Font(bold=True, size=14)
        ws["A2"] = "Embedded PNG of the season chart. Source files also saved as PNG, SVG, and PDF next to this workbook."
        img = XLImage(str(png))
        img.width = 960
        img.height = 550
        ws.add_image(img, "A4")
        ws.column_dimensions["A"].width = 24
        wb.save(XLSX)

    print("wrote", png)
    print("wrote", svg)
    print("wrote", pdf)
    print("updated", XLSX)


if __name__ == "__main__":
    main()
