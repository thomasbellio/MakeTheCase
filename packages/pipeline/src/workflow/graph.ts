import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { END, START, StateGraph } from '@langchain/langgraph';
import { analyzeArgumentGraph, validateArgumentGraph } from '@make-your-case/analysis';
import { toView, type RevisionRepository } from '@make-your-case/domain';
import type { ModelProvider } from '../llm/model-provider.ts';
import { reconstructResponseToDraft } from '../schemas/to-draft.ts';
import { classifySpans } from '../stages/classify.ts';
import { extractArgument } from '../stages/extract.ts';
import { retryFeedback } from '../stages/feedback.ts';
import { countArgumentative, passesGate } from '../stages/gate.ts';
import { checkPreservation } from '../stages/preservation.ts';
import { reconstructArgument } from '../stages/reconstruct.ts';
import { segmentDocument } from '../stages/segment.ts';
import { summarizeNonArgument } from '../stages/summarize.ts';
import { withStage, type ProgressReporter } from './progress.ts';
import { AnalysisState, type AnalysisStateUpdate, type AnalysisStateValue } from './state.ts';

export interface WorkflowConfig {
  /** Reconstruct retries after the first attempt (`PIPELINE_MAX_VALIDATION_RETRIES`). */
  readonly maxValidationRetries: number;
  /** `GATE_MIN_ARGUMENTATIVE_SPANS`. */
  readonly gateMinArgumentativeSpans: number;
}

export interface WorkflowDeps {
  readonly models: ModelProvider;
  /** Bound to one run; the workflow is compiled per run. */
  readonly reporter: ProgressReporter;
  readonly revisions: Pick<RevisionRepository, 'saveAnalysisResult'>;
  readonly config: WorkflowConfig;
  /** Postgres in the worker, so a crashed run can resume; `MemorySaver` in tests. */
  readonly checkpointer: BaseCheckpointSaver;
}

type Node = (state: AnalysisStateValue) => Promise<AnalysisStateUpdate>;

/**
 * The analysis workflow (AGENTS.md section 8.2):
 *
 *   segment → classify → [gate] → extract → reconstruct → validate ─┬→ analyze → persist → END
 *                          │                     ▲                   │
 *                          └→ not_an_argument    └── (errors, ≤N) ───┘
 *                                                     └ (still failing) → fail
 *
 * Each node is a thin adapter over a stage function in `../stages`, which is
 * where the logic and its unit tests live.
 */
export function createAnalysisWorkflow(deps: WorkflowDeps) {
  const { models, reporter, revisions, config } = deps;

  const segment: Node = withStage(reporter, 'segment', (state) => {
    const spans = segmentDocument(state.sourceText);
    return Promise.resolve({ update: { spans }, data: { spans: spans.length } });
  });

  const classify: Node = withStage(reporter, 'classify', async (state) => {
    const spans = await classifySpans(state.spans, models.getChatModel('classify'), {
      onProgress: (done, total) =>
        reporter.stageProgress('classify', `Classified ${String(done)} of ${String(total)} spans`, {
          classified: done,
          total,
        }),
    });
    return { update: { spans }, data: { argumentative: countArgumentative(spans) } };
  });

  // Part of the gate, so it reports under the classify stage rather than a stage of its own.
  const notAnArgument: Node = async (state) => {
    await reporter.stageProgress(
      'classify',
      'Too little argumentation was found to map an argument',
    );
    const summary = await summarizeNonArgument(state.spans, models.getChatModel('classify'));
    return { outcome: 'not_an_argument', summary };
  };

  const extract: Node = withStage(reporter, 'extract', async (state) => {
    const extracted = await extractArgument(state.spans, models.getChatModel('extract'));
    return {
      update: { extracted },
      data: {
        claims: extracted.claims.length,
        inferences: extracted.inferences.length,
        relations: extracted.relations.length,
      },
    };
  });

  const reconstruct: Node = withStage(reporter, 'reconstruct', async (state) => {
    const extracted = required(state.extracted, 'extracted');
    const retry =
      state.errors.length > 0 && state.reconstruction !== null
        ? { previous: state.reconstruction, errors: state.errors }
        : null;
    const reconstruction = await reconstructArgument(
      { spans: state.spans, extracted, retry },
      models.getChatModel('reconstruct'),
    );
    return {
      update: { reconstruction, attempts: state.attempts + 1 },
      data: { attempt: state.attempts + 1 },
    };
  });

  const validate: Node = withStage(reporter, 'validate', async (state) => {
    const reconstruction = required(state.reconstruction, 'reconstruction');
    const { draft, issues } = reconstructResponseToDraft(reconstruction);
    const validation = validateArgumentGraph(
      draft,
      state.spans.map(({ span }) => span.id),
    );
    const problems = [
      ...issues,
      ...(validation.ok ? [] : validation.errors),
      ...checkPreservation(required(state.extracted, 'extracted'), draft),
    ];
    const errors = retryFeedback(problems);

    if (errors.length > 0 && canRetry(state.attempts)) {
      await reporter.validationRetry(state.attempts, errors.length);
    }
    return {
      update: { draft, errors },
      data: { errors: errors.length, warnings: validation.warnings.length },
    };
  });

  const analyze: Node = withStage(reporter, 'analyze', (state) => {
    const findings = [...analyzeArgumentGraph(toView(required(state.draft, 'draft')))];
    return Promise.resolve({ update: { findings }, data: { findings: findings.length } });
  });

  const persist: Node = withStage(reporter, 'persist', async (state) => {
    const revisionId = await revisions.saveAnalysisResult({
      documentId: state.documentId,
      runId: state.runId,
      spans: state.spans.map(({ span }) => span),
      draft: required(state.draft, 'draft'),
      findings: state.findings,
    });
    return { update: { revisionId, outcome: 'completed' } };
  });

  const fail: Node = async (state) => {
    const failureMessage = `The argument could not be reconstructed into a valid structure after ${String(state.attempts)} attempts.`;
    await reporter.runFailed(failureMessage);
    return { outcome: 'failed', failureMessage };
  };

  // Attempts allowed: the first plus `maxValidationRetries` retries.
  const canRetry = (attempts: number) => attempts <= config.maxValidationRetries;

  return new StateGraph(AnalysisState)
    .addNode('segment', segment)
    .addNode('classify', classify)
    .addNode('not_an_argument', notAnArgument)
    .addNode('extract', extract)
    .addNode('reconstruct', reconstruct)
    .addNode('validate', validate)
    .addNode('analyze', analyze)
    .addNode('persist', persist)
    .addNode('fail', fail)
    .addEdge(START, 'segment')
    .addEdge('segment', 'classify')
    .addConditionalEdges(
      'classify',
      (state) =>
        passesGate(state.spans, config.gateMinArgumentativeSpans) ? 'extract' : 'not_an_argument',
      ['extract', 'not_an_argument'],
    )
    .addEdge('not_an_argument', END)
    .addEdge('extract', 'reconstruct')
    .addEdge('reconstruct', 'validate')
    .addConditionalEdges(
      'validate',
      (state) => {
        if (state.errors.length === 0) return 'analyze';
        return canRetry(state.attempts) ? 'reconstruct' : 'fail';
      },
      ['analyze', 'reconstruct', 'fail'],
    )
    .addEdge('analyze', 'persist')
    .addEdge('persist', END)
    .addEdge('fail', END)
    .compile({ checkpointer: deps.checkpointer });
}

export type AnalysisWorkflow = ReturnType<typeof createAnalysisWorkflow>;

function required<T>(value: T | null, name: string): T {
  // Unreachable through the graph's edges; a loud failure beats a silent null.
  if (value === null) throw new Error(`workflow state is missing ${name}`);
  return value;
}
