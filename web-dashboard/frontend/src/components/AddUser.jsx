import React, { useState, useEffect, useRef } from "react";
import { createMember, fetchNextMemberId, uploadMemberImages, getOrgMode, validateFrame } from "../services/api";

const STEPS = ["center", "left", "right"];
const STEP_LABELS = {
  center: "Look Straight",
  left: "Turn LEFT",
  right: "Turn RIGHT"
};

const AddUser = ({ onUserCreated, focus }) => {
  const [name, setName] = useState("");
  const [phoneDigits, setPhoneDigits] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [generatedId, setGeneratedId] = useState("");
  const [manualId, setManualId] = useState("");
  const [idType, setIdType] = useState("member_id");

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState("idle"); 
  const [circleColor, setCircleColor] = useState("blue");
  const [statusMessage, setStatusMessage] = useState("");
  const [capturedImages, setCapturedImages] = useState([]);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const nameRef = useRef(null);
  
  const captureStateRef = useRef({
    validWindowStart: null,
    bestFrame: null,
    prevFaceCx: null,
    pollingTimer: null,
    captures: []
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
    if (phoneDigits.length > 0 && phoneDigits.length !== 10) return setError("Phone must be exactly 10 digits.");
    
    const enteredId = manualId.trim();
    if (enteredId && (isNaN(enteredId) || parseInt(enteredId) <= 0)) {
      return setError(`${idLabel} must be a positive number.`);
    }

    if (capturedImages.length === 0) return setError("Please capture face images first.");

    setIsSubmitting(true);
    try {
      const created = await createMember({
        name,
        phoneNumber: phoneDigits ? `+91${phoneDigits}` : undefined,
        personId: enteredId ? parseInt(enteredId) : undefined,
      });

      const personId = created.person_id || created.member_id || created.employee_id;

      try {
        const ulMode = capturedImages.length === 1 ? "upload" : "camera";
        const structImages = capturedImages.map(c => ({
          angle: c.angle || "center",
          base64: c.dataUrl
        }));
        const captureResult = await uploadMemberImages(personId, structImages, ulMode);
        setMessage(`Member created (${idType}: ${personId}) — ${captureResult.count || 0} images saved`);
      } catch (captureErr) {
        setMessage(`Member created (${idType}: ${personId}), but image upload failed: ${captureErr.message}`);
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
      validWindowStart: null,
      bestFrame: null,
      prevFaceCx: null,
      pollingTimer: null,
      captures: []
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
    
    // Auto start first step after 1500ms
    setTimeout(() => {
       startScanningStep();
    }, 1500);
  };

  const closeCamera = () => {
    setCameraOpen(false);
    setPhase("idle");
    setStatusMessage("");
    if (captureStateRef.current.pollingTimer) {
      clearTimeout(captureStateRef.current.pollingTimer);
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
  };

  const startScanningStep = () => {
    setPhase("scanning");
    setStatusMessage("");
    setCircleColor("blue");
    captureStateRef.current.isScanning = true;
    captureStateRef.current.validWindowStart = null;
    captureStateRef.current.bestFrame = null;
    captureStateRef.current.bestInvalidFrame = null;
    captureStateRef.current.stepStartTime = Date.now();
    captureStateRef.current.validConsecutiveFrames = 0;
    pollFrame();
  };

  const pollFrame = async () => {
    const state = captureStateRef.current;
    if (!videoRef.current || !canvasRef.current) return;
    
    setPhase((currentPhase) => {
      if (currentPhase !== "scanning") return currentPhase;
      
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (video.videoWidth === 0) {
          state.pollingTimer = setTimeout(pollFrame, 100);
          return currentPhase;
      }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);
      
      const dataUrl = canvas.toDataURL("image/jpeg", 0.90);
      
      // Needs to get latest stepIndex here:
      setStepIndex(idx => {
          const step = STEPS[idx];
          validateFrame(0, dataUrl, step, state.prevFaceCx)
            .then(res => {
              if (!state.isScanning || !res) return;
              
              const elapsedTotal = Date.now() - state.stepStartTime;
              const isTimeoutFallback = elapsedTotal > 3000;
              
              if (elapsedTotal < 1000) {
                 res.valid = false;
                 if (res.reason === "OK") res.reason = "Hold position...";
              }

              if (res.score > 0) {
                 if (!state.bestInvalidFrame || res.score > state.bestInvalidFrame.score) {
                    state.bestInvalidFrame = { dataUrl, score: res.score, face_cx: res.face_cx };
                 }
              }

              if (res.valid) {
                setStatusMessage("");
                if (!state.validWindowStart) {
                  state.validWindowStart = Date.now();
                  state.validConsecutiveFrames = 0;
                }
                state.validConsecutiveFrames = (state.validConsecutiveFrames || 0) + 1;
                
                if (!state.bestFrame || res.score > state.bestFrame.score) {
                  state.bestFrame = { dataUrl, score: res.score, face_cx: res.face_cx };
                }
                
                const elapsed = Date.now() - state.validWindowStart;
                if (elapsed >= 500 || state.validConsecutiveFrames >= 3) {
                  handleSuccessfulCapture(step, state.bestFrame);
                  return; 
                }
              } else {
                setStatusMessage(res.reason || "Invalid");
                state.validWindowStart = null;
                state.bestFrame = null;
                state.validConsecutiveFrames = 0;
                
                if (isTimeoutFallback && state.bestInvalidFrame) {
                   console.log("Fallback triggered for step", step, "after", elapsedTotal, "ms");
                   setStatusMessage("Capturing best available...");
                   handleSuccessfulCapture(step, state.bestInvalidFrame);
                   return;
                }
              }
              
              setPhase((p) => {
                if (p === "scanning") state.pollingTimer = setTimeout(pollFrame, 100);
                return p;
              });
            })
            .catch(err => {
              setPhase((p) => {
                if (p === "scanning") state.pollingTimer = setTimeout(pollFrame, 500);
                return p;
              });
            });
          return idx;
      });
        
      return currentPhase;
    });
  };

  const handleSuccessfulCapture = (step, frame) => {
    captureStateRef.current.isScanning = false;
    if (captureStateRef.current.pollingTimer) {
       clearTimeout(captureStateRef.current.pollingTimer);
    }
    setPhase("captured");
    setCircleColor("green");
    const captures = captureStateRef.current.captures;
    captures.push({ angle: step, dataUrl: frame.dataUrl, score: frame.score });
    captureStateRef.current.prevFaceCx = frame.face_cx;
    
    setTimeout(() => {
      setStepIndex(old => {
        const next = old + 1;
        if (next < 3) {
          setPhase("instruction");
          setCircleColor("blue");
          setTimeout(() => { startScanningStep(); }, 1500);
          return next;
        } else {
          setCapturedImages(captures);
          setPhase("done");
          closeCamera();
          return old;
        }
      });
    }, 1000);
  };

  const idLabel = mode ? "Employee ID" : "Member ID";

  return (
    <div className="card">
      <h2 className="card-title">Add New Member</h2>
      <p className="card-description">
        Create a new {mode ? "employee" : "member"} with face enrollment. 
      </p>

      <form className="vertical-form" onSubmit={handleSubmit}>
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

        <div className="form-group">
          <label>Face Capture</label>

          {capturedImages.length > 0 && (
            <div className="capture-thumbnails">
              {capturedImages.map((cap, i) => (
                <div key={i} className="capture-thumb">
                  <img src={cap.dataUrl || cap.base64} alt={`frame ${i + 1}`} />
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
              <button type="button" className="ghost-btn" onClick={() => {
                setCapturedImages([]);
                openCamera();
              }}>
                Retake
              </button>
            </div>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}
        {message && <div className="success-message">{message}</div>}

        <button type="submit" className="primary-btn" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Add Member"}
        </button>
      </form>

      {cameraOpen && (
        <div className="camera-modal">
          <div className="camera-content card" style={{ textAlign: "center", position: "relative" }}>
            
            <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginBottom: "12px" }}>
               {STEPS.map((s, i) => (
                 <div key={s} style={{
                   width: "12px", height: "12px", borderRadius: "50%",
                   backgroundColor: i < stepIndex ? "#4ade80" : (i === stepIndex ? "#3b82f6" : "#e5e7eb")
                 }} />
               ))}
            </div>

            <div style={{ position: "relative", display: "inline-block" }}>
              <video
                ref={videoRef}
                className="camera-video-circle"
                style={{
                  border: `4px solid ${circleColor === "green" ? "#4ade80" : "#3b82f6"}`,
                  transition: "border-color 0.3s ease",
                  width: "240px", height: "240px"
                }}
                autoPlay
                playsInline
                muted
              />
              
              <div style={{
                position: "absolute", top: "10px", left: "50%", transform: "translateX(-50%)",
                backgroundColor: "rgba(0,0,0,0.6)", color: "white", padding: "6px 16px",
                borderRadius: "20px", fontWeight: "bold", zIndex: 10
              }}>
                {STEP_LABELS[STEPS[stepIndex]]}
              </div>
              
              {statusMessage && (
                <div style={{
                  position: "absolute", top: "45px", left: "50%", transform: "translateX(-50%)",
                  backgroundColor: "rgba(220,38,38,0.8)", color: "white", padding: "4px 12px",
                  borderRadius: "12px", fontSize: "0.85rem", whiteSpace: "nowrap", zIndex: 10
                }}>
                  {statusMessage}
                </div>
              )}
            </div>

            <canvas ref={canvasRef} style={{ display: "none" }} />

            <div className="camera-actions" style={{ marginTop: "16px" }}>
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
