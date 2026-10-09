import { createInMemoryRepositories } from '@make-your-case/domain/testing';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeModelProvider, RecordingProgressReporter } from '../src/testing/index.ts';
import {
  CHECKPOINT_SCHEMA,
  createAnalysisWorkflow,
  createPostgresCheckpointer,
  runAnalysis,
} from '../src/workflow/index.ts';

/**
 * The Postgres checkpointer against a real database (`pnpm test:db`): a run
 * that fails part way resumes from its checkpoint in a fresh workflow — as it
 * would in a restarted worker — without repeating the stages it finished.
 */

function connectionString(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'TEST_DATABASE_URL is not set. Run `pnpm db:up` and copy .env.example to .env.',
    );
  }
  return url;
}

/** Creates the test database if absent; `persistence`'s suite may not have run first. */
async function ensureDatabaseExists(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '');
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const existing = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (existing.rowCount === 0) await admin.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await admin.end();
  }
}

const checkpointers: { end(): Promise<void> }[] = [];

beforeAll(async () => {
  await ensureDatabaseExists(connectionString());
});
afterAll(async () => {
  await Promise.all(checkpointers.map((checkpointer) => checkpointer.end()));
});

const SOURCE = 'Notice must be in writing. The tenant gave written notice. So notice was valid.';

describe('createPostgresCheckpointer', () => {
  it('lets a fresh workflow resume a failed run from its last checkpoint', async () => {
    const repositories = createInMemoryRepositories();
    const document = await repositories.documents.create({
      source_text: SOURCE,
      title: null,
      role: 'own_brief',
    });
    const run = await repositories.runs.create({ document_id: document.id, status: 'running' });
    const input = { runId: run.id, documentId: document.id, sourceText: SOURCE };
    const models = new FakeModelProvider({
      classify: [
        {
          labels: ['s1', 's2', 's3'].map((span_id) => ({
            span_id,
            function: 'argumentative',
            confidence: 0.9,
          })),
        },
      ],
      extract: [new Error('provider unavailable')],
    });

    const workflowFor = async () => {
      const checkpointer = await createPostgresCheckpointer(connectionString());
      checkpointers.push(checkpointer);
      return createAnalysisWorkflow({
        models,
        reporter: new RecordingProgressReporter(),
        revisions: repositories.revisions,
        config: { maxValidationRetries: 0, gateMinArgumentativeSpans: 2 },
        checkpointer,
      });
    };

    await expect(runAnalysis(await workflowFor(), input)).rejects.toThrow('provider unavailable');

    models.enqueue('extract', { claims: [], inferences: [], relations: [] });
    models.enqueue('reconstruct', { claims: [], inferences: [], relations: [] });
    // An empty graph has no thesis, so with no retries the run fails validation:
    // enough to show it continued from extract rather than starting over.
    const outcome = await runAnalysis(await workflowFor(), input);

    expect(outcome.status).toBe('failed');
    expect(models.callsFor('classify')).toHaveLength(1);
    expect(models.callsFor('extract')).toHaveLength(2);
  });

  it('keeps its tables in their own schema', async () => {
    const client = new pg.Client({ connectionString: connectionString() });
    await client.connect();
    try {
      const tables = await client.query<{ table_schema: string }>(
        "select distinct table_schema from information_schema.tables where table_name = 'checkpoints'",
      );
      expect(tables.rows.map((row) => row.table_schema)).toEqual([CHECKPOINT_SCHEMA]);
    } finally {
      await client.end();
    }
  });
});
