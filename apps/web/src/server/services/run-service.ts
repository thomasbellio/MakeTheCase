import {
  runIdSchema,
  type AnalysisRun,
  type AnalysisRunRepository,
  type RunEvent,
  type RunId,
  type RunStatus,
} from '@make-your-case/domain';
import { fail, ok, type ServiceResult } from './result.ts';

export interface RunServiceDeps {
  readonly runs: AnalysisRunRepository;
}

/** Statuses after which a run emits no further events. */
export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'completed',
  'not_an_argument',
  'failed',
]);

export async function getRun(
  deps: RunServiceDeps,
  rawId: string,
): Promise<ServiceResult<AnalysisRun>> {
  const id = parseRunId(rawId);
  const run = id === null ? null : await deps.runs.getById(id);
  return run === null ? runNotFound() : ok(run);
}

export type RunStreamItem =
  | { readonly kind: 'event'; readonly event: RunEvent }
  | { readonly kind: 'end'; readonly status: RunStatus };

export interface StreamOptions {
  readonly signal: AbortSignal;
  /** §8.6 allows polling the events table; ≈500 ms. */
  readonly pollMs?: number;
  /** Injected so tests do not wait in real time. */
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Opens a run's event stream, or reports that the run does not exist.
 *
 * Checked up front so a bad id gets a 404 rather than an empty stream.
 */
export async function openRunEventStream(
  deps: RunServiceDeps,
  rawId: string,
  afterSequence: number,
  options: StreamOptions,
): Promise<ServiceResult<AsyncGenerator<RunStreamItem, void>>> {
  const id = parseRunId(rawId);
  const run = id === null ? null : await deps.runs.getById(id);
  if (id === null || run === null) return runNotFound();
  return ok(streamRunEvents(deps, id, afterSequence, options));
}

/**
 * Yields a run's events after `afterSequence`, then one `end` once the run is
 * terminal.
 *
 * Each poll reads the run's status *before* its events. The worker writes a
 * run's events before marking it terminal, so a status read as terminal means
 * every event already exists and the poll that follows drains them all: the
 * stream cannot end with an event still unsent.
 */
export async function* streamRunEvents(
  deps: RunServiceDeps,
  runId: RunId,
  afterSequence: number,
  options: StreamOptions,
): AsyncGenerator<RunStreamItem, void> {
  const { signal, pollMs = 500, sleep = abortableSleep } = options;
  let after = afterSequence;

  while (!signal.aborted) {
    const run = await deps.runs.getById(runId);
    if (run === null) return;

    // A client that disconnects mid-batch ends the generator at this `yield`
    // (the stream's `cancel` calls `return`), so no abort check is needed here.
    for (const event of await deps.runs.listEventsSince(runId, after)) {
      yield { kind: 'event', event };
      after = event.sequence;
    }

    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      yield { kind: 'end', status: run.status };
      return;
    }

    await sleep(pollMs, signal);
  }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

function parseRunId(raw: string): RunId | null {
  const parsed = runIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function runNotFound<T>(): ServiceResult<T> {
  return fail('not_found', 'No analysis run with this id exists.');
}
