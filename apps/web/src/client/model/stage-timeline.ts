import { pipelineStageSchema, type PipelineStage, type RunEvent } from '@make-your-case/domain';

/**
 * Reduces a run's progress events (AGENTS.md section 8.4) to what the stage
 * timeline shows. Pure, so the ViewModel only stores events and the derivation
 * is tested without MobX.
 */

export type StageState = 'pending' | 'active' | 'done' | 'failed';

export interface StageView {
  readonly stage: PipelineStage;
  readonly label: string;
  readonly state: StageState;
  /** The latest progress message, e.g. "Classified 40 of 120 spans". */
  readonly message: string | null;
  /** What the stage produced, once done, e.g. "12 claims, 9 inferences, 2 relations". */
  readonly detail: string | null;
  /** How many times the stage has started; above 1 only for the retry loop. */
  readonly attempts: number;
}

export interface RetryNotice {
  readonly attempt: number;
  readonly errorCount: number;
}

export interface Timeline {
  readonly stages: readonly StageView[];
  readonly retries: readonly RetryNotice[];
  /** The user-safe message from `run_failed`, if the run failed. */
  readonly failure: string | null;
  /** The sequence of the newest event folded in, or -1. */
  readonly lastSequence: number;
}

export const STAGES: readonly PipelineStage[] = pipelineStageSchema.options;

const LABELS: Record<PipelineStage, string> = {
  segment: 'Split into sentences',
  classify: 'Identify argumentative passages',
  extract: 'Extract claims and reasoning',
  reconstruct: 'Reconstruct the argument',
  validate: 'Check the structure',
  analyze: 'Analyze the reasoning',
  persist: 'Save the analysis',
};

/** Nouns for the counts in each stage's `stage_completed` payload. */
const COUNTS: Record<PipelineStage, readonly (readonly [key: string, noun: string])[]> = {
  segment: [['spans', 'sentence']],
  classify: [['argumentative', 'argumentative sentence']],
  extract: [
    ['claims', 'claim'],
    ['inferences', 'inference'],
    ['relations', 'relation'],
  ],
  reconstruct: [],
  validate: [
    ['errors', 'problem'],
    ['warnings', 'warning'],
  ],
  analyze: [['findings', 'finding']],
  persist: [],
};

export function emptyTimeline(): Timeline {
  return {
    stages: STAGES.map((stage) => ({
      stage,
      label: LABELS[stage],
      state: 'pending',
      message: null,
      detail: null,
      attempts: 0,
    })),
    retries: [],
    failure: null,
    lastSequence: -1,
  };
}

export function stageTimeline(events: readonly RunEvent[]): Timeline {
  return [...events].sort((a, b) => a.sequence - b.sequence).reduce(applyEvent, emptyTimeline());
}

export function applyEvent(timeline: Timeline, event: RunEvent): Timeline {
  if (event.sequence <= timeline.lastSequence) return timeline;
  const next = { ...timeline, lastSequence: event.sequence };
  const { stage } = event;

  switch (event.type) {
    case 'stage_started': {
      if (stage === null) return next;
      const index = STAGES.indexOf(stage);
      return {
        ...next,
        stages: timeline.stages.map((view, i) => {
          if (view.stage === stage) {
            return { ...view, state: 'active', message: null, attempts: view.attempts + 1 };
          }
          // Re-entering an earlier stage (the reconstruct → validate retry
          // loop) makes the stages after it pending again.
          return i > index && view.state === 'done' ? { ...view, state: 'pending' } : view;
        }),
      };
    }
    case 'stage_progress':
      if (stage === null) return next;
      return update(next, stage, { message: stringField(event.payload, 'message') });
    case 'stage_completed':
      if (stage === null) return next;
      return update(next, stage, { state: 'done', detail: describeCounts(stage, event.payload) });
    case 'validation_retry':
      return {
        ...next,
        retries: [
          ...timeline.retries,
          {
            attempt: numberField(event.payload, 'attempt') ?? timeline.retries.length + 1,
            errorCount: numberField(event.payload, 'errorCount') ?? 0,
          },
        ],
      };
    case 'run_failed':
      return {
        ...markFailed(next),
        failure: stringField(event.payload, 'message') ?? 'The analysis stopped.',
      };
  }
}

/**
 * The stage a failure belongs to: the one running, or — when the run failed
 * between stages, as it does once validation retries are exhausted — the one
 * that ran last.
 */
function markFailed(timeline: Timeline): Timeline {
  const active = timeline.stages.findIndex((view) => view.state === 'active');
  const index = active !== -1 ? active : timeline.stages.findLastIndex((view) => view.attempts > 0);
  if (index === -1) return timeline;
  return {
    ...timeline,
    stages: timeline.stages.map((view, i) => (i === index ? { ...view, state: 'failed' } : view)),
  };
}

function update(timeline: Timeline, stage: PipelineStage, patch: Partial<StageView>): Timeline {
  return {
    ...timeline,
    stages: timeline.stages.map((view) => (view.stage === stage ? { ...view, ...patch } : view)),
  };
}

function describeCounts(stage: PipelineStage, payload: RunEvent['payload']): string | null {
  const parts = COUNTS[stage].flatMap(([key, noun]) => {
    const count = numberField(payload, key);
    return count === null ? [] : [`${String(count)} ${count === 1 ? noun : `${noun}s`}`];
  });
  return parts.length === 0 ? null : parts.join(', ');
}

function stringField(payload: RunEvent['payload'], key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' ? value : null;
}

function numberField(payload: RunEvent['payload'], key: string): number | null {
  const value = payload?.[key];
  return typeof value === 'number' ? value : null;
}
