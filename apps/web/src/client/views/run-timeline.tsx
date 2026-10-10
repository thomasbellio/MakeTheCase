'use client';

import { observer } from 'mobx-react-lite';
import { CheckIcon, CircleIcon, LoaderCircleIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { StageState, Timeline } from '../model/stage-timeline';
import type { ConnectionState } from '../viewmodels/run-progress-view-model';

/** What the timeline reads; a `RunProgressViewModel` satisfies it. */
export interface TimelineSource {
  readonly timeline: Timeline;
  readonly connection: ConnectionState;
  readonly isQueued: boolean;
}

const STATE_TEXT: Record<StageState, string> = {
  pending: 'Not started',
  active: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

/** The stage timeline (AGENTS.md section 9.2), driven by the run's event stream. */
export const RunTimeline = observer(function RunTimeline({
  progress,
}: {
  progress: TimelineSource;
}) {
  const { timeline, connection, isQueued } = progress;

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
      <h2 id="timeline-heading" className="font-heading text-base font-semibold">
        Analysis progress
      </h2>

      {/* Announced to screen readers as stages move. */}
      <div aria-live="polite" className="text-sm text-muted-foreground">
        {isQueued && <p>Waiting for the analysis to start…</p>}
        {connection === 'reconnecting' && <p>Connection lost. Reconnecting…</p>}
      </div>

      <ol className="flex flex-col gap-2">
        {timeline.stages.map((stage) => (
          <li key={stage.stage} className="flex items-start gap-3" data-state={stage.state}>
            <StageIcon state={stage.state} />
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm',
                  stage.state === 'pending' ? 'text-muted-foreground' : 'font-medium',
                )}
              >
                {stage.label}
                <span className="sr-only">: {STATE_TEXT[stage.state]}</span>
                {stage.attempts > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    attempt {stage.attempts}
                  </span>
                )}
              </p>
              {stage.message !== null && (
                <p className="text-sm text-muted-foreground">{stage.message}</p>
              )}
              {stage.message === null && stage.detail !== null && (
                <p className="text-sm text-muted-foreground">{stage.detail}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {timeline.retries.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Retries">
          {timeline.retries.map((retry) => (
            <li key={retry.attempt} className="flex items-center gap-2 text-severity-warning">
              <RotateCcwIcon className="size-4" aria-hidden />
              The reconstruction had {retry.errorCount} structural{' '}
              {retry.errorCount === 1 ? 'problem' : 'problems'} on attempt {retry.attempt}; trying
              again.
            </li>
          ))}
        </ul>
      )}
    </section>
  );
});

function StageIcon({ state }: { state: StageState }) {
  const className = 'mt-0.5 size-4 shrink-0';
  switch (state) {
    case 'pending':
      return <CircleIcon className={cn(className, 'text-muted-foreground')} aria-hidden />;
    case 'active':
      return <LoaderCircleIcon className={cn(className, 'animate-spin')} aria-hidden />;
    case 'done':
      return <CheckIcon className={className} aria-hidden />;
    case 'failed':
      return <XIcon className={cn(className, 'text-severity-critical')} aria-hidden />;
  }
}
