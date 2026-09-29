import os
from pathlib import Path

from dotenv import load_dotenv

SERVER = Path(__file__).resolve().parent.parent
ROOT = SERVER.parent
load_dotenv(SERVER / ".env")


def _flag(name: str, default: str) -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes")


# CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> (read by the SDK itself).
CLOUDINARY_URL = os.getenv("CLOUDINARY_URL", "").strip()

# Everything GreenProof writes lives under this folder in the Media Library.
ROOT_FOLDER = os.getenv("GP_FOLDER", "greenproof").strip().strip("/")
IMAGE_PRESET = f"{ROOT_FOLDER}_evidence_image"
VIDEO_PRESET = f"{ROOT_FOLDER}_evidence_video"

# Cloudinary AI add-ons, run per item after upload. One that is not enabled on the account is skipped, never fatal.
TAGGING = _flag("CLD_TAGGING", "true")  # Google Auto Tagging
CAPTIONING = _flag("CLD_CAPTIONING", "true")  # Cloudinary AI Content Analysis
AI_VISION = _flag("CLD_AI_VISION", "true")  # Cloudinary AI Vision: our own activity tags
VISUAL_SEARCH = _flag("CLD_VISUAL_SEARCH", "true")  # index photos for Cloudinary visual search

# Optional team key: when set, opening and changing projects needs the header X-Editor-Key.
# Public report links never need it.
EDITOR_KEY = os.getenv("EDITOR_KEY", "").strip()

WEB_DIST = ROOT / "web" / "dist"
