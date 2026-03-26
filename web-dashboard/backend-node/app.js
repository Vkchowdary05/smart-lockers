/**
 * app.js — Express entry point for Secure Locker Node backend
 *
 * Mirrors the structure of Flask's create_app() in backend/app.py:
 *  - CORS on all /api/* routes
 *  - JWT via Authorization header or ?jwt= query param
 *  - All route blueprints registered
 *  - Super admin seeded on startup
 *  - Static file serving for React build (optional)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = parseInt(process.env.PORT || '5001', 10);

// ─── Middleware ──────────────────────────────────────────────────
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Routes ─────────────────────────────────────────────────────
const authRouter       = require('./routes/auth');
const passwordRouter   = require('./routes/password');
const membersRouter    = require('./routes/members');
const lockersRouter    = require('./routes/lockers');
const liveRouter       = require('./routes/live');
const superAdminRouter = require('./routes/superAdmin');
const syncRouter       = require('./routes/sync');

app.use('/api/admin',        authRouter);
app.use('/api/admin',        passwordRouter);
app.use('/api/members',      membersRouter);
app.use('/api/lockers',      lockersRouter);
app.use('/api',              liveRouter);          // /api/live-lockers, /api/check-in, /api/check-out
app.use('/api/super-admin',  superAdminRouter);
app.use('/api/v1/org',       syncRouter);

// ─── Health ─────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', engine: 'node' }));

// ─── Route list (dev helper) ─────────────────────────────────────
app.get('/api/routes', (req, res) => {
  const routes = [];
  app._router.stack.forEach(layer => {
    if (layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach(sublayer => {
        if (sublayer.route) {
          const methods = Object.keys(sublayer.route.methods).map(m => m.toUpperCase());
          routes.push({ path: sublayer.route.path, methods });
        }
      });
    }
  });
  res.json(routes);
});

// ─── Serve React frontend build (optional) ───────────────────────
const staticDir = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// ─── Global error handler ────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('[UNHANDLED_ERROR]', err.message);
  res.status(500).json({ message: 'Internal server error' });
});

// ─── Startup ────────────────────────────────────────────────────
async function startup() {
  const adminService = require('./services/adminService');
  const daemonDb = require('./services/daemonDb');
  
  // Ensure tables exist in auth DB
  await adminService.ensureAdminsTable();
  await daemonDb.ensureOrganisationInfoTable();
  console.log('[DB] Core tables verified (admins, audit_logs, organisation_info)');

  // Seed super admin
  await seedSuperAdmin(adminService);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER] Node backend running on http://0.0.0.0:${PORT}`);
  });
}

async function seedSuperAdmin(adminService) {
  const username = process.env.SUPER_ADMIN_USERNAME;
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const orgName  = process.env.SUPER_ADMIN_ORG_NAME || 'MicroSysLogic';

  if (!username || !password) {
    console.warn('[SEED] SUPER_ADMIN_USERNAME/PASSWORD not set — skipping seed.');
    return;
  }

  const existing = await adminService.findSuperAdmin(username);
  if (existing) {
    console.log(`[SEED] Super admin '${username}' already exists.`);
    return;
  }

  const hash = await adminService.hashPassword(password);
  await adminService.createAdmin({
    orgId:             null,
    organizationName:  orgName,
    username,
    passwordHash:      hash,
    role:              'super_admin',
    mustChangePassword: false,
  });
  console.log(`[SEED] Super admin '${username}' created.`);
}

startup().catch(err => {
  console.error('[STARTUP_FAILED]', err.message);
  process.exit(1);
});
