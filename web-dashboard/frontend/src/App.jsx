import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import DashboardPage from "./pages/DashboardPage";
import SuperAdminPage from "./pages/SuperAdminPage";
import ProtectedRoute from "./components/ProtectedRoute";
import ChangePassword from "./components/ChangePassword";
import { getUserRole, getMustChangePassword, isAuthenticated, clearAuthToken } from "./services/api";
import { useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/* ─── Idle Timer Constants ─── */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CHECK_INTERVAL_MS = 60 * 1000;     // check every minute

/**
 * RoleRedirect — renders at "/" and sends the user to the right place
 * based on their JWT role and password change status.
 * Unauthenticated users go to the landing page.
 */
const RoleRedirect = () => {
  if (!isAuthenticated()) return <Navigate to="/landing" replace />;

  if (getMustChangePassword()) return <Navigate to="/change-password" replace />;

  const role = getUserRole();
  if (role === "super_admin") return <Navigate to="/super-admin/dashboard" replace />;
  if (role === "org_admin") return <Navigate to="/dashboard" replace />;
  return <Navigate to="/landing" replace />;
};

/**
 * IdleWatcher — monitors user activity and logs out after 30 min idle.
 * Placed inside Router context so it can use useNavigate.
 */
const IdleWatcher = () => {
  const lastActivity = useRef(Date.now());
  const navigate = useNavigate();
  const location = useLocation();

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    // Track user activity
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));

    const interval = setInterval(() => {
      // Only check timeout for authenticated users
      if (!isAuthenticated()) return;

      // Don't timeout on public pages
      if (location.pathname === "/landing" || location.pathname === "/login") return;

      if (Date.now() - lastActivity.current > IDLE_TIMEOUT_MS) {
        clearAuthToken();
        navigate("/login", { replace: true });
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(interval);
    };
  }, [touch, navigate, location.pathname]);

  return null; // renders nothing
};

const App = () => {
  return (
    <>
      <IdleWatcher />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />

        <Route element={<ProtectedRoute />}>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/super-admin/dashboard" element={<SuperAdminPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
};

export default App;
