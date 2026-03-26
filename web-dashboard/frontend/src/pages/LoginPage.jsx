import React from "react";
import Login from "../components/Login";
import { useNavigate } from "react-router-dom";
import { getUserRole, getMustChangePassword } from "../services/api";

const LoginPage = () => {
  const navigate = useNavigate();

  const handleLoginSuccess = () => {
    // Check if password change is required first
    if (getMustChangePassword()) {
      navigate("/change-password", { replace: true });
      return;
    }

    const role = getUserRole();
    if (role === "super_admin") {
      navigate("/super-admin/dashboard", { replace: true });
    } else {
      navigate("/dashboard", { replace: true });
    }
  };

  return (
    <div className="page-wrapper">
      <Login onLoginSuccess={handleLoginSuccess} />
    </div>
  );
};

export default LoginPage;
