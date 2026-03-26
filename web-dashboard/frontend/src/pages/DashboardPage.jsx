import React, { useState } from "react";
import Navbar from "../components/Navbar";
import NavigationBar from "../components/NavigationBar";
import LivePage from "../components/LivePage";
import AddUser from "../components/AddUser";
import ModifyUser from "../components/ModifyUser";
import RemoveUser from "../components/RemoveUser";
import AnalysisPage from "../components/AnalysisPage";

const DashboardPage = () => {
  const [activeTab, setActiveTab] = useState("live");
  const [memberAction, setMemberAction] = useState(null);

  const handleTabChange = (tab, action) => {
    setActiveTab(tab);
    setMemberAction(action);
  };

  const renderContent = () => {
    switch (activeTab) {
      case "live":
        return <LivePage />;
      case "members":
        switch (memberAction) {
          case "add":
            return <AddUser onUserCreated={() => {}} />;
          case "modify":
            return <ModifyUser />;
          case "remove":
            return <RemoveUser />;
          default:
            return <LivePage />;
        }
      case "analysis":
        return <AnalysisPage />;
      default:
        return <LivePage />;
    }
  };

  return (
    <div className="sl-page-root">
      <Navbar />
      <NavigationBar activeTab={activeTab} onTabChange={handleTabChange} />
      <main className="sl-page-main">
        {renderContent()}
      </main>
    </div>
  );
};

export default DashboardPage;
