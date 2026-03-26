from __future__ import annotations

"""
Select the "best" face images from a captured set.

We use a simple sharpness metric (variance of Laplacian) as a proxy for image
quality and keep the top K images.
"""

import base64
from typing import Iterable, List

import cv2
import numpy as np




def _sharpness_score(image_path: str) -> float:
  img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
  if img is None:
    return 0.0
  return float(cv2.Laplacian(img, cv2.CV_64F).var())


def _sharpness_score_from_bytes(img_bytes: bytes) -> float:
  """Compute sharpness score from raw image bytes."""
  arr = np.frombuffer(img_bytes, dtype=np.uint8)
  img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
  if img is None:
    return 0.0
  return float(cv2.Laplacian(img, cv2.CV_64F).var())


def select_best_faces(
  image_paths: Iterable[str],
  top_k: int | None = None,
) -> List[str]:
  """
  Pick the top K images by sharpness score.
  """
  top_k = top_k or 3
  scored: List[tuple[str, float]] = []

  for path in image_paths:
    score = _sharpness_score(path)
    scored.append((path, score))

  scored.sort(key=lambda x: x[1], reverse=True)

  best = [path for path, _ in scored[:top_k]]
  return best


def select_best_faces_b64(
  base64_images: List[str],
  top_k: int | None = None,
) -> List[str]:
  """Select the best K base64-encoded images by sharpness score.

  Returns only the selected base64 strings (top K).
  """
  top_k = top_k or 3

  scored: List[tuple[int, float]] = []
  for idx, b64_data in enumerate(base64_images):
    raw = b64_data
    if "," in raw:
      raw = raw.split(",", 1)[1]
    try:
      img_bytes = base64.b64decode(raw)
      score = _sharpness_score_from_bytes(img_bytes)
    except Exception:
      score = 0.0
    scored.append((idx, score))

  scored.sort(key=lambda x: x[1], reverse=True)

  best_indices = [idx for idx, _ in scored[:top_k]]
  return [base64_images[i] for i in best_indices]
