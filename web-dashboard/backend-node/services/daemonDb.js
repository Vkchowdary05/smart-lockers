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
 * recent_update rules (daemon sync protocol):
 *   'A' = Added, 'M' = Modified, 'D' = Deleted (soft), 'I' = Images updated
 *   NEVER write to row_checksum, total_checksum, image_checksum
 */

const pool = require('../db/daemonPool');
const {
  getMemberTableName,
  getLogsTableName,
  getLiveTableName,
  getIdColumn,
} = require('../utils/tableNames');

// ─── Organisation Info ───────────────────────────────────────────

async function ensureOrganisationInfoTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organisation_info (
      organization_id SERIAL PRIMARY KEY,
      organization    TEXT NOT NULL,
      mac             TEXT NOT NULL UNIQUE,
      mode            BOOLEAN NOT NULL DEFAULT false,
      vault_count     INTEGER NOT NULL DEFAULT 10,
      fault_vault     TEXT DEFAULT '{}',
      total_checksum  TEXT,
      api_token       TEXT
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
  return rows[0].next_id || 1;
}

async function listMembers(orgName, orgId, includeDeleted = false, mode = false) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  let query = `SELECT * FROM "${table}"`;
  if (!includeDeleted) {
    query += ` WHERE recent_update IS NULL OR recent_update != 'D'`;
  }
  query += ` ORDER BY "${idCol}"`;
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
    `SELECT * FROM "${table}" WHERE recent_update IS NOT NULL ORDER BY "${idCol}"`
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
  await pool.query(
    `INSERT INTO organisation_info
       (organization_id, organization, mac, mode, vault_count, fault_vault, total_checksum, api_token)
     VALUES
       ($1, $2, $3, $4, $5, $6, NULL,
        md5(random()::text || clock_timestamp()::text) || md5(clock_timestamp()::text || random()::text))`,
    [orgId, orgName, mac, mode, vaultCount, faultVault]
  );
  
  await ensureMemberTable(orgName, orgId, mode);
  await ensureLogsTable(orgName, orgId, mode);
  
  return getOrgInfo(orgId);
}

async function deleteOrganisation(orgId) {
  const org = await getOrgInfo(orgId);
  if (!org) return;

  const orgNameClean = org.organization.replace(/ /g, '').toLowerCase();
  const memberTable  = `${orgNameClean}_${orgId}`;
  const logsTable    = `${orgNameClean}_${orgId}_logs`;
  const liveTable    = `${orgNameClean}_${orgId}_live`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DROP TABLE IF EXISTS "${memberTable}" CASCADE`);
    await client.query(`DROP TABLE IF EXISTS "${logsTable}" CASCADE`);
    await client.query(`DROP TABLE IF EXISTS "${liveTable}" CASCADE`);
    await client.query('DELETE FROM organisation_info WHERE organization_id = $1', [orgId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Dynamic Table Initialization (Trigger Replacement) ────────────

async function ensureMemberTable(orgName, orgId, mode) {
  const table = getMemberTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      "${idCol}" INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      phone_number TEXT,
      imagepath TEXT,
      vault_number INTEGER,
      checkin_timestamp TIMESTAMPTZ,
      checkout_timestamp TIMESTAMPTZ,
      recent_update VARCHAR(1),
      row_checksum TEXT,
      image_checksum TEXT
    )
  `);
}

async function ensureLogsTable(orgName, orgId, mode) {
  const table = getLogsTableName(orgName, orgId);
  const idCol = getIdColumn(mode);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      id SERIAL PRIMARY KEY,
      "${idCol}" INTEGER,
      vault_number INTEGER,
      checkin_timestamp TIMESTAMPTZ,
      checkout_timestamp TIMESTAMPTZ,
      images INTEGER DEFAULT 0
    )
  `);
}

// ─── Live Table ───────────────────────────────────────────────────

async function ensureLiveTable(orgName, orgId) {
  const table = getLiveTableName(orgName, orgId);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${table}" (
      id             SERIAL PRIMARY KEY,
      serial_no      INTEGER GENERATED ALWAYS AS IDENTITY,
      user_name      TEXT NOT NULL,
      member_id      TEXT NOT NULL,
      locker_number  INTEGER NOT NULL,
      check_in_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      check_out_time TIMESTAMPTZ,
      duration       INTEGER,
      status         TEXT NOT NULL DEFAULT 'active'
    )
  `);
}

async function insertLiveCheckin(orgName, orgId, { userName, memberId, lockerNumber }) {
  await ensureLiveTable(orgName, orgId);
  const table = getLiveTableName(orgName, orgId);
  const { rows } = await pool.query(
    `INSERT INTO "${table}" (user_name, member_id, locker_number, check_in_time, status)
     VALUES ($1, $2, $3, NOW(), 'active')
     RETURNING *`,
    [userName, String(memberId), lockerNumber]
  );
  return rows[0];
}

async function updateLiveCheckout(orgName, orgId, recordId) {
  const table = getLiveTableName(orgName, orgId);
  const { rows } = await pool.query(
    `UPDATE "${table}"
     SET check_out_time = NOW(),
         status = 'completed',
         duration = EXTRACT(EPOCH FROM (NOW() - check_in_time))::INTEGER / 60
     WHERE id = $1
     RETURNING *`,
    [recordId]
  );
  return rows[0] || null;
}

async function fetchLiveLockers(orgName, orgId) {
  await ensureLiveTable(orgName, orgId);
  const table = getLiveTableName(orgName, orgId);
  const { rows } = await pool.query(
    `SELECT * FROM "${table}" ORDER BY check_in_time DESC`
  );
  return rows;
}

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
  ensureLiveTable,
  insertLiveCheckin,
  updateLiveCheckout,
  fetchLiveLockers,
  ensureOrganisationInfoTable,
};
