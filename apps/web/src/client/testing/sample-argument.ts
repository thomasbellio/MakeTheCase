import {
  newId,
  type AnalysisRun,
  type ArgumentGraph,
  type Claim,
  type ClaimId,
  type Document,
  type DocumentId,
  type Finding,
  type FindingId,
  type Inference,
  type InferenceId,
  type RelationId,
  type RevisionId,
  type RunId,
  type Span,
  type SpanId,
} from '@make-your-case/domain';

/**
 * A small, complete revision for client tests: a rule, an uncited fact and an
 * inferred premise jointly concluding the thesis (the shape of fixture 05),
 * plus an opposing claim undercutting that step and one unconnected background
 * claim. Every visual state in AGENTS.md section 9.3 is reachable from it.
 *
 * Content is invented for tests and is not taken from `fixtures/`.
 */
export interface SampleArgument {
  readonly document: Document;
  readonly run: AnalysisRun;
  readonly spans: Span[];
  readonly graph: ArgumentGraph;
  readonly ids: {
    readonly rule: ClaimId;
    readonly fact: ClaimId;
    readonly bridge: ClaimId;
    readonly thesis: ClaimId;
    readonly objection: ClaimId;
    readonly background: ClaimId;
    readonly step: InferenceId;
    readonly spans: readonly SpanId[];
  };
}

const SENTENCES = [
  { text: 'Notice of Renewal', heading: true },
  { text: 'The standard of review is de novo.', heading: false },
  {
    text: 'The lease requires the tenant to give written notice of renewal by June 1 (Lease § 12).',
    heading: false,
  },
  { text: 'The tenant emailed the landlord on May 20.', heading: false },
  { text: 'The landlord argues that an email is not written notice.', heading: false },
  { text: 'The tenant therefore renewed the lease.', heading: false },
] as const;

export function sampleArgument(): SampleArgument {
  const documentId = newId<DocumentId>();
  const revisionId = newId<RevisionId>();

  // "# " precedes the heading, as pasted Markdown would.
  let sourceText = '';
  const spans: Span[] = SENTENCES.map((sentence, ordinal) => {
    if (ordinal > 0) sourceText += '\n\n';
    if (sentence.heading) sourceText += '# ';
    const charStart = sourceText.length;
    sourceText += sentence.text;
    return {
      id: newId<SpanId>(),
      document_id: documentId,
      ordinal,
      char_start: charStart,
      char_end: sourceText.length,
      is_heading: sentence.heading,
      function: sentence.heading ? 'unclassified' : ordinal === 1 ? 'descriptive' : 'argumentative',
      function_confidence: 0.9,
    };
  });
  const spanId = (ordinal: number): SpanId => {
    const span = spans[ordinal];
    if (span === undefined) throw new Error(`no span ${String(ordinal)}`);
    return span.id;
  };

  const claim = (fields: Partial<Claim> & Pick<Claim, 'canonical_text'>): Claim => ({
    id: newId<ClaimId>(),
    revision_id: revisionId,
    kind: 'factual',
    modality: 'asserted',
    origin: 'stated',
    attribution: 'author',
    citation: null,
    confidence: 0.9,
    is_thesis: false,
    ...fields,
  });

  const background = claim({
    canonical_text: 'The standard of review is de novo.',
    kind: 'legal_rule',
  });
  const rule = claim({
    canonical_text: 'A tenant must give written notice of renewal by June 1.',
    kind: 'legal_rule',
    citation: 'Lease § 12',
  });
  const fact = claim({ canonical_text: 'The tenant emailed the landlord on May 20.' });
  const objection = claim({
    canonical_text: 'An email is not written notice.',
    kind: 'definitional',
    attribution: 'opposing',
  });
  const thesis = claim({
    canonical_text: 'The tenant renewed the lease.',
    kind: 'normative',
    is_thesis: true,
  });
  const bridge = claim({
    canonical_text: 'An email satisfies the written-notice requirement.',
    kind: 'definitional',
    origin: 'inferred',
    confidence: 0.7,
  });

  const step: Inference = {
    id: newId<InferenceId>(),
    revision_id: revisionId,
    conclusion_claim_id: thesis.id,
    formalization: null,
    scheme: 'deductive',
    origin: 'stated',
    attribution: 'author',
    confidence: 0.85,
  };

  const finding = (
    fields: Pick<Finding, 'kind' | 'severity' | 'explanation' | 'targets'>,
  ): Finding => ({
    id: newId<FindingId>(),
    revision_id: revisionId,
    produced_by: `${fields.kind.replace(/_/g, '-')}@1.0.0`,
    ...fields,
  });
  const on = (id: ClaimId) => [{ target: 'claim' as const, claim_id: id, ordinal: 0 }];

  const graph: ArgumentGraph = {
    revision_id: revisionId,
    // Deliberately not in reading order, as the repository returns them.
    claims: [thesis, bridge, objection, fact, background, rule],
    occurrences: [
      { claim_id: background.id, span_id: spanId(1), surface_text: SENTENCES[1].text },
      { claim_id: rule.id, span_id: spanId(2), surface_text: SENTENCES[2].text },
      { claim_id: fact.id, span_id: spanId(3), surface_text: SENTENCES[3].text },
      {
        claim_id: objection.id,
        span_id: spanId(4),
        surface_text: 'an email is not written notice',
      },
      { claim_id: thesis.id, span_id: spanId(5), surface_text: SENTENCES[5].text },
    ],
    inferences: [step],
    premises: [
      { inference_id: step.id, claim_id: bridge.id, origin: 'inferred' },
      { inference_id: step.id, claim_id: fact.id, origin: 'stated' },
      { inference_id: step.id, claim_id: rule.id, origin: 'stated' },
    ],
    relations: [
      {
        id: newId<RelationId>(),
        revision_id: revisionId,
        source_claim_id: objection.id,
        target_claim_id: null,
        target_inference_id: step.id,
        type: 'undercut',
      },
    ],
    findings: [
      finding({
        kind: 'load_bearing',
        severity: 'info',
        explanation:
          'Without “The tenant emailed the landlord on May 20.” the thesis is unsupported.',
        targets: on(fact.id),
      }),
      finding({
        kind: 'implicit_premise',
        severity: 'critical',
        explanation:
          'The conclusion depends on an unstated premise: “An email satisfies the written-notice requirement.”',
        targets: on(bridge.id),
      }),
      finding({
        kind: 'unsupported_claim',
        severity: 'warning',
        explanation:
          '“The tenant emailed the landlord on May 20.” is a load-bearing fact with no citation.',
        targets: on(fact.id),
      }),
      finding({
        kind: 'load_bearing',
        severity: 'info',
        explanation: 'Without “A tenant must give written notice…” the thesis is unsupported.',
        targets: on(rule.id),
      }),
      finding({
        kind: 'load_bearing',
        severity: 'info',
        explanation: 'Without the unstated premise the thesis is unsupported.',
        targets: on(bridge.id),
      }),
      finding({
        kind: 'unchecked_step',
        severity: 'info',
        explanation: 'This deductive step has no formalization, so its validity was not checked.',
        targets: [{ target: 'inference', inference_id: step.id, ordinal: 0 }],
      }),
      finding({
        kind: 'unconnected_claim',
        severity: 'info',
        explanation: '“The standard of review is de novo.” takes part in no inference or relation.',
        targets: on(background.id),
      }),
    ],
  };

  const document: Document = {
    id: documentId,
    source_text: sourceText,
    title: 'Notice of renewal',
    role: 'own_brief',
    created_at: new Date('2026-10-01T12:00:00.000Z'),
  };

  const run: AnalysisRun = {
    id: newId<RunId>(),
    document_id: documentId,
    revision_id: revisionId,
    status: 'completed',
    current_stage: null,
    summary: null,
    model_config: null,
    error: null,
    started_at: new Date('2026-10-01T12:00:01.000Z'),
    finished_at: new Date('2026-10-01T12:01:00.000Z'),
  };

  return {
    document,
    run,
    spans,
    graph,
    ids: {
      rule: rule.id,
      fact: fact.id,
      bridge: bridge.id,
      thesis: thesis.id,
      objection: objection.id,
      background: background.id,
      step: step.id,
      spans: spans.map((span) => span.id),
    },
  };
}
