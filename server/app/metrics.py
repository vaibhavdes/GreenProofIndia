"""Impact metrics per site, only from what the team observed: water spread per date and sapling counts per survey."""

from collections import Counter

from . import geo


def _usable(ev: dict) -> bool:
    return ev.get("status") == "ready" and (ev.get("review") or {}).get("status") != "rejected"


def site_metrics(project: dict, site: dict, proofs: dict[str, dict]) -> dict:
    evidence = [e for e in project.get("evidence", []) if e.get("site_id") == site["id"] and _usable(e)]
    scores = [proofs[e["id"]]["score"] for e in evidence if e["id"] in proofs]
    measurements = sorted((m for m in project.get("measurements", []) if m["site_id"] == site["id"]), key=lambda m: m["date"])
    out = {
        "boundary_ha": round(geo.area_ha(site.get("boundary") or []), 2),
        "evidence": len(evidence),
        "photos": sum(e["resource_type"] == "image" for e in evidence),
        "videos": sum(e["resource_type"] == "video" for e in evidence),
        "avg_proof": round(sum(scores) / len(scores)) if scores else None,
        "flagged": sum(1 for e in evidence if e["id"] in proofs and proofs[e["id"]]["grade"] == "weak"),
        "activities": Counter(a["name"] for e in evidence for a in e.get("activities", [])).most_common(),
    }
    water = [m for m in measurements if m["kind"] == "water"]
    if water:
        first, last = water[0], water[-1]
        out["water"] = {
            "baseline_ha": first["water_area_ha"],
            "baseline_date": first["date"],
            "latest_ha": last["water_area_ha"],
            "latest_date": last["date"],
            # A change needs two observations; with one there is only the measured area.
            "change_ha": round(last["water_area_ha"] - first["water_area_ha"], 2) if len(water) > 1 else None,
            "change_pct": round((last["water_area_ha"] - first["water_area_ha"]) / first["water_area_ha"] * 100) if len(water) > 1 and first["water_area_ha"] else None,
        }
    survival = [m for m in measurements if m["kind"] == "survival"]
    if survival:
        last_date = survival[-1]["date"]
        latest = [m for m in survival if m["date"] == last_date]
        planted = sum(m["planted"] for m in latest)
        alive = sum(m["alive"] for m in latest)
        out["survival"] = {
            "date": last_date,
            "planted": planted,
            "alive": alive,
            "pct": round(alive / planted * 100) if planted else None,
        }
    return out


def project_metrics(sites: list[dict], evidence: list[dict]) -> dict:
    ms = [s["metrics"] for s in sites]
    usable = [e for e in evidence if _usable(e) and e.get("proof")]
    water = [m["water"] for m in ms if m.get("water", {}).get("change_ha") is not None]
    survival = [m["survival"] for m in ms if "survival" in m]
    planted = sum(s["planted"] for s in survival)
    alive = sum(s["alive"] for s in survival)
    return {
        "sites": len(sites),
        # Across all evidence, including items not matched to any site (those are exactly the ones to review).
        "evidence": len(usable),
        "avg_proof": round(sum(e["proof"]["score"] for e in usable) / len(usable)) if usable else None,
        "flagged": sum(1 for e in usable if e["proof"]["grade"] == "weak"),
        "water_gain_ha": round(sum(w["change_ha"] for w in water), 2) if water else None,
        "trees_planted": planted or None,
        "trees_alive": alive or None,
        "survival_pct": round(alive / planted * 100) if planted else None,
    }


def _month(value: str | None) -> str | None:
    if not value or len(value) < 7:
        return None
    y, m = value[:4], value[5:7]
    names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{names[int(m) - 1]} {y}" if m.isdigit() and 1 <= int(m) <= 12 else None


def span(days: int) -> str:
    if days < 60:
        return _n(days, "day")
    if days < 730:
        return _n(round(days / 30.4), "month")
    return f"{days / 365.25:.1f} years"


def _n(count: int, word: str) -> str:
    return f"{count:,} {word}{'' if count == 1 else 's'}"


def summary(sites: list[dict], evidence: list[dict]) -> list[str]:
    """Plain-language summary, built only from the recorded evidence and observations."""
    ready = [e for e in evidence if e.get("status") == "ready" and (e.get("review") or {}).get("status") != "rejected"]
    if not ready:
        return []
    times = sorted(t for t in ((e.get("exif") or {}).get("taken_at") or (e.get("uploaded_at") or "")[:19] for e in ready) if t)
    photos = sum(e["resource_type"] == "image" for e in ready)
    videos = len(ready) - photos
    span_text = ""
    if times:
        first, last = _month(times[0]), _month(times[-1])
        span_text = f", captured {first}" if first == last else f", captured {first} to {last}"
    media = " and ".join(_n(n, w) for n, w in ((photos, "photo"), (videos, "video")) if n)
    lines = [f"{media} from {_n(len(sites), 'site')}{span_text}."]
    grades = Counter(e["proof"]["grade"] for e in ready if e.get("proof"))
    if grades:
        line = f"{grades['strong']} of {sum(grades.values())} items have strong proof"
        if grades["weak"]:
            line += f"; {grades['weak']} {'is' if grades['weak'] == 1 else 'are'} weak or reused and {'needs' if grades['weak'] == 1 else 'need'} review"
        lines.append(line + ".")
    for site in sites:
        m = site["metrics"]
        if "water" in m:
            w = m["water"]
            if w["change_ha"] is None:
                lines.append(f"{site['name']}: water spread measured at {w['latest_ha']} ha on {w['latest_date']}.")
            else:
                verb = "grew" if w["change_ha"] >= 0 else "shrank"
                lines.append(f"{site['name']}: water spread {verb} from {w['baseline_ha']} ha ({w['baseline_date']}) to {w['latest_ha']} ha ({w['latest_date']}).")
        if "survival" in m:
            s = m["survival"]
            lines.append(f"{site['name']}: {s['alive']:,} of {s['planted']:,} saplings alive on {s['date']} ({s['pct']}%).")
        pair = site.get("pair")
        if pair:
            where = " from the same spot" if pair.get("distance_m") is not None and pair["distance_m"] <= 150 else ""
            lines.append(f"{site['name']}: before/after photos{where}, {span(pair['days'])} apart.")
    top = Counter(a["name"] for e in ready for a in e.get("activities", [])).most_common(3)
    if top:
        lines.append("Most documented: " + ", ".join(f"{name} ({n})" for name, n in top) + ".")
    return lines
