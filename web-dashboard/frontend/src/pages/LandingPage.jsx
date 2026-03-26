import React from "react";
import { Link } from "react-router-dom";

const LandingPage = () => {
    return (
        <div className="landing-page">
            <div className="landing-hero">
                {/* Decorative background elements */}
                <div className="landing-bg-glow landing-glow-1" />
                <div className="landing-bg-glow landing-glow-2" />

                <div className="landing-content">
                    <img src="/images/MSL Logo.jpeg" alt="Secure Locker Logo" className="landing-logo" />
                    <h1 className="landing-title">Secure Locker</h1>
                    <p className="landing-subtitle">Your Security Matters.</p>
                    <Link to="/login" className="primary-btn landing-login-btn">
                        Login
                    </Link>
                </div>

                <footer className="landing-footer">
                    <p>© {new Date().getFullYear()} MicroSysLogic · All rights reserved</p>
                </footer>
            </div>
        </div>
    );
};

export default LandingPage;
