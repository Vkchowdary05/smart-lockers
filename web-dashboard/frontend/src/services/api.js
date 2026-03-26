const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

const TOKEN_KEY = "secureLockerToken";
const MUST_CHANGE_PW_KEY = "secureLockerMustChangePw";

export function setAuthToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(MUST_CHANGE_PW_KEY);
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY);
}

// Decode JWT payload (naive base64 decode) to access admin identity fields
export function getAuthPayload() {
  const token = getAuthToken();
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch (e) {
    return null;
  }
}

export function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Get the current user's role from the JWT.
 * @returns {"super_admin" | "org_admin" | null}
 */
export function getUserRole() {
  const payload = getAuthPayload();
  return payload?.role || null;
}

/**
 * Get the org mode from the JWT.
 * @returns {boolean} true = private (employee_id), false = public (member_id)
 */
export function getOrgMode() {
  const payload = getAuthPayload();
  return payload?.mode || false;
}

/**
 * Check if user must change their password before accessing dashboard.
 */
export function getMustChangePassword() {
  return localStorage.getItem(MUST_CHANGE_PW_KEY) === "true";
}

export function setMustChangePassword(val) {
  localStorage.setItem(MUST_CHANGE_PW_KEY, val ? "true" : "false");
}

// ─── HTTP Helper ───────────────────────────────────────────────

async function request(path, options = {}) {
  const token = getAuthToken();

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  let text = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { data = await res.json(); } catch (e) { data = null; }
  } else {
    try { text = await res.text(); } catch (e) { text = null; }
  }

  if (res.status === 401) {
    clearAuthToken();
    const message = data?.message || data?.msg || text || `Authentication error (${res.status})`;
    throw new Error(message);
  }

  if (!res.ok) {
    const message = data?.message || data?.msg || text || "Request failed";
    throw new Error(message);
  }

  return data;
}

// ─── AUTH ───────────────────────────────────────────────────────

export async function loginAdmin({ organization, username, password }) {
  // Clear any stale token BEFORE login — prevents sending an expired
  // Bearer header that Flask-JWT-Extended may reject.
  clearAuthToken();

  const res = await fetch(`${API_BASE_URL}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organization, username, password }),
  });

  let data = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try { data = await res.json(); } catch (e) { data = null; }
  }

  if (!res.ok) {
    const message = data?.message || data?.msg || `Login failed (${res.status})`;
    throw new Error(message);
  }

  const token = data?.token || data?.access_token || data?.accessToken;
  if (token) setAuthToken(token);

  // Store must_change_password flag
  if (data?.must_change_password !== undefined) {
    setMustChangePassword(data.must_change_password);
  }

  return data;
}

// ─── PASSWORD ──────────────────────────────────────────────────

export async function changePassword({ currentPassword, newPassword, confirmPassword }) {
  const data = await request("/admin/change-password", {
    method: "POST",
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    }),
  });
  setMustChangePassword(false);
  return data;
}

// ─── MEMBERS (daemon-compatible) ───────────────────────────────

export async function fetchMembers() {
  return request("/members", { method: "GET" });
}

// Backward compat alias
export const fetchUsers = fetchMembers;

export async function fetchNextMemberId() {
  return request("/members/next-id", { method: "GET" });
}

// Backward compat alias
export const fetchNextUserId = fetchNextMemberId;

export async function createMember({ name, phoneNumber, personId }) {
  return request("/members", {
    method: "POST",
    body: JSON.stringify({
      name,
      phone_number: phoneNumber,
      ...(personId !== undefined && personId !== "" ? { person_id: personId } : {}),
    }),
  });
}

// Backward compat alias
export const createUser = createMember;

export async function updateMember(personId, { name, phoneNumber }) {
  return request(`/members/${personId}`, {
    method: "PUT",
    body: JSON.stringify({ name, phone_number: phoneNumber }),
  });
}

export async function deleteMember(personId) {
  return request(`/members/${personId}`, { method: "DELETE" });
}

// Backward compat alias
export const deleteUser = deleteMember;

export async function uploadMemberImages(personId, imagesArray, mode = "camera") {
  return request(`/members/${personId}/images`, {
    method: "POST",
    body: JSON.stringify({ mode, images: imagesArray }),
  });
}

export async function validateFrame(personId, imageBase64, step, prevCx = null) {
  return request(`/members/${personId}/validate-frame`, {
    method: "POST",
    body: JSON.stringify({ image: imageBase64, step, prev_cx: prevCx }),
  });
}

// Backward compat alias
export const captureUserFace = uploadMemberImages;

export async function fetchMemberImages(personId) {
  return request(`/members/${personId}/images`);
}

// Backward compat alias
export const fetchUserImages = fetchMemberImages;

export function getMemberImageUrl(personId, filename) {
  const token = getAuthToken();
  return `${API_BASE_URL}/members/${personId}/images/${encodeURIComponent(filename)}?jwt=${token}`;
}

// Backward compat alias
export const getUserImageUrl = getMemberImageUrl;

export async function fetchMemberLogs(page = 1, perPage = 50) {
  return request(`/members/logs?page=${page}&per_page=${perPage}`);
}

export async function fetchPendingSync() {
  return request("/members/pending-sync");
}

// ─── LOCKERS ───────────────────────────────────────────────────

export async function fetchLockerStats() {
  return request("/lockers/stats", { method: "GET" });
}

export async function fetchLockerLive() {
  return request("/lockers/live", { method: "GET" });
}

export async function fetchLiveLockers() {
  return request("/live-lockers", { method: "GET" });
}

export async function checkIn({ userName, memberId, lockerNumber }) {
  return request("/check-in", {
    method: "POST",
    body: JSON.stringify({ user_name: userName, member_id: memberId, locker_number: lockerNumber }),
  });
}

export async function checkOut({ id }) {
  return request("/check-out", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
}

// ─── SUPER ADMIN: ORGANIZATIONS ────────────────────────────────

export async function fetchOrganizations(page = 1, perPage = 20) {
  return request(`/super-admin/organizations?page=${page}&per_page=${perPage}`);
}

export async function createOrganization({ orgName, orgCode, orgId, mac, mode, vaultCount, adminName, adminPhone, adminEmail }) {
  return request("/super-admin/organizations", {
    method: "POST",
    body: JSON.stringify({
      org_name: orgName,
      org_code: orgCode,
      org_id: orgId,
      mac: mac,
      mode: mode,
      vault_count: vaultCount,
      admin_name: adminName,
      admin_phone: adminPhone,
      admin_email: adminEmail,
    }),
  });
}

export async function deleteOrganization(orgId) {
  return request(`/super-admin/organizations/${orgId}`, {
    method: "DELETE",
  });
}

export async function resetAdminPassword(adminId) {
  return request(`/super-admin/admins/${adminId}/reset-password`, {
    method: "POST",
  });
}
