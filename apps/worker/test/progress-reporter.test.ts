import { beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '@make-your-case/domain/testing';
import type { RunId } from '@make-your-case/domain';
import { DatabaseProgressReporter } from '../src/progress-reporter.ts';

let repositories: ReturnType<typeof createInMemoryRepositories>;
let runId: RunId;
let reporter: DatabaseProgressReporter;

beforeEach(async () => {
  repositories = createInMemoryRepositories();
  const document = await repositories.documents.create({
    source_text: 'A document.',
    title: null,
    role: 'other',
  });
  const run = await repositories.runs.create({ document_id: document.id, status: 'running' });
  runId = run.id;
  reporter = new DatabaseProgressReporter(repositories.runs, runId);
});

const events = async () => repositories.runs.listEventsSince(runId, -1);

describe('DatabaseProgressReporter', () => {
  it('writes one event per report, in order', async () => {
    await reporter.stageStarted('segment');
    await reporter.stageCompleted('segment', { spans: 11 });
    await reporter.stageStarted('classify');

    const written = await events();
    expect(written.map((e) => [e.type, e.stage])).toEqual([
      ['stage_started', 'segment'],
      ['stage_completed', 'segment'],
      ['stage_started', 'classify'],
    ]);
    // Monotonic, which is what lets the SSE stream resume from Last-Event-ID.
    expect(written.map((e) => e.sequence)).toEqual([0, 1, 2]);
  });

  it('moves the run’s current stage as each stage starts', async () => {
    await reporter.stageStarted('extract');
    expect((await repositories.runs.getById(runId))?.current_stage).toBe('extract');

    await reporter.stageStarted('reconstruct');
    expect((await repositories.runs.getById(runId))?.current_stage).toBe('reconstruct');
  });

  it('carries progress counts alongside the message', async () => {
    await reporter.stageProgress('classify', 'Classified 40 of 120 spans', {
      classified: 40,
      total: 120,
    });

    const [event] = await events();
    expect(event?.payload).toEqual({
      message: 'Classified 40 of 120 spans',
      classified: 40,
      total: 120,
    });
  });

  it('reports a validation retry as counts, not as the errors themselves', async () => {
    await reporter.validationRetry(2, 3);

    const [event] = await events();
    expect(event?.type).toBe('validation_retry');
    expect(event?.stage).toBe('validate');
    expect(event?.payload).toEqual({ attempt: 2, errorCount: 3 });
  });

  it('records a failure with its user-safe message and no stage', async () => {
    await reporter.runFailed('The analysis could not be completed.');

    const [event] = await events();
    expect(event?.type).toBe('run_failed');
    expect(event?.stage).toBeNull();
    expect(event?.payload).toEqual({ message: 'The analysis could not be completed.' });
  });

  it('writes nothing but numbers and the pipeline’s own messages', async () => {
    // Section 8.4: these rows are shown to users, so no document text, prompt,
    // model output or stack trace may reach them. `ProgressData` is numbers
    // only at the type level; this guards the payloads actually written.
    await reporter.stageStarted('classify');
    await reporter.stageProgress('classify', 'Classified 2 of 2 spans', {
      classified: 2,
      total: 2,
    });
    await reporter.stageCompleted('classify', { argumentative: 2 });
    await reporter.validationRetry(1, 1);

    for (const event of await events()) {
      for (const [key, value] of Object.entries(event.payload ?? {})) {
        if (key === 'message') {
          expect(typeof value).toBe('string');
          continue;
        }
        expect(typeof value, `${key} should be a number`).toBe('number');
      }
    }
  });
});
