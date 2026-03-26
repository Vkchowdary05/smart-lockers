import sys
import json
import os
import cv2
import numpy as np
import face_recognition
import argparse
from typing import Dict, Any, List, Optional

def compute_face_metrics(image: np.ndarray, face_location: tuple) -> Dict[str, Any]:
    """
    Computes metrics for a face location.
    face_location is (top, right, bottom, left) from face_recognition.
    """
    top, right, bottom, left = face_location
    face_w = right - left
    face_h = bottom - top
    
    # Face Area Ratio
    h, w = image.shape[:2]
    face_area = face_w * face_h
    total_area = w * h
    face_ratio = round(face_area / total_area, 4) if total_area > 0 else 0
    
    # Simple Blur/Sharpness (Laplacian Variance)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    face_roi = gray[top:bottom, left:right]
    if face_roi.size > 0:
        blur_score = cv2.Laplacian(face_roi, cv2.CV_64F).var()
    else:
        blur_score = 0
        
    # Face Center Offset
    face_cx = (left + right) / 2
    face_cy = (top + bottom) / 2
    offset_x = (face_cx - (w / 2)) / (w / 2)
    offset_y = (face_cy - (h / 2)) / (h / 2)

    return {
        "face_ratio": face_ratio,
        "blur_score": round(float(blur_score), 2),
        "face_cx": round(float(face_cx), 2),
        "face_cy": round(float(face_cy), 2),
        "offset_x": round(float(offset_x), 3),
        "offset_y": round(float(offset_y), 3),
        "bbox": {"top": top, "right": right, "bottom": bottom, "left": left}
    }

def validate_step(image: np.ndarray, step: str, prev_cx: Optional[float] = None) -> Dict[str, Any]:
    """
    Validates if the detected face matches the enrollment step (center, left, right, up).
    Returns {valid: bool, reason: str, score: float, ...}
    """
    face_locations = face_recognition.face_locations(image)
    if not face_locations:
        return {"valid": False, "reason": "No face detected", "score": 0}
    
    if len(face_locations) > 1:
        return {"valid": False, "reason": "Multiple faces detected", "score": 0}

    # Use the first (and only) face
    face_loc = face_locations[0]
    metrics = compute_face_metrics(image, face_loc)
    
    # Base requirements
    if metrics["face_ratio"] < 0.05:
        return {"valid": False, "reason": "Face too far", "score": metrics["blur_score"]}
    if metrics["blur_score"] < 20: # Lowered threshold for robustness
        return {"valid": False, "reason": "Image too blurry", "score": metrics["blur_score"]}

    # Step-specific logic using facial landmarks if needed, 
    # but for simplicity we can use face center offset for left/right
    landmarks = face_recognition.face_landmarks(image, [face_loc])[0]
    
    # Check "looking straight" vs "turned" roughly
    # nose_bridge vs average eye position
    nose = landmarks.get("nose_bridge", [])
    left_eye = landmarks.get("left_eye", [])
    right_eye = landmarks.get("right_eye", [])
    
    if not nose or not left_eye or not right_eye:
        return {"valid": False, "reason": "Could not identify facial features", "score": metrics["blur_score"]}

    # Rough head pose estimation based on landmarks
    # This is a simplified version of what might be needed
    
    valid = False
    reason = "Wrong position"
    
    if step == "center":
        # Nose should be roughly between eyes horizontally
        if abs(metrics["offset_x"]) < 0.15:
            valid = True
            reason = "OK"
        else:
            reason = "Look straight at the camera"
            
    elif step == "slight_left":
        # Face should be slightly to the left side of the frame or head turned left
        # If head is turned left, the right side of the face is more visible
        if metrics["offset_x"] < -0.05:
            valid = True
            reason = "OK"
        else:
            reason = "Turn slightly LEFT"
            
    elif step == "slight_right":
        if metrics["offset_x"] > 0.05:
            valid = True
            reason = "OK"
        else:
            reason = "Turn slightly RIGHT"
            
    elif step == "chin_up":
        # Nose bridge should be higher up than average
        if metrics["offset_y"] < -0.05:
            valid = True
            reason = "OK"
        else:
            reason = "Tilt chin UP"

    return {
        "valid": valid,
        "reason": reason,
        "score": metrics["blur_score"],
        "face_cx": metrics["face_cx"],
        "face_cy": metrics["face_cy"],
        "metrics": metrics
    }

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["validate", "enroll", "verify"])
    parser.add_argument("--input", required=True, help="Path to image file or JSON job file")
    parser.add_argument("--step", help="Enrollment step (center, slight_left, etc.)")
    parser.add_argument("--prev_cx", type=str, help="Previous face center X")
    parser.add_argument("--member_id", help="Member ID for enrollment")
    parser.add_argument("--output_dir", help="Output directory for embeddings")
    
    args = parser.parse_args()
    
    try:
        if args.mode == "validate":
            if not os.path.exists(args.input):
                print(json.dumps({"valid": False, "reason": "Input file not found"}))
                return
            
            image = face_recognition.load_image_file(args.input)
            prev_cx = float(args.prev_cx) if args.prev_cx and args.prev_cx != "null" else None
            result = validate_step(image, args.step, prev_cx)
            print(json.dumps(result))

        elif args.mode == "enroll" or args.mode == "camera" or args.mode == "upload":
            # The backend might call this with --mode camera or --mode upload for enrollment
            # based on current members.js logic.
            
            # For simplicity, we'll support both "enroll" and the existing "camera"/"upload" modes
            enroll_mode = args.mode
            if enroll_mode in ["camera", "upload"]:
                # Current backend sends JSON list of images for camera, single file for upload
                pass
            
            # Load images
            images_to_process = []
            if os.path.isdir(args.input):
                # Process all jpg in dir
                for f in os.listdir(args.input):
                    if f.endswith(".jpg"):
                        images_to_process.append({"path": os.path.join(args.input, f), "angle": "unknown"})
            elif args.input.endswith(".json"):
                # Job file from backend
                with open(args.input, 'r') as f:
                    job_data = json.load(f)
                temp_dir = os.path.join(os.path.dirname(args.input), "temp_enroll")
                os.makedirs(temp_dir, exist_ok=True)
                for i, img_data in enumerate(job_data):
                    b64 = img_data.get("base64") or img_data.get("dataUrl") or img_data
                    angle = img_data.get("angle", "unknown") if isinstance(img_data, dict) else "unknown"
                    if isinstance(b64, str) and "base64," in b64:
                        b64 = b64.split("base64,")[1]
                    
                    import base64
                    img_path = os.path.join(temp_dir, f"frame_{i}.jpg")
                    with open(img_path, "wb") as f_out:
                        f_out.write(base64.b64decode(b64))
                    images_to_process.append({"path": img_path, "angle": angle})
            else:
                images_to_process.append({"path": args.input, "angle": "unknown"})

            encodings = []
            image_metrics_list = []
            
            for i, img_info in enumerate(images_to_process):
                img_path = img_info["path"]
                angle = img_info["angle"]
                img = face_recognition.load_image_file(img_path)
                face_locations = face_recognition.face_locations(img)
                
                if face_locations:
                    found_encs = face_recognition.face_encodings(img, known_face_locations=face_locations)
                    if found_encs:
                        encodings.append(found_encs[0])
                        
                        # Compute metrics
                        metrics = compute_face_metrics(img, face_locations[0])
                        metrics["angle"] = angle
                        metrics["filename"] = f"{args.member_id}-{i+1}.jpg" if args.member_id else f"frame-{i+1}.jpg"
                        image_metrics_list.append(metrics)
                        
                        # Save the image to output_dir
                        if args.output_dir and args.member_id:
                            import shutil
                            os.makedirs(args.output_dir, exist_ok=True)
                            dest_path = os.path.join(args.output_dir, f"{args.member_id}-{i+1}.jpg")
                            shutil.copy(img_path, dest_path)

            if not encodings:
                print(json.dumps({"success": False, "error": "No faces found in any image"}))
                return

            # Average encodings (normalized)
            avg_enc = np.mean(encodings, axis=0)
            avg_enc = avg_enc / np.linalg.norm(avg_enc)
            
            # Save encoding if output_dir and member_id provided
            if args.output_dir and args.member_id:
                os.makedirs(args.output_dir, exist_ok=True)
                import datetime
                metadata = {
                    "person_id": args.member_id,
                    "embedding_model": "face_recognition_128d",
                    "embedding": avg_enc.tolist(),
                    "metrics": {
                        "image_count": len(encodings),
                        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                        "images": image_metrics_list
                    }
                }
                metadata_file = os.path.join(args.output_dir, f"{args.member_id}-metadata.json")
                with open(metadata_file, "w") as f:
                    json.dump(metadata, f, indent=2)

            print(json.dumps({
                "success": True,
                "count": len(encodings),
                "has_embedding": True
            }))

    except Exception as e:
        import traceback
        print(json.dumps({"success": False, "error": str(e), "traceback": traceback.format_exc()}))

if __name__ == "__main__":
    main()
