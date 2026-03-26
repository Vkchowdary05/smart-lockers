import React, { useState, useEffect, useCallback } from "react";
import { fetchLiveLockers } from "../services/api";

const STATUS_COLORS = {
  Available: "#15803D",
  "In Use": "#1976D2",
  Offline: "#B91C1C",
  Faulty: "#EA580C",
};

const STATUS_BG = {
  Available: "#F0FDF4",
  "In Use": "#E3F2FD",
  Offline: "#FEF2F2",
  Faulty: "#FFF7ED",
};

const LivePage = () => {
  const [stats, setStats] = useState({ total_lockers: 0, empty_lockers: 0, busy_lockers: 0 });
  const [lockers, setLockers] = useState([]);
  const [networkOnline, setNetworkOnline] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const liveData = await fetchLiveLockers();
      setStats({
        total_lockers: liveData.stats?.total_lockers || 0,
        empty_lockers: liveData.stats?.empty_lockers || 0,
        busy_lockers: liveData.stats?.used_lockers || 0,
      });
      setLockers(liveData.live || []);
      setNetworkOnline(true);
    } catch (err) {
      console.error("Failed to load locker data:", err);
      setNetworkOnline(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [loadData]);

  const formatDuration = (minutes) => {
    if (minutes == null) return "—";
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return "—";
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="sl-live-page">
      {/* Section 1: Network Status */}
      <div className={`sl-network-status ${networkOnline === false ? "sl-network-offline" : "sl-network-online"}`}>
        <span className="sl-network-dot">{networkOnline === false ? "🔴" : "🟢"}</span>
        <span>Locker Network Status: <strong>{networkOnline === false ? "OFFLINE" : "ONLINE"}</strong></span>
      </div>

      {/* Section 2: Stats Cards */}
      <div className="sl-stats-grid">
        <div className="sl-stat-card">
          <div className="sl-stat-label">Total Lockers</div>
          <div className="sl-stat-value">{stats.total_lockers}</div>
        </div>
        <div className="sl-stat-card">
          <div className="sl-stat-label">Empty Lockers</div>
          <div className="sl-stat-value sl-stat-empty">{stats.empty_lockers}</div>
        </div>
        <div className="sl-stat-card">
          <div className="sl-stat-label">Busy Lockers</div>
          <div className="sl-stat-value sl-stat-busy">{stats.busy_lockers}</div>
        </div>
      </div>

      {/* Section 3: Locker Usage Table */}
      <div className="sl-live-table-card">
        <h3 className="sl-live-table-title">Locker Usage</h3>
        {loading ? (
          <p className="muted-text">Loading locker data...</p>
        ) : lockers.length === 0 ? (
          <p className="muted-text">No locker activity found.</p>
        ) : (
          <div className="sl-live-table-wrapper">
            <table className="sl-live-table">
              <thead>
                <tr>
                  <th>Serial No</th>
                  <th>User Name</th>
                  <th>Member ID</th>
                  <th>Locker Number</th>
                  <th>Check-in Time</th>
                  <th>Duration</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lockers.map((locker, idx) => {
                  const displayStatus = locker.status === "active" ? "In Use" : "Available";
                  return (
                    <tr key={idx}>
                      <td>{locker.serial_no ?? idx + 1}</td>
                      <td><strong>{locker.user_name || "—"}</strong></td>
                      <td>{locker.member_id ?? "—"}</td>
                      <td>{locker.locker_number ?? "—"}</td>
                      <td>{formatTime(locker.check_in_time)}</td>
                      <td>{formatDuration(locker.duration)}</td>
                      <td>
                        <span
                          className="sl-status-badge"
                          style={{
                            color: STATUS_COLORS[displayStatus] || "#64748B",
                            background: STATUS_BG[displayStatus] || "#F8FAFC",
                          }}
                        >
                          {displayStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default LivePage;
