import type { PipelineStage } from '@make-your-case/domain';

/** Numbers only: event payloads are shown to users and must never carry document text. */
export type ProgressData = Readonly<Record<string, number>>;

/**
 * Where the workflow reports progress (AGENTS.md section 8.4). The worker
 * implements it by appending `RunEvent` rows; tests record the calls.
 *
 * Messages must be safe to show users: no prompts, no model output, no stack
 * traces, no secrets.
 */
export interface ProgressReporter {
  stageStarted(stage: PipelineStage): Promise<void>;
  stageProgress(stage: PipelineStage, message: string, data?: ProgressData): Promise<void>;
  stageCompleted(stage: PipelineStage, data?: ProgressData): Promise<void>;
  validationRetry(attempt: number, errorCount: number): Promise<void>;
  runFailed(message: string): Promise<void>;
}

/** Wraps a node so it reports `stage_started` before and `stage_completed` after it runs. */
export function withStage<State, Update>(
  reporter: ProgressReporter,
  stage: PipelineStage,
  node: (state: State) => Promise<{ update: Update; data?: ProgressData }>,
): (state: State) => Promise<Update> {
  return async (state) => {
    await reporter.stageStarted(stage);
    const { update, data } = await node(state);
    await reporter.stageCompleted(stage, data);
    return update;
  };
}
