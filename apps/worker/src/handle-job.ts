import type { AnalyzeDocumentJob, Repositories } from '@make-your-case/domain';
import {
  createAnalysisWorkflow,
  runAnalysis,
  type AnalysisOutcome,
  type ModelProvider,
  type WorkflowConfig,
  type WorkflowDeps,
} from '@make-your-case/pipeline';
import { DatabaseProgressReporter } from './progress-reporter.ts';
import { markRunning, markUnexpectedFailure, terminalUpdate } from './run-lifecycle.ts';
import { log } from './logger.ts';

/**
 * Runs one `analyze-document` job (AGENTS.md section 8.5).
 *
 * Separate from the pg-boss plumbing so it can be tested with in-memory
 * repositories and a fake model provider, without a queue or a database.
 */

export interface JobDeps {
  readonly repositories: Repositories;
  readonly models: ModelProvider;
  /**
   * Taken from the pipeline's own dependency shape rather than imported from
   * LangGraph: section 4 does not give the worker a LangGraph dependency, and
   * it has no need to know what a checkpointer is.
   */
  readonly checkpointer: WorkflowDeps['checkpointer'];
  readonly config: WorkflowConfig;
}

export async function handleAnalyzeDocument(
  job: AnalyzeDocumentJob,
  deps: JobDeps,
): Promise<AnalysisOutcome> {
  const { repositories, models, checkpointer, config } = deps;
  const { runId, documentId } = job;

  const run = await repositories.runs.getById(runId);
  if (run === null) throw new Error(`no run ${runId}`);

  // A finished run means this job was redelivered after the run completed.
  // `runAnalysis` would return the recorded outcome without calling a model,
  // but there is no reason to rebuild the workflow to find that out.
  if (run.status === 'completed' || run.status === 'not_an_argument') {
    log('info', 'job already finished; nothing to do', { runId, status: run.status });
    return run.status === 'completed' && run.revision_id !== null
      ? { status: 'completed', revisionId: run.revision_id }
      : { status: 'not_an_argument', summary: run.summary ?? '' };
  }

  const document = await repositories.documents.getById(documentId);
  if (document === null) throw new Error(`no document ${documentId}`);

  await markRunning(repositories.runs, runId, models);

  const workflow = createAnalysisWorkflow({
    models,
    // Bound to this run, so the workflow is compiled per job.
    reporter: new DatabaseProgressReporter(repositories.runs, runId),
    revisions: repositories.revisions,
    config,
    checkpointer,
  });

  try {
    const outcome = await runAnalysis(workflow, {
      runId,
      documentId,
      sourceText: document.source_text,
    });
    await repositories.runs.updateStatus(runId, terminalUpdate(outcome));

    log('info', 'run finished', {
      runId,
      outcome: outcome.status,
      ...(outcome.status === 'completed' ? { revisionId: outcome.revisionId } : {}),
    });
    return outcome;
  } catch (error) {
    // `runAnalysis` propagates what it did not expect (a provider outage,
    // output that never matches the schema). The user gets a safe message and
    // the detail goes to the log, never to the run row.
    log('error', 'run failed unexpectedly', {
      runId,
      error: (error as Error).message,
      name: (error as Error).name,
    });
    await new DatabaseProgressReporter(repositories.runs, runId).runFailed(
      'The analysis stopped unexpectedly.',
    );
    await markUnexpectedFailure(repositories.runs, runId);

    // Rethrown so the queue records the job as failed. The checkpoint means a
    // redelivery resumes rather than repeating paid work.
    throw error;
  }
}
