/**
 * auth.js — POST /api/admin/login
 * Port of backend/routes/auth_routes.py
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

const adminService = require('../services/adminService');
const daemonDb = require('../services/daemonDb');

const JWT_SECRET     = process.env.JWT_SECRET     || 'locker-msl-jwt-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { organization = '', username = '', password = '' } = req.body || {};

    if (!organization.trim() || !username.trim() || !password) {
      return res.status(400).json({ message: 'organization, username and password are required' });
    }

    const admin = await adminService.findAdminByOrgAndUsername(organization.trim(), username.trim());
    if (!admin) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordOk = await adminService.checkPassword(password, admin.password_hash);
    if (!passwordOk) {
      console.log(`[LOGIN_FAIL] org='${organization}' user='${username}'`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Build JWT claims
    const claims = {
      role:              admin.role,
      org_id:            admin.org_id,
      organization_name: admin.organization_name,
      username:          admin.username,
      admin_name:        admin.name || admin.username,
    };

    // For non-super-admins, enrich with daemon org info
    if (admin.role !== 'super_admin') {
      const daemonOrg = await daemonDb.getOrgInfo(admin.org_id);
      if (!daemonOrg) {
        return res.status(403).json({ message: 'Organization not found. Contact your super admin.' });
      }
      claims.org_id      = daemonOrg.organization_id;
      claims.org_name    = daemonOrg.organization;
      claims.mode        = daemonOrg.mode;
      claims.vault_count = daemonOrg.vault_count;
    }

    const accessToken = jwt.sign(
      { sub: String(admin.id), ...claims },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.status(200).json({
      access_token:        accessToken,
      admin:               adminService.adminToDict(admin),
      must_change_password: admin.must_change_password,
    });
  } catch (err) {
    console.error('[LOGIN_ERROR]', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
