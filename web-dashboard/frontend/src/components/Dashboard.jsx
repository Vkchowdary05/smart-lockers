import React, { useState, useEffect } from "react";
import AddUser from "./AddUser";
import ViewUsers from "./ViewUsers";
import { fetchUsers } from "../services/api";

const Dashboard = () => {
  const [action, setAction] = useState("view"); // default = show ALL users
  const [addFocusToggle, setAddFocusToggle] = useState(false);

  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await fetchUsers();
      const list = Array.isArray(data) ? data : data.users || [];
      setUsers(list);
    } catch (e) {
      setUsers([]);
    }
  };

  const triggerRefresh = () => {
    loadUsers();
    setRefreshCounter((c) => c + 1);
  };

  const onClickAdd = () => {
    setAction("add");
    setAddFocusToggle((s) => !s);
  };

  // Clear selectedUser if the user list becomes empty or selected user is no longer in list
  useEffect(() => {
    if (users.length === 0) {
      setSelectedUser(null);
    } else if (selectedUser) {
      const exists = users.find((u) => u.user_id === selectedUser.user_id);
      if (!exists) {
        setSelectedUser(null);
      }
    }
  }, [users, selectedUser]);

  return (
    <div className="dashboard-grid">
      {/* LEFT COLUMN: User Table / Content */}
      <div className="dashboard-left">
        {action === "add" && (
          <AddUser
            onUserCreated={(u) => {
              triggerRefresh();
              setSelectedUser(u);
              setAction("view");
            }}
            focus={addFocusToggle}
          />
        )}

        {(action === "view" || action === "delete") && (
          <ViewUsers
            key={refreshCounter}
            selectionEnabled={action === "delete"}
            onSelect={(u) => setSelectedUser(u)}
            onDeleted={triggerRefresh}
          />
        )}
      </div>

      {/* RIGHT COLUMN: Actions & Stats */}
      <div className="dashboard-right">
        {/* TOTAL USERS BLOCK */}
        <div className="total-users-block">
          <div className="total-users-label">Total Users</div>
          <div className="total-users-count">{users.length}</div>
        </div>

        {/* ACTION BUTTONS CARD */}
        <div className="card action-buttons-card">
          <h3 className="card-title" style={{ fontSize: "16px", marginBottom: "12px" }}>Actions</h3>
          <div className="dashboard-action-stack">
            <button
              className={`ghost-btn action-stack-btn ${action === "add" ? "tab-btn-active" : ""}`}
              onClick={onClickAdd}
            >
              Add Users
            </button>
            <button
              className={`ghost-btn action-stack-btn ${action === "view" ? "tab-btn-active" : ""}`}
              onClick={() => setAction("view")}
            >
              View Users
            </button>
            <button
              className={`ghost-btn action-stack-btn ${action === "delete" ? "tab-btn-active" : ""}`}
              onClick={() => setAction("delete")}
            >
              Delete Users
            </button>
          </div>
        </div>

        {/* NOTE: Selected User details are now shown in the Left Accordion */}
      </div>
    </div>
  );
};

export default Dashboard;
