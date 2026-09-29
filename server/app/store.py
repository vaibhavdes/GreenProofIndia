"""Project records. Each project is one JSON document (sites, evidence facts, measurements, stories,
audit log) kept in Cloudinary as an authenticated raw asset, so Cloudinary is the only storage.

The service runs as one instance: records are held in memory and written back shortly after a change.
"""

import json
import logging
import secrets
import threading
from datetime import datetime, timezone

from . import cld, config

log = logging.getLogger("greenproof.store")

_projects: dict[str, dict] = {}
_dirty: set[str] = set()
_lock = threading.RLock()
_stop = threading.Event()


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(4)}"


def _record_id(project_id: str) -> str:
    return f"{config.ROOT_FOLDER}/_records/{project_id}.json"


# ------------------------------ Cloudinary ------------------------------


def _load_all() -> list[dict]:
    out = []
    for item in cld.list_json(f"{config.ROOT_FOLDER}/_records/"):
        try:
            out.append(cld.fetch_json(item["public_id"], item.get("version")))
        except Exception as exc:  # one broken record should not stop the service
            log.error("could not read %s: %s", item["public_id"], cld.safe_error(exc))
    return out


def _save(project: dict):
    cld.upload_json(_record_id(project["id"]), project)


# ------------------------------ lifecycle ------------------------------


def load():
    with _lock:
        _projects.clear()
        for project in _load_all():
            _projects[project["id"]] = project
    log.info("loaded %d projects", len(_projects))


def flush():
    with _lock:
        pending = [(pid, json.loads(json.dumps(_projects[pid]))) for pid in _dirty if pid in _projects]
        _dirty.clear()
    for pid, snapshot in pending:
        try:
            _save(snapshot)
        except Exception as exc:
            log.error("could not save %s: %s", pid, cld.safe_error(exc))
            with _lock:
                _dirty.add(pid)


def _flusher():
    while not _stop.wait(2.0):
        flush()


def start():
    threading.Thread(target=_flusher, name="record-flusher", daemon=True).start()


def stop():
    _stop.set()
    flush()


# ------------------------------ access ------------------------------


def all_projects() -> list[dict]:
    with _lock:
        return list(_projects.values())


def get(project_id: str) -> dict | None:
    return _projects.get(project_id)


def by_share_token(token: str) -> dict | None:
    with _lock:
        return next((p for p in _projects.values() if p.get("share_token") and secrets.compare_digest(p["share_token"], token)), None)


def create(project: dict) -> dict:
    with _lock:
        _projects[project["id"]] = project
        _dirty.add(project["id"])
    return project


def touch(project_id: str):
    with _lock:
        _dirty.add(project_id)


def lock():
    return _lock


def audit(project: dict, action: str, detail: str, ref: str | None = None, actor: str = "team"):
    with _lock:
        project.setdefault("audit", []).append({"at": now_iso(), "actor": actor, "action": action, "detail": detail, "ref": ref})
        _dirty.add(project["id"])
