import React, { useState, useEffect, useRef } from "react";
import { createMember, fetchNextMemberId, uploadMemberImages, getOrgMode, validateFrame } from "../services/api";

// ─── Enrollment Step Configuration ──────────────────────────────────────────
// Must match VALID_STEPS in python/process_face.py
const STEPS = ["center", "slight_left", "slight_right", "chin_up"];

const STEP_LABELS = {
  center:      "Look Straight",
  slight_left: "Slight LEFT ←",
  slight_right: "Slight RIGHT →",
  chin_up:     "Chin UP ↑",
};

// Short instruction shown inside the camera overlay
const STEP_HINTS = {
  center:      "Look directly at the camera",
  slight_left: "Slowly turn your head a little to your LEFT",
  slight_right: "Slowly turn your head a little to your RIGHT",
  chin_up:     "Gently tilt your chin upward",
};

// Directional arrow shown as SVG overlay during each step
const STEP_ARROWS = {
  center:      null,
  slight_left: "left",
  slight_right: "right",
  chin_up:     "up",
};

// ─── Arrow Overlay Component ─────────────────────────────────────────────────
function DirectionArrow({ direction }) {
  if (!direction) return null;
  const style = {
    position: "absolute",
    zIndex: 20,
    pointerEvents: "none",
    opacity: 0.9,
  };

  if (direction === "left") {
    return (
      <div style={{ ...style, left: "8px", top: "50%", transform: "translateY(-50%)" }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="17" fill="rgba(59,130,246,0.85)" />
          <path d="M22 10L13 18L22 26" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  }
  if (direction === "right") {
    return (
      <div style={{ ...style, right: "8px", top: "50%", transform: "translateY(-50%)" }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="17" fill="rgba(59,130,246,0.85)" />
          <path d="M14 10L23 18L14 26" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  }
  if (direction === "up") {
    return (
      <div style={{ ...style, top: "8px", left: "50%", transform: "translateX(-50%)" }}>
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
          <circle cx="18" cy="18" r="17" fill="rgba(59,130,246,0.85)" />
          <path d="M10 22L18 13L26 22" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    );
  }
  return null;
}

// ─── Face Oval Overlay Component ─────────────────────────────────────────────
function FaceOval({ color }) {
  const borderColor = color === "green" ? "#4ade80" : color === "yellow" ? "#facc15" : "rgba(255,255,255,0.5)";
  return (
    <div style={{
      position: "absolute",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: "130px",
      height: "170px",
      borderRadius: "50%",
      border: `2.5px dashed ${borderColor}`,
      pointerEvents: "none",
      zIndex: 15,
      transition: "border-color 0.3s ease",
    }} />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
const AddUser = ({ onUserCreated, focus }) => {
  const [name, setName]               = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage]         = useState("");
  const [error, setError]             = useState("");
  const [cameraOpen, setCameraOpen]   = useState(false);
  const [generatedId, setGeneratedId] = useState("");
  const [manualId, setManualId]       = useState("");
  const [idType, setIdType]           = useState("member_id");

  const [stepIndex, setStepIndex]         = useState(0);
  const [phase, setPhase]                 = useState("idle");
  const [circleColor, setCircleColor]     = useState("blue");
  const [statusMessage, setStatusMessage] = useState("");
  const [capturedImages, setCapturedImages] = useState([]);

  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const nameRef   = useRef(null);

  const captureStateRef = useRef({
    validWindowStart:      null,
    bestFrame:             null,
    bestInvalidFrame:      null,
    prevFaceCx:            null,
    pollingTimer:          null,
    isScanning:            false,
    captures:              [],
    stepStartTime:         null,
    validConsecutiveFrames: 0,
  });

  const mode = getOrgMode();

  useEffect(() => {
    if (focus && nameRef.current) nameRef.current.focus();
  }, [focus]);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchNextMemberId();
        setGeneratedId(data.next_id || "");
        setIdType(data.id_type || (mode ? "employee_id" : "member_id"));
      } catch (e) {
        setGeneratedId("");
      }
    };
    load();
  }, [mode]);

  const handlePhoneChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    setPhoneDigits(raw.slice(0, 10));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");

    if (!name) return setError("Name is required.");
    if (phoneDigits.length > 0 && phoneDigits.length !== 10)
      return setError("Phone must be exactly 10 digits.");

    const enteredId = manualId.trim();
    if (enteredId && (isNaN(enteredId) || parseInt(enteredId) <= 0)) {
      return setError(`${idLabel} must be a positive number.`);
    }
    if (capturedImages.length === 0)
      return setError("Please capture face images first.");

    setIsSubmitting(true);
    try {
      const created = await createMember({
        name,
        phoneNumber: phoneDigits ? `+91${phoneDigits}` : undefined,
        personId: enteredId ? parseInt(enteredId) : undefined,
      });

      const personId =
        created.person_id || created.member_id || created.employee_id;

      try {
        const ulMode = capturedImages.length === 1 ? "upload" : "camera";
        const structImages = capturedImages.map((c) => ({
          angle:  c.angle || "center",
          base64: c.dataUrl,
        }));
        const captureResult = await uploadMemberImages(personId, structImages, ulMode);
        setMessage(
          `Member created (${idType}: ${personId}) — ${captureResult.count || 0} images saved`
        );
      } catch (captureErr) {
        setMessage(
          `Member created (${idType}: ${personId}), but image upload failed: ${captureErr.message}`
        );
      }

      setName("");
      setPhoneDigits("");
      setManualId("");
      setCapturedImages([]);
      setPhase("idle");
      try {
        const nextIdData = await fetchNextMemberId();
        setGeneratedId(nextIdData.next_id || "");
      } catch (e) {}
      if (onUserCreated) onUserCreated(created);
    } catch (err) {
      setError(err.message || "Failed to create member.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCamera = async () => {
    setCameraOpen(true);
    setPhase("instruction");
    setStepIndex(0);
    setCircleColor("blue");
    setStatusMessage("");
    setCapturedImages([]);

    captureStateRef.current = {
      validWindowStart:      null,
      bestFrame:             null,
      bestInvalidFrame:      null,
      prevFaceCx:            null,
      pollingTimer:          null,
      isScanning:            false,
      captures:              [],
      stepStartTime:         null,
      validConsecutiveFrames: 0,
    };

    const constraints = [
      { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: "environment" } } },
      { video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } },
      { video: true },
    ];

    let stream = null;
    for (const c of constraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(c);
        break;
      } catch (e) {}
    }

    if (!stream) {
      setError("Unable to access camera.");
      setCameraOpen(false);
      return;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
    }

    // Auto-start first step after 1000ms (faster than original 1500ms)
    setTimeout(() => {
      startScanningStep();
    }, 1000);
  };

  const closeCamera = () => {
    setCameraOpen(false);
    setPhase("idle");
    setStatusMessage("");
    const state = captureStateRef.current;
    state.isScanning = false;
    if (state.pollingTimer) clearTimeout(state.pollingTimer);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const startScanningStep = () => {
    setPhase("scanning");
    setStatusMessage("");
    setCircleColor("blue");
    const state = captureStateRef.current;
    state.isScanning               = true;
    state.validWindowStart         = null;
    state.bestFrame                = null;
    state.bestInvalidFrame         = null;
    state.stepStartTime            = Date.now();
    state.validConsecutiveFrames   = 0;
    pollFrame();
  };

  const pollFrame = async () => {
    const state = captureStateRef.current;
    if (!videoRef.current || !canvasRef.current) return;

    setPhase((currentPhase) => {
      if (currentPhase !== "scanning") return currentPhase;

      const canvas = canvasRef.current;
      const video  = videoRef.current;

      if (video.videoWidth === 0) {
        state.pollingTimer = setTimeout(pollFrame, 100);
        return currentPhase;
      }

      canvas.width  = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);

      const dataUrl = canvas.toDataURL("image/jpeg", 0.90);

      // Read current stepIndex inside state setter to avoid stale closure
      setStepIndex((idx) => {
        const step = STEPS[idx];

        validateFrame(0, dataUrl, step, state.prevFaceCx)
          .then((res) => {
            if (!state.isScanning || !res) return;

            const elapsedTotal = Date.now() - state.stepStartTime;

            // Brief lock-in period: do not accept captures in first 800ms
            // (gives user time to get into position)
            if (elapsedTotal < 800) {
              res.valid = false;
              if (res.reason === "OK") res.reason = "Hold position...";
            }

            // Track best frame seen so far (even invalid ones, for fallback)
            if (res.score > 0) {
              if (!state.bestInvalidFrame || res.score > state.bestInvalidFrame.score) {
                state.bestInvalidFrame = {
                  dataUrl,
                  score:   res.score,
                  face_cx: res.face_cx,
                };
              }
            }

            if (res.valid) {
              setStatusMessage("");
              if (!state.validWindowStart) {
                state.validWindowStart       = Date.now();
                state.validConsecutiveFrames = 0;
              }
              state.validConsecutiveFrames =
                (state.validConsecutiveFrames || 0) + 1;

              if (!state.bestFrame || res.score > state.bestFrame.score) {
                state.bestFrame = {
                  dataUrl,
                  score:   res.score,
                  face_cx: res.face_cx,
                };
              }

              const elapsed = Date.now() - state.validWindowStart;
              // Capture after 300ms of valid frames OR 2 consecutive valid frames
              if (elapsed >= 300 || state.validConsecutiveFrames >= 2) {
                handleSuccessfulCapture(step, state.bestFrame);
                return;
              }
            } else {
              setStatusMessage(res.reason || "Adjust position");
              state.validWindowStart       = null;
              state.bestFrame              = null;
              state.validConsecutiveFrames = 0;

              // Timeout fallback: use best available frame after 2500ms
              const isTimeoutFallback = elapsedTotal > 2500;
              if (isTimeoutFallback && state.bestInvalidFrame) {
                console.log(
                  `[Fallback] step=${step} elapsed=${elapsedTotal}ms score=${state.bestInvalidFrame.score}`
                );
                setStatusMessage("Capturing best available...");
                handleSuccessfulCapture(step, state.bestInvalidFrame);
                return;
              }
            }

            setPhase((p) => {
              if (p === "scanning") {
                state.pollingTimer = setTimeout(pollFrame, 100);
              }
              return p;
            });
          })
          .catch(() => {
            setPhase((p) => {
              if (p === "scanning") {
                state.pollingTimer = setTimeout(pollFrame, 500);
              }
              return p;
            });
          });

        return idx;
      });

      return currentPhase;
    });
  };

  const handleSuccessfulCapture = (step, frame) => {
    const state = captureStateRef.current;
    state.isScanning = false;
    if (state.pollingTimer) clearTimeout(state.pollingTimer);

    setPhase("captured");
    setCircleColor("green");
    setStatusMessage("");

    state.captures.push({
      angle:   step,
      dataUrl: frame.dataUrl,
      score:   frame.score,
    });
    state.prevFaceCx = frame.face_cx;

    // Brief green flash, then advance to next step
    setTimeout(() => {
      setStepIndex((old) => {
        const next = old + 1;
        if (next < STEPS.length) {           // STEPS.length = 4 now
          setPhase("instruction");
          setCircleColor("blue");
          setTimeout(() => {
            startScanningStep();
          }, 1000);                           // 1 second between steps
          return next;
        } else {
          // All steps done
          setCapturedImages(state.captures.slice());
          setPhase("done");
          closeCamera();
          return old;
        }
      });
    }, 800);
  };

  const idLabel = mode ? "Employee ID" : "Member ID";

  // Current step name for UI (read-only rendering)
  const currentStep = STEPS[stepIndex] || "center";

  return (
    <div className="card">
      <h2 className="card-title">Add New Member</h2>
      <p className="card-description">
        Create a new {mode ? "employee" : "member"} with face enrollment.
      </p>

      <form className="vertical-form" onSubmit={handleSubmit}>
        {/* Name */}
        <div className="form-group">
          <label htmlFor="name">Name</label>
          <input
            id="name"
            ref={nameRef}
            type="text"
            placeholder="Enter name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Phone */}
        <div className="form-group">
          <label htmlFor="phone">Phone Number</label>
          <div className="phone-input-wrapper">
            <span className="phone-prefix">+91</span>
            <input
              id="phone"
              type="tel"
              className="phone-input-field"
              placeholder="9876543210"
              value={phoneDigits}
              onChange={handlePhoneChange}
              maxLength={10}
            />
          </div>
        </div>

        {/* ID */}
        <div className="form-group">
          <label>{idLabel}</label>
          <input
            type="number"
            min="1"
            placeholder={generatedId ? `Auto: ${generatedId}` : "Auto-generated"}
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
          />
        </div>

        {/* Face Capture */}
        <div className="form-group">
          <label>Face Capture</label>

          {capturedImages.length > 0 && (
            <div className="capture-thumbnails">
              {capturedImages.map((cap, i) => (
                <div key={i} className="capture-thumb">
                  <img src={cap.dataUrl || cap.base64} alt={`${cap.angle}`} />
                  <div style={{
                    fontSize: "0.70rem", textAlign: "center",
                    color: "#6b7280", marginTop: "2px"
                  }}>
                    {STEP_LABELS[cap.angle] || cap.angle}
                  </div>
                </div>
              ))}
            </div>
          )}

          {capturedImages.length === 0 && !cameraOpen && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="primary-btn" onClick={openCamera}>
                Open Camera
              </button>
              <label className="ghost-btn" style={{ cursor: "pointer", margin: 0 }}>
                Upload File
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = Array.from(e.target.files);
                    if (!files.length) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      setCapturedImages([{ angle: "center", dataUrl: ev.target.result }]);
                      setPhase("done");
                    };
                    reader.readAsDataURL(files[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}

          {capturedImages.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  setCapturedImages([]);
                  openCamera();
                }}
              >
                Retake
              </button>
            </div>
          )}
        </div>

        {error   && <div className="error-message">{error}</div>}
        {message && <div className="success-message">{message}</div>}

        <button type="submit" className="primary-btn" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Add Member"}
        </button>
      </form>

      {/* ── Camera Modal ──────────────────────────────────────────────────── */}
      {cameraOpen && (
        <div className="camera-modal">
          <div
            className="camera-content card"
            style={{ textAlign: "center", position: "relative" }}
          >
            {/* Step progress dots */}
            <div style={{
              display: "flex", justifyContent: "center",
              gap: "8px", marginBottom: "10px"
            }}>
              {STEPS.map((s, i) => (
                <div
                  key={s}
                  title={STEP_LABELS[s]}
                  style={{
                    width: "12px", height: "12px", borderRadius: "50%",
                    backgroundColor:
                      i < stepIndex  ? "#4ade80" :
                      i === stepIndex ? "#3b82f6" : "#e5e7eb",
                    transition: "background-color 0.3s ease",
                  }}
                />
              ))}
            </div>

            {/* Step label */}
            <div style={{
              fontSize: "1.05rem", fontWeight: "700",
              color: "#1f2937", marginBottom: "6px"
            }}>
              Step {stepIndex + 1} of {STEPS.length}: {STEP_LABELS[currentStep]}
            </div>

            {/* Hint text */}
            <div style={{
              fontSize: "0.82rem", color: "#6b7280",
              marginBottom: "8px", minHeight: "18px"
            }}>
              {phase === "instruction" || phase === "scanning"
                ? STEP_HINTS[currentStep]
                : phase === "captured"
                ? "✓ Captured!"
                : ""}
            </div>

            {/* Video + overlays */}
            <div style={{ position: "relative", display: "inline-block" }}>
              <video
                ref={videoRef}
                className="camera-video-circle"
                style={{
                  border: `4px solid ${circleColor === "green" ? "#4ade80" : "#3b82f6"}`,
                  transition: "border-color 0.3s ease",
                  width: "240px",
                  height: "240px",
                }}
                autoPlay
                playsInline
                muted
              />

              {/* Face oval guide */}
              <FaceOval color={circleColor === "green" ? "green" : "white"} />

              {/* Directional arrow (shown only during scanning) */}
              {(phase === "scanning" || phase === "instruction") && (
                <DirectionArrow direction={STEP_ARROWS[currentStep]} />
              )}

              {/* Status badge (error/instruction message) */}
              {statusMessage && phase === "scanning" && (
                <div style={{
                  position: "absolute", bottom: "10px", left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "rgba(220,38,38,0.82)",
                  color: "white", padding: "4px 12px",
                  borderRadius: "12px", fontSize: "0.80rem",
                  whiteSpace: "nowrap", zIndex: 20,
                  maxWidth: "220px", overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>
                  {statusMessage}
                </div>
              )}

              {/* Success flash badge */}
              {phase === "captured" && (
                <div style={{
                  position: "absolute", bottom: "10px", left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "rgba(22,163,74,0.90)",
                  color: "white", padding: "4px 14px",
                  borderRadius: "12px", fontSize: "0.85rem",
                  fontWeight: "600", zIndex: 20,
                }}>
                  ✓ Got it!
                </div>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: "none" }} />

            {/* Action buttons */}
            <div className="camera-actions" style={{ marginTop: "14px" }}>
              {(phase === "instruction" || phase === "scanning") && (
                <button className="primary-btn" disabled>
                  {phase === "instruction" ? "Get Ready..." : "Scanning..."}
                </button>
              )}
              <button className="ghost-btn" onClick={closeCamera}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AddUser;
