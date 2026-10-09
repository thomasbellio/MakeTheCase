import type { PipelineStage, RevisionId, RunId } from '@make-your-case/domain';
import {
  PROMPT_VERSIONS,
  createAnalysisWorkflow,
  runAnalysis,
  type AnalysisOutcome,
} from '@make-your-case/pipeline';
import {
  allHardChecksPassed,
  scoreHardChecks,
  type FixtureCase,
  type KeyResult,
} from '@make-your-case/answer-keys';
import type { Harness } from './compose.ts';
import { ConsoleProgressReporter } from './progress.ts';
import { checkPersistenceRoundTrip, observeRun, type FinalState } from './subject.ts';
import { renderGraph } from './render.ts';
import { gradeSoftExpectations, type SoftGrade } from './judge/judge.ts';
import { judgePrompt } from './judge/judge.v1.ts';

/**
 * One fixture, end to end. Total by construction: nothing escapes, because
 * `runAnalysis` propagates unexpected failures by contract and losing the other
 * thirteen fixtures to one provider hiccup would be this harness's worst
 * failure mode.
 */

export interface FixtureCounts {
  readonly spans: number;
  readonly spansLabelledArgumentative: number;
  readonly spansConfidentlyArgumentative: number;
  readonly claims: number;
  readonly inferredClaims: number;
  readonly claimsNotAsserted: number;
  readonly occurrences: number;
  readonly inferences: number;
  readonly relations: number;
  readonly findings: number;
}

export interface FixtureResult {
  readonly id: string;
  readonly purpose: string;
  readonly durationMs: number;
  readonly expectedStatus: 'completed' | 'not_an_argument';
  readonly actualStatus: 'completed' | 'not_an_argument' | 'failed' | 'errored';
  readonly statusMatched: boolean;
  readonly hard: readonly KeyResult[];
  readonly soft: readonly SoftGrade[];
  readonly counts: FixtureCounts | null;
  readonly findingsByKind: Readonly<Record<string, number>>;
  readonly retries: number;
  readonly stageDurationsMs: Readonly<Record<string, number>>;
  readonly runId: RunId | null;
  readonly revisionId: RevisionId | null;
  readonly summary: string | null;
  readonly persistence: KeyResult | null;
  /** The exact text the judge saw, so a soft failure is debuggable. */
  readonly rendering: string | null;
  readonly error: {
    readonly name: string;
    readonly message: string;
    readonly stage: PipelineStage | null;
  } | null;
  /** True when the status matched and nothing failed unexplained. */
  readonly passed: boolean;
}

export interface RunFixtureOptions {
  readonly judge: boolean;
}

export async function runFixture(
  fixture: FixtureCase,
  harness: Harness,
  options: RunFixtureOptions,
): Promise<FixtureResult> {
  const startedAt = Date.now();
  const reporter = new ConsoleProgressReporter(fixture.stem);
  const { env, repositories, models } = harness;

  let runId: RunId | null = null;

  const errored = (error: unknown): FixtureResult => ({
    id: fixture.stem,
    purpose: fixture.key.purpose,
    durationMs: Date.now() - startedAt,
    expectedStatus: fixture.key.expected_status,
    actualStatus: 'errored',
    statusMatched: false,
    hard: [],
    soft: [],
    counts: null,
    findingsByKind: {},
    retries: reporter.retries,
    stageDurationsMs: Object.fromEntries(reporter.durations),
    runId,
    revisionId: null,
    summary: null,
    persistence: null,
    rendering: null,
    error: {
      name: (error as Error).name,
      // Truncated: a driver error echoes its parameters, which for this harness
      // means the whole document (AGENTS.md section 11).
      message: truncate((error as Error).message, 500),
      stage: reporter.lastStage,
    },
    passed: false,
  });

  try {
    // What `POST /api/documents` would reject rather than truncate (section 8.2).
    if (fixture.sourceText.length > env.MAX_DOCUMENT_CHARS) {
      throw new Error(
        `the fixture is ${String(fixture.sourceText.length)} characters, over MAX_DOCUMENT_CHARS (${String(env.MAX_DOCUMENT_CHARS)})`,
      );
    }

    const document = await repositories.documents.create({
      source_text: fixture.sourceText,
      title: fixture.stem,
      role: 'other',
    });
    const run = await repositories.runs.create({ document_id: document.id, status: 'queued' });
    runId = run.id;

    // Mirrors what the worker will record, so `model_config` is real rather
    // than a report-only artifact.
    await repositories.runs.updateStatus(run.id, {
      status: 'running',
      started_at: new Date(),
      model_config: {
        stages: models.describe(),
        prompts: { ...PROMPT_VERSIONS, judge: `${judgePrompt.id}@${String(judgePrompt.version)}` },
      },
    });

    const workflow = createAnalysisWorkflow({
      models,
      reporter,
      revisions: repositories.revisions,
      config: {
        maxValidationRetries: env.PIPELINE_MAX_VALIDATION_RETRIES,
        gateMinArgumentativeSpans: env.GATE_MIN_ARGUMENTATIVE_SPANS,
      },
      checkpointer: harness.newCheckpointer(),
    });

    const outcome: AnalysisOutcome = await runAnalysis(workflow, {
      runId: run.id,
      documentId: document.id,
      sourceText: fixture.sourceText,
    });

    const snapshot = await workflow.getState({ configurable: { thread_id: run.id } });
    const state = snapshot.values as FinalState;
    const observed = observeRun(outcome, state);

    await repositories.runs.updateStatus(run.id, terminalUpdate(outcome));

    const hard = [...scoreHardChecks(fixture.key, observed.scoreInput)];

    // Checked directly rather than by scoring the saved graph, which comes back
    // in UUID order and would make every report non-reproducible.
    let persistence: KeyResult | null = null;
    if (outcome.status === 'completed' && state.draft !== null) {
      const saved = await repositories.revisions.getArgumentGraph(outcome.revisionId);
      const result = checkPersistenceRoundTrip(state.draft, state.findings, saved);
      persistence = result.ok
        ? { key: 'persistence_roundtrip', status: 'pass' }
        : { key: 'persistence_roundtrip', status: 'fail', reason: result.reason };
    }

    const rendering =
      observed.graph === null
        ? outcome.status === 'not_an_argument'
          ? `The tool produced no argument graph: it ended the run as not an argument, with this summary:\n${outcome.summary}`
          : null
        : renderGraph(observed.graph, observed.findings);

    const soft =
      options.judge && rendering !== null
        ? await gradeSoftExpectations(
            { key: fixture.key, document: fixture.sourceText, produced: rendering },
            models,
          )
        : [];

    const statusMatched = outcome.status === fixture.key.expected_status;
    const hardAndPersistence = persistence === null ? hard : [...hard, persistence];

    return {
      id: fixture.stem,
      purpose: fixture.key.purpose,
      durationMs: Date.now() - startedAt,
      expectedStatus: fixture.key.expected_status,
      actualStatus: outcome.status,
      statusMatched,
      hard: hardAndPersistence,
      soft,
      counts: countsOf(observed, state),
      findingsByKind: tally(observed.findings.map((f) => f.kind)),
      retries: reporter.retries,
      stageDurationsMs: Object.fromEntries(reporter.durations),
      runId: run.id,
      revisionId: outcome.status === 'completed' ? outcome.revisionId : null,
      summary: outcome.status === 'not_an_argument' ? outcome.summary : null,
      persistence,
      rendering,
      error: null,
      passed: statusMatched && allHardChecksPassed(hardAndPersistence),
    };
  } catch (error) {
    if (runId !== null) {
      // Keep the database honest about what happened, best effort.
      await repositories.runs
        .updateStatus(runId, {
          status: 'failed',
          error: 'The analysis could not be completed.',
          finished_at: new Date(),
        })
        .catch(() => undefined);
    }
    return errored(error);
  }
}

function terminalUpdate(outcome: AnalysisOutcome) {
  const finished_at = new Date();
  if (outcome.status === 'completed') {
    return { status: 'completed' as const, revision_id: outcome.revisionId, finished_at };
  }
  if (outcome.status === 'not_an_argument') {
    return { status: 'not_an_argument' as const, summary: outcome.summary, finished_at };
  }
  return { status: 'failed' as const, error: outcome.message, finished_at };
}

function countsOf(observed: ReturnType<typeof observeRun>, state: FinalState): FixtureCounts {
  const graph = observed.graph;
  return {
    spans: state.spans.length,
    spansLabelledArgumentative: observed.spansLabelledArgumentative,
    spansConfidentlyArgumentative: observed.spansConfidentlyArgumentative,
    claims: graph?.claims.length ?? 0,
    inferredClaims: graph?.claims.filter((c) => c.origin === 'inferred').length ?? 0,
    claimsNotAsserted: graph?.claims.filter((c) => c.modality !== 'asserted').length ?? 0,
    occurrences: graph?.occurrences.length ?? 0,
    inferences: graph?.inferences.length ?? 0,
    relations: graph?.relations.length ?? 0,
    findings: observed.findings.length,
  };
}

function truncate(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}… (${String(text.length)} characters)`;
}

function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
