import React, { useState, useEffect, useRef } from "react";
import {
  fetchMembers,
  updateMember,
  uploadMemberImages,
  fetchMemberImages,
  getMemberImageUrl,
  getOrgMode,
  validateFrame
} from "../services/api";

const STEPS = ["center", "left", "right"];
const STEP_LABELS = {
  center: "Look Straight",
  left: "Turn LEFT",
  right: "Turn RIGHT"
};

const ModifyUser = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMember, setSelectedMember] = useState(null);

  const [editName, setEditName] = useState("");
  const [editPhoneDigits, setEditPhoneDigits] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [reEnroll, setReEnroll] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturedImages, setCapturedImages] = useState([]);
  const [previewUrl, setPreviewUrl] = useState(null);

  const [stepIndex, setStepIndex] = useState(0);
  const [phase, setPhase] = useState("idle");
  const [circleColor, setCircleColor] = useState("blue");
  const [statusMessage, setStatusMessage] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const captureStateRef = useRef({
    validWindowStart: null,
    bestFrame: null,
    prevFaceCx: null,
    pollingTimer: null,
    captures: []
  });

  const mode = getOrgMode();
  const idLabel = mode ? "Employee ID" : "Member ID";

  const loadMembers = async () => {
    setLoading(true);
    try {
      const data = await fetchMembers();
      setMembers(Array.isArray(data) ? data : data.members || []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMembers(); }, []);

  const getPersonId = (m) => m.person_id || m.member_id || m.employee_id;

  const selectMember = async (member) => {
    const pid = getPersonId(member);
    setSelectedMember(member);
    setEditName(member.name || "");

    const raw = (member.phone_number || "").replace(/\D/g, "");
    setEditPhoneDigits(raw.startsWith("91") ? raw.slice(2) : raw);

    setMessage("");
    setError("");
    setReEnroll(false);
    setCapturedImages([]);
    setPhase("idle");
    setPreviewUrl(null);

    try {
      const imgData = await fetchMemberImages(pid);
      if (imgData.images && imgData.images.length > 0) {
        setPreviewUrl(getMemberImageUrl(pid, imgData.images[0]));
      }
    } catch {}
  };

  const handlePhoneChange = (e) => {
    const raw = e.target.value.replace(/\D/g, "");
    setEditPhoneDigits(raw.slice(0, 10));
  };

  const handleSave = async () => {
    if (!selectedMember) return;
    setError("");
    setMessage("");

    if (!editName.trim()) return setError("Name is required.");
    if (editPhoneDigits.length > 0 && editPhoneDigits.length !== 10) return setError("Phone must be exactly 10 digits.");

    setSaving(true);
    const pid = getPersonId(selectedMember);

    try {
      await updateMember(pid, {
        name: editName.trim(),
        phoneNumber: editPhoneDigits ? `+91${editPhoneDigits}` : undefined,
      });

      let imgMsg = "";
      if (reEnroll && capturedImages.length > 0) {
        try {
          const ulMode = capturedImages.length === 1 ? "upload" : "camera";
          const structImages = capturedImages.map(c => ({
            angle: c.angle || "center",
            base64: c.dataUrl
          }));
          const result = await uploadMemberImages(pid, structImages, ulMode);
          imgMsg = ` — ${result.count || 0} images updated`;
        } catch (imgErr) {
          imgMsg = ` — image upload failed: ${imgErr.message}`;
        }
      }

      setMessage(`Member updated successfully${imgMsg}`);
      loadMembers();
    } catch (err) {
      setError(err.message || "Failed to update member.");
    } finally {
      setSaving(false);
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
      } catch {}
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
    
    setTimeout(() => { startScanningStep(); }, 1500);
  };

  const closeCamera = () => {
    setCameraOpen(false);
    setPhase("idle");
    setStatusMessage("");
    if (captureStateRef.current.pollingTimer) clearTimeout(captureStateRef.current.pollingTimer);
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
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
      
      setStepIndex(idx => {
          const step = STEPS[idx];
          const memberId = selectedMember ? getPersonId(selectedMember) : 0;
          validateFrame(memberId, dataUrl, step, state.prevFaceCx)
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

  return (
    <div className="sl-modify-page">
      <div className="sl-modify-layout">
        <div className="sl-modify-list-panel">
          <h3 className="sl-section-title">Select Member to Modify</h3>
          {loading ? (
            <p className="muted-text">Loading members...</p>
          ) : members.length === 0 ? (
            <p className="muted-text">No members found.</p>
          ) : (
            <div className="sl-member-list">
              {members.map((m) => {
                const pid = getPersonId(m);
                const isSelected = selectedMember && getPersonId(selectedMember) === pid;
                return (
                  <div
                    key={pid}
                    className={`sl-member-list-item ${isSelected ? "sl-member-selected" : ""}`}
                    onClick={() => selectMember(m)}
                  >
                    <div className="sl-member-list-name">{m.name}</div>
                    <div className="sl-member-list-id">{idLabel}: {pid}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sl-modify-edit-panel">
          {!selectedMember ? (
            <div className="sl-modify-placeholder">
              <p className="muted-text">Select a member from the list to edit their details.</p>
            </div>
          ) : (
            <div className="card">
              <h3 className="card-title">Edit Member — {idLabel}: {getPersonId(selectedMember)}</h3>

              {previewUrl && !reEnroll && (
                <div className="sl-modify-preview">
                  <img src={previewUrl} alt="Current face" />
                </div>
              )}

              <div className="vertical-form" style={{ marginTop: 16 }}>
                <div className="form-group">
                  <label>Name</label>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Enter name" />
                </div>

                <div className="form-group">
                  <label>Phone Number</label>
                  <div className="phone-input-wrapper">
                    <span className="phone-prefix">+91</span>
                    <input type="tel" className="phone-input-field" placeholder="9876543210" value={editPhoneDigits} onChange={handlePhoneChange} maxLength={10} />
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={reEnroll} onChange={(e) => setReEnroll(e.target.checked)} style={{ width: "auto" }} />
                    Re-enroll Face Images
                  </label>
                </div>

                {reEnroll && (
                  <div className="form-group">
                    {capturedImages.length > 0 && (
                      <div className="capture-thumbnails">
                        {capturedImages.map((cap, i) => (
                          <div key={i} className="capture-thumb">
                            <img src={cap.dataUrl} alt={`frame ${i + 1}`} />
                          </div>
                        ))}
                      </div>
                    )}

                    {capturedImages.length === 0 && !cameraOpen && (
                      <button type="button" className="ghost-btn" onClick={openCamera} style={{ marginTop: 4 }}>
                        Open Camera
                      </button>
                    )}
                  </div>
                )}

                {error && <div className="error-message">{error}</div>}
                {message && <div className="success-message">{message}</div>}

                <button className="primary-btn" onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
                  {saving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

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
              <button className="ghost-btn" onClick={closeCamera}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModifyUser;
