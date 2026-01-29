#!/usr/bin/env tsx
/**
 * Clone user data between databases (e.g., production → local).
 *
 * Modes:
 *   --export  Export a single user's data to JSON (run on source machine)
 *   --import  Import JSON into the local database (run locally)
 *
 * Options:
 *   --user-email <email>   User email to export (required for --export)
 *   --file <path>          JSON file path (default: ./data/export-user.json)
 *   --db-path <path>       Override DB_PATH for export
 *
 * Full automation:
 *   --host <user@host>     SSH host — will export remotely, SCP, and import locally
 *   --remote-dir <path>    Remote project directory (default: /app)
 */

import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

// Tables to export, keyed by user_id
const USER_TABLES = [
  'users',
  'user_settings',
  'emails',
  'email_attachments',
  'email_analyses',
  'todos',
  'events',
  'email_summaries',
  'child_profiles',
  'recurring_activities',
  'processed_emails',
] as const;

// email_attachments joins through emails, not directly by user_id
const TABLES_VIA_EMAIL = new Set(['email_attachments']);

interface ExportData {
  exported_at: string;
  user_email: string;
  user_id: string;
  tables: Record<string, unknown[]>;
}

function exportUserData(userEmail: string, dbPath?: string) {
  // Set DB_PATH before importing db module
  if (dbPath) {
    process.env.DB_PATH = dbPath;
  }

  // Dynamic import so DB_PATH env is set first
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const resolvedPath = dbPath || process.env.DB_PATH || join(process.cwd(), 'data', 'app.db');
  const db = new Database(resolvedPath, { readonly: true });
  db.pragma('journal_mode = WAL');

  // Find user
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(userEmail) as
    | { user_id: string }
    | undefined;

  if (!user) {
    console.error(`User not found: ${userEmail}`);
    process.exit(1);
  }

  const userId = user.user_id;
  console.log(`Exporting data for user ${userEmail} (${userId})`);

  const data: ExportData = {
    exported_at: new Date().toISOString(),
    user_email: userEmail,
    user_id: userId,
    tables: {},
  };

  for (const table of USER_TABLES) {
    try {
      let rows: unknown[];
      if (TABLES_VIA_EMAIL.has(table as string)) {
        // Join through emails table
        rows = db
          .prepare(
            `SELECT ea.* FROM ${table} ea JOIN emails e ON ea.email_id = e.id WHERE e.user_id = ?`
          )
          .all(userId);
      } else {
        rows = db.prepare(`SELECT * FROM ${table} WHERE user_id = ?`).all(userId);
      }
      data.tables[table] = rows;
      console.log(`  ${table}: ${rows.length} rows`);
    } catch (err: unknown) {
      // Table might not exist on older schemas
      console.warn(`  ${table}: skipped (${(err as Error).message})`);
      data.tables[table] = [];
    }
  }

  db.close();
  return data;
}

function importUserData(filePath: string) {
  const raw = readFileSync(filePath, 'utf-8');
  const data: ExportData = JSON.parse(raw);

  console.log(`Importing data for ${data.user_email} (exported ${data.exported_at})`);

  // Import db module (uses default DB_PATH)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3');
  const resolvedPath = process.env.DB_PATH || join(process.cwd(), 'data', 'app.db');
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');

  // Import order matters for foreign keys — users first, then dependent tables
  const importOrder: string[] = [
    'users',
    'user_settings',
    'emails',
    'email_attachments',
    'email_analyses',
    'todos',
    'events',
    'email_summaries',
    'child_profiles',
    'recurring_activities',
    'processed_emails',
  ];

  const transaction = db.transaction(() => {
    for (const table of importOrder) {
      const rows = data.tables[table];
      if (!rows || rows.length === 0) {
        console.log(`  ${table}: 0 rows (skipped)`);
        continue;
      }

      // Get columns from first row
      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = columns.map(() => '?').join(', ');
      const columnList = columns.join(', ');

      const stmt = db.prepare(
        `INSERT OR REPLACE INTO ${table} (${columnList}) VALUES (${placeholders})`
      );

      let count = 0;
      for (const row of rows) {
        const values = columns.map((col) => (row as Record<string, unknown>)[col]);
        try {
          stmt.run(...values);
          count++;
        } catch (err: unknown) {
          console.warn(`  ${table}: failed to insert row: ${(err as Error).message}`);
        }
      }
      console.log(`  ${table}: ${count} rows imported`);
    }
  });

  transaction();
  db.close();
  console.log('\nImport complete.');
}

async function main() {
  const { values } = parseArgs({
    options: {
      export: { type: 'boolean', default: false },
      import: { type: 'boolean', default: false },
      'user-email': { type: 'string' },
      file: { type: 'string', default: './data/export-user.json' },
      'db-path': { type: 'string' },
      host: { type: 'string' },
      'remote-dir': { type: 'string', default: '/app' },
    },
    strict: true,
  });

  const file = values.file!;

  // Full automation: SSH export + SCP + local import
  if (values.host) {
    const email = values['user-email'];
    if (!email) {
      console.error('--user-email is required with --host');
      process.exit(1);
    }

    const host = values.host;
    const remoteDir = values['remote-dir']!;
    const remoteFile = `${remoteDir}/data/export-user.json`;
    const dbPathArg = values['db-path'] ? ` --db-path ${values['db-path']}` : '';

    console.log(`\n1/3 Exporting from ${host}...`);
    execSync(
      `ssh ${host} "bash -lc 'cd ${remoteDir} && npx tsx src/scripts/cloneUserData.ts --export --user-email ${email}${dbPathArg}'"`,
      { stdio: 'inherit' }
    );

    console.log(`\n2/3 Copying export file...`);
    const localDir = dirname(file);
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });
    execSync(`scp ${host}:${remoteFile} ${file}`, { stdio: 'inherit' });

    console.log(`\n3/3 Importing locally...`);
    importUserData(file);
    return;
  }

  // Export mode
  if (values.export) {
    const email = values['user-email'];
    if (!email) {
      console.error('--user-email is required for --export');
      process.exit(1);
    }

    const data = exportUserData(email, values['db-path']);

    const dir = dirname(file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
    console.log(`\nExported to ${file}`);
    return;
  }

  // Import mode
  if (values.import) {
    if (!existsSync(file)) {
      console.error(`File not found: ${file}`);
      process.exit(1);
    }
    importUserData(file);
    return;
  }

  console.error('Specify --export, --import, or --host. Run with --help for usage.');
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
