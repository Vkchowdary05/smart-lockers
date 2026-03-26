/**
 * superAdmin.js — /api/super-admin/* routes
 * Port of backend/routes/super_admin_routes.py
 */
const express = require('express');
const router = express.Router();

const { roleRequired } = require('../middlewares/roleCheck');
const adminService = require('../services/adminService');
const daemonDb = require('../services/daemonDb');
const { generateTempPassword } = require('../utils/tempPassword');

// GET /api/super-admin/organizations
router.get('/organizations', roleRequired('super_admin'), async (req, res) => {
  try {
    const orgs   = await daemonDb.listAllOrgs();
    const result = [];

    for (const org of orgs) {
      const admins = await adminService.findAdminsByOrgId(org.organization_id, 'org_admin');
      result.push({
        organization_id: org.organization_id,
        organization:    org.organization,
        mac:             org.mac,
        mode:            org.mode,
        vault_count:     org.vault_count,
        fault_vault:     org.fault_vault,
        total_checksum:  org.total_checksum,
        admins:          admins.map(a => adminService.adminToDict(a)),
      });
    }

    return res.json({ organizations: result, total: result.length, page: 1, pages: 1 });
  } catch (err) {
    console.error('[LIST_ORGS_ERROR]', err.message);
    return res.status(500).json({ message: 'Failed to fetch organizations' });
  }
});

// POST /api/super-admin/organizations
router.post('/organizations', roleRequired('super_admin'), async (req, res) => {
  try {
    const {
      org_name = '', org_id, mac = '', mode = false,
      vault_count = 10, fault_vault = '{}',
      admin_name = '', admin_phone = '', admin_email = '',
    } = req.body || {};

    if (!org_name.trim() || !admin_name.trim() || !admin_email.trim()) {
      return res.status(400).json({ message: 'org_name, admin_name, and admin_email are required' });
    }
    if (!org_id) return res.status(400).json({ message: 'org_id (numeric) is required' });

    const numericOrgId = parseInt(org_id, 10);
    if (!numericOrgId) return res.status(400).json({ message: 'org_id must be a numeric value' });

    if (!mac.trim()) return res.status(400).json({ message: 'MAC address is required' });
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac.trim().toLowerCase())) {
      return res.status(400).json({ message: 'MAC address must be in format aa:bb:cc:dd:ee:ff' });
    }

    let cleanPhone = null;
    if (admin_phone) {
      const ph = admin_phone.replace(/[\s-]/g, '');
      if (!/^\+91[0-9]{10}$/.test(ph)) {
        return res.status(400).json({ message: 'Contact number must be +91 followed by exactly 10 digits' });
      }
      cleanPhone = ph;
    }

    // Check duplicates
    const existingOrg = await daemonDb.getOrgInfo(numericOrgId);
    if (existingOrg) return res.status(409).json({ message: `Daemon org ID ${numericOrgId} already exists` });

    const tempPassword = generateTempPassword();
    const passwordHash = await adminService.hashPassword(tempPassword);

    // 1. Register in daemon DB (trigger creates member + logs tables)
    const daemonOrg = await daemonDb.createOrganisation({
      orgId:      numericOrgId,
      orgName:    org_name.trim(),
      mac:        mac.trim().toLowerCase(),
      mode:       Boolean(mode),
      vaultCount: parseInt(vault_count, 10),
      faultVault: String(fault_vault),
    });

    // 2. Create org admin in auth DB
    const admin = await adminService.createAdmin({
      orgId:             numericOrgId,
      organizationName:  org_name.trim(),
      username:          admin_email.trim(),
      passwordHash,
      role:              'org_admin',
      name:              admin_name.trim(),
      email:             admin_email.trim(),
      phone:             cleanPhone,
      mustChangePassword: true,
    });

    await adminService.logAction({
      adminId:    null,
      action:     'create_org',
      targetType: 'organization',
      targetId:   String(numericOrgId),
      details:    JSON.stringify({ org_name: org_name.trim(), admin_email: admin_email.trim(), mode }),
    });

    return res.status(201).json({
      message:      'Organization created successfully',
      organization: {
        organization_id: daemonOrg.organization_id,
        organization:    daemonOrg.organization,
        mode:            mode ? 'private' : 'public',
        vault_count,
      },
      admin:         adminService.adminToDict(admin),
      temp_password: tempPassword,
    });
  } catch (err) {
    const msg = err.message || '';
    console.error('[CREATE_ORG_ERROR]', msg);
    if (msg.includes('mac') && msg.toLowerCase().includes('unique')) {
      return res.status(409).json({ message: `MAC address is already registered to another organization` });
    }
    if (msg.includes('organization_id') && msg.toLowerCase().includes('unique')) {
      return res.status(409).json({ message: `Organization ID already exists` });
    }
    return res.status(500).json({ message: `Failed to create organization: ${msg}` });
  }
});

// DELETE /api/super-admin/organizations/:id
router.delete('/organizations/:id', roleRequired('super_admin'), async (req, res) => {
  const orgId = parseInt(req.params.id, 10);
  try {
    const org = await daemonDb.getOrgInfo(orgId);
    if (!org) return res.status(404).json({ message: 'Organization not found' });

    await daemonDb.deleteOrganisation(orgId);
    await adminService.deleteAdminsByOrgId(orgId, 'org_admin');

    await adminService.logAction({
      adminId:    null,
      action:     'delete_org',
      targetType: 'organization',
      targetId:   String(orgId),
      details:    JSON.stringify({ org_id: orgId }),
    });

    return res.json({ message: 'Organization deleted' });
  } catch (err) {
    console.error(`[DELETE_ORG_ERROR] org_id=${orgId}:`, err.message);
    return res.status(500).json({ message: `Failed to delete organization: ${err.message}` });
  }
});

// DELETE /api/super-admin/admins/:id
router.delete('/admins/:id', roleRequired('super_admin'), async (req, res) => {
  const adminId = parseInt(req.params.id, 10);
  const admin = await adminService.findAdminById(adminId);
  if (!admin) return res.status(404).json({ message: 'Admin not found' });
  if (admin.role === 'super_admin') return res.status(403).json({ message: 'Cannot delete a super admin' });

  await adminService.deleteAdminById(adminId);
  await adminService.logAction({
    adminId:    null,
    action:     'delete_admin',
    targetType: 'admin',
    targetId:   String(adminId),
    details:    JSON.stringify({ username: admin.username, org_id: admin.org_id }),
  });

  return res.json({ message: 'Admin deleted' });
});

// POST /api/super-admin/admins/:id/reset-password
router.post('/admins/:id/reset-password', roleRequired('super_admin'), async (req, res) => {
  const adminId = parseInt(req.params.id, 10);
  const admin = await adminService.findAdminById(adminId);
  if (!admin) return res.status(404).json({ message: 'Admin not found' });
  if (admin.role === 'super_admin') {
    return res.status(403).json({ message: 'Cannot reset super admin password through this endpoint' });
  }

  const tempPassword = generateTempPassword();
  const newHash = await adminService.hashPassword(tempPassword);
  await adminService.updateAdminPassword(adminId, newHash);
  await adminService.setMustChangePassword(adminId, true);

  await adminService.logAction({
    adminId:    null,
    action:     'reset_password',
    targetType: 'admin',
    targetId:   String(adminId),
    details:    JSON.stringify({ username: admin.username, org_id: admin.org_id }),
  });

  return res.json({ message: 'Password reset successfully', temp_password: tempPassword });
});

// GET /api/super-admin/audit-logs
router.get('/audit-logs', roleRequired('super_admin'), async (req, res) => {
  const page    = Math.max(1, parseInt(req.query.page    || '1', 10));
  const perPage = Math.min(parseInt(req.query.per_page || '50', 10), 100);
  const result  = await adminService.getAuditLogs(page, perPage);
  return res.json(result);
});

module.exports = router;
