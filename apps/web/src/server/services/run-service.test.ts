import { describe, expect, it } from 'vitest';
import { newId, type DocumentId, type RunId } from '@make-your-case/domain';
import { InMemoryAnalysisRunRepository } from '@make-your-case/domain/testing';
import {
  abortableSleep,
  getRun,
  openRunEventStream,
  streamRunEvents,
  type RunStreamItem,
} from './run-service.ts';

async function setup() {
  const runs = new InMemoryAnalysisRunRepository();
  const run = await runs.create({ document_id: newId<DocumentId>(), status: 'running' });
  return { runs, runId: run.id };
}

async function collect(stream: AsyncGenerator<RunStreamItem, void>): Promise<RunStreamItem[]> {
  const items: RunStreamItem[] = [];
  for await (const item of stream) items.push(item);
  return items;
}

const summarize = (items: RunStreamItem[]): string[] =>
  items.map((item) =>
    item.kind === 'end'
      ? `end:${item.status}`
      : `${String(item.event.sequence)}:${item.event.type}`,
  );

describe('streamRunEvents', () => {
  it('streams every event, then ends once the run is terminal', async () => {
    const { runs, runId } = await setup();
    await runs.appendEvent({
      run_id: runId,
      stage: 'segment',
      type: 'stage_started',
      payload: null,
    });

    // Each poll the worker moves on: one more event, then the run completes.
    let polls = 0;
    const sleep = async (): Promise<void> => {
      polls += 1;
      if (polls === 1) {
        await runs.appendEvent({
          run_id: runId,
          stage: 'segment',
          type: 'stage_completed',
          payload: { spans: 3 },
        });
      } else {
        await runs.updateStatus(runId, { status: 'completed' });
      }
    };

    const items = await collect(
      streamRunEvents({ runs }, runId, -1, { signal: new AbortController().signal, sleep }),
    );

    expect(summarize(items)).toEqual(['0:stage_started', '1:stage_completed', 'end:completed']);
  });

  it('resumes after the given sequence', async () => {
    const { runs, runId } = await setup();
    for (const type of ['stage_started', 'stage_progress', 'stage_completed'] as const) {
      await runs.appendEvent({ run_id: runId, stage: 'classify', type, payload: null });
    }
    await runs.updateStatus(runId, { status: 'failed' });

    const items = await collect(
      streamRunEvents({ runs }, runId, 0, { signal: new AbortController().signal }),
    );

    expect(summarize(items)).toEqual(['1:stage_progress', '2:stage_completed', 'end:failed']);
  });

  it('drains events written before the run turned terminal', async () => {
    const { runs, runId } = await setup();
    // As the worker does: the failure event, then the terminal status.
    await runs.appendEvent({ run_id: runId, stage: null, type: 'run_failed', payload: null });
    await runs.updateStatus(runId, { status: 'failed' });

    const items = await collect(
      streamRunEvents({ runs }, runId, -1, { signal: new AbortController().signal }),
    );

    expect(summarize(items)).toEqual(['0:run_failed', 'end:failed']);
  });

  it('stops polling when the client goes away', async () => {
    const { runs, runId } = await setup();
    const controller = new AbortController();
    let polls = 0;
    const sleep = (): Promise<void> => {
      polls += 1;
      if (polls === 3) controller.abort();
      return Promise.resolve();
    };

    const items = await collect(
      streamRunEvents({ runs }, runId, -1, { signal: controller.signal, sleep }),
    );

    expect(items).toEqual([]);
    expect(polls).toBe(3);
  });
});

describe('opening a stream', () => {
  it('reports an unknown or malformed run as not found', async () => {
    const { runs } = await setup();
    const signal = new AbortController().signal;

    for (const id of ['nope', newId<RunId>()]) {
      expect(await openRunEventStream({ runs }, id, -1, { signal })).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
      expect(await getRun({ runs }, id)).toMatchObject({ ok: false });
    }
  });

  it('returns a run that exists', async () => {
    const { runs, runId } = await setup();
    expect(await getRun({ runs }, runId)).toMatchObject({ ok: true, value: { id: runId } });
  });
});

describe('abortableSleep', () => {
  it('resolves early when aborted', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleeping = abortableSleep(10_000, controller.signal);
    controller.abort();
    await sleeping;
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
