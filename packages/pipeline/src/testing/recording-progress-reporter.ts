import type { PipelineStage } from '@make-your-case/domain';
import type { ProgressData, ProgressReporter } from '../workflow/progress.ts';

export type RecordedProgress =
  | { readonly type: 'stage_started'; readonly stage: PipelineStage }
  | {
      readonly type: 'stage_progress';
      readonly stage: PipelineStage;
      readonly message: string;
      readonly data?: ProgressData;
    }
  | {
      readonly type: 'stage_completed';
      readonly stage: PipelineStage;
      readonly data?: ProgressData;
    }
  | { readonly type: 'validation_retry'; readonly attempt: number; readonly errorCount: number }
  | { readonly type: 'run_failed'; readonly message: string };

/** A `ProgressReporter` that records every call, for asserting on what a run reported. */
export class RecordingProgressReporter implements ProgressReporter {
  readonly events: RecordedProgress[] = [];

  stageStarted(stage: PipelineStage): Promise<void> {
    this.events.push({ type: 'stage_started', stage });
    return Promise.resolve();
  }

  stageProgress(stage: PipelineStage, message: string, data?: ProgressData): Promise<void> {
    this.events.push({
      type: 'stage_progress',
      stage,
      message,
      ...(data === undefined ? {} : { data }),
    });
    return Promise.resolve();
  }

  stageCompleted(stage: PipelineStage, data?: ProgressData): Promise<void> {
    this.events.push({ type: 'stage_completed', stage, ...(data === undefined ? {} : { data }) });
    return Promise.resolve();
  }

  validationRetry(attempt: number, errorCount: number): Promise<void> {
    this.events.push({ type: 'validation_retry', attempt, errorCount });
    return Promise.resolve();
  }

  runFailed(message: string): Promise<void> {
    this.events.push({ type: 'run_failed', message });
    return Promise.resolve();
  }

  /** The stages completed, in order. */
  completedStages(): PipelineStage[] {
    return this.events.flatMap((event) => (event.type === 'stage_completed' ? [event.stage] : []));
  }
}
