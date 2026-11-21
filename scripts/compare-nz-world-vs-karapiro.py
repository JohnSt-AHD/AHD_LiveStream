"""Compare Karāpiro premier course times with NZ World Cup / Worlds / Olympic bests."""

from __future__ import annotations

import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
KARA = ROOT / "public" / "data" / "karapiro-premier-fastest.csv"
WORLD = ROOT / "public" / "data" / "nz-fastest-world-rowing.csv"
OUT_XLSX = ROOT / "public" / "data" / "nz-world-vs-karapiro.xlsx"
OUT_CSV = ROOT / "public" / "data" / "nz-world-vs-karapiro.csv"

# World Rowing class -> Karāpiro premier event code
MAP = {
    "M1x": "M Prm 1X",
    "LM1x": "M Prm 1X (L)",
    "M2-": "M Prm 2-",
    "LM2-": "M Prm 2- (L)",
    "M2x": "M Prm 2X",
    "LM2x": "M Prm 2X (L)",
    "M4-": "M Prm 4-",
    "M4+": "M Prm 4+",
    "M4x": "M Prm 4X-",
    "M8+": "M Prm 8+",
    "W1x": "W Prm 1X",
    "LW1x": "W Prm 1X (L)",
    "W2-": "W Prm 2-",
    "W2x": "W Prm 2X",
    "LW2x": "W Prm 2X (L)",
    "W4-": "W Prm 4-",
    "W4x": "W Prm 4X-",
    "W8+": "W Prm 8+",
}

ORDER = list(MAP.keys())


def parse_time(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s:
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(s)
    except ValueError:
        return None


def fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    s = seconds % 60
    return f"{m}:{s:05.2f}"


def fmt_delta(world: float, kara: float) -> str:
    d = world - kara
    sign = "+" if d > 0 else ""
    return f"{sign}{d:.2f}"


def load_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def main():
    kara_rows = {r["event"]: r for r in load_csv(KARA) if r.get("event")}
    world_rows = {r["boat_class"]: r for r in load_csv(WORLD) if r.get("boat_class")}

    rows = []
    for wc in ORDER:
        kcode = MAP[wc]
        w = world_rows.get(wc, {})
        k = kara_rows.get(kcode, {})
        wt = parse_time(w.get("time", ""))
        kt = parse_time(k.get("time", ""))
        club = (k.get("club_code") or "").upper()
        foreign = bool(club) and not club.startswith(("RNZ", "RPC", "NZL")) and club not in {
            "WKOC", "NSHC", "HWBC", "WRAC", "CAMC",
        }
        # Club codes that are clearly not NZ high performance still count as Karāpiro times.
        # Flag non-NZ nations (SUI, AUS, etc.)
        foreign = club.startswith("H") and club[1:].isalpha() and club in {"HSUI", "HAUS", "HGBR"}
        if club.startswith("H") and len(club) == 4:
            foreign = True
        faster = ""
        delta = ""
        if wt is not None and kt is not None:
            delta = fmt_delta(wt, kt)
            faster = "World Rowing NZ" if wt < kt else ("Karāpiro" if kt < wt else "equal")
        rows.append(
            {
                "boat_class": wc,
                "karapiro_event": kcode,
                "faster": faster,
                "delta_s_world_minus_karapiro": delta,
                "world_time": w.get("time") or "",
                "karapiro_time": fmt_time(kt) if kt else (k.get("time") or ""),
                "world_crew": w.get("crew") or "",
                "karapiro_crew": k.get("athlete_names") or k.get("crew") or "",
                "world_where": f"{w.get('competition', '')} · {w.get('race', '')}".strip(" ·"),
                "karapiro_where": f"{k.get('regatta', '')} · {k.get('round', '')}".strip(" ·"),
                "world_year": w.get("year") or "",
                "karapiro_year": k.get("year") or "",
                "karapiro_note": "Not an NZ crew" if foreign else "",
            }
        )

    unmatched_world = [c for c in world_rows if c not in MAP]
    unmatched_kara = [e for e in kara_rows if e not in MAP.values() and "U20" not in e and "U22" not in e]

    fields = list(rows[0].keys()) if rows else []
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)

    wb = Workbook()
    ws = wb.active
    ws.title = "World vs Karāpiro"
    header_fill = PatternFill("solid", fgColor="00397C")
    win_w = PatternFill("solid", fgColor="C6EFCE")
    win_k = PatternFill("solid", fgColor="FFF2CC")
    header_font = Font(bold=True, color="FFFFFF")
    for c, name in enumerate(fields, 1):
        cell = ws.cell(1, c, name)
        cell.fill = header_fill
        cell.font = header_font
    for r, row in enumerate(rows, 2):
        for c, name in enumerate(fields, 1):
            cell = ws.cell(r, c, row[name])
            if name == "faster":
                if row[name] == "World Rowing NZ":
                    cell.fill = win_w
                elif row[name] == "Karāpiro":
                    cell.fill = win_k
    widths = {
        "boat_class": 12,
        "karapiro_event": 16,
        "faster": 18,
        "delta_s_world_minus_karapiro": 16,
        "world_time": 12,
        "karapiro_time": 14,
        "world_crew": 48,
        "karapiro_crew": 48,
        "world_where": 52,
        "karapiro_where": 48,
        "world_year": 12,
        "karapiro_year": 14,
        "karapiro_note": 18,
    }
    for i, name in enumerate(fields, 1):
        ws.column_dimensions[get_column_letter(i)].width = widths.get(name, 14)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(fields))}{len(rows) + 1}"
    ws.freeze_panes = "A2"

    notes = wb.create_sheet("Notes")
    notes["A1"] = "Comparison notes"
    notes["A1"].font = Font(bold=True, size=14)
    notes["A3"] = "World column"
    notes["B3"] = "Fastest NZL 2000 m at World Cup, World Championships or Olympics"
    notes["A4"] = "Karāpiro column"
    notes["B4"] = "Fastest premier time found on RowIT at Lake Karāpiro (any crew)"
    notes["A5"] = "Delta"
    notes["B5"] = "World minus Karāpiro. Negative = NZ went faster internationally."
    notes["A6"] = "Not the same thing"
    notes["B6"] = (
        "Karāpiro times are course times at home (club/NZ champs). "
        "World times are NZ crews abroad at World Cups / Worlds / Olympics. "
        "Conditions, round (heat vs final) and crew line-up all differ."
    )
    notes["A7"] = "World classes with no Karāpiro premier match"
    notes["B7"] = ", ".join(unmatched_world) or "—"
    notes["A8"] = "Karāpiro premier events not in World list"
    notes["B8"] = ", ".join(unmatched_kara) or "—"
    notes.column_dimensions["A"].width = 28
    notes.column_dimensions["B"].width = 90
    wb.save(OUT_XLSX)

    print(f"Wrote {OUT_CSV}")
    print(f"Wrote {OUT_XLSX}")
    print(f"{'class':6} {'world':>8} {'kara':>8} {'dlt':>8}  faster")
    for row in rows:
        print(
            f"{row['boat_class']:6} {row['world_time']:>8} {row['karapiro_time']:>8} "
            f"{row['delta_s_world_minus_karapiro']:>8}  {row['faster']} {row['karapiro_note']}"
        )


if __name__ == "__main__":
    main()
