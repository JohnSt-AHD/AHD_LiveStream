"""Domestic premier 1X: NZ champs + CTC + NICC + Christmas, season top-4."""

from __future__ import annotations

import csv
import json
import re
import statistics
import time
import urllib.request
from collections import defaultdict
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "probe-out" / "nzcc-1x-cache"
OUT_CSV = ROOT / "public" / "data" / "nz-domestic-prm-1x-top4-history.csv"
OUT_JSON = ROOT / "public" / "data" / "nz-domestic-prm-1x-top4-history.json"
OUT_DETAIL = ROOT / "public" / "data" / "nz-domestic-prm-1x-top4-athletes.csv"
OUT_XLSX = ROOT / "public" / "data" / "nz-domestic-prm-1x-top4-history.xlsx"
OUT_REG = ROOT / "public" / "data" / "nz-domestic-prm-1x-regattas.csv"

UA = {"User-Agent": "Mozilla/5.0 RNZ-1x-history"}
YEARS = list(range(2007, 2027))
MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "january": 1, "february": 2, "march": 3, "april": 4, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}
VENUE_RE = re.compile(
    r"(Lake Kar[aā]piro|Kar[aā]piro|Lake Ruataniwha|Ruataniwha|Twizel|Lake Hood)",
    re.I,
)


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", "replace")


def looks_csv(text: str) -> bool:
    head = (text or "").lstrip()[:80].lower()
    return bool(text) and not head.startswith("<") and "event" in head


def cached_text(name: str, urls: list[str]) -> str | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists() and path.stat().st_size > 200:
        body = path.read_text(encoding="utf-8", errors="replace")
        if name.endswith(".html") or looks_csv(body):
            return body
    last_err = None
    for url in urls:
        try:
            body = fetch(url)
        except Exception as e:
            last_err = e
            continue
        if name.endswith(".csv") and not looks_csv(body):
            continue
        if not body:
            continue
        path.write_text(body, encoding="utf-8")
        time.sleep(0.2)
        return body
    if last_err:
        print(f"  fail {name} {last_err}")
    return None


def parse_time(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s or re.match(r"^(SCR|DNS|DNF|RMV|EXC|BUW|DSQ|NTT)$", s, re.I):
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            a, b, c = parts
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
    rows = list(csv.reader(lines))
    header = [h.strip() for h in rows[0]]
    seen: dict[str, int] = {}
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
    if len(cols) >= 3 and re.match(r"^[MW]", cols[2] or ""):
        return cols[2]
    if len(cols) >= 2:
        return cols[1]
    return ""


def is_open_prm_1x(etype: str) -> str | None:
    et = re.sub(r"\s+", " ", (etype or "").strip())
    if re.search(r"\(L\)|\(P\)|Lightweight|Para|Sht|250m|1000m|U20|U21|U22", et, re.I):
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


def parse_results_html(html: str, event_n: str) -> list[dict]:
    races = []
    table_re = re.compile(
        r'<table class="result-table" summary="Results for event (\d+), ([^"]+)"[\s\S]*?(?=<table class="result-table"|$)',
        re.I,
    )
    row_re = re.compile(r'<tr class="result-details">([\s\S]*?)</tr>', re.I)
    for tm in table_re.finditer(html):
        if tm.group(1) != str(event_n):
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
            raw_time = time_m.group(1).strip() if time_m else ""
            sec = parse_time(raw_time)
            if sec is None or sec < 300 or sec > 900:
                continue
            entries.append(
                {
                    "place": int(place_m.group(1)) if place_m else None,
                    "pid": name_m.group(1),
                    "name": expand_name(name_m.group(2)),
                    "club": club_m.group(1) if club_m else "",
                    "time": raw_time,
                    "seconds": sec,
                    "best_round": round_label,
                    "round_kind": round_kind,
                }
            )
        if entries:
            races.append({"round": round_kind, "label": round_label, "entries": entries})
    return races


def venue_from_html(html: str) -> str:
    code = re.search(r'href="venues/(kar|rua|hood)"', html)
    if code:
        return {"kar": "Lake Karapiro", "rua": "Lake Ruataniwha", "hood": "Lake Hood"}[code.group(1)]
    m = VENUE_RE.search(unescape(html[:12000]))
    if not m:
        return ""
    t = m.group(1)
    if re.search(r"kar", t, re.I):
        return "Lake Karapiro"
    if re.search(r"ruat|twizel", t, re.I):
        return "Lake Ruataniwha"
    return t


def title_from_html(html: str) -> str:
    tm = re.search(r"<title>([^<]+)", html)
    if not tm:
        return ""
    return unescape(tm.group(1)).replace(" regatta results", "").replace("Regatta results", "").strip()


def date_from_html(html: str) -> tuple[int | None, int | None]:
    og = re.search(r'property="og:description" content="([^"]+)"', html)
    blob = unescape(og.group(1)) if og else ""
    dm = re.search(
        r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})",
        blob,
        re.I,
    )
    if dm:
        return int(dm.group(2)), MONTHS[dm.group(1).lower()]
    ym = re.search(r'class="cardRegattaYear">(\d{4})', html)
    mm = re.search(r'class="cardRegattaMonth">([A-Za-z]{3})', html)
    year = int(ym.group(1)) if ym else None
    month = MONTHS.get((mm.group(1).lower() if mm else ""), None)
    return year, month


def family_of(title: str, code: str) -> str:
    t = (title or "").lower()
    if "christmas" in t:
        return "Christmas"
    if "town cup" in t or "cambridge" in t:
        return "Cambridge Town Cup"
    if "north island" in t:
        return "North Island"
    if "national" in t or "championship" in t or code.startswith("nzcc"):
        return "NZ Championships"
    if code.endswith("r1"):
        return "Christmas"
    if code.endswith("r2"):
        return "Cambridge Town Cup"
    if code.startswith("nicc"):
        return "North Island"
    return title or code


def season_of(cal_year: int | None, month: int | None, code: str) -> int | None:
    if cal_year and month == 12:
        return cal_year + 1
    if cal_year:
        return cal_year
    m = re.search(r"(\d{4})", code)
    y = int(m.group(1)) if m else None
    if y is None:
        return None
    if code.endswith("r1"):
        return y + 1
    return y


def best_by_athlete(races: list[dict]) -> list[dict]:
    best: dict[str, dict] = {}
    for race in races:
        for e in race["entries"]:
            key = e["pid"] or e["name"].casefold()
            prev = best.get(key)
            if prev is None or e["seconds"] < prev["seconds"]:
                best[key] = {**e, "best_round": race["label"]}
    return sorted(best.values(), key=lambda r: r["seconds"])


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


def iter_codes() -> list[str]:
    codes = []
    for y in YEARS:
        codes.append(f"nzcc{y}")
        codes.append(f"nicc{y}")
        codes.append(f"kric{y}r1")
        codes.append(f"kric{y}r2")
    codes.append("kric2006r1")
    return codes


def main():
    appearances = []
    regatta_log = []

    for code in iter_codes():
        print(f"=== {code} ===")
        events_text = cached_text(
            f"{code}-events.csv",
            [
                f"https://l.rowit.nz/altitude/{code}/events.csv",
                f"https://rowit.nz/{code}/events.csv",
            ],
        )
        if not events_text:
            print("  no events")
            continue
        targets = []
        for rec in parse_csv_rows(events_text):
            gender = is_open_prm_1x(event_type(rec))
            if not gender:
                continue
            en = event_num(rec)
            if not re.match(r"^\d+$", en or ""):
                continue
            targets.append((gender, en, event_type(rec)))
        if not targets:
            print("  no open Prm 1X")
            continue

        meta_html = None
        for gender, en, etype in targets:
            html = cached_text(
                f"{code}-{gender}-{en}.html",
                [f"https://rowit.nz/{code}/results?en={en}"],
            )
            if not html:
                print(f"  {gender} en={en} no html")
                continue
            if meta_html is None:
                meta_html = html
            races = parse_results_html(html, en)
            best = best_by_athlete(races)
            print(f"  {gender} en={en} races={len(races)} unique={len(best)}")
            title = title_from_html(html)
            cal_y, month = date_from_html(html)
            season = season_of(cal_y, month, code)
            fam = family_of(title, code)
            venue = venue_from_html(html)
            for a in best:
                appearances.append(
                    {
                        "season": season,
                        "gender": "Men" if gender == "M" else "Women",
                        "pid": a["pid"],
                        "name": a["name"],
                        "club": a["club"],
                        "seconds": a["seconds"],
                        "time": fmt_time(a["seconds"]),
                        "round": a.get("best_round", ""),
                        "code": code,
                        "regatta": fam,
                        "title": title,
                        "venue": venue,
                        "event_num": en,
                        "source_url": f"https://rowit.nz/{code}/results?en={en}",
                    }
                )
            regatta_log.append(
                {
                    "code": code,
                    "gender": "Men" if gender == "M" else "Women",
                    "title": title,
                    "regatta": fam,
                    "season": season,
                    "calendar_year": cal_y or "",
                    "month": month or "",
                    "venue": venue,
                    "event_num": en,
                    "unique_scullers": len(best),
                    "fastest": fmt_time(best[0]["seconds"]) if best else "",
                    "source_url": f"https://rowit.nz/{code}/results?en={en}",
                }
            )

    # unique athlete best per season/gender
    by_key: dict[tuple, dict] = {}
    for row in appearances:
        if not row["season"]:
            continue
        key = (row["season"], row["gender"], row["pid"] or row["name"].casefold())
        prev = by_key.get(key)
        if prev is None or row["seconds"] < prev["seconds"]:
            by_key[key] = row

    seasons = []
    detail_rows = []
    grouped: dict[tuple, list] = defaultdict(list)
    for row in by_key.values():
        grouped[(row["season"], row["gender"])].append(row)

    for (season, gender), rows in sorted(grouped.items()):
        rows.sort(key=lambda r: r["seconds"])
        stats = top4_stats(rows)
        if not stats["n"]:
            continue
        regs = sorted({a["regatta"] for a in stats["athletes"]})
        names = "; ".join(
            f"{a['name']} {fmt_time(a['seconds'])} ({a['regatta']})" for a in stats["athletes"]
        )
        seasons.append(
            {
                "year": season,
                "gender": gender,
                "regattas": " / ".join(sorted({r["regatta"] for r in rows})),
                "unique_scullers": len(rows),
                "n_top": stats["n"],
                "mean": fmt_time(stats["mean"]),
                "mean_s": round(stats["mean"], 3),
                "sd_s": round(stats["sd"], 3),
                "spread_s": round(stats["spread"], 3),
                "fastest": fmt_time(stats["fastest"]),
                "fastest_s": round(stats["fastest"], 3),
                "slowest": fmt_time(stats["slowest"]),
                "slowest_s": round(stats["slowest"], 3),
                "minus_1sd": fmt_time(stats["mean"] - stats["sd"]),
                "plus_1sd": fmt_time(stats["mean"] + stats["sd"]),
                "top4_from": " / ".join(regs),
                "top4": names,
                "venue_mix": " / ".join(sorted({a["venue"] for a in stats["athletes"] if a["venue"]})),
            }
        )
        for i, a in enumerate(stats["athletes"], 1):
            detail_rows.append(
                {
                    "year": season,
                    "gender": gender,
                    "rank": i,
                    "name": a["name"],
                    "club": a["club"],
                    "time": fmt_time(a["seconds"]),
                    "seconds": round(a["seconds"], 3),
                    "regatta": a["regatta"],
                    "round": a["round"],
                    "venue": a["venue"],
                    "code": a["code"],
                    "pid": a["pid"],
                    "source_url": a["source_url"],
                }
            )
        mean_txt = fmt_time(stats["mean"])
        print(f"SEASON {season} {gender} n={len(rows)} mean={mean_txt} sd={stats['sd']:.2f}s {names}")

    fields = [
        "year", "gender", "regattas", "unique_scullers", "n_top", "mean", "mean_s",
        "sd_s", "spread_s", "fastest", "fastest_s", "slowest", "slowest_s",
        "minus_1sd", "plus_1sd", "top4_from", "top4", "venue_mix",
    ]
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(seasons)
    afields = [
        "year", "gender", "rank", "name", "club", "time", "seconds", "regatta",
        "round", "venue", "code", "pid", "source_url",
    ]
    with OUT_DETAIL.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=afields)
        w.writeheader()
        w.writerows(detail_rows)
    rfields = [
        "code", "gender", "title", "regatta", "season", "calendar_year", "month",
        "venue", "event_num", "unique_scullers", "fastest", "source_url",
    ]
    with OUT_REG.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rfields)
        w.writeheader()
        w.writerows(regatta_log)
    OUT_JSON.write_text(json.dumps(seasons, indent=2), encoding="utf-8")

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, Alignment
        from openpyxl.utils import get_column_letter

        wb = Workbook()
        ws = wb.active
        ws.title = "Season top-4"
        ws.append(fields)
        for cell in ws[1]:
            cell.font = Font(bold=True)
            cell.alignment = Alignment(wrap_text=True, vertical="center")
        for row in seasons:
            ws.append([row.get(k, "") for k in fields])
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(fields))}{len(seasons) + 1}"
        ws.column_dimensions["Q"].width = 80
        ws.column_dimensions["C"].width = 40

        ws2 = wb.create_sheet("Top-4 athletes")
        ws2.append(afields)
        for cell in ws2[1]:
            cell.font = Font(bold=True)
        for row in detail_rows:
            ws2.append([row.get(k, "") for k in afields])
        ws2.freeze_panes = "A2"
        ws2.column_dimensions["D"].width = 28

        ws3 = wb.create_sheet("Regattas scraped")
        ws3.append(rfields)
        for cell in ws3[1]:
            cell.font = Font(bold=True)
        for row in regatta_log:
            ws3.append([row.get(k, "") for k in rfields])
        ws3.freeze_panes = "A2"

        notes = wb.create_sheet("Notes")
        notes["A1"] = "Method"
        notes["A1"].font = Font(bold=True, size=14)
        notes["A3"] = "Scope"
        notes["B3"] = (
            "Open premier singles (M/W Prm 1X) at NZ Championships, Cambridge Town Cup, "
            "North Island Championships, and Karapiro Christmas Regatta, 2007-2026. "
            "Lightweight, para, and age-group premier 1X excluded."
        )
        notes["A4"] = "Season"
        notes["B4"] = (
            "Rowing season ending in the NZ champs year: Christmas in December of Y-1 "
            "counts toward season Y, with Town Cup / NICC / NZ champs in Jan-Feb Y."
        )
        notes["A5"] = "Time used"
        notes["B5"] = (
            "Each unique sculler's fastest 2000 m across those four regattas that season "
            "(any round), then the four fastest scullers."
        )
        notes["A6"] = "Spread"
        notes["B6"] = "Sample SD (n-1) of the four times. Band is mean +/- 1 SD."
        notes["A7"] = "Gaps"
        notes["B7"] = (
            "Town Cup as KRI r2 is missing on RowIT from 2020; NICC fills the January "
            "Karapiro slot. Christmas 2026 had not been raced at scrape time. "
            "2010 NICC was combined into Cambridge Town Cup."
        )
        notes.column_dimensions["A"].width = 16
        notes.column_dimensions["B"].width = 110
        wb.save(OUT_XLSX)
        print("wrote", OUT_XLSX)
    except ImportError:
        print("openpyxl missing; skipped xlsx")

    print("wrote", OUT_CSV)
    print("wrote", OUT_DETAIL)
    print("wrote", OUT_REG)
    print("wrote", OUT_JSON)


if __name__ == "__main__":
    main()
