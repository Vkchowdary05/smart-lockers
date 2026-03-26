"""
Face processing service.

Handles face detection, embedding generation, and quality metrics
computation using DeepFace (with OpenCV fallback).
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

# Try to import DeepFace; mark as unavailable if missing
try:
  from deepface import DeepFace

  _DEEPFACE_AVAILABLE = True
except ImportError:
  _DEEPFACE_AVAILABLE = False


def _compute_blur_score(image: np.ndarray) -> float:
  """Laplacian variance as a sharpness/blur metric."""
  gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
  return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _compute_brightness(image: np.ndarray) -> float:
  """Mean grayscale intensity."""
  gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image
  return float(np.mean(gray))


def _compute_face_ratio(
  image: np.ndarray, bbox: Optional[dict] = None
) -> float:
  """Ratio of face bounding box area to total image area."""
  if bbox is None:
    return 0.0

  h, w = image.shape[:2]
  total_area = h * w
  if total_area == 0:
    return 0.0

  face_w = bbox.get("w", 0)
  face_h = bbox.get("h", 0)
  face_area = face_w * face_h
  return round(face_area / total_area, 4)


def _normalize_embedding(embedding: list) -> List[float]:
  """L2-normalize an embedding vector."""
  arr = np.array(embedding, dtype=np.float64)
  norm = np.linalg.norm(arr)
  if norm == 0:
    return arr.tolist()
  return (arr / norm).tolist()


def process_face_images(
  image_paths: List[str],
) -> Dict[str, Any]:
  """
  Process a list of face images.

  Returns a dict with:
    - embedding: averaged, normalized vector (or None if DeepFace unavailable)
    - metrics: quality summary dict
  """
  embeddings: List[list] = []
  blur_scores: List[float] = []
  brightness_scores: List[float] = []
  face_ratios: List[float] = []
  yaw_values: List[float] = []
  pitch_values: List[float] = []
  roll_values: List[float] = []

  for img_path in image_paths:
    img = cv2.imread(img_path)
    if img is None:
      continue

    blur = _compute_blur_score(img)
    brightness = _compute_brightness(img)
    blur_scores.append(blur)
    brightness_scores.append(brightness)

    if _DEEPFACE_AVAILABLE:
      try:
        # Generate embedding
        embedding_objs = DeepFace.represent(
          img_path=img_path,
          model_name="Facenet512",
          enforce_detection=False,
        )
        if embedding_objs and len(embedding_objs) > 0:
          emb = embedding_objs[0].get("embedding")
          if emb:
            embeddings.append(emb)

          # Face area from DeepFace result
          facial_area = embedding_objs[0].get("facial_area", {})
          if facial_area:
            ratio = _compute_face_ratio(img, facial_area)
            face_ratios.append(ratio)

        # Analyze face attributes (yaw/pitch/roll approximation)
        try:
          analysis = DeepFace.analyze(
            img_path=img_path,
            actions=["emotion"],  # lightweight analysis
            enforce_detection=False,
            silent=True,
          )
          if analysis and isinstance(analysis, list) and len(analysis) > 0:
            region = analysis[0].get("region", {})
            if region:
              ratio = _compute_face_ratio(img, region)
              if not face_ratios or face_ratios[-1] == 0:
                face_ratios.append(ratio)
        except Exception:
          pass

      except Exception:
        # DeepFace processing failed for this image, continue
        pass
    else:
      # Fallback: use OpenCV Haar cascade for basic face detection
      gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
      cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
      )
      detected = cascade.detectMultiScale(gray, 1.1, 5)
      if len(detected) > 0:
        x, y, w, h = detected[0]
        ratio = _compute_face_ratio(img, {"x": x, "y": y, "w": w, "h": h})
        face_ratios.append(ratio)

  # Average embedding
  avg_embedding = None
  if embeddings:
    avg = np.mean(embeddings, axis=0)
    avg_embedding = _normalize_embedding(avg.tolist())

  # Build metrics summary
  metrics: Dict[str, Any] = {
    "image_count": len(image_paths),
    "avg_blur_score": round(float(np.mean(blur_scores)), 2) if blur_scores else 0,
    "avg_brightness": round(float(np.mean(brightness_scores)), 1) if brightness_scores else 0,
    "avg_face_ratio": round(float(np.mean(face_ratios)), 4) if face_ratios else 0,
    "max_yaw": round(float(max(yaw_values)), 2) if yaw_values else None,
    "max_pitch": round(float(max(pitch_values)), 2) if pitch_values else None,
    "max_roll": round(float(max(roll_values)), 2) if roll_values else None,
    "embedding_available": avg_embedding is not None,
    "embedding_model": "Facenet512" if avg_embedding is not None else None,
    "last_updated": datetime.now(timezone.utc).isoformat(),
  }

  return {
    "embedding": avg_embedding,
    "metrics": metrics,
  }
