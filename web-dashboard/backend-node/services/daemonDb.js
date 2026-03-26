/**
 * daemonDb.js — Port of backend/database/daemon_db.py
 *
 * Raw-SQL helpers for the locker_msl (daemon) database.
 * Handles all dynamic per-org table operations.
 *
 * Table naming:
 *   Members : {orgNameClean}_{orgId}
 *   Logs    : {orgNameClean}_{orgId}_logs
 *   Live    : {orgNameClean}_{orgId}_live
 *
 * Schema rules (matching Locker_schema_26.sql):
 *   - Active table has BOTH member_id and employee_id columns always.
 *     For mode=false (public): member_id is set, employee_id is NULL.
 *     For mode=true (private): employee_id is set, member_id is NULL.
 *   - row_checksum, image_checksum, total_checksum are trigger-maintained — NEVER write them.
 *   - recent_update: 'A'=Added, 'M'=Modified, 'D'=Deleted(soft), 'I'=Images updated, NULL=synced
 *   - imagepath format: OrgName/OrgId/PersonId
 *   - Logs table primary key is log_id (BIGSERIAL), contains both member_id and employee_id.
 *   - organisation_info has mqtt_username column.
 */

const pool = require('../db/daemonPool');
const {
  getMemberTableName,
  getLogsTableName,
  getIdColumn,
} = require('../utils/tableNames');

// ─── Organisation Info ───────────────────────────────────────────

async function ensureOrganisationInfoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organisation_info (
      organization_id BIGINT PRIMARY KEY,
      organization    VARCHAR(150) NOT NULL,
      mac             VARCHAR(17)  NOT NULL UNIQUE,
      mode            BOOLEAN      NOT NULL DEFAULT false,
      vault_count     INTEGER      NOT NULL DEFAULT 10,
      fault_vault     TEXT         DEFAULT '{}',
      total_checksum  VARCHAR(64),
      api_token       VARCHAR(64)  UNIQUE,
      mqtt_username   VARCHAR(50)  UNIQUE
    )
  `);
}

async function getOrgInfo(orgId) {
  const { rows } = await pool.query(
    'SELECT * FROM organisation_info WHERE organization_id = $1',
    [orgId]
  );
  return rows[0] || null;
}

async function getOrgInfoByName(orgName) {
  const { rows } = await pool.query(
    'SELECT * FROM organisation_info WHERE organization = $1',
    [orgName]
  );
  return rows[0] || null;
}

async function listAllOrgs() {
  const { rows } = await pool.query(
    'SELECT * FROM organisation_info ORDER BY organization_id'
  );
  return rows;
}

// ─── Member CRUD ─────────────────────────────────────────────────

async function getNextId(orgName, orgId, mode) {
  const table  = getMemberTableName(orgName, orgId);
  const idCol  = getIdColumn(mode);
  const { rows } = await pool.query(
    `SELECT COALESCE(MAX("${idCol}"), 0) + 1 AS next_id FROM "${table}"`
  );
  return parseInt(rows[0].next_id, 10) || 1;
}

async function listMembers(orgName, orgId, includeDeleted = false, mode = false) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  let query = `SELECT * FROM "${table}"`;
  if (!includeDeleted) {
    query += ` WHERE recent_update IS DISTINCT FROM 'D'`;
  }
  query += ` ORDER BY "${idCol}" NULLS LAST`;
  const { rows } = await pool.query(query);
  return rows;
}

async function getMember(orgName, orgId, mode, personId) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  const { rows } = await pool.query(
    `SELECT * FROM "${table}" WHERE "${idCol}" = $1`,
    [personId]
  );
  return rows[0] || null;
}

async function addMember(orgName, orgId, mode, personId, name, phoneNumber = null, imagepath = null) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  // Insert with only the relevant id column set; the other stays NULL.
  // Both member_id and employee_id columns exist; only one is populated per mode.
  await pool.query(
    `INSERT INTO "${table}" ("${idCol}", name, phone_number, imagepath, recent_update)
     VALUES ($1, $2, $3, $4, 'A')`,
    [personId, name, phoneNumber, imagepath]
  );
  return getMember(orgName, orgId, mode, personId);
}

async function updateMember(orgName, orgId, mode, personId, { name, phoneNumber, imagepath } = {}) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);

  const setParts = [
    `recent_update = CASE WHEN recent_update = 'A' THEN 'A' ELSE 'M' END`
  ];
  const params   = [personId];
  let paramIdx   = 2;

  if (name !== undefined && name !== null) {
    setParts.push(`name = $${paramIdx++}`);
    params.push(name);
  }
  if (phoneNumber !== undefined && phoneNumber !== null) {
    setParts.push(`phone_number = $${paramIdx++}`);
    params.push(phoneNumber);
  }
  if (imagepath !== undefined && imagepath !== null) {
    setParts.push(`imagepath = $${paramIdx++}`);
    params.push(imagepath);
  }

  const setClause = setParts.join(', ');
  const result = await pool.query(
    `UPDATE "${table}" SET ${setClause} WHERE "${idCol}" = $1`,
    params
  );

  if (result.rowCount === 0) return null;
  return getMember(orgName, orgId, mode, personId);
}

async function deleteMember(orgName, orgId, mode, personId) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  const result = await pool.query(
    `UPDATE "${table}" SET recent_update = 'D' WHERE "${idCol}" = $1`,
    [personId]
  );
  return result.rowCount > 0;
}

async function markImagesUpdated(orgName, orgId, mode, personId) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  const result = await pool.query(
    `UPDATE "${table}" SET recent_update = CASE WHEN recent_update = 'A' THEN 'A' ELSE 'I' END WHERE "${idCol}" = $1`,
    [personId]
  );
  return result.rowCount > 0;
}

async function getPendingSync(orgName, orgId, mode = false) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  const { rows } = await pool.query(
    `SELECT * FROM "${table}" WHERE recent_update IS NOT NULL ORDER BY "${idCol}" NULLS LAST`
  );
  return rows;
}

// ─── Logs (Read-Only) ────────────────────────────────────────────

async function fetchLogs(orgName, orgId, limit = 100, offset = 0) {
  const table = getLogsTableName(orgName, orgId);
  const { rows } = await pool.query(
    `SELECT * FROM "${table}" ORDER BY checkin_timestamp DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

// ─── Organisation Management ─────────────────────────────────────

async function createOrganisation({ orgId, orgName, mac, mode, vaultCount, faultVault = '{}' }) {
  // Insert into organisation_info — api_token generated server-side using md5 of random values
  // We use a simple token generation here; in production the SQL trigger/seed does this.
  const crypto = require('crypto');
  const apiToken = crypto.randomBytes(32).toString('hex');

  await pool.query(
    `INSERT INTO organisation_info
       (organization_id, organization, mac, mode, vault_count, fault_vault, total_checksum, api_token)
     VALUES
       ($1, $2, $3, $4, $5, $6, NULL, $7)
     ON CONFLICT (organization_id) DO NOTHING`,
    [orgId, orgName, mac, mode, vaultCount, faultVault, apiToken]
  );

  // Create the member and logs tables matching the target schema
  await ensureMemberTable(orgName, orgId);
  await ensureLogsTable(orgName, orgId);

  return getOrgInfo(orgId);
}

async function deleteOrganisation(orgId) {
  const org = await getOrgInfo(orgId);
  if (!org) return;

  const memberTable  = `${orgNameClean}_${orgId}`;
  const logsTable    = `${orgNameClean}_${orgId}_logs`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS "${memberTable}" CASCADE`);
    await client.query(`DROP TABLE IF EXISTS "${logsTable}" CASCADE`);
    await client.query('DELETE FROM organisation_info WHERE organization_id = $1', [orgId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Dynamic Table Initialization ────────────────────────────────
// These match the target schema from Locker_schema_26.sql exactly.

async function ensureMemberTable(orgName, orgId) {
  const table = getMemberTableName(orgName, orgId);
  const orgNameClean = orgName.replace(/ /g, '').toLowerCase();
  // Both member_id and employee_id are always present.
  // The CHECK constraint ensures at least one is non-null.
  // row_checksum and image_checksum are trigger-maintained — never written by Node.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      row_id              BIGSERIAL PRIMARY KEY,
      member_id           BIGINT UNIQUE,
      employee_id         BIGINT UNIQUE,
      name                VARCHAR(150) NOT NULL,
      phone_number        VARCHAR(15),
      imagepath           TEXT,
      recent_update       CHAR(1),
      vault_number        INTEGER,
      checkin_timestamp   TIMESTAMP,
      checkout_timestamp  TIMESTAMP,
      duration_min        INTEGER,
      row_checksum        VARCHAR(64),
      image_checksum      VARCHAR(64),
      CONSTRAINT "chk_${orgNameClean}_${orgId}_atleast_one_id"
        CHECK (member_id IS NOT NULL OR employee_id IS NOT NULL),
      CONSTRAINT "chk_${orgNameClean}_${orgId}_recent_update"
        CHECK (recent_update IS NULL OR recent_update IN ('A','M','D','I'))
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_member_id"
    ON "${table}" (member_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_employee_id"
    ON "${table}" (employee_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_vault_number"
    ON "${table}" (vault_number)`);
}

async function ensureLogsTable(orgName, orgId) {
  const table = getLogsTableName(orgName, orgId);
  const orgNameClean = orgName.replace(/ /g, '').toLowerCase();
  // Logs table matches schema: log_id primary key, both member_id and employee_id,
  // plus name, phone_number, imagepath, duration_min columns.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      log_id              BIGSERIAL PRIMARY KEY,
      vault_number        INTEGER   NOT NULL,
      member_id           BIGINT,
      employee_id         BIGINT,
      name                VARCHAR(150),
      phone_number        VARCHAR(15),
      imagepath           TEXT,
      checkin_timestamp   TIMESTAMP NOT NULL,
      checkout_timestamp  TIMESTAMP,
      duration_min        INTEGER,
      CONSTRAINT "chk_${orgNameClean}_${orgId}_logs_atleast_one_id"
        CHECK (member_id IS NOT NULL OR employee_id IS NOT NULL)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_logs_vault_number"
    ON "${table}" (vault_number)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_logs_member_id"
    ON "${table}" (member_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_logs_employee_id"
    ON "${table}" (employee_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS "idx_${orgNameClean}_${orgId}_logs_checkin"
    ON "${table}" (checkin_timestamp)`);
}

// (Live tables are maintained separately via external triggers/daemon)

module.exports = {
  getOrgInfo,
  getOrgInfoByName,
  listAllOrgs,
  getNextId,
  listMembers,
  getMember,
  addMember,
  updateMember,
  deleteMember,
  markImagesUpdated,
  getPendingSync,
  fetchLogs,
  createOrganisation,
  deleteOrganisation,
  ensureOrganisationInfoTable,
  ensureMemberTable,
  ensureLogsTable,
};
