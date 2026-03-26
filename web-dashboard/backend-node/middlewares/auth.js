const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'locker-msl-jwt-secret-2026';

/**
 * JWT authentication middleware.
 * Reads Bearer token from Authorization header OR ?jwt= query param.
 * On success, attaches decoded payload to req.jwtClaims.
 */
function requireAuth(req, res, next) {
  let token = null;

  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }

  // Fallback: ?jwt= query param (used for <img src> requests)
  if (!token && req.query.jwt) {
    token = req.query.jwt;
  }

  if (!token) {
    return res.status(401).json({ message: 'Missing authentication token' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.jwtClaims = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/**
 * Extract org context from JWT claims.
 * Returns { orgId, orgName, mode } or nulls.
 */
function getOrgFromClaims(claims) {
  return {
    orgId:   claims.org_id   ?? null,
    orgName: claims.org_name ?? null,
    mode:    claims.mode     ?? false,
  };
}

module.exports = { requireAuth, getOrgFromClaims };
