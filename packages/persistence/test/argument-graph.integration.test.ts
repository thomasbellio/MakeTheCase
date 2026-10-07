import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  newId,
  type ArgumentGraph,
  type ClaimId,
  type DocumentId,
  type InferenceId,
  type RevisionId,
  type SpanId,
} from '@make-your-case/domain';
import { DrizzleDocumentRepository } from '../src/repositories/document-repository.ts';
import { DrizzleRevisionRepository } from '../src/repositories/revision-repository.ts';
import { DrizzleSpanRepository } from '../src/repositories/span-repository.ts';
import { revisions } from '../src/schema/tables.ts';
import { setupTestDb, type TestDb } from './helpers/db.ts';

let harness: TestDb | undefined;

beforeAll(async () => {
  harness = await setupTestDb();
});

/** The harness, once `beforeAll` has run. */
function db(): TestDb {
  if (harness === undefined) throw new Error('the test database was not set up');
  return harness;
}
beforeEach(async () => {
  await db().truncate();
});
afterAll(async () => {
  // `beforeAll` may have thrown before assigning, in which case its error is
  // the one worth seeing.
  await harness?.close();
});

/**
 * Builds a graph exercising every entity type and every nullable column that
 * matters: an inferred claim with no occurrence, a claim with two occurrences,
 * an opposing claim, all four relation types, a formalization, and findings
 * with multiple ordered targets.
 */
async function seedGraph(): Promise<{ graph: ArgumentGraph; documentId: DocumentId }> {
  const documents = new DrizzleDocumentRepository(db().db);
  const spansRepo = new DrizzleSpanRepository(db().db);

  const document = await documents.create({
    source_text: 'The contract required written notice. An email was sent on day 28.',
    title: 'Round trip',
    role: 'own_brief',
  });

  const spanA = newId<SpanId>();
  const spanB = newId<SpanId>();
  await spansRepo.saveAll(document.id, [
    {
      id: spanA,
      document_id: document.id,
      ordinal: 0,
      char_start: 0,
      char_end: 36,
      is_heading: false,
      function: 'argumentative',
      function_confidence: 0.9,
    },
    {
      id: spanB,
      document_id: document.id,
      ordinal: 1,
      char_start: 37,
      char_end: 66,
      is_heading: false,
      function: 'narrative',
      function_confidence: null,
    },
  ]);

  const revisionId = newId<RevisionId>();
  await db()
    .db.insert(revisions)
    .values({ id: revisionId, documentId: document.id, author: 'system' });

  const rule = newId<ClaimId>();
  const fact = newId<ClaimId>();
  const inferredPremise = newId<ClaimId>();
  const thesis = newId<ClaimId>();
  const opposing = newId<ClaimId>();
  const step = newId<InferenceId>();
  const opposingStep = newId<InferenceId>();

  const graph: ArgumentGraph = {
    revision_id: revisionId,
    claims: [
      {
        id: rule,
        revision_id: revisionId,
        canonical_text: 'Section 9 requires written notice within 30 days',
        kind: 'legal_rule',
        modality: 'asserted',
        origin: 'stated',
        attribution: 'author',
        citation: 'Agreement § 9',
        confidence: 1,
        is_thesis: false,
      },
      {
        id: fact,
        revision_id: revisionId,
        canonical_text: 'An email was sent on day 28',
        kind: 'factual',
        modality: 'probable',
        origin: 'stated',
        attribution: 'author',
        citation: null,
        confidence: 0.75,
        is_thesis: false,
      },
      {
        id: inferredPremise,
        revision_id: revisionId,
        canonical_text: 'An email counts as written notice',
        kind: 'definitional',
        modality: 'asserted',
        origin: 'inferred',
        attribution: 'author',
        citation: null,
        confidence: 0.5,
        is_thesis: false,
      },
      {
        id: thesis,
        revision_id: revisionId,
        canonical_text: 'Notice was timely',
        kind: 'normative',
        modality: 'asserted',
        origin: 'stated',
        attribution: 'author',
        citation: null,
        confidence: 1,
        is_thesis: true,
      },
      {
        id: opposing,
        revision_id: revisionId,
        canonical_text: 'Notice had to be sent by certified mail',
        kind: 'legal_rule',
        modality: 'asserted',
        origin: 'stated',
        attribution: 'opposing',
        citation: 'Agreement § 9',
        confidence: 1,
        is_thesis: false,
      },
    ],
    // The rule is stated twice; the inferred premise not at all.
    occurrences: [
      { claim_id: rule, span_id: spanA, surface_text: 'required written notice' },
      { claim_id: rule, span_id: spanB, surface_text: 'the notice requirement' },
      { claim_id: fact, span_id: spanB, surface_text: 'An email was sent on day 28' },
      { claim_id: thesis, span_id: spanA, surface_text: 'notice was timely' },
      { claim_id: opposing, span_id: spanB, surface_text: 'certified mail' },
    ],
    inferences: [
      {
        id: step,
        revision_id: revisionId,
        conclusion_claim_id: thesis,
        scheme: 'deductive',
        origin: 'stated',
        attribution: 'author',
        formalization: {
          atoms: { N: fact, E: inferredPremise, T: thesis },
          premises: [
            { implies: [{ and: [{ atom: 'N' }, { atom: 'E' }] }, { atom: 'T' }] },
            { atom: 'N' },
            { atom: 'E' },
          ],
          conclusion: { atom: 'T' },
        },
        confidence: 0.9,
      },
      {
        id: opposingStep,
        revision_id: revisionId,
        conclusion_claim_id: opposing,
        scheme: 'deductive',
        origin: 'stated',
        attribution: 'opposing',
        formalization: null,
        confidence: 1,
      },
    ],
    premises: [
      { inference_id: step, claim_id: rule, origin: 'stated' },
      { inference_id: step, claim_id: fact, origin: 'stated' },
      { inference_id: step, claim_id: inferredPremise, origin: 'inferred' },
      { inference_id: opposingStep, claim_id: opposing, origin: 'stated' },
    ],
    relations: [
      {
        id: newId(),
        revision_id: revisionId,
        source_claim_id: opposing,
        target_claim_id: thesis,
        target_inference_id: null,
        type: 'rebut',
      },
      {
        id: newId(),
        revision_id: revisionId,
        source_claim_id: fact,
        target_claim_id: opposing,
        target_inference_id: null,
        type: 'undermine',
      },
      {
        id: newId(),
        revision_id: revisionId,
        source_claim_id: rule,
        target_claim_id: null,
        target_inference_id: opposingStep,
        type: 'undercut',
      },
      {
        id: newId(),
        revision_id: revisionId,
        source_claim_id: rule,
        target_claim_id: fact,
        target_inference_id: null,
        type: 'qualify',
      },
    ],
    findings: [
      {
        id: newId(),
        revision_id: revisionId,
        kind: 'implicit_premise',
        severity: 'critical',
        explanation: 'The step relies on a premise the text does not state.',
        produced_by: 'implicit-premise@1.0.0',
        targets: [
          { target: 'claim', claim_id: inferredPremise, ordinal: 0 },
          { target: 'inference', inference_id: step, ordinal: 1 },
        ],
      },
      {
        id: newId(),
        revision_id: revisionId,
        kind: 'load_bearing',
        severity: 'info',
        explanation: 'Without this nothing supports the conclusion.',
        produced_by: 'load-bearing@1.0.0',
        targets: [{ target: 'claim', claim_id: rule, ordinal: 0 }],
      },
    ],
  };

  return { graph, documentId: document.id };
}

/** Sorts every collection so comparison does not depend on row order. */
function normalize(graph: ArgumentGraph): unknown {
  const by =
    <T>(key: (x: T) => string) =>
    (a: T, b: T) =>
      key(a).localeCompare(key(b));
  return {
    revision_id: graph.revision_id,
    claims: [...graph.claims].sort(by((c) => c.id)),
    occurrences: [...graph.occurrences].sort(by((o) => o.claim_id + o.span_id)),
    inferences: [...graph.inferences].sort(by((i) => i.id)),
    premises: [...graph.premises].sort(by((p) => p.inference_id + p.claim_id)),
    relations: [...graph.relations].sort(by((r) => r.id)),
    findings: [...graph.findings]
      .sort(by((f) => f.id))
      .map((f) => ({ ...f, targets: [...f.targets].sort((a, b) => a.ordinal - b.ordinal) })),
  };
}

describe('saveArgumentGraph / getArgumentGraph', () => {
  it('round-trips a full graph unchanged', async () => {
    const { graph } = await seedGraph();
    const repo = new DrizzleRevisionRepository(db().db);

    const savedId = await repo.saveArgumentGraph(graph);
    expect(savedId).toBe(graph.revision_id);

    const loaded = await repo.getArgumentGraph(graph.revision_id);
    if (loaded === null) throw new Error('the revision was not saved');
    expect(normalize(loaded)).toEqual(normalize(graph));
  });

  it('preserves the formalization, including its claim references', async () => {
    const { graph } = await seedGraph();
    const repo = new DrizzleRevisionRepository(db().db);
    await repo.saveArgumentGraph(graph);

    const loaded = await repo.getArgumentGraph(graph.revision_id);
    const deductive = loaded?.inferences.find((i) => i.formalization !== null);
    const original = graph.inferences.find((i) => i.formalization !== null);

    expect(deductive?.formalization).toEqual(original?.formalization);
    // Atoms must point at real claim IDs, not stranded local IDs.
    for (const claimId of Object.values(deductive?.formalization?.atoms ?? {})) {
      expect(loaded?.claims.some((c) => c.id === claimId)).toBe(true);
    }
  });

  it('keeps finding targets in their recorded order', async () => {
    const { graph } = await seedGraph();
    const repo = new DrizzleRevisionRepository(db().db);
    await repo.saveArgumentGraph(graph);

    const loaded = await repo.getArgumentGraph(graph.revision_id);
    const finding = loaded?.findings.find((f) => f.kind === 'implicit_premise');

    expect(finding?.targets.map((t) => t.ordinal)).toEqual([0, 1]);
    expect(finding?.targets[0]?.target).toBe('claim');
    expect(finding?.targets[1]?.target).toBe('inference');
  });

  it('returns null for a revision that does not exist', async () => {
    const repo = new DrizzleRevisionRepository(db().db);
    expect(await repo.getArgumentGraph(newId<RevisionId>())).toBeNull();
  });

  it('finds the latest revision for a document', async () => {
    const { graph, documentId } = await seedGraph();
    const repo = new DrizzleRevisionRepository(db().db);
    await repo.saveArgumentGraph(graph);

    const latest = await repo.getLatestForDocument(documentId);
    expect(latest?.revision_id).toBe(graph.revision_id);
  });

  it('writes nothing when the transaction fails part way through', async () => {
    const { graph } = await seedGraph();
    const repo = new DrizzleRevisionRepository(db().db);

    // A premise pointing at a claim that was never inserted violates the
    // foreign key, which aborts the transaction after claims and inferences
    // have already been written.
    const firstInference = graph.inferences[0];
    if (firstInference === undefined) throw new Error('fixture has no inferences');
    const broken: ArgumentGraph = {
      ...graph,
      premises: [
        ...graph.premises,
        { inference_id: firstInference.id, claim_id: newId<ClaimId>(), origin: 'stated' },
      ],
    };

    await expect(repo.saveArgumentGraph(broken)).rejects.toThrow();

    // Nothing from the aborted attempt survives.
    const loaded = await repo.getArgumentGraph(graph.revision_id);
    expect(loaded?.claims ?? []).toHaveLength(0);
  });
});
