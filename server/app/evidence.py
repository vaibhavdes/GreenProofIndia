"""Turn a Cloudinary asset into an evidence record: capture facts, AI understanding, site assignment."""

import hashlib
import logging
import re
from datetime import datetime, timezone

from . import cld, config, geo, store

log = logging.getLogger("greenproof.evidence")

# When AI Vision is off or unavailable, map Cloudinary's own tags and caption onto the same activity names.
KEYWORDS = {
    "dry lakebed": ["dry", "drought", "cracked", "mud crack", "arid", "dried"],
    "water-filled lake": ["lake", "pond", "reservoir", "water resources", "body of water", "waterway", "loch"],
    "desilting work": ["excavator", "bulldozer", "digger", "construction equipment", "backhoe", "jcb", "digging", "tractor"],
    "bund or embankment work": ["embankment", "retaining wall", "stone wall", "levee", "masonry"],
    "weeds or waste in water": ["algae", "hyacinth", "garbage", "waste", "pollution", "litter"],
    "saplings planted": ["sapling", "seedling", "tree guard", "planting", "young plant", "nursery", "pit", "trench"],
    "established trees": ["forest", "woodland", "tree", "grove", "vegetation", "canopy"],
    "dead or dry saplings": ["dead plant", "dead tree", "withered", "barren"],
    "people working": ["worker", "people", "crowd", "labor", "volunteer", "community"],
    "project signboard": ["signage", "sign", "billboard", "banner"],
}

_DMS = re.compile(r"(\d+(?:\.\d+)?)\s*deg\s*(\d+(?:\.\d+)?)?'?\s*(\d+(?:\.\d+)?)?\"?\s*([NSEW])?", re.I)


def parse_coord(value, ref: str | None = None) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = str(value).strip()
        match = _DMS.search(text)
        if match:
            d, m, s, hemi = match.groups()
            number = float(d) + float(m or 0) / 60 + float(s or 0) / 3600
            ref = hemi or ref
        else:
            try:
                number = float(text.split()[0])
            except ValueError:
                return None
            if text[-1:].upper() in "NSEW":
                ref = text[-1:]
    if ref and ref.strip().upper()[:1] in ("S", "W"):
        number = -abs(number)
    return number


def parse_position(meta: dict) -> tuple[float, float] | None:
    lat = parse_coord(meta.get("GPSLatitude"), meta.get("GPSLatitudeRef"))
    lng = parse_coord(meta.get("GPSLongitude"), meta.get("GPSLongitudeRef"))
    if (lat is None or lng is None) and meta.get("GPSPosition"):
        parts = str(meta["GPSPosition"]).split(",")
        if len(parts) == 2:
            lat, lng = parse_coord(parts[0]), parse_coord(parts[1])
    if (lat is None or lng is None) and meta.get("GPSCoordinates"):  # videos: "18.5204, 73.8567, 560"
        parts = re.split(r"[,\s]+", str(meta["GPSCoordinates"]).strip())
        if len(parts) >= 2:
            lat, lng = parse_coord(parts[0]), parse_coord(parts[1])
    if lat is None or lng is None or (lat == 0 and lng == 0) or abs(lat) > 90 or abs(lng) > 180:
        return None
    return round(lat, 7), round(lng, 7)


def parse_time(meta: dict) -> str | None:
    for key in ("DateTimeOriginal", "CreateDate", "MediaCreateDate", "DateTimeDigitized", "DateTime"):
        raw = meta.get(key)
        if not raw:
            continue
        match = re.match(r"(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):?(\d{2})?", str(raw))
        if not match or match.group(1) == "0000":
            continue
        y, mo, d, h, mi, s = (int(g or 0) for g in match.groups())
        try:
            return datetime(y, mo, d, h, mi, s).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
    return None


def parse_heading(meta: dict) -> float | None:
    try:
        return round(float(str(meta.get("GPSImgDirection")).split()[0]), 1)
    except (TypeError, ValueError):
        return None


def parse_context(resource: dict) -> dict:
    return (resource.get("context") or {}).get("custom", {}) or {}


def google_tags(resource: dict) -> list[str]:
    info = resource.get("info") or {}
    categorization = info.get("categorization") or {}
    out = []
    for engine in categorization.values():
        for item in (engine or {}).get("data") or []:
            tag = item.get("tag") if isinstance(item, dict) else None
            if tag and (item.get("confidence") or 1) >= 0.55:
                out.append(tag.lower())
    return out


def caption(resource: dict) -> str | None:
    detection = (resource.get("info") or {}).get("detection") or {}
    data = (detection.get("captioning") or {}).get("data") or {}
    return data.get("caption") if isinstance(data, dict) else None


def keyword_activities(tags: list[str], text: str | None) -> list[dict]:
    haystack = " " + " ".join(tags + [text or ""]).lower() + " "
    names = [name for name, words in KEYWORDS.items() if any(w in haystack for w in words)]
    if "dry lakebed" in names and "water-filled lake" in names:
        names.remove("water-filled lake")  # "a dry lake bed" mentions a lake but is not water-filled
    return [{"name": name, "confidence": None, "via": "tags"} for name in names]


def facts_from_resource(resource: dict) -> dict:
    """Pure: everything we keep about an asset, from one Admin API response."""
    meta = resource.get("image_metadata") or resource.get("media_metadata") or resource.get("video_metadata") or {}
    ctx = parse_context(resource)
    position = parse_position(meta)
    device = None
    try:
        if ctx.get("gp_dev_lat") and ctx.get("gp_dev_lng"):
            device = {"lat": float(ctx["gp_dev_lat"]), "lng": float(ctx["gp_dev_lng"]), "accuracy_m": float(ctx.get("gp_dev_acc") or 0) or None}
    except ValueError:
        device = None
    quality = resource.get("quality_analysis") or {}
    tags = [t for t in resource.get("tags", []) if not t.startswith("gp")]
    for tag in google_tags(resource):
        if tag not in tags:
            tags.append(tag)
    return {
        "id": resource["asset_id"],
        "public_id": resource["public_id"],
        "version": resource.get("version"),
        "resource_type": resource.get("resource_type", "image"),
        "format": resource.get("format"),
        "width": resource.get("width"),
        "height": resource.get("height"),
        "bytes": resource.get("bytes"),
        "duration": resource.get("duration"),
        "etag": resource.get("etag"),
        "phash": resource.get("phash"),
        "secure_url": resource.get("secure_url"),
        "uploaded_at": resource.get("created_at"),
        "original_filename": resource.get("original_filename"),
        "exif": {
            "lat": position[0] if position else None,
            "lng": position[1] if position else None,
            "taken_at": parse_time(meta),
            "heading": parse_heading(meta),
            "make": meta.get("Make"),
            "model": meta.get("Model"),
            "software": meta.get("Software"),
        },
        "device": device,
        "uploader": ctx.get("gp_by") or None,
        "chosen_site": ctx.get("gp_site") or None,
        "tags": tags[:25],
        "caption": caption(resource),
        "faces": len(resource.get("faces") or []),
        "quality": quality.get("focus") if isinstance(quality.get("focus"), (int, float)) else resource.get("quality_score"),
    }


def assign_site(project: dict, facts: dict) -> tuple[str | None, str]:
    """GPS inside a site boundary wins; then the site chosen at upload; then the nearest site within 500 m."""
    sites = [s for s in project.get("sites", []) if len(s.get("boundary") or []) >= 3]
    points = []
    if facts["exif"]["lat"] is not None:
        points.append(((facts["exif"]["lat"], facts["exif"]["lng"]), "photo GPS"))
    if facts.get("device"):
        points.append(((facts["device"]["lat"], facts["device"]["lng"]), "phone location at upload"))
    for point, source in points:
        for site in sites:
            if geo.near_or_inside(site["boundary"], *point):
                return site["id"], source
    chosen = facts.get("chosen_site")
    if chosen and any(s["id"] == chosen for s in project.get("sites", [])):
        return chosen, "chosen at upload"
    lat, lng = facts["exif"]["lat"], facts["exif"]["lng"]
    if lat is not None and sites:
        nearest = min(sites, key=lambda s: geo.distance_to_polygon_m(s["boundary"], lat, lng))
        if geo.distance_to_polygon_m(nearest["boundary"], lat, lng) <= 500:
            return nearest["id"], "nearest site (photo GPS)"
    return None, "unassigned"


def placeholder(project: dict, public_id: str, resource_type: str) -> dict:
    """Show the upload in the UI straight away while Cloudinary data is fetched."""
    with store.lock():
        existing = next((e for e in project.setdefault("evidence", []) if e["public_id"] == public_id), None)
        if existing:
            return existing
        record = {"id": f"pending:{public_id}", "public_id": public_id, "resource_type": resource_type, "status": "processing", "uploaded_at": store.now_iso()}
        project["evidence"].append(record)
        store.touch(project["id"])
        return record


def ingest(project: dict, public_id: str, resource_type: str):
    """Runs in a worker thread: one Admin call, AI Vision, hashing, site assignment, then mirror back to Cloudinary."""
    try:
        resource = cld.resource(public_id, resource_type)
        ctx = parse_context(resource)
        if ctx.get("gp_project") != project["id"]:
            raise ValueError("this asset was not uploaded to this project")
        facts = facts_from_resource(resource)

        sha256 = None
        if resource_type == "image" and facts["secure_url"]:
            data = cld.download(facts["secure_url"])
            sha256 = hashlib.sha256(data).hexdigest() if data else None
        facts["sha256"] = sha256

        # Cloudinary AI, per item after upload. Photos: one look. Videos: frames from the start, middle and end,
        # so work shown anywhere in the clip counts. An add-on that is not enabled is noted and skipped.
        frames = ["50p"] if resource_type == "image" else ["10p", "50p", "90p"]
        middle = cld.still(facts, "c_limit,w_1024,h_1024,q_auto")
        facts["ai"] = {}

        def run(feature: str, call):
            try:
                result = call()
                facts["ai"][feature] = "ok"
                return result
            except Exception as exc:
                facts["ai"][feature] = cld.safe_error(exc)[:160]
                log.warning("%s unavailable for %s: %s", feature, public_id, facts["ai"][feature])
                return None

        if config.CAPTIONING and not facts["caption"]:
            facts["caption"] = run("captioning", lambda: cld.caption(middle))
        if config.TAGGING:
            for tag in run("google_tagging", lambda: cld.google_tags(middle)) or []:
                if tag not in facts["tags"]:
                    facts["tags"].append(tag)
        activities: dict[str, dict] = {}
        if config.AI_VISION:
            for tags in run("ai_vision", lambda: [cld.ai_vision_tags(cld.still(facts, "c_limit,w_1024,h_1024,q_auto", offset=o)) for o in frames]) or []:
                for tag in tags:
                    best = activities.get(tag["name"])
                    if not best or (tag["confidence"] or 0) > (best["confidence"] or 0):
                        activities[tag["name"]] = {**tag, "via": "ai_vision"}
        activities = list(activities.values())
        if not activities:
            activities = keyword_activities(facts["tags"], facts["caption"])
        facts["activities"] = activities

        with store.lock():
            old = next((e for e in project.get("evidence", []) if e["public_id"] == public_id), None)
            if old and old.get("site_source") == "set by team":
                site_id, site_source = old.get("site_id"), "set by team"
            else:
                site_id, site_source = assign_site(project, facts)
            facts.update(site_id=site_id, site_source=site_source, status="ready")
            facts["review"] = (old or {}).get("review") or {"status": "pending"}
            reanalysed = bool(old and old.get("exif") is not None)  # it was processed before
            project["evidence"] = [e for e in project.get("evidence", []) if e["public_id"] != public_id] + [facts]
            store.touch(project["id"])
        if reanalysed:
            store.audit(project, "evidence.reanalysed", f"{public_id}: Cloudinary AI ran again", facts["id"])
        else:
            store.audit(project, "evidence.added", f"{resource_type} {public_id} → {site_source}", facts["id"], facts.get("uploader") or "field team")
        mirror(project, facts)
    except Exception as exc:
        log.exception("ingest failed for %s", public_id)
        with store.lock():
            for record in project.get("evidence", []):
                if record["public_id"] == public_id:
                    record.update(status="error", error=cld.safe_error(exc))
            store.touch(project["id"])


def mirror(project: dict, facts: dict):
    """Write what we learned back onto the asset, so the Media Library is organised by site and activity."""
    from . import proof  # local import: proof depends on this module's records

    try:
        result = proof.score(facts, project, proof.build_index(store.all_projects()))
        tags = [f"gp_site_{facts['site_id']}" if facts.get("site_id") else "gp_unassigned"]
        tags += ["gp_act_" + re.sub(r"[^a-z0-9]+", "_", a["name"]) for a in facts["activities"]]
        if any(c["status"] == "fail" and c["key"] == "originality" for c in result["checks"]):
            tags.append("gp_flag_reused")
        cld.add_tags(facts["public_id"], facts["resource_type"], tags)
        context = {"gp_score": str(result["score"]), "gp_grade": result["grade"]}
        if facts.get("site_id"):
            context["gp_site"] = facts["site_id"]
        if facts.get("sha256"):
            context["gp_sha256"] = facts["sha256"]
        cld.add_context(facts["public_id"], facts["resource_type"], context)
    except Exception as exc:
        log.warning("could not mirror %s to Cloudinary: %s", facts["public_id"], cld.safe_error(exc))


def capture_time(ev: dict) -> str:
    return (ev.get("exif") or {}).get("taken_at") or (ev.get("uploaded_at") or "")[:19]


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
