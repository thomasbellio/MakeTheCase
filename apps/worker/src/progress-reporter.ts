import type {
  AnalysisRunRepository,
  PipelineStage,
  RunEventType,
  RunId,
} from '@make-your-case/domain';
import type { ProgressData, ProgressReporter } from '@make-your-case/pipeline';

/**
 * Progress feedback, persisted (AGENTS.md section 8.4).
 *
 * Each pipeline event becomes a `RunEvent` row, which the API's SSE stream
 * replays to the browser. `appendEvent` assigns the monotonic sequence per run
 * in SQL, so the stream can resume from `Last-Event-ID` without this having to
 * track position.
 *
 * Bound to one run, because the workflow is compiled per run.
 *
 * **Payloads are numbers only.** `ProgressData` enforces that at the type
 * level, and the reason is that these rows are shown to users: no document
 * text, no prompt, no model output, no stack trace (section 8.4). The one
 * free-text field is the message, which the pipeline writes itself and which
 * never interpolates model output.
 */
export class DatabaseProgressReporter implements ProgressReporter {
  private readonly runs: AnalysisRunRepository;
  private readonly runId: RunId;

  constructor(runs: AnalysisRunRepository, runId: RunId) {
    this.runs = runs;
    this.runId = runId;
  }

  async stageStarted(stage: PipelineStage): Promise<void> {
    // `current_stage` is what a reconnecting client reads before the first
    // event arrives, so it moves with the stage rather than after it.
    await this.runs.updateStatus(this.runId, { current_stage: stage });
    await this.append('stage_started', stage, null);
  }

  async stageProgress(stage: PipelineStage, message: string, data?: ProgressData): Promise<void> {
    await this.append('stage_progress', stage, { message, ...(data ?? {}) });
  }

  async stageCompleted(stage: PipelineStage, data?: ProgressData): Promise<void> {
    await this.append('stage_completed', stage, data === undefined ? null : { ...data });
  }

  async validationRetry(attempt: number, errorCount: number): Promise<void> {
    // Counts only: the errors themselves name local IDs and quote claim text.
    await this.append('validation_retry', 'validate', { attempt, errorCount });
  }

  async runFailed(message: string): Promise<void> {
    // The pipeline's failure messages are written to be user-safe.
    await this.append('run_failed', null, { message });
  }

  private async append(
    type: RunEventType,
    stage: PipelineStage | null,
    payload: Record<string, unknown> | null,
  ): Promise<void> {
    await this.runs.appendEvent({ run_id: this.runId, stage, type, payload });
  }
}
