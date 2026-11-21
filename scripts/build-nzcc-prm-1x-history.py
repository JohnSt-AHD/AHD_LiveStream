"""NZ champs premier 1X: per-season top-4 mean and spread, 2007-2026."""

from __future__ import annotations

import csv
import json
import math
import re
import statistics
import time
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "probe-out" / "nzcc-1x-cache"
OUT_CSV = ROOT / "public" / "data" / "nzcc-prm-1x-top4-history.csv"
OUT_JSON = ROOT / "public" / "data" / "nzcc-prm-1x-top4-history.json"
OUT_DETAIL = ROOT / "public" / "data" / "nzcc-prm-1x-top4-athletes.csv"
OUT_XLSX = ROOT / "public" / "data" / "nzcc-prm-1x-top4-history.xlsx"

UA = {"User-Agent": "Mozilla/5.0 RNZ-1x-history"}
YEARS = list(range(2007, 2027))
VENUE_RE = re.compile(
    r"(Lake Kar[aā]piro|Kar[aā]piro|Lake Ruataniwha|Ruataniwha|Twizel|Lake Hood|Akaroa)",
    re.I,
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def cached(name: str, url: str) -> str:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and path.stat().st_size > 200:
        return path.read_text(encoding="utf-8", errors="replace")
    body = fetch(url)
    path.write_text(body, encoding="utf-8")
    time.sleep(0.25)
    return body


def parse_time(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s or re.match(r"^(SCR|DNS|DNF|RMV|EXC|BUW|DSQ|NTT)$", s, re.I):
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            a, b, c = parts
            # Older RowIT stores hundredths with a colon: 6:56:66 == 6:56.66
            if int(a) <= 30 and "." not in b:
                frac = int(c) / (10 ** len(c)) if c.isdigit() else float(c)
                return int(a) * 60 + int(b) + frac
            return int(a) * 3600 + int(b) * 60 + float(c)
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        return float(s)
    except ValueError:
        return None


def fmt_time(seconds: float) -> str:
    m = int(seconds // 60)
    s = seconds % 60
    return f"{m}:{s:05.2f}"


def expand_name(html: str) -> str:
    text = re.sub(r'<span class="notCompact">([^<]*)</span>', r"\1", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = unescape(text)
    return " ".join(text.split())


def parse_csv_rows(text: str) -> list[dict]:
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return []
    reader = csv.reader(lines)
    rows = list(reader)
    header = [h.strip() for h in rows[0]]
    # 2026 sometimes duplicates Event #
    seen = {}
    uniq = []
    for h in header:
        n = seen.get(h, 0)
        uniq.append(h if n == 0 else f"{h}_{n}")
        seen[h] = n + 1
    out = []
    for cols in rows[1:]:
        if not cols:
            continue
        rec = {uniq[i]: cols[i].strip() if i < len(cols) else "" for i in range(len(uniq))}
        rec["_cols"] = cols
        out.append(rec)
    return out


def event_num(rec: dict) -> str:
    for key in ("Event #", "Event", "event"):
        if rec.get(key):
            return rec[key]
    cols = rec.get("_cols") or []
    return cols[0] if cols else ""


def event_type(rec: dict) -> str:
    for key in rec:
        if key.lower().startswith("event type"):
            return rec[key]
    cols = rec.get("_cols") or []
    # nzcc2026: Event #, Event #, Event Type
    if len(cols) >= 3 and re.match(r"^[MW]", cols[2] or ""):
        return cols[2]
    if len(cols) >= 2:
        return cols[1]
    return ""


def is_open_prm_1x(etype: str) -> str | None:
    et = re.sub(r"\s+", " ", (etype or "").strip())
    if re.search(r"\(L\)|\(P\)|Lightweight|Para|Sht|250m|1000m", et, re.I):
        return None
    if re.match(r"^M\s+Prm\s+1X$", et, re.I):
        return "M"
    if re.match(r"^W\s+Prm\s+1X$", et, re.I):
        return "W"
    return None


def parse_round(label: str) -> tuple[str, str]:
    lab = (label or "").strip()
    low = lab.lower()
    if re.match(r"^a\s*final", low) or re.match(r"^final\s*a\b", low) or low == "final":
        return "A Final", lab
    if "final" in low:
        return "Final", lab
    if "heat" in low:
        return "Heat", lab
    if "semi" in low:
        return "Semi", lab
    if "rep" in low:
        return "Repechage", lab
    if "quarter" in low:
        return "Quarter", lab
    return "Other", lab


def parse_results_html(html: str, event_num: str) -> list[dict]:
    races = []
    table_re = re.compile(
        r'<table class="result-table" summary="Results for event (\d+), ([^"]+)"[\s\S]*?(?=<table class="result-table"|$)',
        re.I,
    )
    row_re = re.compile(r'<tr class="result-details">([\s\S]*?)</tr>', re.I)
    for tm in table_re.finditer(html):
        if tm.group(1) != str(event_num):
            continue
        round_kind, round_label = parse_round(tm.group(2))
        entries = []
        for rm in row_re.finditer(tm.group(0)):
            block = rm.group(1)
            place_m = re.search(r"resultPlaceLink[\s\S]*?<span>(\d+)<sup>", block, re.I)
            time_m = re.search(
                r'class="resultTimeLink"[\s\S]*?</span>\s*<span>([^<]+)</span>',
                block,
                re.I,
            )
            name_m = re.search(
                r'<div class="cardCrewMembers">\s*<a href="[^"]*pid=(\d+)">([\s\S]*?)</a>',
                block,
                re.I,
            )
            club_m = re.search(r'class="cardKeyID">([A-Z0-9*]+)<', block)
            if not name_m:
                continue
            pid = name_m.group(1)
            name = expand_name(name_m.group(2))
            raw_time = time_m.group(1).strip() if time_m else ""
            sec = parse_time(raw_time)
            if sec is None:
                continue
            # Prm 1X is 2000m; drop obvious non-2k times
            if sec < 300 or sec > 900:
                continue
            entries.append(
                {
                    "place": int(place_m.group(1)) if place_m else None,
                    "pid": pid,
                    "name": name,
                    "club": club_m.group(1) if club_m else "",
                    "time": raw_time,
                    "seconds": sec,
                }
            )
        if entries:
            races.append({"round": round_kind, "label": round_label, "entries": entries})
    return races


def venue_from_html(html: str) -> str:
    code = re.search(r'href="venues/(kar|rua|hood)"', html)
    if code:
        return {
            "kar": "Lake Karapiro",
            "rua": "Lake Ruataniwha",
            "hood": "Lake Hood",
        }[code.group(1)]
    blob = unescape(html[:12000])
    m = VENUE_RE.search(blob)
    if not m:
        return ""
    t = m.group(1)
    if re.search(r"kar", t, re.I):
        return "Lake Karapiro"
    if re.search(r"ruat|twizel", t, re.I):
        return "Lake Ruataniwha"
    if re.search(r"hood", t, re.I):
        return "Lake Hood"
    return t


def best_by_athlete(races: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for race in races:
        for e in race["entries"]:
            key = e["pid"] or e["name"].casefold()
            prev = best.get(key)
            if prev is None or e["seconds"] < prev["seconds"]:
                best[key] = {**e, "best_round": race["label"]}
    return sorted(best.values(), key=lambda r: r["seconds"])


def a_final_entries(races: list[dict]) -> list[dict]:
    for race in races:
        if race["round"] == "A Final":
            return sorted(
                [e for e in race["entries"] if e["place"]],
                key=lambda r: (r["place"] or 99, r["seconds"]),
            )
    return []


def top4_stats(rows: list[dict]) -> dict:
    top = rows[:4]
    secs = [r["seconds"] for r in top]
    n = len(secs)
    mean = statistics.fmean(secs) if n else None
    sd = statistics.stdev(secs) if n >= 2 else 0.0
    spread = (max(secs) - min(secs)) if n >= 2 else 0.0
    return {
        "n": n,
        "mean": mean,
        "sd": sd,
        "spread": spread,
        "fastest": secs[0] if secs else None,
        "slowest": secs[-1] if secs else None,
        "athletes": top,
    }


def main():
    seasons = []
    detail_rows = []

    for year in YEARS:
        code = f"nzcc{year}"
        print(f"=== {code} ===")
        try:
            events_text = cached(f"{code}-events.csv", f"https://l.rowit.nz/altitude/{code}/events.csv")
        except Exception as e:
            print("  events fail", e)
            continue
        targets = []
        for rec in parse_csv_rows(events_text):
            gender = is_open_prm_1x(event_type(rec))
            if not gender:
                continue
            en = event_num(rec)
            if en:
                targets.append((gender, en, event_type(rec)))

        if not targets:
            print("  no open Prm 1X")
            continue

        venue = ""
        for gender, en, etype in targets:
            try:
                html = cached(f"{code}-{gender}-{en}.html", f"https://rowit.nz/{code}/results?en={en}")
            except Exception as e:
                print(f"  {gender} en={en} fail {e}")
                continue
            if not venue:
                venue = venue_from_html(html)
            races = parse_results_html(html, str(en).split(",")[0])
            best = best_by_athlete(races)
            a_final = a_final_entries(races)
            stats = top4_stats(best)
            a_stats = top4_stats(a_final)
            mean_txt = fmt_time(stats["mean"]) if stats["mean"] else "-"
            print(
                f"  {gender} en={en} races={len(races)} unique={len(best)} "
                f"mean={mean_txt} sd={stats['sd']:.2f}s venue={venue or '?'}"
            )
            if not stats["n"]:
                continue
            names = "; ".join(
                f"{a['name']} {fmt_time(a['seconds'])}" for a in stats["athletes"]
            )
            seasons.append(
                {
                    "year": year,
                    "regatta": code,
                    "gender": "Men" if gender == "M" else "Women",
                    "event": etype,
                    "event_num": en,
                    "venue": venue,
                    "unique_scullers": len(best),
                    "n_top": stats["n"],
                    "mean_s": round(stats["mean"], 3),
                    "mean": fmt_time(stats["mean"]),
                    "sd_s": round(stats["sd"], 3),
                    "spread_s": round(stats["spread"], 3),
                    "fastest_s": round(stats["fastest"], 3),
                    "fastest": fmt_time(stats["fastest"]),
                    "slowest_s": round(stats["slowest"], 3),
                    "slowest": fmt_time(stats["slowest"]),
                    "minus_1sd": fmt_time(stats["mean"] - stats["sd"]),
                    "plus_1sd": fmt_time(stats["mean"] + stats["sd"]),
                    "a_final_mean": fmt_time(a_stats["mean"]) if a_stats["mean"] else "",
                    "a_final_sd_s": round(a_stats["sd"], 3) if a_stats["n"] else "",
                    "top4": names,
                    "source_url": f"https://rowit.nz/{code}/results?en={en}",
                }
            )
            for i, a in enumerate(stats["athletes"], 1):
                detail_rows.append(
                    {
                        "year": year,
                        "gender": "Men" if gender == "M" else "Women",
                        "rank": i,
                        "name": a["name"],
                        "club": a["club"],
                        "time": fmt_time(a["seconds"]),
                        "seconds": round(a["seconds"], 3),
                        "round": a.get("best_round", ""),
                        "pid": a["pid"],
                        "venue": venue,
                    }
                )

    fields = [
        "year",
        "regatta",
        "gender",
        "event",
        "event_num",
        "venue",
        "unique_scullers",
        "n_top",
        "mean",
        "mean_s",
        "sd_s",
        "spread_s",
        "fastest",
        "fastest_s",
        "slowest",
        "slowest_s",
        "minus_1sd",
        "plus_1sd",
        "a_final_mean",
        "a_final_sd_s",
        "top4",
        "source_url",
    ]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(seasons)
    with OUT_DETAIL.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["year", "gender", "rank", "name", "club", "time", "seconds", "round", "pid", "venue"],
        )
        w.writeheader()
        w.writerows(detail_rows)
    OUT_JSON.write_text(json.dumps(seasons, indent=2), encoding="utf-8")

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment
        from openpyxl.utils import get_column_letter

        seasons_sorted = sorted(seasons, key=lambda r: (r["year"], r["gender"]))
        wb = Workbook()
        ws = wb.active
        ws.title = "Season top-4"
        ws.append(fields)
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        for row in seasons_sorted:
            ws.append([row.get(k, "") for k in fields])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(fields))}{len(seasons_sorted) + 1}"
        widths = {
            "year": 8,
            "regatta": 12,
            "gender": 10,
            "event": 12,
            "venue": 18,
            "top4": 70,
            "source_url": 48,
        }
        for i, name in enumerate(fields, 1):
            ws.column_dimensions[get_column_letter(i)].width = widths.get(name, 12)

        ws2 = wb.create_sheet("Top-4 athletes")
        afields = ["year", "gender", "rank", "name", "club", "time", "seconds", "round", "pid", "venue"]
        ws2.append(afields)
        for cell in ws2[1]:
            cell.font = Font(bold=True)
        for row in detail_rows:
            ws2.append([row.get(k, "") for k in afields])
        ws2.freeze_panes = "A2"
        ws2.column_dimensions["D"].width = 28

        notes = wb.create_sheet("Notes")
        notes["A1"] = "Method"
        notes["A1"].font = Font(bold=True, size=14)
        notes["A3"] = "Scope"
        notes["B3"] = (
            "NZ Rowing Championships (nzcc) 2007-2026, open premier singles only "
            "(M Prm 1X and W Prm 1X). Lightweight and para excluded. 2006 had no premier 1X on RowIT."
        )
        notes["A4"] = "Time used"
        notes["B4"] = (
            "Each unique sculler's fastest 2000 m time at that championship (any round), "
            "then the four fastest scullers."
        )
        notes["A5"] = "Mean"
        notes["B5"] = "Arithmetic mean of those four times."
        notes["A6"] = "Spread"
        notes["B6"] = (
            "Sample standard deviation (n-1) of the four times. Chart band is mean +/- 1 SD. "
            "spread_s is max minus min of the four."
        )
        notes["A7"] = "Venue"
        notes["B7"] = (
            "Championships alternate between Lake Karapiro and Lake Ruataniwha. "
            "Times are not condition-adjusted; wind and venue dominate year-to-year jumps."
        )
        notes["A8"] = "Source"
        notes["B8"] = "rowit.nz HTML results; event numbers from l.rowit.nz/altitude/{code}/events.csv"
        notes.column_dimensions["A"].width = 16
        notes.column_dimensions["B"].width = 100
        wb.save(OUT_XLSX)
        print("wrote", OUT_XLSX)
    except ImportError:
        print("openpyxl missing; skipped xlsx")

    print("wrote", OUT_CSV)
    print("wrote", OUT_DETAIL)
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
