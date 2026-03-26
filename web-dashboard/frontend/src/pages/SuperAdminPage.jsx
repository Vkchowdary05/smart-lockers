import React from "react";
import Navbar from "../components/Navbar";
import SuperAdminDashboard from "../components/SuperAdminDashboard";

const SuperAdminPage = () => {
    return (
        <div>
            <Navbar />
            <div className="dashboard-container">
                <SuperAdminDashboard />
            </div>
        </div>
    );
};

export default SuperAdminPage;
