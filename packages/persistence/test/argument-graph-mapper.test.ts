import { describe, expect, it } from 'vitest';
import {
  localId,
  newId,
  type AnalysisFinding,
  type ArgumentGraphDraft,
  type LocalId,
  type RevisionId,
  type SpanId,
} from '@make-your-case/domain';
import { assignIds, draftToGraph } from '../src/mappers/argument-graph.ts';

/**
 * Unit tests for the local-ID to UUID mapping (AGENTS.md section 7.4). Pure, so
 * they run under the default `pnpm test` with no database.
 */

const draft: ArgumentGraphDraft = {
  claims: [
    {
      id: localId('c1'),
      canonical_text: 'A rule',
      kind: 'legal_rule',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: 'Act § 1',
      confidence: 1,
      is_thesis: false,
    },
    {
      id: localId('c2'),
      canonical_text: 'A conclusion',
      kind: 'normative',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: null,
      confidence: 1,
      is_thesis: true,
    },
  ],
  occurrences: [
    { claim_id: localId('c1'), span_id: localId('s1'), surface_text: 'a rule' },
    { claim_id: localId('c2'), span_id: localId('s2'), surface_text: 'therefore' },
  ],
  inferences: [
    {
      id: localId('i1'),
      conclusion_claim_id: localId('c2'),
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      formalization: {
        atoms: { P: localId('c1'), Q: localId('c2') },
        premises: [{ implies: [{ atom: 'P' }, { atom: 'Q' }] }],
        conclusion: { atom: 'Q' },
      },
      confidence: 1,
    },
  ],
  premises: [{ inference_id: localId('i1'), claim_id: localId('c1'), origin: 'stated' }],
  relations: [
    {
      id: localId('r1'),
      type: 'qualify',
      source_claim_id: localId('c1'),
      target_claim_id: localId('c2'),
      target_inference_id: null,
    },
  ],
  findings: [],
};

const spanIds = new Map<LocalId, SpanId>([
  [localId('s1'), newId<SpanId>()],
  [localId('s2'), newId<SpanId>()],
]);

const findings: readonly AnalysisFinding<LocalId>[] = [
  {
    kind: 'implicit_premise',
    severity: 'warning',
    explanation: 'An observation.',
    produced_by: 'implicit-premise@1.0.0',
    targets: [
      { target: 'claim', claim_id: localId('c1'), ordinal: 0 },
      { target: 'inference', inference_id: localId('i1'), ordinal: 1 },
    ],
  },
];

describe('assignIds', () => {
  it('mints one UUID per local ID, and reuses the given span map', () => {
    const ids = assignIds(draft, spanIds);
    expect(ids.claim.size).toBe(2);
    expect(ids.inference.size).toBe(1);
    expect(ids.relation.size).toBe(1);
    expect(ids.span).toBe(spanIds);
    expect(new Set(ids.claim.values()).size).toBe(2);
  });
});

describe('draftToGraph', () => {
  const revisionId = newId<RevisionId>();
  const ids = assignIds(draft, spanIds);
  const graph = draftToGraph(draft, findings, revisionId, ids);

  it('replaces every local ID with its UUID', () => {
    expect(graph.claims.map((c) => c.id)).toEqual([
      ids.claim.get(localId('c1')),
      ids.claim.get(localId('c2')),
    ]);
    expect(graph.inferences[0]?.conclusion_claim_id).toBe(ids.claim.get(localId('c2')));
    expect(graph.premises[0]?.claim_id).toBe(ids.claim.get(localId('c1')));
    expect(graph.relations[0]?.target_claim_id).toBe(ids.claim.get(localId('c2')));
    expect(graph.occurrences[0]?.span_id).toBe(spanIds.get(localId('s1')));
  });

  it('stamps the revision onto every entity that belongs to it', () => {
    expect(graph.revision_id).toBe(revisionId);
    for (const claim of graph.claims) expect(claim.revision_id).toBe(revisionId);
    for (const inference of graph.inferences) expect(inference.revision_id).toBe(revisionId);
    for (const relation of graph.relations) expect(relation.revision_id).toBe(revisionId);
    for (const finding of graph.findings) expect(finding.revision_id).toBe(revisionId);
  });

  it("remaps the formalization's atoms, so none point at a local ID", () => {
    const atoms = graph.inferences[0]?.formalization?.atoms ?? {};
    expect(atoms.P).toBe(ids.claim.get(localId('c1')));
    expect(atoms.Q).toBe(ids.claim.get(localId('c2')));
    // The formulas themselves are unchanged: they reference atom names only.
    expect(graph.inferences[0]?.formalization?.conclusion).toEqual({ atom: 'Q' });
  });

  it('gives each finding an identity and maps its targets in order', () => {
    expect(graph.findings).toHaveLength(1);
    const finding = graph.findings[0];
    expect(finding?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(finding?.targets).toEqual([
      { target: 'claim', claim_id: ids.claim.get(localId('c1')), ordinal: 0 },
      { target: 'inference', inference_id: ids.inference.get(localId('i1')), ordinal: 1 },
    ]);
  });

  it('throws rather than silently dropping an unmapped local ID', () => {
    const orphaned = {
      ...draft,
      premises: [
        { inference_id: localId('i1'), claim_id: localId('c9'), origin: 'stated' as const },
      ],
    };
    expect(() => draftToGraph(orphaned, [], revisionId, ids)).toThrow(/no claim was assigned/);
  });
});
