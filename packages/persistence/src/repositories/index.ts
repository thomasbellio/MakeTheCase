import type { Repositories } from '@make-your-case/domain';
import type { Db } from '../db.ts';
import { DrizzleDocumentRepository } from './document-repository.ts';
import { DrizzleSpanRepository } from './span-repository.ts';
import { DrizzleRevisionRepository } from './revision-repository.ts';
import { DrizzleAnalysisRunRepository } from './analysis-run-repository.ts';

export * from './document-repository.ts';
export * from './span-repository.ts';
export * from './revision-repository.ts';
export * from './analysis-run-repository.ts';

/**
 * Assembles every repository over one database handle.
 *
 * Each composition root — the worker, the API, the evaluation harness — needs
 * the same four, so they are built here rather than by hand in three places.
 * The handle's lifetime stays with the caller (`createDb` returns its own
 * `close`), because only the caller knows when the process is done with it.
 */
export function createRepositories(db: Db): Repositories {
  return {
    documents: new DrizzleDocumentRepository(db),
    spans: new DrizzleSpanRepository(db),
    revisions: new DrizzleRevisionRepository(db),
    runs: new DrizzleAnalysisRunRepository(db),
  };
}
