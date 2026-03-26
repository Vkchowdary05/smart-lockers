/**
 * adminService.js — Port of backend/models/admin_model.py
 *
 * Raw SQL operations on the admins table in locker_msl_auth.
 * Uses bcryptjs (replaces werkzeug.security PBKDF2).
 *
 * admins schema:
 *   id, org_id, organization_name, username, password_hash,
 *   role, name, email, phone, must_change_password,
 *   last_password_change, created_at, updated_at
 */

const bcrypt = require('bcryptjs');
const authPool = require('../db/authPool');

const SALT_ROUNDS = 10;

async function ensureAdminsTable() {
  await authPool.query(`
    CREATE TABLE IF NOT EXISTS admins (
      id                   SERIAL PRIMARY KEY,
      org_id               INTEGER,
      organization_name    VARCHAR(128) NOT NULL DEFAULT '',
      username             VARCHAR(64)  NOT NULL,
      password_hash        VARCHAR(255) NOT NULL,
      role                 VARCHAR(16)  NOT NULL DEFAULT 'org_admin',
      name                 VARCHAR(128),
      email                VARCHAR(128),
      phone                VARCHAR(20),
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      last_password_change TIMESTAMPTZ,
      created_at           TIMESTAMPTZ DEFAULT NOW(),
      updated_at           TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_admin_org_username UNIQUE (org_id, username)
    )
  `);

  await authPool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id          SERIAL PRIMARY KEY,
      admin_id    INTEGER,
      action      VARCHAR(64),
      target_type VARCHAR(64),
      target_id   VARCHAR(64),
      details     TEXT,
      timestamp   TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function adminToDict(row) {
  return {
    id:                   row.id,
    org_id:               row.org_id,
    organization_name:    row.organization_name,
    username:             row.username,
    role:                 row.role,
    name:                 row.name,
    email:                row.email,
    phone:                row.phone,
    must_change_password: row.must_change_password,
    last_password_change: row.last_password_change ? row.last_password_change.toISOString() : null,
    created_at:           row.created_at ? row.created_at.toISOString() : null,
    updated_at:           row.updated_at ? row.updated_at.toISOString() : null,
  };
}

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function checkPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}

async function findAdminByOrgAndUsername(orgName, username) {
  const { rows } = await authPool.query(
    `SELECT * FROM admins
     WHERE LOWER(organization_name) = LOWER($1) AND LOWER(username) = LOWER($2)`,
    [orgName, username]
  );
  return rows[0] || null;
}

async function findAdminById(id) {
  const { rows } = await authPool.query('SELECT * FROM admins WHERE id = $1', [id]);
  return rows[0] || null;
}

async function findAdminsByOrgId(orgId, role = null) {
  let query = 'SELECT * FROM admins WHERE org_id = $1';
  const params = [orgId];
  if (role) {
    query += ' AND role = $2';
    params.push(role);
  }
  const { rows } = await authPool.query(query, params);
  return rows;
}

async function createAdmin({ orgId, organizationName, username, passwordHash, role = 'org_admin',
                             name = null, email = null, phone = null, mustChangePassword = true }) {
  const { rows } = await authPool.query(
    `INSERT INTO admins
       (org_id, organization_name, username, password_hash, role, name, email, phone, must_change_password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [orgId, organizationName, username, passwordHash, role, name, email, phone, mustChangePassword]
  );
  return rows[0];
}

async function updateAdminPassword(adminId, newPasswordHash) {
  await authPool.query(
    `UPDATE admins SET password_hash = $1, must_change_password = FALSE, last_password_change = NOW(), updated_at = NOW()
     WHERE id = $2`,
    [newPasswordHash, adminId]
  );
}

async function setMustChangePassword(adminId, value = true) {
  await authPool.query(
    'UPDATE admins SET must_change_password = $1, updated_at = NOW() WHERE id = $2',
    [value, adminId]
  );
}

async function deleteAdminById(adminId) {
  const result = await authPool.query('DELETE FROM admins WHERE id = $1', [adminId]);
  return result.rowCount > 0;
}

async function deleteAdminsByOrgId(orgId, role = 'org_admin') {
  await authPool.query('DELETE FROM admins WHERE org_id = $1 AND role = $2', [orgId, role]);
}

async function findSuperAdmin(username) {
  const { rows } = await authPool.query(
    `SELECT * FROM admins WHERE username = $1 AND role = 'super_admin'`,
    [username]
  );
  return rows[0] || null;
}

async function logAction({ adminId = null, action, targetType, targetId, details }) {
  await authPool.query(
    `INSERT INTO audit_logs (admin_id, action, target_type, target_id, details, timestamp)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [adminId, action, targetType, targetId, details]
  );
}

async function getAuditLogs(page = 1, perPage = 50) {
  const offset = (page - 1) * perPage;
  const { rows } = await authPool.query(
    'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1 OFFSET $2',
    [perPage, offset]
  );
  const { rows: countRows } = await authPool.query('SELECT COUNT(*) AS total FROM audit_logs');
  const total = parseInt(countRows[0].total, 10);
  const pages = Math.ceil(total / perPage);
  return { logs: rows, total, page, per_page: perPage, pages };
}

module.exports = {
  ensureAdminsTable,
  adminToDict,
  hashPassword,
  checkPassword,
  findAdminByOrgAndUsername,
  findAdminById,
  findAdminsByOrgId,
  createAdmin,
  updateAdminPassword,
  setMustChangePassword,
  deleteAdminById,
  deleteAdminsByOrgId,
  findSuperAdmin,
  logAction,
  getAuditLogs,
};
