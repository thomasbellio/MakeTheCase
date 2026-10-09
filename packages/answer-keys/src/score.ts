import type {
  AnalysisFinding,
  ArgumentGraphView,
  FindingKind,
  Severity,
  SpanFunction,
} from '@make-your-case/domain';
import type { AnswerKey, HardExpectations, Range } from './schema.ts';

/**
 * The deterministic half of scoring (AGENTS.md section 8.7): every `hard` key
 * produces a pass or a fail with a readable reason. The `soft` keys are the
 * judge's job.
 *
 * Pure, and generic over the ID type, because it has two callers with different
 * ones: `tools/eval` scores the persisted `ArgumentGraph` (UUIDs), while
 * `packages/analysis`'s answer-key test scores a hand-built graph (local IDs).
 */

/**
 * The minimum a span must expose to score the discourse-function keys.
 *
 * `confident` is supplied by the caller rather than derived here: the
 * confidence a label needs before the system acts on it is the gate's rule
 * (`GATE_CONFIDENCE_THRESHOLD` in the pipeline), and duplicating the number
 * here would let the two drift. A span the classifier labelled but is not
 * confident about does not count toward its function — fixture 11 asks for no
 * argumentative spans, and a hedged stray label is not the system claiming the
 * text argues.
 */
export interface SpanView<Id extends string> {
  readonly id: Id;
  readonly function: SpanFunction;
  readonly confident: boolean;
}

export interface ScoreInput<Id extends string> {
  readonly outcome: 'completed' | 'not_an_argument' | 'failed';
  /** `null` when the run produced no revision. */
  readonly graph: ArgumentGraphView<Id> | null;
  readonly findings: readonly AnalysisFinding<Id>[];
  /**
   * `null` when the caller has no spans, which makes the discourse-function
   * keys `skipped`. A hand-built graph has no spans and cannot honestly
   * demonstrate a classification property (section 7.5).
   */
  readonly spans: readonly SpanView<Id>[] | null;
}

export type KeyResult =
  | { readonly key: string; readonly status: 'pass' }
  | { readonly key: string; readonly status: 'fail'; readonly reason: string }
  /** Present in the key but not checkable from what the caller supplied. */
  | { readonly key: string; readonly status: 'skipped'; readonly reason: string }
  /**
   * Failed, but the answer key explains why in `expected_failures`, so it does
   * not gate the run (AGENTS.md section 8.8). The reason carries both.
   */
  | { readonly key: string; readonly status: 'explained'; readonly reason: string };

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { info: 0, warning: 1, critical: 2 };

function describeRange(range: Range): string {
  if (range.min !== undefined && range.max !== undefined) {
    return range.min === range.max
      ? `exactly ${String(range.min)}`
      : `${String(range.min)}–${String(range.max)}`;
  }
  if (range.min !== undefined) return `at least ${String(range.min)}`;
  if (range.max !== undefined) return `at most ${String(range.max)}`;
  return 'any number';
}

function inRange(actual: number, range: Range): boolean {
  return (
    (range.min === undefined || actual >= range.min) &&
    (range.max === undefined || actual <= range.max)
  );
}

/**
 * Collects the results for one key. Written as a builder so each check reads as
 * a single statement and a key absent from the answer key is simply never
 * added — section 8.7's "every key optional; all present keys must pass".
 */
class Results {
  private readonly results: KeyResult[] = [];

  private readonly explanations: Readonly<Record<string, string>>;

  constructor(explanations: Readonly<Record<string, string>>) {
    this.explanations = explanations;
  }

  pass(key: string): void {
    this.results.push({ key, status: 'pass' });
  }

  fail(key: string, reason: string): void {
    const explanation = this.explanations[key];
    this.results.push(
      explanation === undefined
        ? { key, status: 'fail', reason }
        : { key, status: 'explained', reason: `${reason} — explained: ${explanation}` },
    );
  }

  skip(key: string, reason: string): void {
    this.results.push({ key, status: 'skipped', reason });
  }

  check(key: string, ok: boolean, reason: () => string): void {
    if (ok) this.pass(key);
    else this.fail(key, reason());
  }

  /** A count against a range, reported with the actual value either way. */
  range(key: string, label: string, actual: number, range: Range): void {
    this.check(
      key,
      inRange(actual, range),
      () => `${label} is ${String(actual)}; expected ${describeRange(range)}`,
    );
  }

  done(): readonly KeyResult[] {
    return this.results;
  }
}

export function scoreHardChecks<Id extends string>(
  key: AnswerKey,
  input: ScoreInput<Id>,
): readonly KeyResult[] {
  const hard: HardExpectations = key.hard;
  const r = new Results(key.expected_failures);
  const { graph, findings, spans } = input;

  // --- The run as a whole -------------------------------------------------

  if (hard.argument_graph !== undefined) {
    r.check(
      'argument_graph',
      graph === null,
      () => 'a revision was produced; the key expects none',
    );
  }

  // --- Findings ----------------------------------------------------------

  const byKind = new Map<FindingKind, AnalysisFinding<Id>[]>();
  for (const finding of findings) {
    const existing = byKind.get(finding.kind);
    if (existing) existing.push(finding);
    else byKind.set(finding.kind, [finding]);
  }

  for (const required of hard.findings_present ?? []) {
    const matching = byKind.get(required.kind) ?? [];
    const label = `findings_present[${required.kind}${required.severity === undefined ? '' : `/${required.severity}`}]`;

    if (matching.length === 0) {
      r.fail(label, `no ${required.kind} finding was reported`);
    } else if (
      required.severity !== undefined &&
      !matching.some((f) => f.severity === required.severity)
    ) {
      r.fail(
        label,
        `${required.kind} was reported at ${[...new Set(matching.map((f) => f.severity))].join(', ')}, not ${required.severity}`,
      );
    } else {
      r.pass(label);
    }
  }

  for (const forbidden of hard.findings_absent ?? []) {
    const count = (byKind.get(forbidden) ?? []).length;
    r.check(
      `findings_absent[${forbidden}]`,
      count === 0,
      () => `${String(count)} ${forbidden} finding(s) were reported; the key expects none`,
    );
  }

  if (hard.findings_max_severity !== undefined) {
    const ceiling = SEVERITY_ORDER[hard.findings_max_severity];
    const over = findings.filter((f) => SEVERITY_ORDER[f.severity] > ceiling);
    r.check(
      'findings_max_severity',
      over.length === 0,
      () =>
        `${[...new Set(over.map((f) => `${f.kind} (${f.severity})`))].join(', ')} exceed ${hard.findings_max_severity ?? ''}`,
    );
  }

  if (hard.unsupported_claim_count !== undefined) {
    r.range(
      'unsupported_claim_count',
      'unsupported_claim findings',
      (byKind.get('unsupported_claim') ?? []).length,
      hard.unsupported_claim_count,
    );
  }

  // --- Graph shape -------------------------------------------------------

  const graphKeys: readonly (keyof HardExpectations)[] = [
    'claim_count',
    'inference_count',
    'relations_count',
    'relations_present',
    'inferred_claims',
    'max_occurrences_for_single_claim',
    'claims_with_modality_not_asserted',
  ];

  if (graph === null) {
    // Nothing to measure. Reported rather than passed silently, so a run that
    // produced no graph when the key expected one is visible per key.
    for (const name of graphKeys) {
      if (hard[name] !== undefined)
        r.fail(name, 'no revision was produced, so there is nothing to measure');
    }
  } else {
    if (hard.claim_count !== undefined) {
      r.range('claim_count', 'claims', graph.claims.length, hard.claim_count);
    }
    if (hard.inference_count !== undefined) {
      r.range('inference_count', 'inferences', graph.inferences.length, hard.inference_count);
    }
    if (hard.relations_count !== undefined) {
      r.range('relations_count', 'relations', graph.relations.length, hard.relations_count);
    }
    if (hard.inferred_claims !== undefined) {
      r.range(
        'inferred_claims',
        'inferred claims',
        graph.claims.filter((c) => c.origin === 'inferred').length,
        hard.inferred_claims,
      );
    }
    if (hard.claims_with_modality_not_asserted !== undefined) {
      r.range(
        'claims_with_modality_not_asserted',
        'claims with a modality other than asserted',
        graph.claims.filter((c) => c.modality !== 'asserted').length,
        hard.claims_with_modality_not_asserted,
      );
    }
    if (hard.max_occurrences_for_single_claim !== undefined) {
      const counts = new Map<Id, number>();
      for (const occurrence of graph.occurrences) {
        counts.set(occurrence.claim_id, (counts.get(occurrence.claim_id) ?? 0) + 1);
      }
      r.range(
        'max_occurrences_for_single_claim',
        "the most-occurring claim's occurrence count",
        Math.max(0, ...counts.values()),
        hard.max_occurrences_for_single_claim,
      );
    }
    for (const required of hard.relations_present ?? []) {
      const present = graph.relations.some((relation) => relation.type === required);
      r.check(
        `relations_present[${required}]`,
        present,
        () => `no ${required} relation was produced`,
      );
    }
  }

  // --- Discourse function, which needs spans -----------------------------

  const spanFunctionKeys = ['spans_with_function', 'claim_occurrences_in_function'] as const;

  if (spans === null) {
    for (const name of spanFunctionKeys) {
      if (hard[name] !== undefined) {
        r.skip(name, 'the caller supplied no spans, so discourse function cannot be checked');
      }
    }
  } else {
    for (const [fn, range] of Object.entries(hard.spans_with_function ?? {})) {
      r.range(
        `spans_with_function[${fn}]`,
        `${fn} spans`,
        spans.filter((span) => span.function === fn && span.confident).length,
        range,
      );
    }

    const expected = hard.claim_occurrences_in_function ?? {};
    if (Object.keys(expected).length > 0) {
      if (graph === null) {
        for (const fn of Object.keys(expected)) {
          r.fail(
            `claim_occurrences_in_function[${fn}]`,
            'no revision was produced, so there are no occurrences to measure',
          );
        }
      } else {
        const functionOf = new Map(spans.map((span) => [span.id, span.function]));
        for (const [fn, range] of Object.entries(expected)) {
          r.range(
            `claim_occurrences_in_function[${fn}]`,
            `occurrences anchored in ${fn} spans`,
            graph.occurrences.filter((o) => functionOf.get(o.span_id) === fn).length,
            range,
          );
        }
      }
    }
  }

  return r.done();
}

/**
 * True when nothing failed outright. Neither `skipped` nor `explained` fails a
 * fixture: the first was never checked, the second is a known shortfall the
 * answer key accounts for in writing.
 */
export function allHardChecksPassed(results: readonly KeyResult[]): boolean {
  return results.every((result) => result.status !== 'fail');
}
