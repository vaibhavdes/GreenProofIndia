"""GreenProof API: a thin layer over Cloudinary (signing, orchestration, scoring, reports)."""

import hmac
import logging
import re
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import cld, config, evidence, geo, metrics, proof, store, story

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("greenproof")

workers = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gp-worker")
state = {"ready": False, "error": None}


def _boot():
    try:
        if not cld.configured():
            raise RuntimeError("Set CLOUDINARY_URL in server/.env")
        cld.ensure_presets()
        store.load()
        state["ready"] = True
    except Exception as exc:
        state["error"] = cld.safe_error(exc)
        log.error("startup failed: %s", state["error"])


@asynccontextmanager
async def lifespan(_app: FastAPI):
    threading.Thread(target=_boot, daemon=True).start()
    store.start()
    yield
    store.stop()


app = FastAPI(title="GreenProof", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-Editor-Key"],
)


# ------------------------------ guards ------------------------------


def ready():
    if not state["ready"]:
        raise HTTPException(503, state["error"] or "Starting up, loading projects from Cloudinary")


def team(x_editor_key: str | None = Header(default=None)):
    """Everything except the public report. Open when EDITOR_KEY is empty (local use, open trials)."""
    ready()
    if config.EDITOR_KEY and not (x_editor_key and hmac.compare_digest(x_editor_key, config.EDITOR_KEY)):
        raise HTTPException(401, "Team key required")


def _project(pid: str) -> dict:
    project = store.get(pid)
    if not project:
        raise HTTPException(404, "Project not found")
    return project


def _site(project: dict, sid: str) -> dict:
    site = next((s for s in project.get("sites", []) if s["id"] == sid), None)
    if not site:
        raise HTTPException(404, "Site not found")
    return site


def _evidence(project: dict, eid: str) -> dict:
    ev = next((e for e in project.get("evidence", []) if e["id"] == eid), None)
    if not ev:
        raise HTTPException(404, "Evidence not found")
    return ev


# ------------------------------ views ------------------------------

PRIVATE_FIELDS = ("device", "secure_url", "uploader", "chosen_site", "original_filename", "error")


def _is_public(ev: dict, result: dict) -> bool:
    """Weak evidence and videos need an explicit team decision before publication."""
    review = (ev.get("review") or {}).get("status")
    return (
        ev.get("status") == "ready"
        and review != "rejected"
        and (result["grade"] != "weak" or review == "accepted")
        and (ev["resource_type"] != "video" or review == "accepted")
    )


def _public_story(item: dict, visible_ids: set[str]) -> bool:
    sources = item.get("sources") or []
    return item.get("status") == "ready" and bool(sources) and set(sources).issubset(visible_ids)


def build_view(project: dict, public: bool = False) -> dict:
    index = proof.build_index(store.all_projects())
    items, proofs = [], {}
    for ev in project.get("evidence", []):
        item = dict(ev)
        if ev.get("status") == "ready":
            result = proof.score(ev, project, index)
            if public and not _is_public(ev, result):
                continue
            item["proof"] = proofs[ev["id"]] = result
            item["views"] = story.views(ev, public)
        elif public:
            continue
        if public:
            for field in PRIVATE_FIELDS:
                item.pop(field, None)
            if item.get("review"):
                item["review"] = {"status": item["review"].get("status")}
        items.append(item)
    items.sort(key=lambda e: e.get("uploaded_at") or "", reverse=True)
    visible_ids = set(proofs)
    view_project = {**project, "evidence": [ev for ev in project.get("evidence", []) if ev["id"] in visible_ids]} if public else project

    sites = []
    for site in project.get("sites", []):
        s = dict(site)
        s["metrics"] = metrics.site_metrics(view_project, site, proofs)
        s["pair"] = story.pair_for_site(view_project, site, proofs)
        sites.append(s)

    stories = sorted(project.get("stories", []), key=lambda s: s["created_at"], reverse=True)
    if public:
        stories = [s for s in stories if _public_story(s, visible_ids)][:1]
    view = {
        "id": project["id"],
        "name": project["name"],
        "kind": project.get("kind"),
        "org": project.get("org"),
        "funder": project.get("funder"),
        "description": project.get("description"),
        "start_date": project.get("start_date"),
        "created_at": project.get("created_at"),
        "sites": sites,
        "evidence": items,
        "measurements": sorted(project.get("measurements", []), key=lambda m: m["date"]),
        "metrics": metrics.project_metrics(sites, items),
        "summary": metrics.summary(sites, items),
        "stories": stories,
        # The audit log names field workers and holds reviewer notes: team only.
        "audit": [] if public else list(reversed(project.get("audit", [])))[:200],
    }
    if not public:
        view["share_token"] = project.get("share_token")
    return view


def _cover(project: dict) -> str | None:
    """The "after" photo of a chosen before/after pair, else the latest photo that shows the site itself."""
    usable = [
        e for e in project.get("evidence", [])
        if e.get("status") == "ready" and e.get("resource_type") == "image" and (e.get("review") or {}).get("status") != "rejected"
    ]
    by_id = {e["id"]: e for e in usable}
    chosen = [by_id[s["pair"]["after"]] for s in project.get("sites", []) if (s.get("pair") or {}).get("after") in by_id]
    views = [e for e in usable if not (e.get("activities") and {a["name"] for a in e["activities"]} <= story.NOT_A_VIEW)]
    latest = sorted(views or usable, key=lambda e: e.get("uploaded_at") or "", reverse=True)
    pick = (chosen or latest or [None])[0]
    return story.views(pick, True)["thumb"] if pick else None


def summary(project: dict) -> dict:
    ev = project.get("evidence", [])
    return {
        "id": project["id"],
        "name": project["name"],
        "kind": project.get("kind"),
        "org": project.get("org"),
        "funder": project.get("funder"),
        "sites": len(project.get("sites", [])),
        "evidence": len(ev),
        "cover": _cover(project),
        "created_at": project.get("created_at"),
    }


# ------------------------------ config & upload ------------------------------


@app.get("/api/health")
def health():
    return {"ok": True, "ready": state["ready"], "error": state["error"]}


@app.get("/api/config")
def get_config():
    return {
        **(cld.public_config() if cld.configured() else {"cloud_name": None, "api_key": None}),
        "ready": state["ready"],
        "error": state["error"],
        "folder": config.ROOT_FOLDER,
        "image_preset": config.IMAGE_PRESET,
        "video_preset": config.VIDEO_PRESET,
        "editor_key_required": bool(config.EDITOR_KEY),
        "activities": cld.ACTIVITY_NAMES,
    }


# No public_id / overwrite: evidence files get Cloudinary's random IDs and can never be replaced.
SIGNABLE = {"timestamp", "upload_preset", "folder", "asset_folder", "tags", "context", "source"}


class SignIn(BaseModel):
    params_to_sign: dict


@app.post("/api/sign", dependencies=[Depends(team)])
def sign(body: SignIn):
    """Signs Upload Widget requests, only for our presets and only into a real project."""
    params = body.params_to_sign
    extra = set(params) - SIGNABLE
    if extra:
        raise HTTPException(400, f"Cannot sign: {', '.join(sorted(extra))}")
    if params.get("upload_preset") not in (config.IMAGE_PRESET, config.VIDEO_PRESET):
        raise HTTPException(400, "Unknown upload preset")
    match = re.search(r"(?:^|\|)gp_project=([\w-]+)", str(params.get("context", "")))
    if not match or not store.get(match.group(1)):
        raise HTTPException(400, "Upload must name a project")
    folder = str(params.get("folder") or params.get("asset_folder") or "")
    if folder != f"{config.ROOT_FOLDER}/{match.group(1)}":
        raise HTTPException(400, "Wrong folder")
    if abs(int(params.get("timestamp", 0)) - time.time()) > 3600:
        raise HTTPException(400, "Stale timestamp")
    return {"signature": cld.sign(params)}


# ------------------------------ projects ------------------------------


class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    kind: Literal["lake", "plantation", "mixed"] = "mixed"
    org: str | None = Field(default=None, max_length=120)
    funder: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    start_date: str | None = None


@app.get("/api/projects", dependencies=[Depends(team)])
def list_projects():
    return sorted((summary(p) for p in store.all_projects()), key=lambda p: p["created_at"] or "", reverse=True)


@app.post("/api/projects", dependencies=[Depends(team)])
def create_project(body: ProjectIn):
    project = {
        **body.model_dump(),
        "id": store.new_id("p"),
        "created_at": store.now_iso(),
        "share_token": secrets.token_urlsafe(12),
        "sites": [],
        "evidence": [],
        "measurements": [],
        "stories": [],
        "audit": [],
    }
    store.create(project)
    store.audit(project, "project.created", project["name"], project["id"])
    return build_view(project)


@app.get("/api/projects/{pid}", dependencies=[Depends(team)])
def get_project(pid: str):
    return build_view(_project(pid))


# ------------------------------ sites ------------------------------


class SiteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["lake", "plantation"]
    boundary: list[list[float]] = Field(default_factory=list)
    baseline_date: str | None = None


class SitePatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    boundary: list[list[float]] | None = None
    baseline_date: str | None = None
    pair: dict | None = None
    clear_pair: bool = False


def _valid_boundary(boundary: list[list[float]]):
    if boundary and (len(boundary) < 3 or any(len(p) != 2 or abs(p[0]) > 90 or abs(p[1]) > 180 for p in boundary)):
        raise HTTPException(400, "Boundary needs at least 3 [lat, lng] points")


def _reassign(project: dict):
    """Boundaries changed: re-run GPS site matching for items that were placed by GPS or not placed."""
    with store.lock():
        for ev in project.get("evidence", []):
            if ev.get("status") == "ready" and ev.get("site_source") != "set by team":
                ev["site_id"], ev["site_source"] = evidence.assign_site(project, ev)
        store.touch(project["id"])


@app.post("/api/projects/{pid}/sites", dependencies=[Depends(team)])
def create_site(pid: str, body: SiteIn):
    project = _project(pid)
    _valid_boundary(body.boundary)
    site = {**body.model_dump(), "id": store.new_id("s"), "created_at": store.now_iso()}
    with store.lock():
        project["sites"].append(site)
    _reassign(project)
    store.audit(project, "site.created", f"{site['name']} ({site['kind']}, {geo.area_ha(site['boundary']):.2f} ha)", site["id"])
    return build_view(project)


@app.patch("/api/projects/{pid}/sites/{sid}", dependencies=[Depends(team)])
def update_site(pid: str, sid: str, body: SitePatch):
    project = _project(pid)
    site = _site(project, sid)
    changes = body.model_dump(exclude_unset=True)
    if "boundary" in changes:
        _valid_boundary(body.boundary or [])
    if body.pair and not body.clear_pair:
        choices = {
            ev["id"]: ev for ev in project.get("evidence", [])
            if ev.get("site_id") == sid and ev.get("resource_type") == "image"
            and ev.get("status") == "ready" and (ev.get("review") or {}).get("status") != "rejected"
        }
        before, after = choices.get(body.pair.get("before")), choices.get(body.pair.get("after"))
        if not before or not after or before["id"] == after["id"]:
            raise HTTPException(400, "Choose two different, usable photos of this site")
        before_at = evidence.parse_iso(evidence.capture_time(before))
        after_at = evidence.parse_iso(evidence.capture_time(after))
        if not before_at or not after_at or before_at >= after_at:
            raise HTTPException(400, "The before photo must be older than the after photo")
    with store.lock():
        for key in ("name", "boundary", "baseline_date"):
            if key in changes:
                site[key] = changes[key]
        if body.clear_pair:
            site.pop("pair", None)
        elif body.pair:
            site["pair"] = {"before": body.pair["before"], "after": body.pair["after"]}
    if "boundary" in changes:
        _reassign(project)
    store.audit(project, "site.updated", f"{site['name']}: {', '.join(k for k in changes if k != 'clear_pair') or 'pair reset'}", sid)
    return build_view(project)


# ------------------------------ evidence ------------------------------


class IngestIn(BaseModel):
    public_id: str = Field(max_length=300)
    resource_type: Literal["image", "video"] = "image"


class EvidencePatch(BaseModel):
    site_id: str | None = None
    review: Literal["pending", "accepted", "rejected"] | None = None
    note: str | None = Field(default=None, max_length=500)


@app.post("/api/projects/{pid}/evidence", dependencies=[Depends(team)])
def add_evidence(pid: str, body: IngestIn):
    project = _project(pid)
    # The worker checks the asset's gp_project context (set in the signed upload) before accepting it.
    record = evidence.placeholder(project, body.public_id, body.resource_type)
    workers.submit(evidence.ingest, project, body.public_id, body.resource_type)
    return {"id": record["id"], "status": "processing"}


@app.post("/api/projects/{pid}/sync", dependencies=[Depends(team)])
def sync_from_cloudinary(pid: str):
    """Pick up assets added straight to the Media Library with the project's tag."""
    project = _project(pid)
    known = {e["public_id"] for e in project.get("evidence", [])}
    found = [r for r in cld.find_by_tag(f"gp_p_{pid}") if r["public_id"] not in known and r.get("resource_type") in ("image", "video")]
    for resource in found:
        evidence.placeholder(project, resource["public_id"], resource["resource_type"])
        workers.submit(evidence.ingest, project, resource["public_id"], resource["resource_type"])
    return {"queued": len(found)}


@app.post("/api/projects/{pid}/evidence/{eid}/retry", dependencies=[Depends(team)])
def retry_evidence(pid: str, eid: str):
    project = _project(pid)
    ev = _evidence(project, eid)
    with store.lock():
        ev.update(status="processing", error=None)
    workers.submit(evidence.ingest, project, ev["public_id"], ev["resource_type"])
    return {"status": "processing"}


@app.patch("/api/projects/{pid}/evidence/{eid}", dependencies=[Depends(team)])
def update_evidence(pid: str, eid: str, body: EvidencePatch):
    project = _project(pid)
    ev = _evidence(project, eid)
    changes = body.model_dump(exclude_unset=True)
    with store.lock():
        if "site_id" in changes:
            if body.site_id:
                _site(project, body.site_id)
            ev["site_id"], ev["site_source"] = body.site_id, "set by team"
        if body.review:
            ev["review"] = {"status": body.review, "note": body.note, "at": store.now_iso()}
    if "site_id" in changes:
        store.audit(project, "evidence.moved", f"{ev['public_id']} → {body.site_id or 'no site'}", eid)
    if body.review:
        store.audit(project, f"evidence.{body.review}", f"{ev['public_id']}" + (f": {body.note}" if body.note else ""), eid)
    return build_view(project)


def _provenance(project: dict, ev: dict, public: bool) -> dict:
    outputs = []
    visible_ids = set()
    if public:
        index = proof.build_index(store.all_projects())
        visible_ids = {item["id"] for item in project.get("evidence", []) if item.get("status") == "ready" and _is_public(item, proof.score(item, project, index))}
    for s in project.get("stories", []):
        if public and not _public_story(s, visible_ids):
            continue
        if ev["id"] in (s.get("sources") or []):
            for c in s.get("composites", []):
                if ev["id"] in (c["before"], c["after"]):
                    outputs.append({"kind": "before/after image", "url": c["url"], "story": s["id"], "at": s["created_at"]})
            for so in s.get("social", []):
                if so["evidence_id"] == ev["id"]:
                    outputs += [{"kind": f"social {k}", "url": so[k], "story": s["id"], "at": s["created_at"]} for k in ("square", "vertical", "wide")]
            if s.get("reel"):
                outputs.append({"kind": "impact reel (MP4)", "url": s["reel"]["url"], "story": s["id"], "at": s["created_at"]})
            if s.get("pack"):
                outputs.append({"kind": "verification pack (PDF)", "url": s["pack"]["url"], "story": s["id"], "at": s["created_at"]})
    derived = []
    if not public:
        try:
            live = cld.resource_with_derived(ev["public_id"], ev["resource_type"])
            derived = [{"transformation": d.get("transformation"), "url": d.get("secure_url"), "bytes": d.get("bytes")} for d in live.get("derived", [])]
        except Exception as exc:
            derived = [{"error": cld.safe_error(exc)}]
    return {
        "original": {
            "public_id": ev["public_id"],
            "version": ev.get("version"),
            "asset_id": ev["id"],
            "format": ev.get("format"),
            "bytes": ev.get("bytes"),
            "width": ev.get("width"),
            "height": ev.get("height"),
            "etag_md5": ev.get("etag"),
            "sha256": ev.get("sha256"),
            "phash": ev.get("phash"),
            "uploaded_at": ev.get("uploaded_at"),
            "url": None if public else ev.get("secure_url"),
        },
        "outputs": outputs,
        "cloudinary_derived": derived,
        "events": [({"at": a["at"], "actor": "team", "action": a["action"], "detail": "", "ref": a.get("ref")} if public else a) for a in project.get("audit", []) if a.get("ref") == ev["id"]],
    }


@app.get("/api/projects/{pid}/evidence/{eid}/provenance", dependencies=[Depends(team)])
def provenance(pid: str, eid: str):
    project = _project(pid)
    return _provenance(project, _evidence(project, eid), public=False)


# ------------------------------ search ------------------------------

_visual_cache: dict[str, tuple[float, list[str]]] = {}


def _visual(q: str) -> list[str] | None:
    key = q.strip().lower()
    hit = _visual_cache.get(key)
    if hit and time.time() - hit[0] < 600:
        return hit[1]
    try:
        ids = cld.visual_search(q)
    except Exception as exc:
        log.info("visual search unavailable: %s", cld.safe_error(exc))
        return None
    _visual_cache[key] = (time.time(), ids)
    return ids


@app.get("/api/projects/{pid}/search", dependencies=[Depends(team)])
def search(pid: str, q: str = "", site_id: str | None = None, activity: str | None = None, grade: str | None = None, media: str | None = None):
    project = _project(pid)
    view = build_view(project)
    site_names = {s["id"]: s["name"] for s in project.get("sites", [])}
    pool = [e for e in view["evidence"] if e.get("status") == "ready"]
    if site_id:
        pool = [e for e in pool if e.get("site_id") == site_id]
    if activity:
        pool = [e for e in pool if any(a["name"] == activity for a in e.get("activities", []))]
    if grade:
        pool = [e for e in pool if e["proof"]["grade"] == grade]
    if media:
        pool = [e for e in pool if e["resource_type"] == media]
    if not q.strip():
        return {"items": [{"id": e["id"], "match": None} for e in pool], "visual": None}

    ranked, used_visual = [], False
    visual_ids = _visual(q)
    if visual_ids is not None:
        order = {public_id: i for i, public_id in enumerate(visual_ids)}
        ranked = [{"id": e["id"], "match": "visual"} for e in sorted((e for e in pool if e["public_id"] in order), key=lambda e: order[e["public_id"]])]
        # Visual search answers even when the account has no visual index yet (Cloudinary support enables it),
        # so only report it as used when it actually matched something.
        used_visual = bool(ranked)
    words = [w for w in re.findall(r"[a-z0-9]+", q.lower()) if len(w) > 2]
    seen = {r["id"] for r in ranked}
    scored = []
    for e in pool:
        if e["id"] in seen:
            continue
        text = " ".join([e.get("caption") or "", " ".join(e.get("tags", [])), " ".join(a["name"] for a in e.get("activities", [])), site_names.get(e.get("site_id"), "")]).lower()
        hits = sum(1 for w in words if w in text)
        if hits:
            scored.append((hits, e["id"]))
    ranked += [{"id": eid, "match": "tags & caption"} for _, eid in sorted(scored, reverse=True)]
    return {"items": ranked, "visual": used_visual}


# ------------------------------ measurements ------------------------------


class MeasurementIn(BaseModel):
    site_id: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    kind: Literal["water", "survival"]
    water_polygon: list[list[float]] | None = None
    water_area_ha: float | None = Field(default=None, ge=0)
    plot: str | None = Field(default=None, max_length=60)
    planted: int | None = Field(default=None, ge=0)
    alive: int | None = Field(default=None, ge=0)
    note: str | None = Field(default=None, max_length=500)


@app.post("/api/projects/{pid}/measurements", dependencies=[Depends(team)])
def add_measurement(pid: str, body: MeasurementIn):
    project = _project(pid)
    site = _site(project, body.site_id)
    record = {**body.model_dump(), "id": store.new_id("m"), "created_at": store.now_iso()}
    if body.kind == "water":
        if body.water_polygon:
            _valid_boundary(body.water_polygon)
            record["water_area_ha"] = round(geo.area_ha(body.water_polygon), 2)
        if record.get("water_area_ha") is None:
            raise HTTPException(400, "Draw the water spread or enter its area")
        detail = f"{site['name']}: water spread {record['water_area_ha']} ha on {body.date}"
    else:
        if body.planted is None or body.alive is None or body.alive > body.planted:
            raise HTTPException(400, "Enter planted and alive counts (alive ≤ planted)")
        detail = f"{site['name']}{' · ' + body.plot if body.plot else ''}: {body.alive}/{body.planted} alive on {body.date}"
    with store.lock():
        project.setdefault("measurements", []).append(record)
    store.audit(project, "measurement.added", detail, record["id"])
    return build_view(project)


@app.delete("/api/projects/{pid}/measurements/{mid}", dependencies=[Depends(team)])
def delete_measurement(pid: str, mid: str):
    project = _project(pid)
    with store.lock():
        before = len(project.get("measurements", []))
        project["measurements"] = [m for m in project.get("measurements", []) if m["id"] != mid]
        if len(project["measurements"]) == before:
            raise HTTPException(404, "Measurement not found")
    store.audit(project, "measurement.removed", mid, mid)
    return build_view(project)


# ------------------------------ stories ------------------------------


@app.post("/api/projects/{pid}/stories", dependencies=[Depends(team)])
def create_story(pid: str):
    project = _project(pid)
    if any(s.get("status") == "processing" for s in project.get("stories", [])):
        raise HTTPException(409, "A story is already being generated")
    record = {"id": store.new_id("st"), "created_at": store.now_iso(), "status": "processing"}
    with store.lock():
        project.setdefault("stories", []).append(record)
        store.touch(pid)
    workers.submit(story.build, project, record["id"], build_view(project, public=True))
    return record


# ------------------------------ public report ------------------------------


@app.get("/api/public/{token}", dependencies=[Depends(ready)])
def public_report(token: str):
    project = store.by_share_token(token)
    if not project:
        raise HTTPException(404, "This report link is not valid")
    return build_view(project, public=True)


@app.get("/api/public/{token}/evidence/{eid}", dependencies=[Depends(ready)])
def public_provenance(token: str, eid: str):
    project = store.by_share_token(token)
    if not project:
        raise HTTPException(404, "This report link is not valid")
    ev = _evidence(project, eid)
    if ev.get("status") != "ready" or not _is_public(ev, proof.score(ev, project, proof.build_index(store.all_projects()))):
        raise HTTPException(404, "Evidence not found")
    return _provenance(project, ev, public=True)


# ------------------------------ web app ------------------------------

if config.WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=config.WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        file = (config.WEB_DIST / path).resolve()
        if path and file.is_file() and config.WEB_DIST.resolve() in file.parents:
            return FileResponse(file)
        return FileResponse(config.WEB_DIST / "index.html")
