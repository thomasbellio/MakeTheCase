import type { Repositories } from '@make-your-case/domain';
import { createDb, createRepositories } from '@make-your-case/persistence';
import { serverEnv } from './env.ts';
import { PgBossJobQueue, type JobQueue } from './queue.ts';

/**
 * The API's composition root (AGENTS.md section 4): the one place that owns
 * the connection pool and the queue, and hands the services their
 * dependencies.
 */
export interface ServerResources {
  readonly repositories: Repositories;
  readonly queue: JobQueue;
  readonly maxDocumentChars: number;
}

/**
 * Cached on `globalThis` because Next re-evaluates modules on every dev-mode
 * reload: a module-level variable would open a fresh pool each time and leak
 * the old one until Postgres ran out of connections. The symbol is registered
 * (`Symbol.for`) so a reloaded module finds the same key.
 *
 * Only the long-lived resources are cached. Services are cheap and built per
 * request, so an edit to a service takes effect without a restart.
 */
const KEY = Symbol.for('make-your-case.server-resources');

export function serverResources(): ServerResources {
  const holder = globalThis as unknown as Record<symbol, ServerResources | undefined>;
  const existing = holder[KEY];
  if (existing !== undefined) return existing;
  const built = build();
  holder[KEY] = built;
  return built;
}

function build(): ServerResources {
  const env = serverEnv();
  const { db } = createDb(env.DATABASE_URL);
  return {
    repositories: createRepositories(db),
    queue: new PgBossJobQueue(env.DATABASE_URL),
    maxDocumentChars: env.MAX_DOCUMENT_CHARS,
  };
}
