import type { AnalysisRunRepository, RunId, RunStatusUpdate } from '@make-your-case/domain';
import type { AnalysisOutcome, ModelProvider } from '@make-your-case/pipeline';
import { PROMPT_VERSIONS } from '@make-your-case/pipeline';

/**
 * The run row's own story, which the workflow does not tell.
 *
 * `createAnalysisWorkflow` is given only `saveAnalysisResult`, so nothing in the
 * pipeline sets a run's status, its timestamps or its `model_config` — that is
 * the composition root's job (AGENTS.md section 8.5), and until now nobody did
 * it, so every run stayed `queued` forever.
 */

/** What produced this run, recorded so a result can be traced to it (section 8.1). */
export function modelConfig(models: ModelProvider): Record<string, unknown> {
  return {
    // `describe()` is secret-free by construction: provider and model only.
    stages: models.describe(),
    prompts: { ...PROMPT_VERSIONS },
  };
}

export async function markRunning(
  runs: AnalysisRunRepository,
  runId: RunId,
  models: ModelProvider,
): Promise<void> {
  await runs.updateStatus(runId, {
    status: 'running',
    started_at: new Date(),
    // Cleared in case this is a redelivery after a crash.
    error: null,
    model_config: modelConfig(models),
  });
}

/** Translates the workflow's outcome into the run's terminal state. */
export function terminalUpdate(outcome: AnalysisOutcome): RunStatusUpdate {
  const finished_at = new Date();

  switch (outcome.status) {
    case 'completed':
      return {
        status: 'completed',
        revision_id: outcome.revisionId,
        current_stage: null,
        finished_at,
      };
    case 'not_an_argument':
      // The summary is required when the status is `not_an_argument` (section 6),
      // and the database enforces it.
      return {
        status: 'not_an_argument',
        summary: outcome.summary,
        current_stage: null,
        finished_at,
      };
    case 'failed':
      return { status: 'failed', error: outcome.message, current_stage: null, finished_at };
    default: {
      const unhandled: never = outcome;
      throw new Error(`unhandled outcome: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The message a user sees when a run died in a way the pipeline did not expect.
 *
 * Deliberately uninformative: an unexpected error can carry a provider
 * response, a prompt or document text, none of which may reach the user or the
 * run row (section 8.4). The detail goes to the worker's log instead.
 */
export const UNEXPECTED_FAILURE_MESSAGE =
  'The analysis stopped unexpectedly. Nothing was saved; the document can be submitted again.';

export async function markUnexpectedFailure(
  runs: AnalysisRunRepository,
  runId: RunId,
): Promise<void> {
  await runs.updateStatus(runId, {
    status: 'failed',
    error: UNEXPECTED_FAILURE_MESSAGE,
    current_stage: null,
    finished_at: new Date(),
  });
}
