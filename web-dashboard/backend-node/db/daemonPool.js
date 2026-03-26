const { Pool } = require('pg');

// Daemon database pool — locker_msl (member data, org tables)
const daemonPool = new Pool({
  host:     process.env.POSTGRES_HOST     || '127.0.0.1',
  port:     parseInt(process.env.POSTGRES_PORT || '5432'),
  user:     process.env.POSTGRES_USER     || 'locker_msl',
  password: process.env.POSTGRES_PASSWORD || 'msl_locker_2025',
  database: process.env.POSTGRES_DB       || 'locker_msl',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

daemonPool.on('error', (err) => {
  console.error('[DAEMON_DB] Unexpected error on idle client', err.message);
});

module.exports = daemonPool;
