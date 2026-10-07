import { execFileSync } from 'node:child_process';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { createDb, type Db } from '../../src/db.ts';

/**
 * Harness for the repository round-trip tests (AGENTS.md section 7.6).
 *
 * Runs against a separate `makeyourcase_test` database on the local Compose
 * Postgres, so integration tests never touch development data. Isolation
 * between tests is TRUNCATE rather than an enclosing transaction: the thing
 * under test is that `saveArgumentGraph` commits atomically, and wrapping it in
 * an outer transaction would hide exactly the bug we want to catch.
 */

const TABLES = [
  'finding_target',
  'finding',
  'relation',
  'inference_premise',
  'inference',
  'occurrence',
  'claim',
  'revision',
  'run_event',
  'analysis_run',
  'span',
  'document',
] as const;

function connectionString(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `pnpm db:up` and copy .env.example to .env.',
    );
  }
  return url;
}

/**
 * Creates the test database if it is absent.
 *
 * A Compose init script cannot do this: those run only when the volume is first
 * created, and a developer who already has a dev volume would never get one.
 */
async function ensureDatabaseExists(url: string): Promise<void> {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });

  try {
    await admin.connect();
  } catch (error) {
    // The most likely cause by far, and the message Postgres gives is not
    // obviously actionable.
    throw new Error(`could not reach Postgres at ${parsed.host}. Run \`pnpm db:up\` first.`, {
      cause: error,
    });
  }

  try {
    const existing = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) {
      // Identifier cannot be parameterised; the name comes from our own
      // configuration, and quoting it blocks injection via the URL.
      await admin.query(`create database "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}

export interface TestDb {
  readonly db: Db;
  truncate: () => Promise<void>;
  close: () => Promise<void>;
}

export async function setupTestDb(): Promise<TestDb> {
  const url = connectionString();
  await ensureDatabaseExists(url);

  const { db, close } = createDb(url);
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });

  const truncate = async (): Promise<void> => {
    await db.execute(
      `truncate table ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity cascade`,
    );
  };

  await truncate();
  return { db, truncate, close };
}

/** True when a Postgres reachable at TEST_DATABASE_URL is available. */
export function hasTestDatabase(): boolean {
  if (process.env.TEST_DATABASE_URL === undefined) return false;
  try {
    execFileSync('docker', ['compose', 'ps', '--status', 'running', '--quiet', 'postgres'], {
      cwd: new URL('../../../../', import.meta.url).pathname,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}
