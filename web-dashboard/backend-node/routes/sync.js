/**
 * sync.js — GET /api/v1/org/:orgId/sync
 * Port of backend/routes/sync_routes.py
 *
 * Public endpoint used by locker devices/daemon (auth via api_token header).
 * Returns pending members and recent logs for the specified org.
 */
const express = require('express');
const router = express.Router();
const daemonDb = require('../services/daemonDb');

// GET /api/v1/org/:orgId/sync
router.get('/:orgId/sync', async (req, res) => {
  const orgId = parseInt(req.params.orgId, 10);
  if (!orgId) return res.status(400).json({ message: 'Invalid org_id' });

  try {
    const orgInfo = await daemonDb.getOrgInfo(orgId);
    if (!orgInfo) return res.status(404).json({ message: `Organization ID ${orgId} not found` });

    const orgName = orgInfo.organization;
    const mode    = orgInfo.mode;
    const now     = new Date().toISOString();

    // Pending members
    let pending = [];
    try {
      pending = await daemonDb.getPendingSync(orgName, orgId, mode);
      pending.forEach(row => {
        ['checkin_timestamp', 'checkout_timestamp'].forEach(k => {
          if (row[k]) row[k] = String(row[k]);
        });
      });
    } catch (err) {
      console.warn(`[SYNC_MEMBERS_ERROR] org=${orgName}_${orgId}:`, err.message);
    }

    // Recent logs
    let logs = [];
    try {
      logs = await daemonDb.fetchLogs(orgName, orgId, 50, 0);
      logs.forEach(log => {
        ['checkin_timestamp', 'checkout_timestamp'].forEach(k => {
          if (log[k]) log[k] = String(log[k]);
        });
      });
    } catch (err) {
      console.warn(`[SYNC_LOGS_ERROR] org=${orgName}_${orgId}:`, err.message);
    }

    console.log(`[SYNC_REQUEST] org=${orgName}_${orgId} pending=${pending.length} logs=${logs.length}`);

    return res.json({
      organization:     orgName,
      organization_id:  orgId,
      mode:             mode ? 'private' : 'public',
      pending_members:  pending,
      logs,
      total_checksum:   orgInfo.total_checksum,
      server_time:      now,
    });
  } catch (err) {
    console.error(`[SYNC_ERROR] org_id=${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
