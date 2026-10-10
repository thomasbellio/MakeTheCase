import { makeAutoObservable, observableRef, runInAction } from 'mobx';
import type { AnalysisRun, RunEvent, RunStatus } from '@make-your-case/domain';
import type { ApiClient, Unsubscribe } from '../api/api-client.ts';
import { applyEvent, emptyTimeline, type Timeline } from '../model/stage-timeline.ts';

/** How a run ended, with what the user should be told. */
export type RunOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'not_an_argument'; readonly summary: string; readonly run: AnalysisRun }
  | { readonly status: 'failed'; readonly message: string; readonly run: AnalysisRun | null };

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

const GENERIC_FAILURE = 'The analysis stopped before it finished.';

/**
 * Live progress for one run (AGENTS.md section 8.4), driven by its SSE stream.
 *
 * Always subscribes from the first event, so opening the page mid-run — or
 * after it ended — rebuilds the whole timeline rather than only what happens
 * from now on.
 */
export class RunProgressViewModel {
  timeline: Timeline = emptyTimeline();
  connection: ConnectionState = 'connecting';
  outcome: RunOutcome | null = null;

  private readonly api: ApiClient;
  private readonly run: AnalysisRun;
  private readonly onFinished: (outcome: RunOutcome) => void;
  private unsubscribe: Unsubscribe | null = null;

  constructor(api: ApiClient, run: AnalysisRun, onFinished: (outcome: RunOutcome) => void = noop) {
    this.api = api;
    this.run = run;
    this.onFinished = onFinished;
    makeAutoObservable<this, 'api' | 'run' | 'onFinished' | 'unsubscribe'>(
      this,
      { api: false, run: false, onFinished: false, unsubscribe: false, timeline: observableRef },
      { autoBind: true },
    );
  }

  get isQueued(): boolean {
    return this.timeline.lastSequence === -1 && this.outcome === null;
  }

  start(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.api.subscribeRunEvents(this.run.id, -1, {
      onEvent: (event) => {
        this.receive(event);
      },
      onEnd: ({ status }) => {
        void this.finish(status);
      },
      onConnection: (state) => {
        this.setConnection(state);
      },
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.connection !== 'closed') this.connection = 'closed';
  }

  receive(event: RunEvent): void {
    this.timeline = applyEvent(this.timeline, event);
  }

  setConnection(state: 'open' | 'reconnecting'): void {
    this.connection = state;
  }

  /** The stream says the run is over; fetch it for the summary or error to show. */
  private async finish(status: RunStatus): Promise<void> {
    this.connection = 'closed';
    this.unsubscribe = null;
    const result = await this.api.getRun(this.run.id);
    const run = result.ok ? result.value : null;
    const outcome = toOutcome(status, run, this.timeline.failure);
    runInAction(() => {
      this.outcome = outcome;
    });
    this.onFinished(outcome);
  }
}

export function toOutcome(
  status: RunStatus,
  run: AnalysisRun | null,
  streamedFailure: string | null,
): RunOutcome {
  // The document page re-fetches what it needs on completion, so a failed
  // status fetch does not turn a finished run into a failure.
  if (status === 'completed') return { status: 'completed' };
  if (status === 'not_an_argument' && run !== null) {
    return {
      status: 'not_an_argument',
      summary: run.summary ?? 'The text does not appear to make an argument.',
      run,
    };
  }
  return { status: 'failed', message: run?.error ?? streamedFailure ?? GENERIC_FAILURE, run };
}

function noop(): void {
  // No listener.
}
