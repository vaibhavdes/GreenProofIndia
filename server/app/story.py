"""Before/after pairing and the impact story: composites, social crops, a reel (MP4) and a verification pack (PDF).

Every output is a Cloudinary transformation of the original evidence, so each one traces back to a
public_id + version. Outputs are built from photos, with faces blurred.
"""

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from . import cld, config, geo, metrics, store
from .evidence import capture_time, parse_iso

log = logging.getLogger("greenproof.story")

MIN_GAP_DAYS = 14
BLUR = "e_blur_faces:800"


def _usable_images(project: dict, site_id: str) -> list[dict]:
    items = [
        e for e in project.get("evidence", [])
        if e.get("site_id") == site_id and e.get("status") == "ready" and e["resource_type"] == "image"
        and (e.get("review") or {}).get("status") != "rejected"
    ]
    return sorted(items, key=capture_time)


def _days(a: dict, b: dict) -> int:
    ta, tb = parse_iso(capture_time(a)), parse_iso(capture_time(b))
    return (tb - ta).days if ta and tb else 0


def _distance(a: dict, b: dict) -> float | None:
    ea, eb = a.get("exif") or {}, b.get("exif") or {}
    if ea.get("lat") is None or eb.get("lat") is None:
        return None
    return geo.haversine_m((ea["lat"], ea["lng"]), (eb["lat"], eb["lng"]))


def _viewpoint(a: dict, b: dict) -> tuple[float, str]:
    ea, eb = a.get("exif") or {}, b.get("exif") or {}
    score, notes = 0.0, []
    d = _distance(a, b)
    if d is not None:
        score += max(0.0, 1 - d / 150) * 0.6
        notes.append(f"{d:.0f} m apart")
    else:
        score += 0.15
    if ea.get("heading") is not None and eb.get("heading") is not None:
        diff = abs((ea["heading"] - eb["heading"] + 180) % 360 - 180)
        score += max(0.0, 1 - diff / 90) * 0.4
        notes.append(f"facing within {diff:.0f}°")
    else:
        score += 0.1
    return score, ", ".join(notes)


def pair_for_site(project: dict, site: dict, proofs: dict[str, dict] | None = None) -> dict | None:
    items = _usable_images(project, site["id"])
    by_id = {e["id"]: e for e in items}
    # Auto-pairing trusts only the camera's own timestamp, and never weak (e.g. reused) evidence.
    candidates = [e for e in items if (e.get("exif") or {}).get("taken_at") and (not proofs or proofs.get(e["id"], {}).get("grade") != "weak")]
    manual = site.get("pair") or {}
    if manual.get("before") in by_id and manual.get("after") in by_id:
        before, after = by_id[manual["before"]], by_id[manual["after"]]
        return {"site_id": site["id"], "before": before["id"], "after": after["id"], "auto": False, "days": _days(before, after), "distance_m": _distance(before, after), "reason": "Chosen by the project team"}
    if len(candidates) < 2:
        return None
    third = max(1, len(candidates) // 3)
    best = None
    for b in candidates[:third]:
        for a in candidates[-third:]:
            gap = _days(b, a)
            if gap < MIN_GAP_DAYS:
                continue
            distance = _distance(b, a)
            if distance is not None and distance > 150:
                continue
            view, notes = _viewpoint(b, a)
            value = view + min(gap / 365, 1) * 0.3
            if not best or value > best[0]:
                best = (value, b, a, gap, notes)
    if not best:
        return None
    _, b, a, gap, notes = best
    reason = f"Earliest and latest views, {metrics.span(gap)} apart" + (f"; {notes}" if notes else "")
    return {"site_id": site["id"], "before": b["id"], "after": a["id"], "auto": True, "days": gap, "distance_m": _distance(b, a), "reason": reason}


# ------------------------------ delivery URLs ------------------------------


def views(ev: dict, public: bool) -> dict:
    blur = f"/{BLUR}" if public else ""
    if ev["resource_type"] == "video":
        # Face blurring works on images only (on a video frame it blurs everything), so videos are shown as recorded
        # and reach the public report only once the team has accepted them.
        return {
            "thumb": cld.still(ev, "c_fill,g_auto,w_480,h_360/q_auto"),
            "large": cld.still(ev, "c_limit,w_1600,h_1600/q_auto"),
            "video": cld.url(ev["public_id"], "c_limit,w_1280,h_1280/q_auto", version=ev.get("version"), resource_type="video", fmt="mp4"),
        }
    return {
        "thumb": cld.still(ev, f"c_fill,g_auto,w_480,h_360{blur}/q_auto/f_auto"),
        "large": cld.still(ev, f"c_limit,w_1600,h_1600{blur}/q_auto/f_auto"),
        "slider": cld.still(ev, f"c_fill,g_center,w_1200,h_800/{BLUR}/q_auto/f_auto"),
    }


def _date_label(ev: dict) -> str:
    parsed = parse_iso(capture_time(ev))
    return parsed.strftime("%d %b %Y") if parsed else "date unknown"


def _label(text: str, size: int, gravity: str, x: int, y: int, bold: bool = True, color: str = "white", bg: str | None = "rgb:00000099", width: int | None = None) -> str:
    font = f"Arial_{size}" + ("_bold" if bold else "")
    style = f"l_text:{font}:{cld.text(text)},co_{color}" + (f",b_{bg}" if bg else "") + (f",c_fit,w_{width}" if width else "")
    return f"{style}/fl_layer_apply,g_{gravity},x_{x},y_{y}"


def composite_url(before: dict, after: dict, title: str) -> str:
    """One shareable image: before | after, dated, faces blurred."""
    steps = [
        f"c_fill,g_center,w_800,h_800/{BLUR}",
        "c_pad,g_west,w_1600,h_800,b_black",
        f"l_{cld.layer_id(after['public_id'])},c_fill,g_center,w_800,h_800/{BLUR}/fl_layer_apply,g_east",
        _label(f" BEFORE · {_date_label(before)} ", 34, "south_west", 24, 24),
        _label(f" AFTER · {_date_label(after)} ", 34, "south_east", 24, 24),
        _label(f" {title} ", 30, "north", 0, 20, bold=False),
        "q_auto",
    ]
    return cld.url(before["public_id"], "/".join(steps), version=before.get("version"), fmt="jpg")


def social_urls(ev: dict, caption: str) -> dict:
    overlay = _label(f" {caption} ", 40, "south", 0, 60, width=960)
    return {
        "square": cld.still(ev, f"c_fill,g_auto,w_1080,h_1080/{BLUR}/e_improve/{overlay}/q_auto"),
        "vertical": cld.still(ev, f"c_fill,g_auto,w_1080,h_1920/{BLUR}/e_improve/{overlay}/q_auto"),
        "wide": cld.still(ev, f"c_fill,g_auto,w_1200,h_630/{BLUR}/e_improve/{overlay}/q_auto"),
    }


# ------------------------------ reel & pack ------------------------------


def _reel_frame(ev: dict, heading: str, lines: list[str], dim: bool = False) -> str:
    """9:16 frame. Plain frames: heading on top, lines at the bottom. Dim frames: title card text in the centre."""
    lines = [l for l in lines if l]
    steps = [f"c_fill,g_center,w_720,h_1280/{BLUR}"]
    if dim:
        steps += ["e_blur:600/e_brightness:-45", _label(heading, 56, "center", 0, -160, width=640, bg=None)]
        steps += [_label(line, 32, "center", 0, -40 + i * 64, bold=False, width=640, bg=None) for i, line in enumerate(lines)]
    else:
        steps.append(_label(f" {heading} ", 56, "north", 0, 110))
        steps += [_label(f" {line} ", 32, "south", 0, 120 + (len(lines) - 1 - i) * 60, bold=False, width=640) for i, line in enumerate(lines)]
    steps.append("q_auto")
    return cld.still(ev, "/".join(steps))


def _height(text: str, size: int, width: int = 1100) -> int:
    """Height a wrapped text overlay takes (Arial averages about half its size per character)."""
    per_line = max(1, int(width / (size * 0.52)))
    return math.ceil(len(text) / per_line) * round(size * 1.45)


def _pack_page(ev: dict, lines: list[str]) -> str:
    lines = [line for line in lines if line and line.strip()]  # Cloudinary rejects an empty text overlay
    steps = [f"c_fill,g_center,w_1240,h_900/{BLUR}", "c_pad,g_north,w_1240,h_1754,b_white"]
    y = 940
    for i, line in enumerate(lines):
        size = 40 if i == 0 else 28
        steps.append(_label(line, size, "north_west", 70, y, bold=i == 0, color="rgb:111827", bg=None, width=1100))
        y += _height(line, size) + 12
    steps.append(_label("GreenProof verification pack · faces blurred · originals traceable by Cloudinary public ID and version", 22, "south", 0, 40, bold=False, color="rgb:6b7280", bg=None, width=1100))
    return cld.still(ev, "/".join(steps))


def _cover_page(ev: dict, project: dict, summary: list[str]) -> str:
    summary = [line for line in summary if line and line.strip()]
    steps = [f"c_fill,g_center,w_1240,h_700/{BLUR}", "c_pad,g_north,w_1240,h_1754,b_white"]
    steps.append(_label(project["name"], 64, "north_west", 70, 760, color="rgb:065f46", bg=None, width=1100))
    y = 760 + _height(project["name"], 64) + 30
    for line in summary:
        if y > 1680:
            break
        steps.append(_label(line, 30, "north_west", 70, y, bold=False, color="rgb:111827", bg=None, width=1100))
        y += _height(line, 30) + 18
    return cld.still(ev, "/".join(steps))


def build(project: dict, story_id: str, view: dict):
    """Worker thread. `view` is the editor view of the project (sites with metrics, evidence with proofs)."""
    story = next(s for s in project["stories"] if s["id"] == story_id)
    try:
        evidence = {e["id"]: e for e in view["evidence"]}
        pm = view["metrics"]
        headline = []
        if pm.get("water_gain_ha") is not None:
            headline.append(f"Water spread {pm['water_gain_ha']:+} ha")
        if pm.get("survival_pct") is not None:
            headline.append(f"{pm['trees_alive']:,} of {pm['trees_planted']:,} trees alive ({pm['survival_pct']}%)")
        if pm.get("avg_proof") is not None:
            headline.append(f"{pm['evidence']} evidence items · average Proof Score {pm['avg_proof']}/100")

        composites, frames, pages, social, sources = [], [], [], [], []
        for site in view["sites"]:
            pair = site.get("pair")
            if not pair:
                continue
            before, after = evidence[pair["before"]], evidence[pair["after"]]
            sources += [before["id"], after["id"]]
            composites.append({"site_id": site["id"], "url": composite_url(before, after, f"{project['name']} · {site['name']}"), "before": before["id"], "after": after["id"]})
            m = site["metrics"]
            result = []
            if "water" in m:
                w = m["water"]
                result.append(f"Water spread {w['latest_ha']} ha" if w["change_ha"] is None else f"Water spread {w['baseline_ha']} → {w['latest_ha']} ha")
            if "survival" in m:
                result.append(f"{m['survival']['pct']}% of saplings alive")
            frames.append(_reel_frame(before, "BEFORE", [site["name"], _date_label(before)]))
            frames.append(_reel_frame(after, "AFTER", [site["name"], _date_label(after)] + result))
            social.append({"site_id": site["id"], "evidence_id": after["id"], **social_urls(after, f"{site['name']}: {' · '.join(result) or 'restoration in progress'}")})

        strongest = sorted((e for e in view["evidence"] if e.get("proof") and e["proof"]["grade"] == "strong" and e["resource_type"] == "image"), key=lambda e: -e["proof"]["score"])
        # The pack is for verifiers: every photo (flagged ones too), grouped by site and in date order.
        site_order = {s["id"]: i for i, s in enumerate(view["sites"])}
        photos = sorted((e for e in view["evidence"] if e.get("proof") and e["resource_type"] == "image"), key=lambda e: (site_order.get(e.get("site_id"), 99), capture_time(e)))
        for ev in photos[:28]:
            site_name = next((s["name"] for s in view["sites"] if s["id"] == ev.get("site_id")), "")
            exif = ev.get("exif") or {}
            gps = f"GPS {exif['lat']:.5f}, {exif['lng']:.5f}" if exif.get("lat") is not None else "No GPS in file"
            checks = " · ".join(f"{c['label']} {c['points']}/{c['max']}" for c in ev["proof"]["checks"])
            issues = "; ".join(c["detail"] for c in ev["proof"]["checks"] if c["status"] != "pass")
            pages.append(_pack_page(ev, [
                f"{site_name or 'No site'} · {_date_label(ev)} · Proof Score {ev['proof']['score']}/100 ({ev['proof']['grade']})",
                (ev.get("caption") or "").capitalize() or ", ".join(a["name"] for a in ev.get("activities", [])[:3]),
                " · ".join(x for x in (gps, ", ".join(a["name"] for a in ev.get("activities", [])[:3])) if x),
                checks,
                f"Check: {issues}" if issues else "",
                f"Cloudinary public ID {ev['public_id']} · version {ev.get('version')}",
                f"SHA-256 {ev.get('sha256') or 'n/a'}",
            ]))
            if ev["id"] not in sources:
                sources.append(ev["id"])

        if not frames and strongest:
            fallback = strongest[:6]
            frames = [_reel_frame(ev, _date_label(ev), [next((s["name"] for s in view["sites"] if s["id"] == ev.get("site_id")), "")]) for ev in fallback]
            sources.extend(ev["id"] for ev in fallback if ev["id"] not in sources)
        if not frames:
            raise ValueError("Add at least two photos of one site, taken 2+ weeks apart, or some strong evidence first")

        cover = evidence[sources[-1]] if sources else strongest[0]
        frames.append(_reel_frame(cover, project["name"], headline + ["Evidence documented with GreenProof"], dim=True))
        frames.insert(0, _reel_frame(evidence[sources[0]] if sources else cover, project["name"], [project.get("org") or "", "Did the restoration work? Here is the evidence."], dim=True))
        pages.insert(0, _cover_page(cover, project, (view.get("summary") or headline)[:7] + [f"Generated {datetime.now():%d %b %Y}", f"Funder: {project.get('funder') or '—'} · Implementer: {project.get('org') or '—'}"]))

        base = f"{config.ROOT_FOLDER}/{project['id']}/stories/{story_id}"
        reel, pack = None, None
        for kind, urls in (("reel", frames[:30]), ("pack", pages[:30])):
            tag = f"gp_{kind}_{story_id}"
            try:
                # Each frame/page becomes a real image (zero-padded names keep the order), then `multi` joins them.
                with ThreadPoolExecutor(max_workers=4) as pool:
                    list(pool.map(lambda item: cld.materialise(item[1], f"{base}/{kind}_{item[0]:02d}", tag), enumerate(urls)))
                result = cld.multi_from_tag(tag, "mp4" if kind == "reel" else "pdf", delay_ms=2200 if kind == "reel" else None)
                if kind == "reel":
                    reel = result
                else:
                    pack = result
            except Exception as exc:
                story[f"{kind}_error"] = cld.safe_error(exc)

        with store.lock():
            story.update(
                status="ready",
                composites=composites,
                social=social,
                frames=frames,
                reel=reel,
                pack=pack,
                sources=sources,
                headline=headline,
            )
            store.touch(project["id"])
        store.audit(project, "story.generated", f"Impact story from {len(sources)} evidence items", story_id)
    except Exception as exc:
        log.exception("story failed")
        with store.lock():
            story.update(status="error", error=cld.safe_error(exc))
            store.touch(project["id"])
