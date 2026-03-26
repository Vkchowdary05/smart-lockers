import React, { useEffect, useState } from "react";
import { fetchMembers, deleteMember, fetchMemberImages, getAuthToken, getOrgMode, getMemberImageUrl } from "../services/api";
import ConfirmModal from "./ConfirmModal";

const ViewUsers = ({ selectionEnabled = false, onSelect, onDeleted }) => {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // Accordion Logic
  const [expandedId, setExpandedId] = useState(null);
  const [expandedImages, setExpandedImages] = useState([]);
  const [expandedMetrics, setExpandedMetrics] = useState(null);
  const [imageEnlarged, setImageEnlarged] = useState(null);

  // Confirm modal state
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

  const getPersonId = (member) => {
    return member.person_id || member.member_id || member.employee_id;
  };

  // Toggle Accordion
  const toggleRow = async (member) => {
    if (onSelect) onSelect(member);
    const pid = getPersonId(member);

    if (expandedId === pid) {
      setExpandedId(null);
      setExpandedImages([]);
      setExpandedMetrics(null);
      setImageEnlarged(null);
      return;
    }

    setExpandedId(pid);
    setImageEnlarged(null);
    setExpandedImages([]);
    setExpandedMetrics(null);

    try {
      const data = await fetchMemberImages(pid);
      const filenames = data.images || [];
      const urls = filenames.map(f => getMemberImageUrl(pid, f));
      setExpandedImages(urls);
      if (data.face_metrics) {
        setExpandedMetrics(data.face_metrics);
      }
    } catch (err) {
      console.error("Failed to load images", err);
    }
  };

  // Single delete (with confirmation)
  const requestDeleteSingle = (member) => {
    const pid = getPersonId(member);
    setConfirmTitle("Delete Member");
    setConfirmMessage(
      `Are you sure you want to delete "${member.name || pid}"? This will mark the member for deletion and sync to the locker controller.`
    );
    setConfirmAction(() => () => performDeleteSingle(pid));
    setConfirmOpen(true);
  };

  const performDeleteSingle = async (personId) => {
    setConfirmOpen(false);
    setDeletingId(personId);
    try {
      await deleteMember(personId);
      setMembers((prev) => prev.filter((m) => getPersonId(m) !== personId));
      if (expandedId === personId) {
        setExpandedId(null);
        setExpandedImages([]);
        setExpandedMetrics(null);
      }
      if (onDeleted) onDeleted();
    } catch (err) {
      alert(err.message || "Failed to delete member.");
    } finally {
      setDeletingId(null);
    }
  };

  // Multi-delete
  const toggleSelect = (personId) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (copy.has(personId)) copy.delete(personId);
      else copy.add(personId);
      return copy;
    });
  };

  const requestDeleteSelected = () => {
    if (selected.size === 0) return;
    setConfirmTitle("Delete Selected Members");
    setConfirmMessage(
      `Are you sure you want to delete ${selected.size} selected member(s)? They will be marked for deletion.`
    );
    setConfirmAction(() => () => performDeleteSelected());
    setConfirmOpen(true);
  };

  const performDeleteSelected = async () => {
    setConfirmOpen(false);
    try {
      for (const pid of Array.from(selected)) {
        await deleteMember(pid);
      }
      setMembers((prev) => prev.filter((m) => !selected.has(getPersonId(m))));

      if (expandedId && selected.has(expandedId)) {
        setExpandedId(null);
        setExpandedImages([]);
        setExpandedMetrics(null);
      }

      setSelected(new Set());
      if (onDeleted) onDeleted();
    } catch (err) {
      alert(err.message || "Failed to delete selected members");
    }
  };

  // Sync status badge
  const getSyncBadge = (recentUpdate) => {
    if (!recentUpdate) return <span className="status-badge status-active">Synced</span>;
    const labels = { A: "Added", M: "Modified", D: "Deleted", I: "Images" };
    return <span className="status-badge status-inactive">{labels[recentUpdate] || recentUpdate}</span>;
  };

  return (
    <div className="card view-users-card">
      <div className="card-header-row">
        <div>
          <h2 className="card-title">Members</h2>
          <p className="user-count-badge">
            Total Members: <strong>{members.length}</strong>
          </p>
        </div>
        <button className="ghost-btn" onClick={loadMembers} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {error && <div className="error-message">{error}</div>}

      <div className="view-users-table-area">
        {loading && !members.length ? (
          <p className="muted-text">Loading members...</p>
        ) : members.length === 0 ? (
          <p className="muted-text">No members found.</p>
        ) : (
          <div className="table-wrapper scrollable-list">
            <table className="user-table">
              <thead>
                <tr>
                  {selectionEnabled && <th></th>}
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
                    <React.Fragment key={pid}>
                      <tr
                        onClick={() => toggleRow(m)}
                        className={`accordion-row ${expandedId === pid ? "accordion-row-expanded" : ""}`}
                      >
                        {selectionEnabled && (
                          <td>
                            <input
                              type="checkbox"
                              checked={selected.has(pid)}
                              onChange={(e) => {
                                e.stopPropagation();
                                toggleSelect(pid);
                              }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                        )}
                        <td>{pid}</td>
                        <td><strong>{m.name}</strong></td>
                        <td>{m.phone_number}</td>
                        <td>{getSyncBadge(m.recent_update)}</td>
                        <td>
                          <button
                            className="danger-btn btn-sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              requestDeleteSingle(m);
                            }}
                            disabled={deletingId === pid}
                          >
                            {deletingId === pid ? "Deleting..." : "Delete"}
                          </button>
                        </td>
                      </tr>

                      {expandedId === pid && (
                        <tr className="accordion-content-row">
                          <td colSpan={selectionEnabled ? 7 : 6}>
                            <div className="accordion-body">
                              <div className="accordion-grid">
                                <div className="accordion-details">
                                  <span className="accordion-label">{idLabel}</span>
                                  <span className="accordion-value">{pid}</span>

                                  <span className="accordion-label">Phone</span>
                                  <span className="accordion-value">{m.phone_number}</span>

                                  <span className="accordion-label">Vault</span>
                                  <span className="accordion-value">{m.vault_number || "—"}</span>

                                  <span className="accordion-label">Sync Status</span>
                                  <span className="accordion-value">
                                    {getSyncBadge(m.recent_update)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
            {selectionEnabled && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="danger-btn"
                  onClick={requestDeleteSelected}
                  disabled={selected.size === 0}
                >
                  Delete Selected ({selected.size})
                </button>
              </div>
            )}
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

export default ViewUsers;

