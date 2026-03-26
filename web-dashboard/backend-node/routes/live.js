/**
 * live.js — NEW live locker system
 *
 * Uses per-org ${orgName}_live tables with columns:
 *   id, serial_no, user_name, member_id, locker_number,
 *   check_in_time, check_out_time, duration, status
 *
 * No organization_code column — the table name itself identifies the org.
 *
 * Endpoints:
 *   GET  /api/live-lockers   — fetch all live records + stats
 *   POST /api/check-in       — insert new check-in (status='active')
 *   POST /api/check-out      — update checkout timestamp + duration
 */
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/auth');
const daemonDb = require('../services/daemonDb');

function getOrg(req) {
  const c = req.jwtClaims || {};
  return { orgId: c.org_id ?? null, orgName: c.org_name ?? null, mode: c.mode ?? false };
}

// GET /api/live-lockers
router.get('/live-lockers', requireAuth, async (req, res) => {
  const { orgId, orgName } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  try {
    const rows = await daemonDb.fetchLiveLockers(orgName, orgId);

    // Compute stats
    const orgInfo     = await daemonDb.getOrgInfo(orgId);
    const totalLockers = orgInfo ? (orgInfo.vault_count || 0) : 0;
    const usedLockers  = rows.filter(r => r.status === 'active').length;
    const emptyLockers = Math.max(0, totalLockers - usedLockers);

    return res.json({
      live: rows,
      stats: { total_lockers: totalLockers, used_lockers: usedLockers, empty_lockers: emptyLockers },
    });
  } catch (err) {
    console.error(`[LIVE_LOCKERS_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/check-in
router.post('/check-in', requireAuth, async (req, res) => {
  const { orgId, orgName } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  const { user_name, member_id, locker_number } = req.body || {};
  if (!user_name || member_id == null || locker_number == null) {
    return res.status(400).json({ message: 'user_name, member_id, and locker_number are required' });
  }

  try {
    const row = await daemonDb.insertLiveCheckin(orgName, orgId, {
      userName:     user_name,
      memberId:     member_id,
      lockerNumber: parseInt(locker_number, 10),
    });
    return res.status(201).json({ message: 'Check-in recorded', record: row });
  } catch (err) {
    console.error(`[CHECK_IN_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

// POST /api/check-out
router.post('/check-out', requireAuth, async (req, res) => {
  const { orgId, orgName } = getOrg(req);
  if (!orgId || !orgName) return res.status(400).json({ message: 'Missing organisation in token' });

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ message: 'id (live record id) is required' });

  try {
    const row = await daemonDb.updateLiveCheckout(orgName, orgId, parseInt(id, 10));
    if (!row) return res.status(404).json({ message: 'Live record not found or already checked out' });
    return res.json({ message: 'Check-out recorded', record: row });
  } catch (err) {
    console.error(`[CHECK_OUT_ERROR] org=${orgName}_${orgId}:`, err.message);
    return res.status(500).json({ message: err.message });
  }
});

module.exports = router;
