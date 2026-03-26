from __future__ import annotations

"""Storage service for face images — daemon-compatible.

Stores images in the daemon-expected folder structure:
  media/OrgName/OrgId/PersonId/{PersonId}-{serial}.jpg

The database stores the absolute imagepath:
  D:/path/to/media/OrgName/OrgId/PersonId
"""

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

# Resolve MEDIA_ROOT from env, or default to ../../../daemon/media
default_media_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../daemon/media"))
MEDIA_ROOT = os.environ.get("MEDIA_ROOT", default_media_root)


def _ensure_dir(path: str) -> None:
  Path(path).mkdir(parents=True, exist_ok=True)


def get_image_folder(org_name: str, org_id: int, person_id: int) -> str:
  """Return the relative folder path for a member's face images.

  Format: OrgName/OrgId/PersonId
  Example: ReddyLabs/101/42
  """
  return f"{org_name}/{org_id}/{person_id}"


def get_absolute_image_folder(org_name: str, org_id: int, person_id: int) -> str:
  """Return the absolute folder path for a member's face images."""
  rel = get_image_folder(org_name, org_id, person_id)
  return os.path.join(MEDIA_ROOT, rel)


def save_face_images(
  org_name: str,
  org_id: int,
  person_id: int,
  base64_images: List[str],
) -> tuple[str, List[str]]:
  """Save base64-encoded images to disk.

  Filenames follow daemon convention: {personId}-{serial}.jpg
  Returns (imagepath, list_of_saved_file_paths).
  """
  rel_path = get_image_folder(org_name, org_id, person_id)
  folder_abs = os.path.join(MEDIA_ROOT, rel_path)
  _ensure_dir(folder_abs)

  saved_paths: List[str] = []

  for idx, b64_data in enumerate(base64_images, start=1):
    # Strip data URI prefix if present
    if "," in b64_data:
      b64_data = b64_data.split(",", 1)[1]

    image_bytes = base64.b64decode(b64_data)

    # Daemon filename convention: {personId}-{serial}.jpg
    filename = f"{person_id}-{idx}.jpg"
    filepath = os.path.join(folder_abs, filename)

    with open(filepath, "wb") as f:
      f.write(image_bytes)

    saved_paths.append(filepath)

  # Return the absolute folder path (stored in DB)
  return folder_abs, saved_paths


def save_user_images(
  org_name: str,
  org_id: int,
  person_id: int,
  base64_images: List[str],
  metadata: Optional[Dict[str, Any]] = None,
) -> str:
  """Save face images + metadata JSON to disk.

  Saves exactly the provided images as:
    PersonId-1.jpg, PersonId-2.jpg, PersonId-3.jpg

  Creates metadata file:
    PersonId-metadata.json

  Returns the absolute folder path for DB storage.
  """
  rel_path = get_image_folder(org_name, org_id, person_id)
  folder_abs = os.path.join(MEDIA_ROOT, rel_path)
  _ensure_dir(folder_abs)

  saved_paths: List[str] = []

  for idx, b64_data in enumerate(base64_images, start=1):
    # Strip data URI prefix if present
    if "," in b64_data:
      b64_data = b64_data.split(",", 1)[1]

    image_bytes = base64.b64decode(b64_data)

    filename = f"{person_id}-{idx}.jpg"
    filepath = os.path.join(folder_abs, filename)

    with open(filepath, "wb") as f:
      f.write(image_bytes)

    saved_paths.append(filepath)

  # Write metadata JSON if provided
  if metadata:
    metadata_file = os.path.join(folder_abs, f"{person_id}-metadata.json")
    with open(metadata_file, "w") as mf:
      json.dump(metadata, mf, indent=2)

  return folder_abs
