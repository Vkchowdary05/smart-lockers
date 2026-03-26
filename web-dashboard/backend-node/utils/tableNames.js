/**
 * Dynamic table name helpers — mirrors config.py get_org_table_name() etc.
 *
 * Convention (daemon-compatible):
 *   member table : {orgNameClean}_{orgId}
 *   logs table   : {orgNameClean}_{orgId}_logs
 *   live table   : {orgNameClean}_{orgId}_live   ← NEW
 *
 * orgNameClean = org_name.replace(/ /g, '').toLowerCase()
 */

function cleanOrgName(orgName) {
  return orgName.replace(/ /g, '').toLowerCase();
}

function getMemberTableName(orgName, orgId) {
  return `${cleanOrgName(orgName)}_${orgId}`;
}

function getLogsTableName(orgName, orgId) {
  return `${cleanOrgName(orgName)}_${orgId}_logs`;
}

function getLiveTableName(orgName, orgId) {
  return `${cleanOrgName(orgName)}_${orgId}_live`;
}

function getIdColumn(mode) {
  // mode=true  → private org → employee_id
  // mode=false → public org  → member_id
  return mode ? 'employee_id' : 'member_id';
}

function getImagePath(orgName, orgId, personId) {
  // Relative path stored in DB: OrgName/OrgId/PersonId
  return `${orgName}/${orgId}/${personId}`;
}

module.exports = {
  cleanOrgName,
  getMemberTableName,
  getLogsTableName,
  getLiveTableName,
  getIdColumn,
  getImagePath,
};
