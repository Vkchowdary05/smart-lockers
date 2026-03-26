import React, { useEffect, useState } from "react";
import { fetchMembers, deleteMember, getOrgMode } from "../services/api";
import ConfirmModal from "./ConfirmModal";

const RemoveUser = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);
  const [message, setMessage] = useState("");

  // Confirm modal
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmAction, setConfirmAction] = useState(null);

  const mode = getOrgMode();
  const idLabel = mode ? "Employee ID" : "Member ID";

  const loadMembers = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchMembers();
      setMembers(Array.isArray(data) ? data : data.members || []);
    } catch (err) {
      setError(err.message || "Failed to load members.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMembers();
  }, []);

  const getPersonId = (m) => m.person_id || m.member_id || m.employee_id;

  const requestDelete = (member) => {
    const pid = getPersonId(member);
    setConfirmTitle("Delete Member");
    setConfirmMessage(
      `Are you sure you want to delete "${member.name || pid}"? This will mark the member for deletion and sync to the locker controller.`
    );
    setConfirmAction(() => () => performDelete(pid, member.name));
    setConfirmOpen(true);
  };

  const performDelete = async (personId, name) => {
    setConfirmOpen(false);
    setDeletingId(personId);
    setMessage("");
    setError("");
    try {
      await deleteMember(personId);
      setMembers((prev) => prev.filter((m) => getPersonId(m) !== personId));
      setMessage(`"${name}" has been marked for deletion.`);
    } catch (err) {
      setError(err.message || "Failed to delete member.");
    } finally {
      setDeletingId(null);
    }
  };

  // Sync status badge
  const getSyncBadge = (recentUpdate) => {
    if (!recentUpdate) return <span className="status-badge status-active">Synced</span>;
    const labels = { A: "Added", M: "Modified", D: "Deleted", I: "Images" };
    return <span className="status-badge status-inactive">{labels[recentUpdate] || recentUpdate}</span>;
  };

  return (
    <div className="card">
      <div className="card-header-row">
        <div>
          <h2 className="card-title">Remove Members</h2>
          <p className="card-description">
            Select a member to remove. Deletion is soft — the row is marked for deletion and synced to the locker controller.
          </p>
        </div>
        <button className="ghost-btn" onClick={loadMembers} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="success-message">{message}</div>}

      <div className="view-users-table-area" style={{ marginTop: 12 }}>
        {loading && !members.length ? (
          <p className="muted-text">Loading members...</p>
        ) : members.length === 0 ? (
          <p className="muted-text">No members found.</p>
        ) : (
          <div className="table-wrapper scrollable-list">
            <table className="user-table">
              <thead>
                <tr>
                  <th>{idLabel}</th>
                  <th>Name</th>
                  <th>Phone Number</th>
                  <th>Sync</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const pid = getPersonId(m);
                  return (
                    <tr key={pid}>
                      <td>{pid}</td>
                      <td><strong>{m.name}</strong></td>
                      <td>{m.phone_number}</td>
                      <td>{getSyncBadge(m.recent_update)}</td>
                      <td>
                        <button
                          className="danger-btn btn-sm"
                          onClick={() => requestDelete(m)}
                          disabled={deletingId === pid}
                        >
                          {deletingId === pid ? "Deleting..." : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        onConfirm={() => { if (confirmAction) confirmAction(); }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
};

export default RemoveUser;
