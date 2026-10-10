import { describe, expect, it } from 'vitest';
import {
  newId,
  type PipelineStage,
  type RunEvent,
  type RunEventType,
  type RunId,
} from '@make-your-case/domain';
import { stageTimeline, type StageState } from './stage-timeline.ts';

const runId = newId<RunId>();

function events(
  ...specs: [type: RunEventType, stage: PipelineStage | null, payload?: Record<string, unknown>][]
): RunEvent[] {
  return specs.map(([type, stage, payload], sequence) => ({
    id: newId(),
    run_id: runId,
    sequence,
    stage,
    type,
    payload: payload ?? null,
    created_at: new Date(),
  }));
}

const states = (list: RunEvent[]): Record<string, StageState> =>
  Object.fromEntries(stageTimeline(list).stages.map((s) => [s.stage, s.state]));

describe('stageTimeline', () => {
  it('starts with every stage pending', () => {
    expect(new Set(Object.values(states([])))).toEqual(new Set(['pending']));
  });

  it('tracks the active stage, its progress message and what finished stages produced', () => {
    const timeline = stageTimeline(
      events(
        ['stage_started', 'segment'],
        ['stage_completed', 'segment', { spans: 12 }],
        ['stage_started', 'classify'],
        ['stage_progress', 'classify', { message: 'Classified 4 of 12 spans', classified: 4 }],
      ),
    );

    const [segment, classify, extract] = timeline.stages;
    expect(segment).toMatchObject({ state: 'done', detail: '12 sentences' });
    expect(classify).toMatchObject({ state: 'active', message: 'Classified 4 of 12 spans' });
    expect(extract?.state).toBe('pending');
  });

  it('describes counts with singular and plural nouns', () => {
    const timeline = stageTimeline(
      events(['stage_completed', 'extract', { claims: 1, inferences: 2, relations: 0 }]),
    );
    expect(timeline.stages[2]?.detail).toBe('1 claim, 2 inferences, 0 relations');
  });

  it('shows the retry loop: notices, attempts, and validate pending again', () => {
    const list = events(
      ['stage_started', 'reconstruct'],
      ['stage_completed', 'reconstruct', { attempt: 1 }],
      ['stage_started', 'validate'],
      ['validation_retry', 'validate', { attempt: 1, errorCount: 3 }],
      ['stage_completed', 'validate', { errors: 3, warnings: 0 }],
      ['stage_started', 'reconstruct'],
    );
    const timeline = stageTimeline(list);

    expect(timeline.retries).toEqual([{ attempt: 1, errorCount: 3 }]);
    expect(states(list)).toMatchObject({ reconstruct: 'active', validate: 'pending' });
    expect(timeline.stages.find((s) => s.stage === 'reconstruct')?.attempts).toBe(2);
  });

  it('marks the running stage failed on an unexpected failure', () => {
    const list = events(
      ['stage_started', 'extract'],
      ['run_failed', null, { message: 'The analysis stopped unexpectedly.' }],
    );

    expect(states(list).extract).toBe('failed');
    expect(stageTimeline(list).failure).toBe('The analysis stopped unexpectedly.');
  });

  it('marks the last stage failed when retries are exhausted between stages', () => {
    const list = events(
      ['stage_started', 'validate'],
      ['stage_completed', 'validate', { errors: 2 }],
      ['run_failed', null, { message: 'Could not reconstruct.' }],
    );
    expect(states(list).validate).toBe('failed');
  });

  it('keeps the gate message on the completed classify stage', () => {
    const timeline = stageTimeline(
      events(
        ['stage_started', 'classify'],
        ['stage_completed', 'classify', { argumentative: 0 }],
        ['stage_progress', 'classify', { message: 'Too little argumentation was found' }],
      ),
    );
    expect(timeline.stages[1]).toMatchObject({
      state: 'done',
      message: 'Too little argumentation was found',
    });
  });

  it('ignores events out of order and duplicates', () => {
    const list = events(['stage_started', 'segment'], ['stage_completed', 'segment']);
    const timeline = stageTimeline([...list, ...list].reverse());
    expect(timeline.stages[0]?.state).toBe('done');
    expect(timeline.lastSequence).toBe(1);
  });
});
