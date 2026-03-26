import React, { useState, useEffect, useCallback } from "react";
import {
    fetchOrganizations,
    createOrganization,
    deleteOrganization,
    resetAdminPassword,
} from "../services/api";
import ConfirmModal from "./ConfirmModal";

const SuperAdminDashboard = () => {
    /* ─── State ───────────────────────────────────────────── */
    const [orgs, setOrgs] = useState([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalOrgs, setTotalOrgs] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Create org form — now includes daemon fields
    const [showForm, setShowForm] = useState(false);
    const [form, setForm] = useState({
        orgName: "",
        orgId: "",       // numeric daemon org ID
        mac: "",         // controller MAC address
        mode: false,     // false=public (member_id), true=private (employee_id)
        vaultCount: 10,  // number of lockers
        adminName: "",
        adminPhone: "",
        adminEmail: "",
    });
    const [tempPassword, setTempPassword] = useState("");
    const [copied, setCopied] = useState(false);
    const [formError, setFormError] = useState("");
    const [formSuccess, setFormSuccess] = useState("");
    const [submitting, setSubmitting] = useState(false);

    // Accordion expansion
    const [expandedOrgId, setExpandedOrgId] = useState(null);

    // Confirm modal
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmTitle, setConfirmTitle] = useState("");
    const [confirmMessage, setConfirmMessage] = useState("");
    const [confirmAction, setConfirmAction] = useState(null);

    // Inline reset password
    const [resetPwMap, setResetPwMap] = useState({});

    /* ─── Form validity ───────────────────────────────────── */
    const macPattern = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
    const isFormValid =
        form.orgName.trim().length > 0 &&
        form.orgId && parseInt(form.orgId) > 0 &&
        macPattern.test(form.mac.trim()) &&
        form.vaultCount > 0 &&
        form.adminName.trim().length > 0 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail);

    /* ─── Load orgs ───────────────────────────────────────── */
    const loadOrgs = useCallback(async (p = page) => {
        setLoading(true);
        setError("");
        try {
            const data = await fetchOrganizations(p, 20);
            setOrgs(data.organizations || []);
            setPage(data.page || 1);
            setTotalPages(data.pages || 1);
            setTotalOrgs(data.total || 0);
        } catch (err) {
            setError(err.message || "Failed to load organizations");
        } finally {
            setLoading(false);
        }
    }, [page]);

    useEffect(() => {
        loadOrgs(1);
    }, []);

    /* ─── Phone input handler ─────────────────────────────── */
    const handlePhoneChange = (e) => {
        const raw = e.target.value.replace(/\D/g, "");
        setForm({ ...form, adminPhone: raw.slice(0, 10) });
    };

    /* ─── Create org ──────────────────────────────────────── */
    const handleCreate = async (e) => {
        e.preventDefault();
        setFormError("");
        setFormSuccess("");

        if (!isFormValid) {
            setFormError("Please fill all required fields correctly.");
            return;
        }

        setSubmitting(true);
        try {
            const data = await createOrganization({
                orgName: form.orgName,
                orgId: parseInt(form.orgId),
                mac: form.mac.trim().toLowerCase(),
                mode: form.mode,
                vaultCount: parseInt(form.vaultCount),
                adminName: form.adminName,
                adminPhone: form.adminPhone ? `+91${form.adminPhone}` : undefined,
                adminEmail: form.adminEmail,
            });
            setTempPassword(data.temp_password || "");
            setFormSuccess(`Organization "${form.orgName}" created! Copy the temporary admin password below.`);
            loadOrgs(1);
        } catch (err) {
            setFormError(err.message || "Failed to create organization.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopyPassword = () => {
        navigator.clipboard.writeText(tempPassword).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleCloseForm = () => {
        setShowForm(false);
        setForm({
            orgName: "", orgId: "", mac: "", mode: false,
            vaultCount: 10, adminName: "", adminPhone: "", adminEmail: "",
        });
        setTempPassword("");
        setFormError("");
        setFormSuccess("");
        setCopied(false);
    };

    /* ─── Delete org ──────────────────────────────────────── */
    const requestDelete = (org) => {
        setConfirmTitle("Delete Organization");
        setConfirmMessage(
            `Are you sure you want to permanently delete "${org.organization}" (ID: ${org.organization_id})? This will remove all members and logs.`
        );
        setConfirmAction(() => async () => {
            setConfirmOpen(false);
            try {
                await deleteOrganization(org.organization_id);
                loadOrgs(page);
            } catch (err) {
                alert(err.message || "Failed to delete");
            }
        });
        setConfirmOpen(true);
    };

    /* ─── Reset admin password ────────────────────────────── */
    const handleResetPassword = async (admin) => {
        try {
            const data = await resetAdminPassword(admin.id);
            setResetPwMap((prev) => ({
                ...prev,
                [admin.id]: { pw: data.temp_password || "", copied: false },
            }));
        } catch (err) {
            alert(err.message || "Failed to reset password");
        }
    };

    const handleCopyResetPw = (adminId) => {
        const entry = resetPwMap[adminId];
        if (!entry) return;
        navigator.clipboard.writeText(entry.pw).then(() => {
            setResetPwMap((prev) => ({
                ...prev,
                [adminId]: { ...prev[adminId], copied: true },
            }));
            setTimeout(() => {
                setResetPwMap((prev) => {
                    const next = { ...prev };
                    delete next[adminId];
                    return next;
                });
            }, 2000);
        });
    };

    /* ─── Toggle accordion ────────────────────────────────── */
    const toggleExpand = (orgId) => {
        if (expandedOrgId === orgId) {
            const org = orgs.find((o) => o.organization_id === orgId);
            if (org && org.admins) {
                setResetPwMap((prev) => {
                    const next = { ...prev };
                    org.admins.forEach((a) => delete next[a.id]);
                    return next;
                });
            }
            setExpandedOrgId(null);
        } else {
            setExpandedOrgId(orgId);
        }
    };

    /* ─── Render ──────────────────────────────────────────── */
    return (
        <div className="sa-dashboard">
            <div className="sa-header">
                <h1 className="sa-title">Super Admin Dashboard</h1>
                <p className="muted-text">MicroSysLogic — System Administration</p>
            </div>

            {/* ─── Actions row ─── */}
            <div className="sa-actions">
                <button
                    className={`ghost-btn ${showForm ? "tab-btn-active" : ""}`}
                    onClick={() => { showForm ? handleCloseForm() : setShowForm(true); }}
                >
                    {showForm ? "Close Form" : "+ Create Organization"}
                </button>
                <button className="ghost-btn" onClick={() => loadOrgs(page)} disabled={loading}>
                    {loading ? "Refreshing..." : "Refresh"}
                </button>
            </div>

            {/* ─── Create org form ─── */}
            {showForm && (
                <div className="card sa-create-card">
                    <h3 className="card-title">Create New Organization</h3>
                    <form onSubmit={handleCreate} className="sa-form">
                        <div className="form-row">
                            <div className="form-group">
                                <label>Organization Name</label>
                                <input
                                    type="text"
                                    placeholder="e.g. ReddyLabs"
                                    value={form.orgName}
                                    onChange={(e) => setForm({ ...form, orgName: e.target.value })}
                                />
                            </div>
                        </div>
                        {/* ─── Daemon fields ─── */}
                        <div className="form-row">
                            <div className="form-group">
                                <label>Daemon Org ID (numeric)</label>
                                <input
                                    type="number"
                                    placeholder="e.g. 101"
                                    min="1"
                                    value={form.orgId}
                                    onChange={(e) => setForm({ ...form, orgId: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Controller MAC Address</label>
                                <input
                                    type="text"
                                    placeholder="aa:bb:cc:dd:ee:ff"
                                    value={form.mac}
                                    onChange={(e) => setForm({ ...form, mac: e.target.value.toLowerCase() })}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Mode</label>
                                <select
                                    value={form.mode ? "private" : "public"}
                                    onChange={(e) => setForm({ ...form, mode: e.target.value === "private" })}
                                >
                                    <option value="public">Public (Member ID)</option>
                                    <option value="private">Private (Employee ID)</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Number of Lockers</label>
                                <input
                                    type="number"
                                    placeholder="e.g. 20"
                                    min="1"
                                    value={form.vaultCount}
                                    onChange={(e) => setForm({ ...form, vaultCount: parseInt(e.target.value) || 1 })}
                                />
                            </div>
                        </div>
                        {/* ─── Admin fields ─── */}
                        <div className="form-row">
                            <div className="form-group">
                                <label>Admin Name</label>
                                <input
                                    type="text"
                                    placeholder="Full name"
                                    value={form.adminName}
                                    onChange={(e) => setForm({ ...form, adminName: e.target.value })}
                                />
                            </div>
                            <div className="form-group">
                                <label>Admin Email</label>
                                <input
                                    type="email"
                                    placeholder="admin@org.com"
                                    value={form.adminEmail}
                                    onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Contact Number <span className="muted-text" style={{fontWeight:400}}>(optional)</span></label>
                                <div className="phone-input-wrapper">
                                    <span className="phone-prefix">+91</span>
                                    <input
                                        type="tel"
                                        className="phone-input-field"
                                        value={form.adminPhone}
                                        onChange={handlePhoneChange}
                                        placeholder="9876543210"
                                        maxLength={10}
                                    />
                                </div>
                                {form.adminPhone.length > 0 && form.adminPhone.length !== 10 && (
                                    <span className="field-hint field-hint-error">
                                        Contact Number must be 10 digits
                                    </span>
                                )}
                            </div>
                        </div>

                        {formError && <div className="error-message">{formError}</div>}
                        {formSuccess && (
                            <div className="success-message">
                                {formSuccess}
                                {tempPassword && (
                                    <div className="pw-field-row" style={{ marginTop: 8 }}>
                                        <input
                                            type="text"
                                            readOnly
                                            value={tempPassword}
                                            className="pw-readonly-field"
                                        />
                                        <button
                                            type="button"
                                            className="ghost-btn btn-sm"
                                            onClick={handleCopyPassword}
                                        >
                                            {copied ? "Copied!" : "Copy"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {!formSuccess ? (
                            <button
                                type="submit"
                                className="primary-btn"
                                disabled={submitting}
                            >
                                {submitting ? "Creating..." : "Create Organization"}
                            </button>
                        ) : (
                            <button type="button" className="ghost-btn" onClick={handleCloseForm}>
                                Done — Close Form
                            </button>
                        )}
                    </form>
                </div>
            )}

            {/* ─── Org list ─── */}
            {error && <div className="error-message">{error}</div>}

            <div className="card">
                <div className="card-header-row">
                    <h2 className="card-title">
                        Organizations
                        <span className="muted-text" style={{ marginLeft: 8, fontSize: 13, fontWeight: 400 }}>
                            ({totalOrgs} total)
                        </span>
                    </h2>
                </div>

                {loading && !orgs.length ? (
                    <p className="muted-text">Loading...</p>
                ) : orgs.length === 0 ? (
                    <p className="muted-text">No organizations found.</p>
                ) : (
                    <>
                        <div className="table-wrapper scrollable-list">
                            <table className="user-table sa-org-table">
                                <thead>
                                    <tr>
                                        <th></th>
                                        <th>Name</th>
                                        <th>ID</th>
                                        <th>Mode</th>
                                        <th>Status</th>
                                        <th>Daemon</th>
                                        <th>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orgs.map((org) => (
                                        <React.Fragment key={org.organization_id}>
                                            <tr
                                                className={`org-row ${expandedOrgId === org.organization_id ? "org-row-expanded" : ""}`}
                                                onClick={() => toggleExpand(org.organization_id)}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <td style={{ width: 28 }}>
                                                    <span className={`expand-icon ${expandedOrgId === org.organization_id ? "expand-icon-open" : ""}`}>
                                                        ▶
                                                    </span>
                                                </td>
                                                <td><strong>{org.organization}</strong></td>
                                                <td>
                                                    <code className="org-code-badge">{org.organization_id}</code>
                                                </td>
                                                <td>
                                                    <span className="status-badge status-active">
                                                        {org.mode ? "Private" : "Public"}
                                                    </span>
                                                </td>
                                                <td>
                                                    <span className="status-badge status-active">Active</span>
                                                </td>
                                                <td>
                                                    <span className="status-badge status-active">✓ Registered</span>
                                                </td>
                                                <td onClick={(e) => e.stopPropagation()}>
                                                    <button
                                                        className="danger-btn btn-sm"
                                                        onClick={() => requestDelete(org)}
                                                    >
                                                        Delete
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* ─── Expanded details ─── */}
                                            {expandedOrgId === org.organization_id && (
                                                <tr className="accordion-row">
                                                    <td colSpan={7}>
                                                        <div className="accordion-content">
                                                            {/* Daemon Info */}
                                                            <div style={{ marginBottom: 16 }}>
                                                                <h4 className="accordion-title">Daemon Info</h4>
                                                                <div className="admin-detail-grid">
                                                                    <div>
                                                                        <span className="detail-label">Org ID</span>
                                                                        <span className="detail-value">{org.organization_id}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="detail-label">MAC Address</span>
                                                                        <span className="detail-value"><code>{org.mac}</code></span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="detail-label">Mode</span>
                                                                        <span className="detail-value">{org.mode ? "Private (Employee ID)" : "Public (Member ID)"}</span>
                                                                    </div>
                                                                    <div>
                                                                        <span className="detail-label">Vault Count</span>
                                                                        <span className="detail-value">{org.vault_count}</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <h4 className="accordion-title">Admin Details</h4>
                                                            {org.admins && org.admins.length > 0 ? (
                                                                org.admins.map((admin) => (
                                                                    <div key={admin.id} className="admin-detail-card">
                                                                        <div className="admin-detail-grid">
                                                                            <div>
                                                                                <span className="detail-label">Name</span>
                                                                                <span className="detail-value">{admin.name || "—"}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="detail-label">Email</span>
                                                                                <span className="detail-value">{admin.email || admin.username || "—"}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="detail-label">Phone</span>
                                                                                <span className="detail-value">{admin.phone || "—"}</span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="detail-label">Created</span>
                                                                                <span className="detail-value">
                                                                                    {admin.created_at ? new Date(admin.created_at).toLocaleDateString() : "—"}
                                                                                </span>
                                                                            </div>
                                                                            <div>
                                                                                <span className="detail-label">Password Status</span>
                                                                                <span className="detail-value">
                                                                                    {admin.must_change_password ? (
                                                                                        <span className="status-badge status-inactive">Must Change</span>
                                                                                    ) : (
                                                                                        <span className="status-badge status-active">Set</span>
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                        <div className="admin-detail-actions">
                                                                            <button
                                                                                className="ghost-btn btn-sm"
                                                                                onClick={() => handleResetPassword(admin)}
                                                                                disabled={!!resetPwMap[admin.id]}
                                                                            >
                                                                                Reset Password
                                                                            </button>
                                                                            {resetPwMap[admin.id] && (
                                                                                <div className="inline-reset-pw">
                                                                                    <code className="inline-reset-pw-value">
                                                                                        {resetPwMap[admin.id].pw}
                                                                                    </code>
                                                                                    <button
                                                                                        className="ghost-btn btn-sm"
                                                                                        onClick={() => handleCopyResetPw(admin.id)}
                                                                                    >
                                                                                        {resetPwMap[admin.id].copied ? "Copied!" : "Copy"}
                                                                                    </button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            ) : (
                                                                <p className="muted-text">No admins found for this organization.</p>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="sa-pagination">
                                <button
                                    className="ghost-btn btn-sm"
                                    disabled={page <= 1}
                                    onClick={() => loadOrgs(page - 1)}
                                >
                                    ← Prev
                                </button>
                                <span className="muted-text">
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    className="ghost-btn btn-sm"
                                    disabled={page >= totalPages}
                                    onClick={() => loadOrgs(page + 1)}
                                >
                                    Next →
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* ─── Confirm Modal ─── */}
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

export default SuperAdminDashboard;
