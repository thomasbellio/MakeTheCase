import {
  toView,
  type AnalysisFinding,
  type ArgumentGraphView,
  type LocalId,
} from '@make-your-case/domain';
import {
  GATE_CONFIDENCE_THRESHOLD,
  type AnalysisOutcome,
  type SegmentedSpan,
} from '@make-your-case/pipeline';
import type { ScoreInput, SpanView } from '@make-your-case/answer-keys';

/**
 * What the scorer and the judge read from a finished run.
 *
 * The subject is the **final workflow state**, not the saved revision, for
 * three reasons:
 *
 * 1. `getArgumentGraph` orders claims, inferences and findings by UUID, so a
 *    saved graph comes back in a different order every run. A report and a
 *    judge prompt that change shape between identical runs cannot be compared.
 * 2. Spans and the graph share one ID space in the state, so counting
 *    occurrences by discourse function is a plain join rather than a mapping
 *    through two sets of identifiers.
 * 3. It is the only source that exists on both outcome paths. A
 *    `not_an_argument` run persists nothing, yet fixtures 11 and 12 still
 *    constrain how its spans were classified.
 *
 * That the persist step works is checked separately and directly, by
 * `checkPersistenceRoundTrip`, rather than by routing every number through it.
 */
export interface RunObservation {
  readonly scoreInput: ScoreInput<string>;
  readonly graph: ArgumentGraphView<string> | null;
  readonly findings: readonly AnalysisFinding<string>[];
  /** Labelled argumentative, whatever the confidence. For the report. */
  readonly spansLabelledArgumentative: number;
  /** Labelled argumentative and confident enough for the gate to count it. */
  readonly spansConfidentlyArgumentative: number;
  readonly attempts: number;
}

export interface FinalState {
  readonly spans: readonly SegmentedSpan[];
  readonly draft: Parameters<typeof toView>[0] | null;
  readonly findings: readonly AnalysisFinding<LocalId>[];
  readonly attempts: number;
  /** The errors from the most recent `validate`, empty once it passed. */
  readonly errors: readonly string[];
}

export function observeRun(outcome: AnalysisOutcome, state: FinalState): RunObservation {
  const spans: SpanView<string>[] = state.spans.map(({ span }) => ({
    id: span.id,
    function: span.function,
    // The gate's rule, applied where the gate's constant lives.
    confident: (span.function_confidence ?? 0) >= GATE_CONFIDENCE_THRESHOLD,
  }));

  // A draft exists from `reconstruct` onward, including on a run that later
  // failed validation. Only a completed run is a graph the fixture produced.
  const graph: ArgumentGraphView<string> | null =
    outcome.status === 'completed' && state.draft !== null ? toView(state.draft) : null;
  const findings: readonly AnalysisFinding<string>[] =
    outcome.status === 'completed' ? state.findings : [];

  return {
    scoreInput: { outcome: outcome.status, graph, findings, spans },
    graph,
    findings,
    spansLabelledArgumentative: state.spans.filter(({ span }) => span.function === 'argumentative')
      .length,
    spansConfidentlyArgumentative: spans.filter(
      (span) => span.function === 'argumentative' && span.confident,
    ).length,
    attempts: state.attempts,
  };
}

/**
 * Confirms the saved revision holds what the run produced.
 *
 * Compares cardinalities rather than contents, because the saved graph's order
 * and identifiers legitimately differ from the draft's. The point is that
 * `saveAnalysisResult` dropped nothing — the mappers' fidelity is covered by
 * the round-trip integration test in `packages/persistence`.
 */
export function checkPersistenceRoundTrip(
  draft: NonNullable<FinalState['draft']>,
  findings: readonly AnalysisFinding<LocalId>[],
  saved: {
    readonly claims: readonly unknown[];
    readonly occurrences: readonly unknown[];
    readonly inferences: readonly unknown[];
    readonly premises: readonly unknown[];
    readonly relations: readonly unknown[];
    readonly findings: readonly unknown[];
  } | null,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (saved === null) {
    return { ok: false, reason: 'the run reported a revision, but it could not be read back' };
  }

  const expected = {
    claims: draft.claims.length,
    occurrences: draft.occurrences.length,
    inferences: draft.inferences.length,
    premises: draft.premises.length,
    relations: draft.relations.length,
    findings: findings.length,
  };

  const mismatches = Object.entries(expected).flatMap(([name, count]) => {
    const actual = saved[name as keyof typeof expected].length;
    return actual === count ? [] : [`${name}: produced ${String(count)}, saved ${String(actual)}`];
  });

  return mismatches.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `the saved revision does not match what was produced — ${mismatches.join('; ')}`,
      };
}
