/**
 * lockers.js — /api/lockers/* routes
 * Port of backend/routes/locker_routes.py
 *
 * READ-ONLY — reads from daemon member + logs tables.
 * Does NOT use the new live table (that's for /api/live-lockers).
 */
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/auth');
const daemonDb = require('../services/daemonDb');
const { getIdColumn } = require('../utils/tableNames');

function getOrg(req) {
  const c = req.jwtClaims || {};
  return { orgId: c.org_id ?? null, orgName: c.org_name ?? null, mode: c.mode ?? false };
}

// GET /api/lockers/stats
router.get('/stats', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  try {
    const orgInfo = await daemonDb.getOrgInfo(orgId);
    const totalLockers = orgInfo ? (orgInfo.vault_count || 0) : 0;

    const members = await daemonDb.listMembers(orgName, orgId, false, mode);
    const busyLockers = members.filter(
      m => m.checkin_timestamp && !m.checkout_timestamp
    ).length;
    const emptyLockers = Math.max(0, totalLockers - busyLockers);

    return res.json({ total_lockers: totalLockers, empty_lockers: emptyLockers, busy_lockers: busyLockers });
  } catch (err) {
    console.error(`[LOCKER_STATS_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

// GET /api/lockers/live
router.get('/live', requireAuth, async (req, res) => {
  const { orgId, orgName, mode } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  try {
    const now   = new Date();
    const idCol = getIdColumn(mode);

    const members = await daemonDb.listMembers(orgName, orgId, false, mode);
    const logs    = await daemonDb.fetchLogs(orgName, orgId, 100, 0);

    // Build member map
    const memberMap = {};
    for (const m of members) {
      const pid = m[idCol];
      if (pid) memberMap[pid] = m;
    }

    const seenVaults = new Set();
    const lockers    = [];

    function calcDuration(checkin, checkout) {
      if (!checkin) return null;
      try {
        const start = new Date(checkin);
        const end   = checkout ? new Date(checkout) : now;
        return Math.floor((end - start) / 60000);
      } catch (_) { return null; }
    }

    for (const log of logs) {
      const vaultNum = log.vault_number;
      if (vaultNum == null || seenVaults.has(vaultNum)) continue;
      seenVaults.add(vaultNum);

      const pid    = log[idCol] || log.member_id || log.employee_id;
      const member = memberMap[pid] || {};
      const checkin  = log.checkin_timestamp;
      const checkout = log.checkout_timestamp;

      lockers.push({
        locker_id:        lockers.length + 1,
        vault_number:     vaultNum,
        user_name:        member.name || log.name || '',
        member_id:        pid,
        phone_number:     member.phone_number || log.phone_number || '',
        checkin_time:     checkin  ? String(checkin)  : null,
        checkout_time:    checkout ? String(checkout) : null,
        duration_minutes: calcDuration(checkin, checkout),
        status:           checkout ? 'Available' : checkin ? 'In Use' : 'Available',
      });
    }

    // Also include members with vault assignments that have no log entries
    for (const m of members) {
      const vaultNum = m.vault_number;
      if (vaultNum == null || seenVaults.has(vaultNum)) continue;
      seenVaults.add(vaultNum);
      const pid      = m[idCol];
      const checkin  = m.checkin_timestamp;
      const checkout = m.checkout_timestamp;
      lockers.push({
        locker_id:        lockers.length + 1,
        vault_number:     vaultNum,
        user_name:        m.name || '',
        member_id:        pid,
        phone_number:     m.phone_number || '',
        checkin_time:     checkin  ? String(checkin)  : null,
        checkout_time:    checkout ? String(checkout) : null,
        duration_minutes: calcDuration(checkin, checkout),
        status:           (checkin && !checkout) ? 'In Use' : 'Available',
      });
    }

    lockers.sort((a, b) => (b.checkin_time || '') > (a.checkin_time || '') ? 1 : -1);

    return res.json({ lockers });
  } catch (err) {
    console.error(`[LOCKER_LIVE_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
