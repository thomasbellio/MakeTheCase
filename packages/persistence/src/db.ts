import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema/index.ts';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Builds a database handle.
 *
 * No module-level singleton (AGENTS.md section 11): the composition roots own
 * the pool's lifetime, and tests need to point at a different database.
 */
export function createDb(connectionString: string): {
  readonly db: Db;
  close: () => Promise<void>;
} {
  const pool = new Pool({ connectionString });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}
