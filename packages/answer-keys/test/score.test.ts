import { describe, expect, it } from 'vitest';
import type {
  AnalysisFinding,
  ArgumentGraphView,
  ClaimView,
  FindingKind,
  Severity,
  SpanFunction,
} from '@make-your-case/domain';
import { answerKeySchema, type AnswerKey, type HardExpectations } from '../src/schema.ts';
import {
  allHardChecksPassed,
  scoreHardChecks,
  type ScoreInput,
  type SpanView,
} from '../src/score.ts';

/**
 * Minimal builders. `packages/analysis` has a richer fixture DSL, but
 * `answer-keys` depends on `domain` alone (AGENTS.md section 4), so these stay
 * local and deliberately small.
 */
function claim(id: string, over: Partial<ClaimView<string>> = {}): ClaimView<string> {
  return {
    id,
    canonical_text: `Claim ${id}`,
    kind: 'factual',
    modality: 'asserted',
    origin: 'stated',
    attribution: 'author',
    citation: null,
    confidence: 1,
    is_thesis: false,
    ...over,
  };
}

function graphOf(over: Partial<ArgumentGraphView<string>> = {}): ArgumentGraphView<string> {
  return { claims: [], occurrences: [], inferences: [], relations: [], ...over };
}

function finding(kind: FindingKind, severity: Severity): AnalysisFinding<string> {
  return { kind, severity, explanation: 'An observation.', produced_by: 'test@1.0.0', targets: [] };
}

function span(id: string, fn: SpanFunction, confident = true): SpanView<string> {
  return { id, function: fn, confident };
}

function key(hard: HardExpectations): AnswerKey {
  return answerKeySchema.parse({
    id: '99-example',
    purpose: 'A scorer test',
    expected_status: 'completed',
    thesis: null,
    hard,
  });
}

function score(hard: HardExpectations, input: Partial<ScoreInput<string>> = {}) {
  return scoreHardChecks(key(hard), {
    outcome: 'completed',
    graph: graphOf(),
    findings: [],
    spans: [],
    ...input,
  });
}

const statuses = (results: readonly { status: string }[]) => results.map((r) => r.status);

describe('expected_failures', () => {
  it('downgrades a named failure to explained, and stops it gating the run', () => {
    const explained = answerKeySchema.parse({
      id: '99-example',
      purpose: 'A scorer test',
      expected_status: 'completed',
      thesis: null,
      hard: { claim_count: { min: 10 } },
      expected_failures: { claim_count: 'extraction does not split the appendix yet' },
    });

    const results = scoreHardChecks(explained, {
      outcome: 'completed',
      graph: graphOf({ claims: [claim('c1', { is_thesis: true })] }),
      findings: [],
      spans: [],
    });

    expect(results[0]?.status).toBe('explained');
    expect(results[0]).toHaveProperty('reason', expect.stringContaining('appendix'));
    expect(allHardChecksPassed(results)).toBe(true);
  });

  it('leaves an unexplained failure failing', () => {
    const results = score({ claim_count: { min: 10 } }, { graph: graphOf() });
    expect(results[0]?.status).toBe('fail');
    expect(allHardChecksPassed(results)).toBe(false);
  });
});

describe('a key with no hard block', () => {
  it('scores nothing at all', () => {
    expect(score({})).toEqual([]);
    expect(allHardChecksPassed(score({}))).toBe(true);
  });
});

describe('argument_graph: absent', () => {
  it('passes when no revision was produced', () => {
    const results = score(
      { argument_graph: 'absent' },
      { outcome: 'not_an_argument', graph: null },
    );
    expect(statuses(results)).toEqual(['pass']);
  });

  it('fails when a revision was produced', () => {
    const results = score({ argument_graph: 'absent' }, { graph: graphOf() });
    expect(results[0]?.status).toBe('fail');
  });
});

describe('findings_present', () => {
  it('passes on kind alone, and on kind with the right severity', () => {
    const findings = [finding('implicit_premise', 'critical')];
    expect(
      statuses(score({ findings_present: [{ kind: 'implicit_premise' }] }, { findings })),
    ).toEqual(['pass']);
    expect(
      statuses(
        score(
          { findings_present: [{ kind: 'implicit_premise', severity: 'critical' }] },
          { findings },
        ),
      ),
    ).toEqual(['pass']);
  });

  it('fails when the kind is missing, saying so', () => {
    const results = score({ findings_present: [{ kind: 'circularity' }] }, { findings: [] });
    expect(results[0]?.status).toBe('fail');
    expect(results[0]).toHaveProperty('reason', expect.stringContaining('no circularity finding'));
  });

  it('fails when the kind is present at the wrong severity, naming what was found', () => {
    const results = score(
      { findings_present: [{ kind: 'implicit_premise', severity: 'critical' }] },
      { findings: [finding('implicit_premise', 'warning')] },
    );
    expect(results[0]?.status).toBe('fail');
    expect(results[0]).toHaveProperty('reason', expect.stringContaining('warning'));
  });
});

describe('findings_absent', () => {
  it('passes when the kind was not reported', () => {
    expect(statuses(score({ findings_absent: ['invalid_step'] }))).toEqual(['pass']);
  });

  it('fails when it was', () => {
    const results = score(
      { findings_absent: ['invalid_step'] },
      { findings: [finding('invalid_step', 'critical')] },
    );
    expect(results[0]?.status).toBe('fail');
  });
});

describe('findings_max_severity', () => {
  it('passes when every finding is at or below the ceiling', () => {
    const findings = [finding('load_bearing', 'info'), finding('unchecked_step', 'info')];
    expect(statuses(score({ findings_max_severity: 'info' }, { findings }))).toEqual(['pass']);
  });

  it('fails when one exceeds it, naming the offender', () => {
    const findings = [finding('load_bearing', 'info'), finding('circularity', 'critical')];
    const results = score({ findings_max_severity: 'info' }, { findings });
    expect(results[0]?.status).toBe('fail');
    expect(results[0]).toHaveProperty('reason', expect.stringContaining('circularity'));
  });
});

describe('unsupported_claim_count', () => {
  it('counts findings, not claims', () => {
    const findings = [finding('unsupported_claim', 'warning')];
    expect(statuses(score({ unsupported_claim_count: { min: 1, max: 1 } }, { findings }))).toEqual([
      'pass',
    ]);
    expect(score({ unsupported_claim_count: { min: 2 } }, { findings })[0]?.status).toBe('fail');
  });
});

describe('the graph-shape counts', () => {
  const graph = graphOf({
    claims: [
      claim('c1', { is_thesis: true, kind: 'normative' }),
      claim('c2'),
      claim('c3', { origin: 'inferred', modality: 'probable' }),
    ],
    occurrences: [
      { claim_id: 'c1', span_id: 's1', surface_text: 'a' },
      { claim_id: 'c2', span_id: 's1', surface_text: 'b' },
      { claim_id: 'c2', span_id: 's2', surface_text: 'c' },
    ],
    inferences: [
      {
        id: 'i1',
        conclusion_claim_id: 'c1',
        premises: [{ claim_id: 'c2', origin: 'stated' }],
        scheme: 'deductive',
        origin: 'stated',
        attribution: 'author',
        formalization: null,
        confidence: 1,
      },
    ],
    relations: [
      {
        id: 'r1',
        type: 'rebut',
        source_claim_id: 'c2',
        target_claim_id: 'c1',
        target_inference_id: null,
      },
    ],
  });

  it.each([
    ['claim_count', { claim_count: { min: 3, max: 3 } }, { claim_count: { min: 4 } }],
    ['inference_count', { inference_count: { min: 1, max: 1 } }, { inference_count: { min: 2 } }],
    ['relations_count', { relations_count: { min: 1 } }, { relations_count: { max: 0 } }],
    ['inferred_claims', { inferred_claims: { min: 1, max: 1 } }, { inferred_claims: { min: 2 } }],
    [
      'max_occurrences_for_single_claim',
      { max_occurrences_for_single_claim: { min: 2, max: 2 } },
      { max_occurrences_for_single_claim: { min: 3 } },
    ],
    [
      'claims_with_modality_not_asserted',
      { claims_with_modality_not_asserted: { min: 1, max: 1 } },
      { claims_with_modality_not_asserted: { min: 2 } },
    ],
  ])('%s passes on the right count and fails on the wrong one', (_name, passing, failing) => {
    expect(statuses(score(passing, { graph }))).toEqual(['pass']);
    const failed = score(failing, { graph });
    expect(failed[0]?.status).toBe('fail');
    // The reason always states what was actually measured.
    expect(failed[0]).toHaveProperty('reason', expect.stringMatching(/\d/));
  });

  it('checks each required relation type separately', () => {
    expect(statuses(score({ relations_present: ['rebut'] }, { graph }))).toEqual(['pass']);
    const results = score({ relations_present: ['rebut', 'undercut'] }, { graph });
    expect(statuses(results)).toEqual(['pass', 'fail']);
  });

  it('fails every graph-shaped key when no revision was produced', () => {
    const results = score(
      { claim_count: { min: 1 }, inference_count: { min: 1 } },
      { graph: null },
    );
    expect(statuses(results)).toEqual(['fail', 'fail']);
    expect(results[0]).toHaveProperty('reason', expect.stringContaining('no revision'));
  });
});

describe('the discourse-function keys', () => {
  const spans = [span('s1', 'argumentative'), span('s2', 'narrative'), span('s3', 'narrative')];
  const graph = graphOf({
    claims: [claim('c1', { is_thesis: true })],
    occurrences: [
      { claim_id: 'c1', span_id: 's2', surface_text: 'a' },
      { claim_id: 'c1', span_id: 's1', surface_text: 'b' },
    ],
  });

  it('counts spans per function', () => {
    expect(
      statuses(score({ spans_with_function: { narrative: { min: 2, max: 2 } } }, { spans, graph })),
    ).toEqual(['pass']);
    expect(
      score({ spans_with_function: { narrative: { min: 3 } } }, { spans, graph })[0]?.status,
    ).toBe('fail');
  });

  it('counts occurrences by the function of the span they anchor to', () => {
    expect(
      statuses(
        score(
          { claim_occurrences_in_function: { narrative: { min: 1, max: 1 } } },
          { spans, graph },
        ),
      ),
    ).toEqual(['pass']);
  });

  it('skips rather than fails when the caller has no spans', () => {
    // The Phase 1 analysis test is exactly this case: a hand-built graph with
    // no spans cannot demonstrate a classification property.
    const results = score(
      {
        spans_with_function: { narrative: { min: 2 } },
        claim_occurrences_in_function: { narrative: { min: 1 } },
      },
      { spans: null, graph },
    );
    expect(statuses(results)).toEqual(['skipped', 'skipped']);
    expect(allHardChecksPassed(results)).toBe(true);
  });

  it('does not count a label the classifier was not confident about', () => {
    // Fixture 11 asks for no argumentative spans. A hedged stray label is not
    // the system claiming the text argues, and the gate ignores it too.
    const hedged = [span('s1', 'argumentative', false), span('s2', 'narrative')];
    expect(
      statuses(score({ spans_with_function: { argumentative: { max: 0 } } }, { spans: hedged })),
    ).toEqual(['pass']);
    const confident = [span('s1', 'argumentative'), span('s2', 'narrative')];
    expect(
      score({ spans_with_function: { argumentative: { max: 0 } } }, { spans: confident })[0]
        ?.status,
    ).toBe('fail');
  });

  it('still counts spans when no revision was produced, but not occurrences', () => {
    // Fixtures 11 and 12: a non-argument run classifies spans and persists
    // nothing, so the span counts are meaningful and the occurrence counts are not.
    const results = score(
      {
        spans_with_function: { narrative: { min: 2 } },
        claim_occurrences_in_function: { narrative: { min: 1 } },
      },
      { spans, graph: null, outcome: 'not_an_argument' },
    );
    expect(statuses(results)).toEqual(['pass', 'fail']);
  });
});
