import { describe, expect, it } from 'vitest';
import { createInMemoryRepositories } from '@make-your-case/domain/testing';
import { newId, type AnalyzeDocumentJob, type RunId } from '@make-your-case/domain';
import {
  FakeModelProvider,
  createMemoryCheckpointer,
  type ScriptedResponse,
} from '@make-your-case/pipeline/testing';
import { handleAnalyzeDocument, type JobDeps } from '../src/handle-job.ts';
import { UNEXPECTED_FAILURE_MESSAGE } from '../src/run-lifecycle.ts';

const SOURCE = ['# A lease', '', 'The lease began in May. The rent is paid monthly.'].join('\n');

/**
 * Only the classify stage is scripted. These tests cover what the **worker**
 * adds — the run's lifecycle, its events, and what happens when something goes
 * wrong — rather than re-testing the workflow, which
 * `packages/pipeline/test/workflow.test.ts` already drives end to end.
 */
async function setup(script: Partial<Record<'classify', readonly ScriptedResponse[]>> = {}) {
  const repositories = createInMemoryRepositories();
  const document = await repositories.documents.create({
    source_text: SOURCE,
    title: 'A lease',
    role: 'other',
  });
  const run = await repositories.runs.create({ document_id: document.id, status: 'queued' });

  const models = new FakeModelProvider(script);
  const deps: JobDeps = {
    repositories,
    models,
    checkpointer: createMemoryCheckpointer(),
    config: { maxValidationRetries: 3, gateMinArgumentativeSpans: 2 },
  };
  const job: AnalyzeDocumentJob = { runId: run.id, documentId: document.id };

  return { repositories, models, deps, job, run };
}

/** Every span labelled the same way, which is all the gate looks at. */
const classified = (fn: 'argumentative' | 'narrative') => ({
  labels: ['s1', 's2', 's3'].map((span_id) => ({ span_id, function: fn, confidence: 0.9 })),
});

describe('handleAnalyzeDocument', () => {
  it('takes a run through its whole lifecycle', async () => {
    const { repositories, deps, job } = await setup({
      classify: [classified('narrative'), { summary: 'A short description of a lease.' }],
    });

    const outcome = await handleAnalyzeDocument(job, deps);
    expect(outcome.status).toBe('not_an_argument');

    const run = await repositories.runs.getById(job.runId);
    expect(run?.status).toBe('not_an_argument');
    expect(run?.summary).toBe('A short description of a lease.');
    // Nothing set these before this milestone; the run stayed `queued` forever.
    expect(run?.started_at).toBeInstanceOf(Date);
    expect(run?.finished_at).toBeInstanceOf(Date);
    expect(run?.current_stage).toBeNull();
  });

  it('records what produced the run', async () => {
    const { repositories, deps, job } = await setup({
      classify: [classified('narrative'), { summary: 'A description.' }],
    });

    await handleAnalyzeDocument(job, deps);

    const config = (await repositories.runs.getById(job.runId))?.model_config;
    expect(config).toHaveProperty('stages');
    expect(config).toHaveProperty('prompts');
  });

  it('leaves a trail of events a client can follow', async () => {
    const { repositories, deps, job } = await setup({
      classify: [classified('narrative'), { summary: 'A description.' }],
    });

    await handleAnalyzeDocument(job, deps);

    const events = await repositories.runs.listEventsSince(job.runId, -1);
    expect(events.map((e) => e.type)).toContain('stage_started');
    expect(events.map((e) => e.stage)).toContain('segment');
    expect(events.map((e) => e.sequence)).toEqual([...events.keys()]);
  });

  it('does nothing when the job is redelivered after the run finished', async () => {
    const { repositories, models, deps, job } = await setup({
      classify: [classified('narrative'), { summary: 'A description.' }],
    });

    await handleAnalyzeDocument(job, deps);
    const callsAfterFirst = models.calls.length;
    const eventsAfterFirst = (await repositories.runs.listEventsSince(job.runId, -1)).length;

    // pg-boss can redeliver a job whose run already completed. Repeating it
    // would spend money and duplicate the events a client is watching.
    const second = await handleAnalyzeDocument(job, deps);

    expect(second.status).toBe('not_an_argument');
    expect(models.calls).toHaveLength(callsAfterFirst);
    expect(await repositories.runs.listEventsSince(job.runId, -1)).toHaveLength(eventsAfterFirst);
  });

  it('fails the run with a safe message when something unexpected goes wrong', async () => {
    const { repositories, deps, job } = await setup({
      classify: [new Error('the provider is unreachable')],
    });

    // Rethrown, so the queue records the job as failed and can redeliver it;
    // the checkpoint means a redelivery resumes rather than starting over.
    await expect(handleAnalyzeDocument(job, deps)).rejects.toThrow(/unreachable/);

    const run = await repositories.runs.getById(job.runId);
    expect(run?.status).toBe('failed');
    expect(run?.error).toBe(UNEXPECTED_FAILURE_MESSAGE);
    // The provider's message is for the log, not for the user.
    expect(run?.error).not.toMatch(/unreachable/);
    expect(run?.finished_at).toBeInstanceOf(Date);

    const events = await repositories.runs.listEventsSince(job.runId, -1);
    expect(events.at(-1)?.type).toBe('run_failed');
  });

  it('refuses a job naming a run that does not exist', async () => {
    const { deps, job } = await setup();
    const missing: AnalyzeDocumentJob = { ...job, runId: newId<RunId>() };

    await expect(handleAnalyzeDocument(missing, deps)).rejects.toThrow(/no run/);
  });
});
