/**
 * password.js — POST /api/admin/change-password
 * Port of backend/routes/password_routes.py
 */
const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middlewares/auth');
const adminService = require('../services/adminService');
const { validatePassword } = require('../utils/passwordPolicy');

// POST /api/admin/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const claims = req.jwtClaims || {};
    const adminId = parseInt(claims.sub, 10);
    if (!adminId) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    const admin = await adminService.findAdminById(adminId);
    if (!admin) {
      return res.status(404).json({ message: 'Admin not found' });
    }

    const { current_password = '', new_password = '', confirm_password = '' } = req.body || {};

    if (!current_password || !new_password || !confirm_password) {
      return res.status(400).json({
        message: 'current_password, new_password, and confirm_password are required',
      });
    }

    const currentOk = await adminService.checkPassword(current_password, admin.password_hash);
    if (!currentOk) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    if (new_password !== confirm_password) {
      return res.status(400).json({ message: 'New password and confirmation do not match' });
    }

    if (new_password === current_password) {
      return res.status(400).json({ message: 'New password must be different from current password' });
    }

    const pwError = validatePassword(new_password);
    if (pwError) {
      return res.status(400).json({ message: pwError });
    }

    const newHash = await adminService.hashPassword(new_password);
    await adminService.updateAdminPassword(adminId, newHash);

    return res.status(200).json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('[CHANGE_PASSWORD_ERROR]', err.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
