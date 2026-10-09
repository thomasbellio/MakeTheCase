import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  localId,
  type AnalysisFinding,
  type AnalysisResult,
  type ArgumentGraphDraft,
  type DocumentId,
  type DraftSpan,
  type LocalId,
  type RunId,
} from '@make-your-case/domain';
import { DrizzleAnalysisRunRepository } from '../src/repositories/analysis-run-repository.ts';
import { DrizzleDocumentRepository } from '../src/repositories/document-repository.ts';
import { DrizzleRevisionRepository } from '../src/repositories/revision-repository.ts';
import { DrizzleSpanRepository } from '../src/repositories/span-repository.ts';
import { occurrences, revisions, spans } from '../src/schema/tables.ts';
import { setupTestDb, type TestDb } from './helpers/db.ts';

let harness: TestDb | undefined;

beforeAll(async () => {
  harness = await setupTestDb();
});
function db(): TestDb {
  if (harness === undefined) throw new Error('the test database was not set up');
  return harness;
}
beforeEach(async () => {
  await db().truncate();
});
afterAll(async () => {
  await harness?.close();
});

const id = (value: string): LocalId => localId(value);

const draftSpans: DraftSpan[] = [
  {
    id: id('s1'),
    ordinal: 0,
    char_start: 0,
    char_end: 30,
    is_heading: false,
    function: 'argumentative',
    function_confidence: 0.9,
  },
  {
    id: id('s2'),
    ordinal: 1,
    char_start: 31,
    char_end: 60,
    is_heading: false,
    function: 'narrative',
    function_confidence: 0.7,
  },
];

/** What the pipeline hands to `persist`: an inferred premise, a formalization, a finding with targets. */
const draft: ArgumentGraphDraft = {
  claims: [
    {
      id: id('c1'),
      canonical_text: 'Notice must be written',
      kind: 'legal_rule',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: 'Agreement § 9',
      confidence: 0.9,
      is_thesis: false,
    },
    {
      id: id('c2'),
      canonical_text: 'An email was sent',
      kind: 'factual',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: null,
      confidence: 0.9,
      is_thesis: false,
    },
    {
      id: id('c3'),
      canonical_text: 'An email is written notice',
      kind: 'legal_rule',
      modality: 'asserted',
      origin: 'inferred',
      attribution: 'author',
      citation: null,
      confidence: 0.6,
      is_thesis: false,
    },
    {
      id: id('c4'),
      canonical_text: 'Notice was given',
      kind: 'normative',
      modality: 'asserted',
      origin: 'stated',
      attribution: 'author',
      citation: null,
      confidence: 0.8,
      is_thesis: true,
    },
  ],
  occurrences: [
    { claim_id: id('c1'), span_id: id('s1'), surface_text: 'notice must be written' },
    { claim_id: id('c2'), span_id: id('s2'), surface_text: 'an email was sent' },
    { claim_id: id('c4'), span_id: id('s1'), surface_text: 'notice was given' },
  ],
  inferences: [
    {
      id: id('i1'),
      conclusion_claim_id: id('c4'),
      formalization: {
        atoms: { E: id('c2'), W: id('c4') },
        premises: [{ atom: 'E' }, { implies: [{ atom: 'E' }, { atom: 'W' }] }],
        conclusion: { atom: 'W' },
      },
      scheme: 'deductive',
      origin: 'stated',
      attribution: 'author',
      confidence: 0.8,
    },
  ],
  premises: [
    { inference_id: id('i1'), claim_id: id('c2'), origin: 'stated' },
    { inference_id: id('i1'), claim_id: id('c3'), origin: 'inferred' },
  ],
  relations: [],
  findings: [],
};

const findings: AnalysisFinding<LocalId>[] = [
  {
    kind: 'implicit_premise',
    severity: 'critical',
    explanation: 'The step relies on an unstated premise.',
    produced_by: 'implicit-premise@1',
    targets: [
      { target: 'claim', claim_id: id('c3'), ordinal: 0 },
      { target: 'inference', inference_id: id('i1'), ordinal: 1 },
    ],
  },
];

async function newRun(): Promise<{ documentId: DocumentId; runId: RunId }> {
  const document = await new DrizzleDocumentRepository(db().db).create({
    source_text: 'x'.repeat(60),
    title: null,
    role: 'own_brief',
  });
  const run = await new DrizzleAnalysisRunRepository(db().db).create({
    document_id: document.id,
    status: 'running',
  });
  return { documentId: document.id, runId: run.id };
}

function resultFor(ids: { documentId: DocumentId; runId: RunId }): AnalysisResult {
  return { ...ids, spans: draftSpans, draft, findings };
}

describe('saveAnalysisResult', () => {
  it('saves spans, a system revision and the graph, and links the revision to the run', async () => {
    const ids = await newRun();
    const revisionsRepo = new DrizzleRevisionRepository(db().db);

    const revisionId = await revisionsRepo.saveAnalysisResult(resultFor(ids));

    const run = await new DrizzleAnalysisRunRepository(db().db).getById(ids.runId);
    expect(run?.revision_id).toBe(revisionId);

    const [revision] = await db().db.select().from(revisions).where(eq(revisions.id, revisionId));
    expect(revision).toMatchObject({
      documentId: ids.documentId,
      author: 'system',
      parentRevisionId: null,
    });

    const stored = await new DrizzleSpanRepository(db().db).listByDocument(ids.documentId);
    expect(stored.map((span) => [span.ordinal, span.function, span.function_confidence])).toEqual([
      [0, 'argumentative', 0.9],
      [1, 'narrative', 0.7],
    ]);

    const graph = await revisionsRepo.getArgumentGraph(revisionId);
    expect(graph?.claims.map((claim) => [claim.canonical_text, claim.origin])).toEqual(
      expect.arrayContaining([['An email is written notice', 'inferred']]),
    );
    expect(graph?.occurrences.map((occurrence) => occurrence.span_id).sort()).toEqual(
      [stored[0]?.id, stored[0]?.id, stored[1]?.id].sort(),
    );
    const thesis = graph?.claims.find((claim) => claim.is_thesis);
    const email = graph?.claims.find((claim) => claim.canonical_text === 'An email was sent');
    expect(graph?.inferences[0]?.formalization?.atoms).toEqual({ E: email?.id, W: thesis?.id });
    expect(graph?.findings[0]?.targets.map((target) => target.ordinal)).toEqual([0, 1]);
  });

  it('is idempotent per run', async () => {
    const ids = await newRun();
    const revisionsRepo = new DrizzleRevisionRepository(db().db);

    const first = await revisionsRepo.saveAnalysisResult(resultFor(ids));
    const second = await revisionsRepo.saveAnalysisResult(resultFor(ids));

    expect(second).toBe(first);
    const [row] = await db().db.select({ n: count() }).from(revisions);
    expect(row?.n).toBe(1);
  });

  it("keeps span IDs and earlier revisions' occurrences when a document is analyzed again", async () => {
    const first = await newRun();
    const revisionsRepo = new DrizzleRevisionRepository(db().db);
    const firstRevision = await revisionsRepo.saveAnalysisResult(resultFor(first));
    const spansBefore = await new DrizzleSpanRepository(db().db).listByDocument(first.documentId);

    const rerun = await new DrizzleAnalysisRunRepository(db().db).create({
      document_id: first.documentId,
      status: 'running',
    });
    const relabelled = draftSpans.map((span) => ({ ...span, function: 'descriptive' as const }));
    const secondRevision = await revisionsRepo.saveAnalysisResult({
      ...resultFor({ documentId: first.documentId, runId: rerun.id }),
      spans: relabelled,
    });

    const spansAfter = await new DrizzleSpanRepository(db().db).listByDocument(first.documentId);
    expect(spansAfter.map((span) => span.id)).toEqual(spansBefore.map((span) => span.id));
    expect(spansAfter.map((span) => span.function)).toEqual(['descriptive', 'descriptive']);

    expect(secondRevision).not.toBe(firstRevision);
    expect((await revisionsRepo.getArgumentGraph(firstRevision))?.occurrences).toHaveLength(3);
    expect((await revisionsRepo.getLatestForDocument(first.documentId))?.revision_id).toBe(
      secondRevision,
    );
  });

  it('writes nothing when the save fails part way through', async () => {
    const ids = await newRun();
    // An occurrence on a span segmentation never produced fails after the
    // spans and revision rows have been written inside the transaction.
    const broken: ArgumentGraphDraft = {
      ...draft,
      occurrences: [
        ...draft.occurrences,
        { claim_id: id('c2'), span_id: id('s9'), surface_text: 'x' },
      ],
    };

    await expect(
      new DrizzleRevisionRepository(db().db).saveAnalysisResult({
        ...resultFor(ids),
        draft: broken,
      }),
    ).rejects.toThrow(/s9/);

    const [spanCount] = await db().db.select({ n: count() }).from(spans);
    const [revisionCount] = await db().db.select({ n: count() }).from(revisions);
    const [occurrenceCount] = await db().db.select({ n: count() }).from(occurrences);
    expect([spanCount?.n, revisionCount?.n, occurrenceCount?.n]).toEqual([0, 0, 0]);
    expect(
      (await new DrizzleAnalysisRunRepository(db().db).getById(ids.runId))?.revision_id,
    ).toBeNull();
  });
});
