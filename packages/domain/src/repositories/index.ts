/**
 * Repository interfaces (AGENTS.md section 5.2).
 *
 * These speak only in domain types — no Drizzle, no row shapes. Implementations
 * live in `@make-your-case/persistence` and are injected at the composition
 * roots (`apps/worker`, `apps/web` server code). In-memory implementations for
 * tests are in `@make-your-case/domain/testing`.
 */

export * from './document-repository.ts';
export * from './span-repository.ts';
export * from './revision-repository.ts';
export * from './analysis-run-repository.ts';
export * from './repositories.ts';
