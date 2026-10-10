import { PgBoss } from 'pg-boss';
import {
  ANALYZE_DOCUMENT_QUEUE,
  PIPELINE_LLM_STAGES,
  parseAnalyzeDocumentJob,
  parseEnv,
  resolveLlmConfig,
} from '@make-your-case/domain';
import { createDb, createRepositories } from '@make-your-case/persistence';
import { createModelProvider, createPostgresCheckpointer } from '@make-your-case/pipeline';
import { handleAnalyzeDocument } from './handle-job.ts';
import { log } from './logger.ts';

/**
 * The worker: a pg-boss consumer for `analyze-document` jobs (AGENTS.md
 * section 8.5).
 *
 * This is a composition root. It owns the database pool, the model provider,
 * the checkpointer and the queue, builds the repositories, and shuts all of
 * them down in order. Nothing below it reaches for a singleton.
 */
async function main(): Promise<void> {
  const env = parseEnv();

  const llm = resolveLlmConfig(env, PIPELINE_LLM_STAGES);
  if (!llm.ok) {
    // Every problem at once, naming variables but never values.
    log('error', 'invalid LLM configuration', { problems: llm.errors });
    process.exit(1);
  }

  const { db, close: closeDb } = createDb(env.DATABASE_URL);
  const repositories = createRepositories(db);
  const models = createModelProvider(llm.value);

  // Postgres-backed, so a run interrupted by a crash or a deploy resumes from
  // its last completed stage instead of repeating paid model calls.
  const checkpointer = await createPostgresCheckpointer(env.DATABASE_URL);

  const boss = new PgBoss(env.DATABASE_URL);
  boss.on('error', (error: Error) => {
    // The queue's own errors are not tied to a job, so they are logged rather
    // than failing a run.
    log('error', 'queue error', { error: error.message });
  });

  await boss.start();
  // Required before a job can be sent or worked in pg-boss 12.
  await boss.createQueue(ANALYZE_DOCUMENT_QUEUE);

  await boss.work<unknown>(ANALYZE_DOCUMENT_QUEUE, async (jobs) => {
    // The handler is given a batch. The default batch size is one, but reading
    // the array rather than `jobs[0]` means a larger size cannot silently drop
    // work later.
    for (const job of jobs) {
      const parsed = parseAnalyzeDocumentJob(job.data);
      log('info', 'job received', { jobId: job.id, runId: parsed.runId, attempt: job.retryCount });

      await handleAnalyzeDocument(parsed, {
        repositories,
        models,
        checkpointer,
        config: {
          maxValidationRetries: env.PIPELINE_MAX_VALIDATION_RETRIES,
          gateMinArgumentativeSpans: env.GATE_MIN_ARGUMENTATIVE_SPANS,
        },
      });
    }
  });

  log('info', 'worker ready', {
    queue: ANALYZE_DOCUMENT_QUEUE,
    llmProvider: env.LLM_PROVIDER,
    maxValidationRetries: env.PIPELINE_MAX_VALIDATION_RETRIES,
  });

  await shutdownOnSignal(async () => {
    log('info', 'shutting down');
    // Graceful: let an in-flight run finish rather than orphaning it mid-stage.
    // A run cut off anyway resumes from its checkpoint on redelivery.
    await boss.stop({ graceful: true });
    await checkpointer.end();
    await closeDb();
    log('info', 'stopped');
  });
}

/** Resolves once the process is asked to stop, then runs `shutdown` once. */
function shutdownOnSignal(shutdown: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let stopping = false;

    const handle = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      log('info', 'signal received', { signal });
      shutdown().then(resolve, reject);
    };

    process.once('SIGINT', () => {
      handle('SIGINT');
    });
    process.once('SIGTERM', () => {
      handle('SIGTERM');
    });
  });
}

main().catch((error: unknown) => {
  log('error', 'worker stopped unexpectedly', {
    error: (error as Error).message,
    name: (error as Error).name,
  });
  process.exit(1);
});
