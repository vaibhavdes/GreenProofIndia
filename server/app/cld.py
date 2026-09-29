"""Everything that talks to Cloudinary: presets, signing, asset details, AI, search, delivery URLs and generated media.

Admin API calls are rate limited on the free plan, so AI and metadata run once at upload time through
the upload presets, and each asset costs one Admin call (`resource`) when we ingest it.
"""

import io
import json
import logging
import re
import time
import urllib.parse

import cloudinary
import cloudinary.api
import cloudinary.exceptions
import cloudinary.uploader
import cloudinary.utils
import httpx

from . import config

# The SDK reads CLOUDINARY_URL when it is first imported, which can be before server/.env is loaded.
cloudinary.reset_config()

log = logging.getLogger("greenproof.cloudinary")

# Our own visual signals, answered by Cloudinary AI Vision (tagging mode) for every photo.
ACTIVITY_TAGS = [
    ("dry lakebed", "A dry or cracked lake, pond or tank bed with little or no water"),
    ("water-filled lake", "A lake, pond or tank holding a large amount of open water"),
    ("desilting work", "Excavators, JCBs, tractors or people digging and removing silt from a water body"),
    ("bund or embankment work", "Stone pitching, bund, embankment or inlet construction around a water body"),
    ("weeds or waste in water", "Water hyacinth, algae, garbage or sewage floating in the water"),
    ("saplings planted", "Freshly dug planting pits, or young saplings or seedlings planted in rows, often with tree guards or stakes"),
    ("established trees", "Healthy grown trees or dense green vegetation"),
    ("dead or dry saplings", "Dead, dried out or broken saplings, or bare patches where planting failed"),
    ("people working", "Community members or workers doing field work"),
    ("project signboard", "A project signboard or information board with text"),
]
ACTIVITY_NAMES = [name for name, _ in ACTIVITY_TAGS]
assert len(ACTIVITY_TAGS) <= 10, "AI Vision accepts at most 10 tag definitions"
# AI Vision accepts only lower-case letters, digits and hyphens in tag names.
_SLUGS = {name.replace(" ", "-"): name for name in ACTIVITY_NAMES}

# Which AI add-ons answered last time: "ok", "not enabled on this Cloudinary account", or an error.
# A feature that is not enabled is skipped for a while instead of being called for every item.
ai_status: dict[str, str] = {}
_ai_skip_until: dict[str, float] = {}


def configured() -> bool:
    cfg = cloudinary.config()
    return bool(cfg.cloud_name and cfg.api_key and cfg.api_secret)


def public_config() -> dict:
    cfg = cloudinary.config()
    return {"cloud_name": cfg.cloud_name, "api_key": cfg.api_key}


# ------------------------------- presets -------------------------------


def _image_preset_settings() -> dict:
    settings = {
        "unsigned": False,
        "overwrite": False,  # evidence is immutable: a new file never replaces an existing one
        "media_metadata": True,
        "phash": True,
        "quality_analysis": True,
        "faces": True,
        "allowed_formats": "jpg,jpeg,png,webp,heic,heif",
    }
    # AI add-ons are not in the preset: one that is not enabled would reject the whole upload.
    # They run per item after upload (analyze() below), so an upload always succeeds.
    if config.VISUAL_SEARCH:
        settings["visual_search"] = True
    return settings


def _video_preset_settings() -> dict:
    return {"unsigned": False, "overwrite": False, "media_metadata": True, "allowed_formats": "mp4,mov,webm,3gp,m4v"}


def ensure_presets():
    """Create or refresh the two signed upload presets the Upload Widget uses."""
    for name, settings in ((config.IMAGE_PRESET, _image_preset_settings()), (config.VIDEO_PRESET, _video_preset_settings())):
        try:
            # Recreate rather than update, so settings removed from the code leave the preset too.
            try:
                cloudinary.api.delete_upload_preset(name)
            except cloudinary.exceptions.NotFound:
                pass
            cloudinary.api.create_upload_preset(name=name, **settings)
            log.info("upload preset %s ready", name)
        except cloudinary.exceptions.Error as exc:
            log.warning("could not create preset %s: %s", name, exc)


def sign(params_to_sign: dict) -> str:
    return cloudinary.utils.api_sign_request(params_to_sign, cloudinary.config().api_secret)


# ---------------------------- asset details ----------------------------


def resource(public_id: str, resource_type: str) -> dict:
    options = {"resource_type": resource_type, "media_metadata": True}
    if resource_type == "image":
        options.update(phash=True, quality_analysis=True, faces=True)
    try:
        return dict(cloudinary.api.resource(public_id, **options))
    except cloudinary.exceptions.Error:
        if resource_type != "image":
            raise
        # quality_analysis is not on every plan; retry without it.
        options.pop("quality_analysis")
        return dict(cloudinary.api.resource(public_id, **options))


def resource_with_derived(public_id: str, resource_type: str) -> dict:
    return dict(cloudinary.api.resource(public_id, resource_type=resource_type, max_results=100))


def find_by_tag(tag: str) -> list[dict]:
    """Search API: every asset carrying a tag (used to pick up Media Library uploads)."""
    out, cursor = [], None
    while True:
        query = cloudinary.Search().expression(f"tags={tag}").with_field("context").with_field("tags").max_results(500)
        if cursor:
            query = query.next_cursor(cursor)
        result = query.execute()
        out += result.get("resources", [])
        cursor = result.get("next_cursor")
        if not cursor:
            return out


class AddonUnavailable(Exception):
    pass


def analyze(feature: str, image_url: str, **body) -> dict:
    """Cloudinary Analyze API (v2): captioning, google_tagging, ai_vision_tagging."""
    if time.time() < _ai_skip_until.get(feature, 0):
        raise AddonUnavailable(ai_status.get(feature, "not enabled"))
    cfg = cloudinary.config()
    response = httpx.post(
        f"https://api.cloudinary.com/v2/analysis/{cfg.cloud_name}/analyze/{feature}",
        auth=(cfg.api_key, cfg.api_secret),
        json={"source": {"uri": image_url}, **body},
        timeout=90,
    )
    if response.status_code == 403:
        ai_status[feature] = "not enabled on this Cloudinary account"
        _ai_skip_until[feature] = time.time() + 600
        raise AddonUnavailable(ai_status[feature])
    if response.status_code >= 400:
        ai_status[feature] = f"error {response.status_code}: {response.text[:160]}"
        response.raise_for_status()
    ai_status[feature] = "ok"
    return response.json()


def caption(image_url: str) -> str | None:
    """Cloudinary AI Content Analysis: a one-sentence caption."""
    return _find_text(analyze("captioning", image_url), "caption")


def google_tags(image_url: str, min_confidence: float = 0.55) -> list[str]:
    """Google Auto Tagging add-on: object and scene tags."""
    tags = []
    for item in _find_dicts(analyze("google_tagging", image_url)):
        name = item.get("tag") or item.get("name") or item.get("label")
        confidence = item.get("confidence")
        if isinstance(name, str) and (not isinstance(confidence, (int, float)) or confidence >= min_confidence) and name.lower() not in tags:
            tags.append(name.lower())
    return tags


def ai_vision_tags(image_url: str) -> list[dict]:
    """Cloudinary AI Vision, tagging mode, with our restoration-specific tag definitions."""
    result = analyze(
        "ai_vision_tagging",
        image_url,
        tag_definitions=[{"name": name.replace(" ", "-"), "description": desc} for name, desc in ACTIVITY_TAGS],
    )
    out = []
    for item in _find_dicts(result):
        name = _SLUGS.get(str(item.get("name", "")).lower())
        if name and name not in {o["name"] for o in out}:
            confidence = item.get("confidence")
            out.append({"name": name, "confidence": confidence if isinstance(confidence, (int, float)) else None})
    return out


def _find_dicts(obj) -> list[dict]:
    """Every dict nested anywhere in a JSON response (response shapes differ between analyses)."""
    found = []
    if isinstance(obj, dict):
        found.append(obj)
        obj = list(obj.values())
    if isinstance(obj, list):
        for item in obj:
            found += _find_dicts(item)
    return found


def _find_text(obj, key: str) -> str | None:
    """First string value stored under `key` anywhere in a JSON response."""
    if isinstance(obj, dict):
        if isinstance(obj.get(key), str) and obj[key].strip():
            return obj[key].strip()
        obj = list(obj.values())
    if isinstance(obj, list):
        for item in obj:
            found = _find_text(item, key)
            if found:
                return found
    return None


def visual_search(text: str) -> list[str]:
    """Cloudinary visual search: public_ids ranked by how well the image matches the text."""
    result = cloudinary.api.visual_search(text=text, max_results=100)
    return [r["public_id"] for r in result.get("resources", [])]


def add_tags(public_id: str, resource_type: str, tags: list[str]):
    for tag in tags:
        cloudinary.uploader.add_tag(tag, [public_id], resource_type=resource_type)


def add_context(public_id: str, resource_type: str, context: dict):
    cloudinary.uploader.add_context(context, [public_id], resource_type=resource_type)


# ------------------------------ delivery ------------------------------


def text(value: str) -> str:
    """Escape text for a text overlay: commas and slashes are double-escaped, the rest URL-encoded once."""
    value = value.replace("%", "%2525").replace(",", "%252C").replace("/", "%252F")
    return urllib.parse.quote(value, safe="%")


def layer_id(public_id: str) -> str:
    return public_id.replace("/", ":")


def url(public_id: str, transformation: str = "", *, version=None, resource_type: str = "image", fmt: str | None = None) -> str:
    options = {"secure": True, "resource_type": resource_type}
    if transformation:
        options["raw_transformation"] = transformation
    if version:
        options["version"] = version
    if fmt:
        options["format"] = fmt
    return cloudinary.utils.cloudinary_url(public_id, **options)[0]


def still(ev: dict, transformation: str, fmt: str = "jpg", offset: str = "50p") -> str:
    """An image URL for any evidence item; videos use a frame (by default from the middle of the clip)."""
    if ev["resource_type"] == "video":
        return url(ev["public_id"], f"so_{offset}/{transformation}" if transformation else f"so_{offset}", version=ev.get("version"), resource_type="video", fmt=fmt)
    return url(ev["public_id"], transformation, version=ev.get("version"), fmt=fmt)


# --------------------------- generated media ---------------------------


def materialise(source_url: str, public_id: str, tag: str):
    """Save a transformation URL (a reel frame or PDF page) as its own image, tagged for `multi`."""
    cloudinary.uploader.upload(source_url, public_id=public_id, tags=[tag, "gp", "gp_story"], overwrite=True, resource_type="image")


def multi_from_tag(tag: str, fmt: str, delay_ms: int | None = None) -> dict:
    """Cloudinary `multi`: one MP4 or PDF from every image with `tag`, ordered by public ID.

    `multi` is a restricted delivery type on new accounts (and not listed in the Security settings),
    so the result is delivered through a signed URL, which Cloudinary always allows.
    """
    options = {"format": fmt}
    if delay_ms:
        options["delay"] = delay_ms
    result = cloudinary.uploader.multi(tag, **options)
    parts = result["secure_url"].split("/image/multi/", 1)[1].split("/")
    transformation = "/".join(p for p in parts[:-1] if not (p[:1] == "v" and p[1:].isdigit()))
    signed = cloudinary.utils.cloudinary_url(
        tag, type="multi", resource_type="image", format=fmt, raw_transformation=transformation or None, sign_url=True, secure=True
    )[0]
    return {"url": signed, "tag": tag, "version": result.get("version")}


# --------------------------- record storage ---------------------------


def upload_json(public_id: str, data: dict) -> dict:
    payload = io.BytesIO(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode())
    return dict(
        cloudinary.uploader.upload(
            payload, public_id=public_id, resource_type="raw", type="authenticated", overwrite=True, invalidate=True
        )
    )


def list_json(prefix: str) -> list[dict]:
    out, cursor = [], None
    while True:
        options = {"resource_type": "raw", "type": "authenticated", "prefix": prefix, "max_results": 500}
        if cursor:
            options["next_cursor"] = cursor
        result = cloudinary.api.resources(**options)
        out += result.get("resources", [])
        cursor = result.get("next_cursor")
        if not cursor:
            return out


def fetch_json(public_id: str, version) -> dict:
    signed = cloudinary.utils.cloudinary_url(
        public_id, resource_type="raw", type="authenticated", sign_url=True, version=version, secure=True
    )[0]
    response = httpx.get(signed, timeout=30)
    response.raise_for_status()
    return response.json()


def download(source_url: str, limit_bytes: int = 40 * 1024 * 1024) -> bytes | None:
    with httpx.stream("GET", source_url, timeout=60, follow_redirects=True) as response:
        response.raise_for_status()
        chunks, size = [], 0
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > limit_bytes:
                return None
            chunks.append(chunk)
    return b"".join(chunks)


def safe_error(exc: Exception) -> str:
    return re.sub(r"cloudinary://\S+", "cloudinary://***", str(exc))[:300]
