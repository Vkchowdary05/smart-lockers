import React from "react";
import { useNavigate } from "react-router-dom";
import { clearAuthToken, getAuthPayload } from "../services/api";

const Navbar = () => {
  const navigate = useNavigate();
  const payload = getAuthPayload();

  const isOrgAdmin = payload?.role === "org_admin";
  const orgName = payload?.organization_name || "";
  const adminName = payload?.admin_name || payload?.username || "";

  const handleLogout = () => {
    clearAuthToken();
    navigate("/login");
  };

  return (
    <nav className="sl-header">
      <div className="sl-header-left">
        <img src="/images/MSL Logo.png" alt="Secure Locker Logo" className="sl-header-logo" />
        <span className="sl-header-org">
          {isOrgAdmin ? orgName : "Secure Locker"}
        </span>
      </div>
      <div className="sl-header-right">
        <span className="sl-header-admin">{adminName}</span>
        <button className="sl-header-logout" onClick={handleLogout}>
          Logout
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
