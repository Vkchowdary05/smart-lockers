import React, { useState } from "react";
import { changePassword } from "../services/api";
import { useNavigate } from "react-router-dom";

const ChangePassword = () => {
    const navigate = useNavigate();
    const [currentPw, setCurrentPw] = useState("");
    const [newPw, setNewPw] = useState("");
    const [confirmPw, setConfirmPw] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Client-side validation helpers
    const hasUpper = /[A-Z]/.test(newPw);
    const hasLower = /[a-z]/.test(newPw);
    const hasDigit = /[0-9]/.test(newPw);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPw);
    const hasLength = newPw.length >= 8;
    const passwordsMatch = newPw === confirmPw && newPw.length > 0;
    const allValid = hasUpper && hasLower && hasDigit && hasSpecial && hasLength && passwordsMatch;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!currentPw) {
            setError("Current password is required.");
            return;
        }
        if (!allValid) {
            setError("Please meet all password requirements.");
            return;
        }

        setSubmitting(true);
        try {
            await changePassword({
                currentPassword: currentPw,
                newPassword: newPw,
                confirmPassword: confirmPw,
            });
            // Redirect based on role
            const role = JSON.parse(atob(localStorage.getItem("secureLockerToken").split(".")[1]))?.role;
            if (role === "super_admin") {
                navigate("/super-admin/dashboard", { replace: true });
            } else {
                navigate("/dashboard", { replace: true });
            }
        } catch (err) {
            setError(err.message || "Failed to change password.");
        } finally {
            setSubmitting(false);
        }
    };

    const Req = ({ met, label }) => (
        <li className={`pw-req ${met ? "pw-req-met" : ""}`}>
            <span className="pw-req-icon">{met ? "✓" : "○"}</span> {label}
        </li>
    );

    return (
        <div className="auth-page">
            <div className="auth-card" style={{ maxWidth: 440 }}>
                <h1 className="app-title">Secure Locker</h1>
                <h2 className="auth-title">Change Password</h2>
                <p className="muted-text" style={{ marginBottom: 20, fontSize: 13 }}>
                    You must set a new password before continuing.
                </p>

                <form className="auth-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="currentPw">Current Password</label>
                        <input
                            id="currentPw"
                            type="password"
                            placeholder="Enter current password"
                            value={currentPw}
                            onChange={(e) => setCurrentPw(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="newPw">New Password</label>
                        <input
                            id="newPw"
                            type="password"
                            placeholder="Enter new password"
                            value={newPw}
                            onChange={(e) => setNewPw(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label htmlFor="confirmPw">Confirm New Password</label>
                        <input
                            id="confirmPw"
                            type="password"
                            placeholder="Re-enter new password"
                            value={confirmPw}
                            onChange={(e) => setConfirmPw(e.target.value)}
                        />
                    </div>

                    {/* Password requirements checklist */}
                    <ul className="pw-requirements">
                        <Req met={hasLength} label="At least 8 characters" />
                        <Req met={hasUpper} label="1 uppercase letter" />
                        <Req met={hasLower} label="1 lowercase letter" />
                        <Req met={hasDigit} label="1 digit" />
                        <Req met={hasSpecial} label="1 special character" />
                        <Req met={passwordsMatch} label="Passwords match" />
                    </ul>

                    {error && <div className="error-message">{error}</div>}

                    <button
                        type="submit"
                        className="primary-btn"
                        disabled={submitting || !allValid}
                    >
                        {submitting ? "Changing..." : "Change Password"}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ChangePassword;
