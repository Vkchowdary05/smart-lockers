/**
 * migrate_existing_tables.js
 *
 * One-time migration script to upgrade existing per-org tables
 * from the old schema to the new schema matching Locker_schema_26.sql.
 *
 * Run once: node scripts/migrate_existing_tables.js
 *
 * What it does:
 *  - For each org in organisation_info:
 *    - Adds missing columns to the active table (employee_id, checkout_timestamp, duration_min, image_checksum, row_id)
 *    - Adds missing columns to the logs table (employee_id, name, phone_number, imagepath, duration_min)
 *    - Renames 'id' to 'log_id' in logs table if needed
 *    - Adds missing constraints and indexes
 *    - Adds mqtt_username column to organisation_info if missing
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/daemonPool');

async function columnExists(client, tableName, columnName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function constraintExists(client, constraintName) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.table_constraints
     WHERE constraint_name = $1`,
    [constraintName]
  );
  return rows.length > 0;
}

async function indexExists(client, indexName) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [indexName]
  );
  return rows.length > 0;
}

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('[MIGRATE] Starting migration...');

    // 1. Add mqtt_username to organisation_info if missing
    const mqttExists = await columnExists(client, 'organisation_info', 'mqtt_username');
    if (!mqttExists) {
      await client.query(`ALTER TABLE organisation_info ADD COLUMN IF NOT EXISTS mqtt_username VARCHAR(50) UNIQUE`);
      console.log('[MIGRATE] Added mqtt_username to organisation_info');
    }

    // 2. Get all orgs
    const { rows: orgs } = await client.query('SELECT * FROM organisation_info ORDER BY organization_id');
    console.log(`[MIGRATE] Found ${orgs.length} organizations`);

    for (const org of orgs) {
      const orgId = org.organization_id;
      const orgNameClean = org.organization.replace(/ /g, '').toLowerCase();
      const memberTable = `${orgNameClean}_${orgId}`;
      const logsTable = `${orgNameClean}_${orgId}_logs`;

      console.log(`\n[MIGRATE] Processing org: ${org.organization} (${orgId})`);

      // ── Active table migrations ──────────────────────────────

      // Check if the active table exists
      const { rows: tableExists } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [memberTable]
      );

      if (tableExists.length === 0) {
        console.log(`[MIGRATE]   Active table "${memberTable}" does not exist, skipping`);
      } else {
        // Add row_id if missing (as BIGSERIAL is tricky to add — add as BIGINT with default)
        if (!(await columnExists(client, memberTable, 'row_id'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS row_id BIGSERIAL`);
          console.log(`[MIGRATE]   Added row_id to ${memberTable}`);
        }

        // Add employee_id if missing
        if (!(await columnExists(client, memberTable, 'employee_id'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS employee_id BIGINT`);
          console.log(`[MIGRATE]   Added employee_id to ${memberTable}`);
        }

        // Add member_id if missing (old private orgs might only have employee_id)
        if (!(await columnExists(client, memberTable, 'member_id'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS member_id BIGINT`);
          console.log(`[MIGRATE]   Added member_id to ${memberTable}`);
        }

        // Add checkout_timestamp if missing
        if (!(await columnExists(client, memberTable, 'checkout_timestamp'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS checkout_timestamp TIMESTAMP`);
          console.log(`[MIGRATE]   Added checkout_timestamp to ${memberTable}`);
        }

        // Add duration_min if missing
        if (!(await columnExists(client, memberTable, 'duration_min'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS duration_min INTEGER`);
          console.log(`[MIGRATE]   Added duration_min to ${memberTable}`);
        }

        // Add image_checksum if missing
        if (!(await columnExists(client, memberTable, 'image_checksum'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS image_checksum VARCHAR(64)`);
          console.log(`[MIGRATE]   Added image_checksum to ${memberTable}`);
        }

        // Add row_checksum if missing
        if (!(await columnExists(client, memberTable, 'row_checksum'))) {
          await client.query(`ALTER TABLE "${memberTable}" ADD COLUMN IF NOT EXISTS row_checksum VARCHAR(64)`);
          console.log(`[MIGRATE]   Added row_checksum to ${memberTable}`);
        }

        // Add recent_update CHECK constraint if missing
        const ruConstraint = `chk_${orgNameClean}_${orgId}_recent_update`;
        if (!(await constraintExists(client, ruConstraint))) {
          try {
            await client.query(`ALTER TABLE "${memberTable}"
              ADD CONSTRAINT "${ruConstraint}"
              CHECK (recent_update IS NULL OR recent_update IN ('A','M','D','I'))`);
            console.log(`[MIGRATE]   Added recent_update constraint to ${memberTable}`);
          } catch (e) {
            console.warn(`[MIGRATE]   Could not add recent_update constraint: ${e.message}`);
          }
        }

        // Add at-least-one-id constraint if missing
        const idConstraint = `chk_${orgNameClean}_${orgId}_atleast_one_id`;
        if (!(await constraintExists(client, idConstraint))) {
          try {
            await client.query(`ALTER TABLE "${memberTable}"
              ADD CONSTRAINT "${idConstraint}"
              CHECK (member_id IS NOT NULL OR employee_id IS NOT NULL)`);
            console.log(`[MIGRATE]   Added atleast_one_id constraint to ${memberTable}`);
          } catch (e) {
            console.warn(`[MIGRATE]   Could not add atleast_one_id constraint (existing NULLs?): ${e.message}`);
          }
        }

        // Add indexes
        const idxMember = `idx_${orgNameClean}_${orgId}_member_id`;
        if (!(await indexExists(client, idxMember))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxMember}" ON "${memberTable}" (member_id)`);
        }
        const idxEmployee = `idx_${orgNameClean}_${orgId}_employee_id`;
        if (!(await indexExists(client, idxEmployee))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxEmployee}" ON "${memberTable}" (employee_id)`);
        }
        const idxVault = `idx_${orgNameClean}_${orgId}_vault_number`;
        if (!(await indexExists(client, idxVault))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxVault}" ON "${memberTable}" (vault_number)`);
        }

        console.log(`[MIGRATE]   Active table "${memberTable}" migrated`);
      }

      // ── Logs table migrations ────────────────────────────────

      const { rows: logsTableExists } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
        [logsTable]
      );

      if (logsTableExists.length === 0) {
        console.log(`[MIGRATE]   Logs table "${logsTable}" does not exist, skipping`);
      } else {
        // Rename 'id' to 'log_id' if needed
        if ((await columnExists(client, logsTable, 'id')) && !(await columnExists(client, logsTable, 'log_id'))) {
          await client.query(`ALTER TABLE "${logsTable}" RENAME COLUMN id TO log_id`);
          console.log(`[MIGRATE]   Renamed id → log_id in ${logsTable}`);
        }

        // Add employee_id if missing
        if (!(await columnExists(client, logsTable, 'employee_id'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS employee_id BIGINT`);
          console.log(`[MIGRATE]   Added employee_id to ${logsTable}`);
        }

        // Add member_id if missing
        if (!(await columnExists(client, logsTable, 'member_id'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS member_id BIGINT`);
          console.log(`[MIGRATE]   Added member_id to ${logsTable}`);
        }

        // Add name if missing
        if (!(await columnExists(client, logsTable, 'name'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS name VARCHAR(150)`);
          console.log(`[MIGRATE]   Added name to ${logsTable}`);
        }

        // Add phone_number if missing
        if (!(await columnExists(client, logsTable, 'phone_number'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS phone_number VARCHAR(15)`);
          console.log(`[MIGRATE]   Added phone_number to ${logsTable}`);
        }

        // Add imagepath if missing
        if (!(await columnExists(client, logsTable, 'imagepath'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS imagepath TEXT`);
          console.log(`[MIGRATE]   Added imagepath to ${logsTable}`);
        }

        // Add duration_min if missing
        if (!(await columnExists(client, logsTable, 'duration_min'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS duration_min INTEGER`);
          console.log(`[MIGRATE]   Added duration_min to ${logsTable}`);
        }

        // Add checkout_timestamp if missing
        if (!(await columnExists(client, logsTable, 'checkout_timestamp'))) {
          await client.query(`ALTER TABLE "${logsTable}" ADD COLUMN IF NOT EXISTS checkout_timestamp TIMESTAMP`);
          console.log(`[MIGRATE]   Added checkout_timestamp to ${logsTable}`);
        }

        // Add indexes
        const idxLogsVault = `idx_${orgNameClean}_${orgId}_logs_vault_number`;
        if (!(await indexExists(client, idxLogsVault))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxLogsVault}" ON "${logsTable}" (vault_number)`);
        }
        const idxLogsMember = `idx_${orgNameClean}_${orgId}_logs_member_id`;
        if (!(await indexExists(client, idxLogsMember))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxLogsMember}" ON "${logsTable}" (member_id)`);
        }
        const idxLogsEmployee = `idx_${orgNameClean}_${orgId}_logs_employee_id`;
        if (!(await indexExists(client, idxLogsEmployee))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxLogsEmployee}" ON "${logsTable}" (employee_id)`);
        }
        const idxLogsCheckin = `idx_${orgNameClean}_${orgId}_logs_checkin`;
        if (!(await indexExists(client, idxLogsCheckin))) {
          await client.query(`CREATE INDEX IF NOT EXISTS "${idxLogsCheckin}" ON "${logsTable}" (checkin_timestamp)`);
        }

        console.log(`[MIGRATE]   Logs table "${logsTable}" migrated`);
      }
    }

    console.log('\n[MIGRATE] Migration complete!');
  } catch (err) {
    console.error('[MIGRATE] ERROR:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
