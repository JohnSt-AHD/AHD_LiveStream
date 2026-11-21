"""
Fastest New Zealand crews at World Cups, World Championships and Olympic Games.

Source: World Rowing public stats API (the same data behind https://worldrowing.com/events-list/).
One row per senior boat class: the fastest NZL/NZL2/… 2000 m time found in those events.

Usage:
    python scripts/build-nz-fastest-world-rowing.py
"""

from __future__ import annotations

import csv
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

BASE = "https://world-rowing-api.soticcloud.net/stats/api"
EVENT_PAGE = "https://worldrowing.com/event/"
UA = "AltitudeHD/nz-fastest-world-rowing (research; +https://worldrowing.com/events-list/)"

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "probe-out" / "world-rowing-cache"
OUT_CSV = ROOT / "public" / "data" / "nz-fastest-world-rowing.csv"
OUT_XLSX = ROOT / "public" / "data" / "nz-fastest-world-rowing.xlsx"

COMP_TYPE_IDS = {
    # World Cups
    "651222cf-95cb-42cc-8207-7c76a57b3000",
    "765733fd-a689-4ee8-9bbe-12c32e7d307e",
    "29712fef-cbdc-4831-8ff6-980543eec908",
    "25d553e7-0a93-462d-bc57-ede2ec6b9f40",
    "071177fe-332d-4561-9d95-0996b9b77619",
    "87165b01-452e-4c90-94d1-9d564cbc54aa",
    "22bf4c5c-316c-4f0b-8749-e93c457da2f6",
    "d82deb69-0c3f-4589-82f3-96d65915fa94",
    # World Championships (including older mixed-type labels)
    "7c4013ad-c7a7-4d0f-a2aa-2a53bcb5d53a",
    "eef29370-44be-4fde-8968-ec4120314851",
    "3e019a7d-77ef-4bef-a852-2b51ddd75bf5",
    "0bbef382-249c-448c-90e6-a0f38bdf7c3b",
    "46a9ef72-2572-4287-b7f9-7fe19cc0959e",
    # Olympic Games
    "543ba8bd-2437-43b7-bd17-4cda34a5945c",
}

SKIP_NAME = re.compile(
    r"youth olympic|paralympic|adaptive|coastal|indoor|beach|masters|"
    r"university|congress|qualification|european|"
    r"under 19|\bu19\b|world junior|junior championships",
    re.I,
)
U23_ONLY = re.compile(r"under 23|\bu23\b", re.I)
SENIOR_ALSO = re.compile(r"\bsenior\b", re.I)

JUNIOR_CLASS = re.compile(
    r"^(J|C|PR|AS|TA|LTA|ID|LTAID|PR[123])|^(B[MWL])",
    re.I,
)
NZL_BOAT = re.compile(r"^NZL\d*$", re.I)

COLUMNS = [
    "boat_class",
    "event_name",
    "time",
    "time_seconds",
    "crew",
    "rank",
    "race",
    "competition",
    "competition_kind",
    "year",
    "venue",
    "date",
    "worldrowing_url",
]


def request_json(path: str, params: dict | None = None, retries: int = 5):
    q = urllib.parse.urlencode(params or {}, doseq=True)
    url = f"{BASE}/{path}" + (f"?{q}" if q else "")
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"Failed {url}: {last}")


def classify_competition(name: str) -> str | None:
    n = name or ""
    if SKIP_NAME.search(n):
        return None
    if U23_ONLY.search(n) and not SENIOR_ALSO.search(n):
        return None
    low = n.lower()
    if "olympic games" in low or re.search(r"\bolympics?\b", low):
        return "Olympic Games"
    if "world rowing cup" in low or re.search(r"world cup\s*[ivx1-6]", low):
        return "World Cup"
    if "world rowing championships" in low or "world championships" in low:
        return "World Championships"
    return None


def is_senior_class(code: str) -> bool:
    c = (code or "").strip()
    if not c:
        return False
    return not JUNIOR_CLASS.search(c)


def parse_result_time(raw) -> float | None:
    if raw in (None, "", "null"):
        return None
    s = str(raw).strip()
    if not s or s.upper() in {"DNS", "DNF", "DSQ", "EXC", "BUW", "FFT", "N/A"}:
        return None
    parts = s.split(":")
    try:
        if len(parts) == 3:
            h, m, sec = parts
            return int(h) * 3600 + int(m) * 60 + float(sec)
        if len(parts) == 2:
            m, sec = parts
            return int(m) * 60 + float(sec)
        return float(s)
    except ValueError:
        return None


def format_time(seconds: float) -> str:
    if seconds >= 3600:
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:05.2f}"
    m = int(seconds // 60)
    s = seconds % 60
    return f"{m}:{s:05.2f}"


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s


def competition_url(name: str) -> str:
    return EVENT_PAGE + slugify(name)


def cache_path(kind: str, key: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^a-zA-Z0-9._-]+", "_", key)
    return CACHE_DIR / f"{kind}_{safe}.json"


def cached_json(kind: str, key: str, loader):
    p = cache_path(kind, key)
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    data = loader()
    p.write_text(json.dumps(data), encoding="utf-8")
    return data


def load_competitions() -> list[dict]:
    seen = {}
    for tid in sorted(COMP_TYPE_IDS):
        payload = cached_json(
            "comps",
            tid,
            lambda t=tid: request_json(
                "competition",
                {"filter[competitionTypeId]": t, "include": "venue,competitionType"},
            ),
        )
        for c in payload.get("data") or []:
            cid = c.get("id")
            if cid:
                seen[cid] = c
        time.sleep(0.15)
    out = []
    for c in seen.values():
        kind = classify_competition(c.get("DisplayName") or "")
        if not kind:
            continue
        c["_kind"] = kind
        out.append(c)
    out.sort(key=lambda x: (str(x.get("Year") or ""), x.get("DisplayName") or ""))
    return out


def load_races(competition_id: str) -> list[dict]:
    payload = cached_json(
        "races",
        competition_id,
        lambda: request_json(
            "race",
            {
                "filter[event.competitionId]": competition_id,
                "include": "event.boatClass,racePhase,raceBoats",
            },
        ),
    )
    return payload.get("data") or []


def load_race_athletes(race_id: str) -> list[dict]:
    payload = cached_json(
        "raceath",
        race_id,
        lambda: request_json(
            f"race/{race_id}",
            {"include": "raceBoats.raceBoatAthletes.person"},
        ),
    )
    data = payload.get("data") or {}
    return data.get("raceBoats") or []


def venue_name(comp: dict) -> str:
    v = comp.get("venue") or {}
    if isinstance(v, dict):
        return v.get("DisplayName") or v.get("Name") or ""
    return ""


def boat_names(boat: dict) -> str:
    athletes = boat.get("raceBoatAthletes") or []
    names = []
    for a in athletes:
        person = a.get("person") or {}
        n = person.get("DisplayName") or person.get("_name") or ""
        if n:
            names.append(n)
    return "; ".join(names)


def collect_bests(competitions: list[dict]) -> dict[str, dict]:
    best: dict[str, dict] = {}
    for i, comp in enumerate(competitions, 1):
        cid = comp["id"]
        name = comp.get("DisplayName") or cid
        print(f"[{i}/{len(competitions)}] {name}", flush=True)
        try:
            races = load_races(cid)
        except Exception as e:
            print(f"  skip: {e}", flush=True)
            continue
        venue = venue_name(comp)
        year = str(comp.get("Year") or "")[:4]
        for race in races:
            event = race.get("event") or {}
            bc = ((event.get("boatClass") or {}).get("DisplayName") or "").strip()
            if not is_senior_class(bc):
                continue
            event_name = event.get("DisplayName") or bc
            for boat in race.get("raceBoats") or []:
                code = (boat.get("DisplayName") or "").strip()
                if not NZL_BOAT.match(code):
                    continue
                if boat.get("InvalidMarkResult"):
                    continue
                secs = parse_result_time(boat.get("ResultTime"))
                if secs is None or secs < 300 or secs > 1200:
                    # 5–20 min keeps 2000 m times. Women's races were 1000 m until 1985.
                    continue
                rec = {
                    "boat_class": bc,
                    "event_name": event_name,
                    "time": format_time(secs),
                    "time_seconds": round(secs, 3),
                    "crew": "",
                    "rank": boat.get("Rank") or "",
                    "race": race.get("DisplayName") or "",
                    "competition": name,
                    "competition_kind": comp["_kind"],
                    "year": year,
                    "venue": venue,
                    "date": (race.get("Date") or "")[:10],
                    "worldrowing_url": competition_url(name),
                    "_race_id": race.get("id") or "",
                    "_boat_id": boat.get("id") or "",
                    "_country_code": code,
                }
                prev = best.get(bc)
                if prev is None or secs < prev["time_seconds"]:
                    best[bc] = rec
        time.sleep(0.12)
    return best


def attach_crews(best: dict[str, dict]) -> None:
    by_race: dict[str, list[dict]] = {}
    for rec in best.values():
        rid = rec.get("_race_id")
        if rid:
            by_race.setdefault(rid, []).append(rec)
    print(f"Loading crews for {len(by_race)} races…", flush=True)
    for i, (rid, recs) in enumerate(by_race.items(), 1):
        try:
            boats = load_race_athletes(rid)
        except Exception as e:
            print(f"  crew skip {rid}: {e}", flush=True)
            continue
        by_id = {b.get("id"): b for b in boats}
        for rec in recs:
            boat = by_id.get(rec.get("_boat_id")) or {}
            rec["crew"] = boat_names(boat)
            if rec["_country_code"] and rec["_country_code"] != "NZL":
                rec["crew"] = f"{rec['_country_code']}: {rec['crew']}".strip(": ")
        if i % 5 == 0:
            print(f"  {i}/{len(by_race)}", flush=True)
        time.sleep(0.12)


def class_sort_key(code: str):
    order = [
        "W1x",
        "W2-",
        "W2+",
        "W2x",
        "W4-",
        "W4+",
        "W4x",
        "W8+",
        "LW1x",
        "LW2-",
        "LW2x",
        "LW4-",
        "LW4x",
        "M1x",
        "M2-",
        "M2+",
        "M2x",
        "M4-",
        "M4+",
        "M4x",
        "M8+",
        "LM1x",
        "LM2-",
        "LM2x",
        "LM4-",
        "LM4x",
        "LM8+",
        "Mix2x",
        "Mix4x",
        "Mix8+",
    ]
    try:
        return (0, order.index(code), code)
    except ValueError:
        return (1, 0, code)


def write_csv(rows: list[dict]) -> None:
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUT_CSV.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)


def write_xlsx(rows: list[dict], n_comps: int, n_classes: int) -> None:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        print("openpyxl not installed — CSV only. pip install openpyxl for Excel.")
        return

    wb = Workbook()
    ws = wb.active
    ws.title = "Fastest NZ crews"
    header_fill = PatternFill("solid", fgColor="00397C")
    header_font = Font(bold=True, color="FFFFFF")
    for col, name in enumerate(COLUMNS, 1):
        cell = ws.cell(1, col, name)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center")
    for r, row in enumerate(rows, 2):
        for c, name in enumerate(COLUMNS, 1):
            ws.cell(r, c, row.get(name, ""))
    widths = {
        "boat_class": 14,
        "event_name": 28,
        "time": 12,
        "time_seconds": 14,
        "crew": 48,
        "rank": 8,
        "race": 36,
        "competition": 48,
        "competition_kind": 22,
        "year": 8,
        "venue": 28,
        "date": 14,
        "worldrowing_url": 56,
    }
    for i, name in enumerate(COLUMNS, 1):
        ws.column_dimensions[get_column_letter(i)].width = widths.get(name, 16)
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{len(rows) + 1}"
    ws.freeze_panes = "A2"

    notes = wb.create_sheet("Notes")
    notes["A1"] = "Fastest New Zealand crew per boat class"
    notes["A1"].font = Font(bold=True, size=14)
    notes["A3"] = "Source"
    notes["B3"] = "World Rowing public stats API (events-list / results)"
    notes["A4"] = "Events included"
    notes["B4"] = "World Rowing Cup, World Rowing Championships, Olympic Games"
    notes["A5"] = "Events excluded"
    notes["B5"] = "U19, U23-only, Junior, Coastal, Indoor, Beach, Masters, Youth Olympics, qualification regattas"
    notes["A6"] = "Boat classes"
    notes["B6"] = "Senior open and lightweight only (no junior/U23/para/coastal codes)"
    notes["A7"] = "Time rule"
    notes["B7"] = (
        "Fastest recorded 2000 m time in any round (heat, repechage, semi or final). "
        "Times under 5:00 are treated as 1000 m / corrupt and dropped (women raced 1000 m until 1985)."
    )
    notes["A8"] = "NZ boats"
    notes["B8"] = "Any NZL / NZL2 / NZL3 boat (second crews at World Cups count)"
    notes["A9"] = "Competitions scanned"
    notes["B9"] = n_comps
    notes["A10"] = "Classes found"
    notes["B10"] = n_classes
    notes["A11"] = "Generated"
    notes["B11"] = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    notes["A12"] = "Events list"
    notes["B12"] = "https://worldrowing.com/events-list/"
    notes.column_dimensions["A"].width = 24
    notes.column_dimensions["B"].width = 100
    wb.save(OUT_XLSX)


def main():
    print("Loading competitions…", flush=True)
    competitions = load_competitions()
    print(f"{len(competitions)} World Cup / Worlds / Olympics competitions", flush=True)
    kinds = {}
    for c in competitions:
        kinds[c["_kind"]] = kinds.get(c["_kind"], 0) + 1
    for k, n in sorted(kinds.items()):
        print(f"  {k}: {n}")

    best = collect_bests(competitions)
    attach_crews(best)
    rows = [best[k] for k in sorted(best, key=class_sort_key)]
    write_csv(rows)
    write_xlsx(rows, len(competitions), len(rows))
    print(f"Wrote {OUT_CSV}")
    if OUT_XLSX.exists():
        print(f"Wrote {OUT_XLSX}")
    print(f"{len(rows)} boat classes")
    for row in rows:
        print(f"  {row['boat_class']:6} {row['time']:>8}  {row['year']} {row['competition']}")


if __name__ == "__main__":
    main()
