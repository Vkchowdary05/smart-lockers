import sys
import json
import os
import io

# Import directly from collocated scripts instead of Flask backend
from face_selection import select_best_faces_b64
from storage_service import save_user_images
from face_processing import process_face_images

def main():
    try:
        # Prevent stdin blocking/decoding issues
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"success": False, "error": "No input received"}))
            return

        payload = json.loads(input_data)
        person_id = payload['person_id']
        org_name = payload['org_name']
        org_id = payload['org_id']
        images = payload['images']

        if not images:
            print(json.dumps({"success": False, "error": "Empty images list"}))
            return
        
        # 1. Select best 3 by sharpness
        best_images = select_best_faces_b64(images, top_k=3)
        
        # 2. Save images using original python daemon logic
        saved_folder = save_user_images(
            org_name=org_name,
            org_id=org_id,
            person_id=person_id,
            base64_images=best_images,
        )
        
        saved_filepaths = [
            os.path.join(saved_folder, f"{person_id}-{idx}.jpg")
            for idx in range(1, len(best_images) + 1)
        ]
        
        # 3. Generate embeddings & metrics
        result = process_face_images(saved_filepaths)
        embedding = result.get("embedding")
        metrics = result.get("metrics", {})
        
        # 4. Save metadata.json
        metadata = {
            "person_id": person_id,
            "embedding_model": "Facenet512" if embedding else None,
            "embedding": embedding,
            "metrics": metrics,
        }
        
        metadata_file = os.path.join(saved_folder, f"{person_id}-metadata.json")
        with open(metadata_file, "w") as mf:
            json.dump(metadata, mf, indent=2)
            
        print(json.dumps({
            "success": True,
            "image_count": len(saved_filepaths),
            "folder": saved_folder,
            "has_embedding": bool(embedding),
            "metrics": metrics
        }))
    except Exception as e:
        import traceback
        err_str = traceback.format_exc()
        print(json.dumps({"success": False, "error": str(e), "traceback": err_str}))

if __name__ == "__main__":
    main()
