/**
 * face_capture.js — Lightweight client-side face capture quality scoring.
 *
 * Runs entirely in the browser using canvas pixel data.
 * Scores frames with a weighted formula for efficient best-frame selection.
 *
 * Thresholds are intentionally relaxed to work in moderate lighting
 * conditions (office, indoor, natural daylight).
 */

// ─── Thresholds (relaxed for real-world use) ────────────────
const BRIGHTNESS_MIN = 30;   // very dim is still OK
const BRIGHTNESS_MAX = 230;  // only reject extreme overexposure
const FACE_AREA_RATIO_MIN = 0.03; // small faces still acceptable

// ─── Helpers ───────────────────────────────────────────────

function toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
        const base = i * 4;
        gray[i] = Math.round(0.299 * data[base] + 0.587 * data[base + 1] + 0.114 * data[base + 2]);
    }
    return { gray, width, height };
}

function mean(arr) {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
}

function laplacianVariance({ gray, width, height }) {
    const values = [];
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const lap =
                gray[idx - width] +
                gray[idx - 1] +
                (-4) * gray[idx] +
                gray[idx + 1] +
                gray[idx + width];
            values.push(lap);
        }
    }
    if (values.length === 0) return 0;
    const m = values.reduce((s, v) => s + v, 0) / values.length;
    return values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
}

// ─── Fast Face Detection ───────────────────────────────────

function detectFaceSync(imageData) {
    const { data, width, height } = imageData;

    let skinPixels = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;

    // Sample every 2nd pixel for speed
    for (let y = 0; y < height; y += 2) {
        for (let x = 0; x < width; x += 2) {
            const i = (y * width + x) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];

            if (r > 60 && g > 30 && b > 15 &&
                r > g && r > b &&
                (r - g) > 10 &&
                Math.abs(r - g) < 130) {
                skinPixels++;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    const totalSampled = (Math.ceil(width / 2)) * (Math.ceil(height / 2));
    const skinRatio = skinPixels / totalSampled;

    if (skinRatio >= 0.03 && skinRatio <= 0.70) {
        return {
            detected: true,
            count: 1,
            faceBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
        };
    }

    return { detected: false, count: 0, faceBox: null };
}

// ─── Score a Single Frame ──────────────────────────────────

/**
 * Score a frame captured from a canvas. Fully synchronous & lightweight.
 *
 * Returns { valid, rejected_reason, blur_score, brightness, face_ratio, score }
 *
 * Rejection only happens for:
 *   - no face detected
 *   - extreme brightness (too dark / too bright)
 *   - face area too small
 *
 * Blur is used ONLY for scoring (not rejection) so slightly blurry
 * frames are accepted but ranked lower.
 */
export function scoreFrame(canvas) {
    const ctx = canvas.getContext("2d");
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const grayData = toGrayscale(imageData);

    // Blur score (sharpness) — used for scoring only, not rejection
    const blurScore = laplacianVariance(grayData);

    // Brightness
    const brightness = mean(grayData.gray);

    // Face detection
    const face = detectFaceSync(imageData);

    // Face area ratio
    let faceRatio = 0;
    if (face.detected && face.faceBox && face.count === 1) {
        const { w, h } = face.faceBox;
        faceRatio = (w * h) / (canvas.width * canvas.height);
    }

    // --- Rejection rules (minimal — only hard failures) ---
    let rejected_reason = null;

    if (!face.detected) {
        rejected_reason = "no_face";
    } else if (brightness < BRIGHTNESS_MIN) {
        rejected_reason = "too_dark";
    } else if (brightness > BRIGHTNESS_MAX) {
        rejected_reason = "too_bright";
    } else if (faceRatio < FACE_AREA_RATIO_MIN) {
        rejected_reason = "face_too_small";
    }
    // NOTE: blur is NOT a rejection criterion — blurry frames just get lower scores

    // --- Weighted quality score ---
    // Normalize blur score to 0-1 range (cap at 500)
    const normalizedBlur = Math.min(blurScore / 500, 1);

    // Normalize brightness to 0-1 (sweet spot around 100-150)
    const brightnessDist = Math.abs(brightness - 125);
    const brightnessWeight = Math.max(0, 1 - brightnessDist / 125);

    // Face ratio already 0-1
    const normalizedFaceRatio = Math.min(faceRatio / 0.5, 1);

    const score = rejected_reason
        ? 0
        : (normalizedBlur * 0.5) + (normalizedFaceRatio * 0.3) + (brightnessWeight * 0.2);

    return {
        valid: rejected_reason === null,
        rejected_reason,
        blur_score: Math.round(blurScore * 10) / 10,
        brightness: Math.round(brightness),
        face_ratio: Math.round(faceRatio * 1000) / 1000,
        score: Math.round(score * 1000) / 1000,
    };
}
