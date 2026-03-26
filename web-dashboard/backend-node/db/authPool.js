const { Pool } = require('pg');

// Auth database pool — locker_msl_auth (admins + audit_logs)
const authPool = new Pool({
  host:     process.env.POSTGRES_HOST     || '127.0.0.1',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  user:     process.env.POSTGRES_USER     || 'locker_msl',
  password: process.env.POSTGRES_PASSWORD || 'msl_locker_2025',
  database: process.env.AUTH_POSTGRES_DB  || 'locker_msl_auth',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

authPool.on('error', (err) => {
  console.error('[AUTH_DB] Unexpected error on idle client', err.message);
});

module.exports = authPool;
