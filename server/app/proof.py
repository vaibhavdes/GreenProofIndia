"""Proof Score (0–100): can this photo or video be trusted as evidence of work at this site?

Four checks, each with a reason a verifier can read:
  location 30 · capture time 20 · originality 35 · file integrity 15
"""

from datetime import timedelta

from . import geo
from .evidence import parse_iso

WEIGHTS = {"location": 30, "time": 20, "originality": 35, "integrity": 15}
PHASH_NEAR = 6  # Hamming distance (of 64 bits) for "the same photo, maybe resized or re-compressed"
EDITING_APPS = ("photoshop", "lightroom", "snapseed", "picsart", "canva", "gimp", "facetune", "remini", "meitu")


def phash_distance(a: str | None, b: str | None) -> int | None:
    if not a or not b or len(a) != len(b):
        return None
    try:
        return bin(int(a, 16) ^ int(b, 16)).count("1")
    except ValueError:
        return None


def build_index(projects: list[dict]) -> list[tuple[dict, dict]]:
    """(evidence, project) for every processed item across every project: reuse is checked globally."""
    return [(ev, p) for p in projects for ev in p.get("evidence", []) if ev.get("status") == "ready"]


def _site(project: dict, site_id: str | None) -> dict | None:
    return next((s for s in project.get("sites", []) if s["id"] == site_id), None)


def _check(key: str, label: str, points: int, status: str, detail: str) -> dict:
    return {"key": key, "label": label, "points": points, "max": WEIGHTS[key], "status": status, "detail": detail}


def _metres(d: float) -> str:
    return f"{d / 1000:.1f} km" if d >= 1000 else f"{d:.0f} m"


def check_location(ev: dict, project: dict) -> dict:
    site = _site(project, ev.get("site_id"))
    if not site:
        exif = ev.get("exif") or {}
        drawn = [s for s in project.get("sites", []) if len(s.get("boundary") or []) >= 3]
        if exif.get("lat") is not None and drawn:
            nearest = min(drawn, key=lambda s: geo.distance_to_polygon_m(s["boundary"], exif["lat"], exif["lng"]))
            d = geo.distance_to_polygon_m(nearest["boundary"], exif["lat"], exif["lng"])
            return _check("location", "Location", 0, "fail", f"Photo GPS is {_metres(d)} from the nearest site, “{nearest['name']}”")
        return _check("location", "Location", 0, "fail", "Not linked to any site of this project")
    boundary = site.get("boundary") or []
    if len(boundary) < 3:
        return _check("location", "Location", 10, "warn", f"Site “{site['name']}” has no boundary drawn yet")
    exif = ev.get("exif") or {}
    if exif.get("lat") is not None:
        d = geo.distance_to_polygon_m(boundary, exif["lat"], exif["lng"])
        if d == 0:
            return _check("location", "Location", 30, "pass", f"Photo GPS is inside “{site['name']}”")
        if d <= geo.GPS_TOLERANCE_M:
            return _check("location", "Location", 30, "pass", f"Photo GPS is at the edge of “{site['name']}” ({d:.0f} m, within GPS accuracy)")
        if d <= 250:
            return _check("location", "Location", 20, "warn", f"Photo GPS is {_metres(d)} outside the boundary")
        return _check("location", "Location", 0, "fail", f"Photo GPS is {_metres(d)} away from “{site['name']}”")
    device = ev.get("device")
    if device:
        d = geo.distance_to_polygon_m(boundary, device["lat"], device["lng"])
        if d <= 250:
            return _check("location", "Location", 15, "warn", "No GPS in the file; the phone was at the site when it was uploaded")
        return _check("location", "Location", 0, "fail", f"No GPS in the file; uploaded {_metres(d)} away from the site")
    return _check("location", "Location", 0, "warn", "No GPS in the file (WhatsApp and many apps remove it)")


def check_time(ev: dict, project: dict) -> dict:
    taken = parse_iso((ev.get("exif") or {}).get("taken_at"))
    uploaded = parse_iso(ev.get("uploaded_at"))
    if not taken:
        return _check("time", "Capture time", 5, "warn", "No capture time in the file; upload time is used instead")
    # EXIF time has no zone; allow a day of slack for it.
    if uploaded and taken > uploaded + timedelta(days=1):
        return _check("time", "Capture time", 0, "fail", "Capture time is after the upload time (camera clock or edited file)")
    start = parse_iso(project.get("start_date"))
    if start and taken < start - timedelta(days=3 * 365):
        return _check("time", "Capture time", 8, "warn", f"Taken {taken:%b %Y}, over 3 years before the project started")
    return _check("time", "Capture time", 20, "pass", f"Captured {taken:%d %b %Y, %H:%M}")


def _earlier(a: dict, b: dict) -> bool:
    return (a.get("uploaded_at") or "", a["id"]) < (b.get("uploaded_at") or "", b["id"])


def check_originality(ev: dict, project: dict, index: list[tuple[dict, dict]]) -> dict:
    compared = 0
    near_same_site = None
    for other, other_project in index:
        if other["id"] == ev["id"]:
            continue
        compared += 1
        where = f"{other_project['name']}" + (f" · {_site(other_project, other.get('site_id'))['name']}" if _site(other_project, other.get("site_id")) else "")
        exact = (ev.get("sha256") and ev.get("sha256") == other.get("sha256")) or (ev.get("etag") and ev.get("etag") == other.get("etag"))
        if exact and _earlier(other, ev):
            return _check("originality", "Originality", 0, "fail", f"Identical file was already submitted in {where}")
        distance = phash_distance(ev.get("phash"), other.get("phash"))
        if distance is None or distance > PHASH_NEAR or not _earlier(other, ev):
            continue
        same_site = other_project["id"] == project["id"] and other.get("site_id") == ev.get("site_id")
        if not same_site:
            return _check("originality", "Originality", 0, "fail", f"Near-identical photo already used in {where}")
        near_same_site = other
    if near_same_site:
        a = parse_iso((near_same_site.get("exif") or {}).get("taken_at"))
        b = parse_iso((ev.get("exif") or {}).get("taken_at"))
        if a and b and abs((b - a).days) >= 7:
            return _check("originality", "Originality", 15, "warn", f"Looks the same as the photo from {a:%d %b %Y}: no visible change, or an old photo reused")
        return _check("originality", "Originality", 20, "warn", "Near-duplicate of another photo of this site")
    return _check("originality", "Originality", 35, "pass", f"No match among {compared} other items across all projects")


def check_integrity(ev: dict) -> dict:
    exif = ev.get("exif") or {}
    software = (exif.get("software") or "").lower()
    camera = " ".join(x for x in (exif.get("make"), exif.get("model")) if x)
    if any(app in software for app in EDITING_APPS):
        points, status, detail = 5, "warn", f"Edited with {exif['software']}"
    elif not camera and not exif.get("taken_at"):
        points, status, detail = 8, "warn", "Camera details removed from the file (forwarded or screenshot?)"
    else:
        points, status, detail = 15, "pass", f"Camera: {camera}" if camera else "File details intact"
    quality = ev.get("quality")
    if isinstance(quality, (int, float)) and quality < 0.35:
        points, status = max(0, points - 5), "warn"
        detail += " · blurry or low quality"
    return _check("integrity", "File integrity", points, status, detail)


def grade(score: int) -> str:
    return "strong" if score >= 80 else "review" if score >= 50 else "weak"


def score(ev: dict, project: dict, index: list[tuple[dict, dict]]) -> dict:
    checks = [check_location(ev, project), check_time(ev, project), check_originality(ev, project, index), check_integrity(ev)]
    total = sum(c["points"] for c in checks)
    return {"score": total, "grade": grade(total), "checks": checks}
