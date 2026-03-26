import os
import sys
import io
import warnings

# --- STDOUT SUPPRESSION (must be first, before all other imports) ---
os.environ["TF_CPP_MIN_LOG_LEVEL"]    = "3"
os.environ["TF_ENABLE_ONEDNN_OPTS"]   = "0"
os.environ["CUDA_VISIBLE_DEVICES"]    = "-1"
os.environ["TF_SILENCE_DEPRECATIONS"] = "1"
os.environ["GLOG_minloglevel"]        = "3"
os.environ["TF_TRT_LOGGER"]          = "3"
warnings.filterwarnings("ignore")

_real_stdout = sys.stdout
sys.stdout   = io.StringIO()   # swallow all output during imports

# --- NOW import everything else ---
import argparse
import base64
import json
import tempfile
import traceback

import cv2
import numpy as np

_real_stdout_pre_deepface = sys.stdout
sys.stdout = io.StringIO()   # extra suppression specifically for DeepFace init
from deepface import DeepFace
sys.stdout = _real_stdout    # restore stdout — only our JSON goes here from now on
# --- END SUPPRESSION ---

# Constants
MIN_FACE_RATIO      = 0.05    # face bounding box area / total image area
CONFIDENCE_THRESH   = 0.75    # DeepFace detection confidence minimum
BLUR_THRESHOLD      = 40.0    # Laplacian variance minimum (below = blurry)
BRIGHTNESS_MIN      = 30      # mean pixel brightness minimum
BRIGHTNESS_MAX      = 230     # mean pixel brightness maximum
CENTER_RANGE        = (0.35, 0.65)   # face center x for "looking straight"
LEFT_RANGE          = (0.60, 1.00)   # face center x for "turned left"
RIGHT_RANGE         = (0.00, 0.40)   # face center x for "turned right"
ANGLE_DELTA_MIN     = 0.15    # minimum cx shift between steps
MODEL_NAME          = "Facenet512"
DETECTOR_BACKEND    = "opencv"       

def decode_image(source):
    if os.path.exists(source):
        img = cv2.imread(source)
    else:
        try:
            # Handle data:image/jpeg;base64, prefix if present
            if "," in source:
                source = source.split(",")[1]
            img_data = base64.b64decode(source)
            nparr = np.frombuffer(img_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        except Exception:
            raise ValueError("Invalid image source")
            
    if img is None:
        raise ValueError("Failed to decode image")
    return img

def detect_faces(img):
    try:
        return DeepFace.extract_faces(
            img_path=img, 
            enforce_detection=False, 
            align=True,
            detector_backend=DETECTOR_BACKEND
        )
    except Exception:
        return []

def blur_score(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var()

def brightness(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return np.mean(gray)

def validate_frame(img, step, prev_cx=None):
    all_faces = detect_faces(img)
    
    # Filter out empty detetions from enforce_detection=False
    real_faces = [f for f in all_faces if f.get("confidence", 0) > 0.0]
    if not real_faces:
        return (False, "No face detected", 0.0, None)
        
    # Dynamic confidence threshold
    conf_thresh = 0.85 if step == "center" else 0.60
    valid_faces = [f for f in real_faces if f.get("confidence", 0) >= conf_thresh]
    
    if not valid_faces:
        return (False, "Adjust position", 0.0, None)
        
    if len(valid_faces) >= 2:
        return (False, "Multiple faces detected", 0.0, None)
        
    f = valid_faces[0]
    region = f.get("facial_area", {})
    img_h, img_w = img.shape[:2]
    img_area = img_w * img_h
    face_area = region.get("w", 0) * region.get("h", 0)
    
    face_ratio = face_area / img_area
    b = blur_score(img)
    br = brightness(img)
    face_cx = (region.get("x", 0) + region.get("w", 0) / 2) / img_w
    
    score = (b / 500.0) * 0.4 + (face_ratio / 0.5) * 0.4 + (1.0 - abs(br - 128.0) / 128.0) * 0.2
    score = max(0.0, min(1.0, float(score)))
    
    if face_ratio < MIN_FACE_RATIO:
        return (False, "Move closer to camera", score, face_cx)
        
    if b < BLUR_THRESHOLD:
        return (False, "Hold still — image blurry", score, face_cx)
        
    if br < BRIGHTNESS_MIN:
        return (False, "Too dark", score, face_cx)
    if br > BRIGHTNESS_MAX:
        return (False, "Too bright", score, face_cx)
        
    if step == "center":
        if not (CENTER_RANGE[0] <= face_cx <= CENTER_RANGE[1]):
            return (False, "Look straight at the camera", score, face_cx)
    elif step == "left":
        if not (LEFT_RANGE[0] <= face_cx <= LEFT_RANGE[1]):
            return (False, "Turn your head to the LEFT", score, face_cx)
        if prev_cx is not None and abs(face_cx - prev_cx) < ANGLE_DELTA_MIN:
            return (False, "Turn further left", score, face_cx)
    elif step == "right":
        if not (RIGHT_RANGE[0] <= face_cx <= RIGHT_RANGE[1]):
            return (False, "Turn your head to the RIGHT", score, face_cx)
        if prev_cx is not None and abs(face_cx - prev_cx) < ANGLE_DELTA_MIN:
            return (False, "Turn further right", score, face_cx)
            
    return (True, "OK", score, face_cx)

def crop_face(img, region):
    img_h, img_w = img.shape[:2]
    x, y, w, h = region["x"], region["y"], region["w"], region["h"]
    
    pad_w = int(w * 0.20)
    pad_h = int(h * 0.20)
    
    x1 = max(0, x - pad_w)
    y1 = max(0, y - pad_h)
    x2 = min(img_w, x + w + pad_w)
    y2 = min(img_h, y + h + pad_h)
    
    cropped = img[y1:y2, x1:x2]
    return cv2.resize(cropped, (224, 224))

def generate_embedding(img):
    try:
        results = DeepFace.represent(
            img_path=img,
            model_name=MODEL_NAME,
            enforce_detection=True,
            align=True,
            detector_backend=DETECTOR_BACKEND
        )
        if not results:
            raise ValueError("No embedding results")
        return np.array(results[0]["embedding"], dtype=np.float32)
    except Exception as e:
        raise ValueError(f"DeepFace.represent failed: {str(e)}")

def save_embeddings(member_id, embeddings_list, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    path = os.path.abspath(os.path.join(output_dir, f"user_{member_id}_embeddings.npy"))
    arr = np.array(embeddings_list, dtype=np.float32)
    np.save(path, arr)
    sys.stderr.write(f"[INFO] Saved {arr.shape} embeddings -> {path}\n")
    return path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["validate", "camera", "upload"], required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--step", required=False)
    parser.add_argument("--prev_cx", required=False)
    parser.add_argument("--member_id", required=False)
    parser.add_argument(
        "--output_dir", 
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "embeddings")
    )
    
    args = parser.parse_args()
    
    if args.mode == "validate":
        img = decode_image(args.input)
        prev_cx = float(args.prev_cx) if args.prev_cx and args.prev_cx != "null" else None
        valid, reason, score, face_cx = validate_frame(img, args.step, prev_cx)
        print(json.dumps({ "valid": valid, "reason": reason, "score": score, "face_cx": face_cx }))
        
    elif args.mode == "camera":
        with open(args.input, "r") as f:
            job = json.load(f)
            
        expected = ["center", "left", "right"]
        embeddings = []
        for angle in expected:
            entry = next((item for item in job if item.get("angle") == angle), None)
            if not entry:
                print(json.dumps({ "success": False, "error": f"[{angle}] Missing angle in job" }))
                sys.exit(1)
                
            img = decode_image(entry["base64"])
                
            faces = detect_faces(img)
            valid_faces = [f for f in faces if f.get("confidence", 0) > 0.0]
            if not valid_faces:
                print(json.dumps({ "success": False, "error": f"[{angle}] Could not detect face on secondary check" }))
                sys.exit(1)
                
            # Sort by confidence
            valid_faces.sort(key=lambda x: x.get("confidence", 0), reverse=True)
            face_img = crop_face(img, valid_faces[0]["facial_area"])
            try:
                emb = generate_embedding(face_img)
                embeddings.append(emb)
            except Exception as e:
                print(json.dumps({ "success": False, "error": f"[{angle}] Embedding failed: {str(e)}" }))
                sys.exit(1)
                
        path = save_embeddings(args.member_id, embeddings, args.output_dir)
        print(json.dumps({ "success": True, "path": path, "count": len(embeddings) }))
        
    elif args.mode == "upload":
        img = decode_image(args.input)
            
        faces = detect_faces(img)
        valid_faces = [f for f in faces if f.get("confidence", 0) > 0.0]
        if not valid_faces:
            print(json.dumps({ "success": False, "error": "Could not detect face on secondary check" }))
            sys.exit(1)
            
        valid_faces.sort(key=lambda x: x.get("confidence", 0), reverse=True)
        face_img = crop_face(img, valid_faces[0]["facial_area"])
        try:
            emb = generate_embedding(face_img)
            path = save_embeddings(args.member_id, [emb], args.output_dir)
            print(json.dumps({ "success": True, "path": path, "count": 1 }))
        except Exception as e:
            print(json.dumps({ "success": False, "error": f"Embedding failed: {str(e)}" }))
            sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except Exception:
        print(json.dumps({
            "success": False,
            "error": "Unhandled exception",
            "trace": traceback.format_exc()
        }))
        sys.exit(1)
