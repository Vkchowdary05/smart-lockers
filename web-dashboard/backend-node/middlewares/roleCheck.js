const { requireAuth } = require('./auth');

/**
 * Role-based access control middleware factory.
 * Usage: router.use(roleRequired('super_admin'))
 *
 * Mirrors Python's @role_required('super_admin') decorator.
 */
function roleRequired(requiredRole) {
  return [
    requireAuth,
    (req, res, next) => {
      const claims = req.jwtClaims || {};
      const role = claims.role;

      if (!role) {
        return res.status(403).json({ message: 'No role in token' });
      }

      if (role !== requiredRole) {
        return res.status(403).json({
          message: `Forbidden. Required role: ${requiredRole}, got: ${role}`,
        });
      }

      next();
    },
  ];
}

module.exports = { roleRequired };
