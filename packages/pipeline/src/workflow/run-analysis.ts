import type { DocumentId, RevisionId, RunId } from '@make-your-case/domain';
import type { AnalysisWorkflow } from './graph.ts';

export interface AnalysisInput {
  readonly runId: RunId;
  readonly documentId: DocumentId;
  readonly sourceText: string;
}

export type AnalysisOutcome =
  | { readonly status: 'completed'; readonly revisionId: RevisionId }
  | { readonly status: 'not_an_argument'; readonly summary: string }
  /** A user-safe message, for `AnalysisRun.error`. */
  | { readonly status: 'failed'; readonly message: string };

/**
 * Runs the workflow for one analysis run, resuming from its last checkpoint
 * if an earlier attempt crashed part way (AGENTS.md section 8.2). The run ID
 * is the checkpoint thread, so a re-delivered job picks up where it stopped
 * rather than repeating paid model calls; a finished run is not re-run.
 *
 * Unexpected failures (a provider outage, output that never matches the
 * schema) propagate; the caller decides what the user is told.
 */
export async function runAnalysis(
  workflow: AnalysisWorkflow,
  input: AnalysisInput,
): Promise<AnalysisOutcome> {
  const config = { configurable: { thread_id: input.runId } };
  const snapshot = await workflow.getState(config);
  const started = Object.keys(snapshot.values as object).length > 0;

  let state;
  if (!started) {
    state = await workflow.invoke(input, config);
  } else if (snapshot.next.length > 0) {
    state = await workflow.invoke(null, config);
  } else {
    state = snapshot.values as Awaited<ReturnType<AnalysisWorkflow['invoke']>>;
  }

  switch (state.outcome) {
    case 'completed':
      if (state.revisionId === null) throw new Error('a completed run has no revision');
      return { status: 'completed', revisionId: state.revisionId };
    case 'not_an_argument':
      return { status: 'not_an_argument', summary: state.summary ?? '' };
    case 'failed':
      return { status: 'failed', message: state.failureMessage ?? 'The analysis failed.' };
    case null:
      throw new Error('the workflow ended without an outcome');
  }
}
