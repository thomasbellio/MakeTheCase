import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  assignIds,
  draftToGraph,
  newId,
  type AnalysisResult,
  type ArgumentGraph,
  type ClaimId,
  type DocumentId,
  type DraftSpan,
  type Finding,
  type FindingId,
  type FindingTarget,
  type Formalization,
  type InferenceId,
  type LocalId,
  type RelationId,
  type RevisionId,
  type RevisionRepository,
  type SpanId,
} from '@make-your-case/domain';
import type { Db } from '../db.ts';
import {
  analysisRuns,
  claims,
  findingTargets,
  findings,
  inferencePremises,
  inferences,
  occurrences,
  relations,
  revisions,
  spans,
} from '../schema/tables.ts';

export class DrizzleRevisionRepository implements RevisionRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Writes a graph's contents in one transaction (AGENTS.md section 5.2), into
   * a revision row that must already exist: `ArgumentGraph` does not carry the
   * document the revision belongs to. `saveAnalysisResult` creates the row.
   */
  async saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId> {
    await this.db.transaction((tx) => insertGraph(tx, graph));
    return graph.revision_id;
  }

  async saveAnalysisResult(result: AnalysisResult): Promise<RevisionId> {
    return this.db.transaction(async (tx) => {
      // Locking the run row serializes two saves for the same run, so the
      // idempotency check below cannot race.
      const [run] = await tx
        .select({ revisionId: analysisRuns.revisionId })
        .from(analysisRuns)
        .where(eq(analysisRuns.id, result.runId))
        .for('update');
      if (run === undefined) throw new Error(`no run ${result.runId}`);
      if (run.revisionId !== null) return run.revisionId as RevisionId;

      const spanIds = await upsertSpans(tx, result.documentId, result.spans);

      const revisionId = newId<RevisionId>();
      await tx.insert(revisions).values({
        id: revisionId,
        documentId: result.documentId,
        parentRevisionId: null,
        author: 'system',
      });
      await insertGraph(
        tx,
        draftToGraph(result.draft, result.findings, revisionId, assignIds(result.draft, spanIds)),
      );
      await tx.update(analysisRuns).set({ revisionId }).where(eq(analysisRuns.id, result.runId));

      return revisionId;
    });
  }

  async getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null> {
    const [revision] = await this.db
      .select()
      .from(revisions)
      .where(eq(revisions.id, revisionId))
      .limit(1);
    if (revision === undefined) return null;

    const claimRows = await this.db
      .select()
      .from(claims)
      .where(eq(claims.revisionId, revisionId))
      .orderBy(asc(claims.id));
    const inferenceRows = await this.db
      .select()
      .from(inferences)
      .where(eq(inferences.revisionId, revisionId))
      .orderBy(asc(inferences.id));
    const relationRows = await this.db
      .select()
      .from(relations)
      .where(eq(relations.revisionId, revisionId))
      .orderBy(asc(relations.id));
    const findingRows = await this.db
      .select()
      .from(findings)
      .where(eq(findings.revisionId, revisionId))
      .orderBy(asc(findings.id));

    const claimIds = claimRows.map((c) => c.id);
    const inferenceIds = inferenceRows.map((i) => i.id);
    const findingIds = findingRows.map((f) => f.id);

    // `inArray` with an empty list produces invalid SQL in some dialects, so
    // the empty cases are short-circuited.
    const occurrenceRows =
      claimIds.length === 0
        ? []
        : await this.db
            .select()
            .from(occurrences)
            .where(inArray(occurrences.claimId, claimIds))
            .orderBy(asc(occurrences.claimId), asc(occurrences.spanId));
    const premiseRows =
      inferenceIds.length === 0
        ? []
        : await this.db
            .select()
            .from(inferencePremises)
            .where(inArray(inferencePremises.inferenceId, inferenceIds))
            .orderBy(asc(inferencePremises.inferenceId), asc(inferencePremises.claimId));
    const targetRows =
      findingIds.length === 0
        ? []
        : await this.db
            .select()
            .from(findingTargets)
            .where(inArray(findingTargets.findingId, findingIds))
            .orderBy(asc(findingTargets.findingId), asc(findingTargets.ordinal));

    const targetsByFinding = new Map<string, FindingTarget<ClaimId | InferenceId>[]>();
    for (const row of targetRows) {
      const target: FindingTarget<ClaimId | InferenceId> =
        row.claimId !== null
          ? { target: 'claim', claim_id: row.claimId as ClaimId, ordinal: row.ordinal }
          : {
              target: 'inference',
              inference_id: row.inferenceId as InferenceId,
              ordinal: row.ordinal,
            };
      const existing = targetsByFinding.get(row.findingId);
      if (existing) {
        existing.push(target);
      } else {
        targetsByFinding.set(row.findingId, [target]);
      }
    }

    const mappedFindings: Finding[] = findingRows.map((row) => ({
      id: row.id as FindingId,
      revision_id: row.revisionId as RevisionId,
      kind: row.kind,
      severity: row.severity,
      explanation: row.explanation,
      produced_by: row.producedBy,
      targets: targetsByFinding.get(row.id) ?? [],
    }));

    return {
      revision_id: revisionId,
      claims: claimRows.map((row) => ({
        id: row.id as ClaimId,
        revision_id: row.revisionId as RevisionId,
        canonical_text: row.canonicalText,
        kind: row.kind,
        modality: row.modality,
        origin: row.origin,
        attribution: row.attribution,
        citation: row.citation,
        confidence: row.confidence,
        is_thesis: row.isThesis,
      })),
      occurrences: occurrenceRows.map((row) => ({
        claim_id: row.claimId as ClaimId,
        span_id: row.spanId as SpanId,
        surface_text: row.surfaceText,
      })),
      inferences: inferenceRows.map((row) => ({
        id: row.id as InferenceId,
        revision_id: row.revisionId as RevisionId,
        conclusion_claim_id: row.conclusionClaimId as ClaimId,
        scheme: row.scheme,
        origin: row.origin,
        attribution: row.attribution,
        formalization: row.formalization as Formalization<ClaimId> | null,
        confidence: row.confidence,
      })),
      premises: premiseRows.map((row) => ({
        inference_id: row.inferenceId as InferenceId,
        claim_id: row.claimId as ClaimId,
        origin: row.origin,
      })),
      relations: relationRows.map((row) => ({
        id: row.id as RelationId,
        revision_id: row.revisionId as RevisionId,
        source_claim_id: row.sourceClaimId as ClaimId,
        target_claim_id: row.targetClaimId as ClaimId | null,
        target_inference_id: row.targetInferenceId as InferenceId | null,
        type: row.type,
      })),
      findings: mappedFindings,
    };
  }

  async getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null> {
    const [latest] = await this.db
      .select({ id: revisions.id })
      .from(revisions)
      .where(eq(revisions.documentId, documentId))
      .orderBy(desc(revisions.createdAt), desc(revisions.id))
      .limit(1);

    return latest === undefined ? null : this.getArgumentGraph(latest.id as RevisionId);
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Inserts a graph's rows. Order follows the foreign keys: claims before the
 * inferences that conclude them, inferences before the premises and relations
 * that point at them, findings before their targets.
 */
async function insertGraph(tx: Tx, graph: ArgumentGraph): Promise<void> {
  if (graph.claims.length > 0) {
    await tx.insert(claims).values(
      graph.claims.map((claim) => ({
        id: claim.id,
        revisionId: claim.revision_id,
        canonicalText: claim.canonical_text,
        kind: claim.kind,
        modality: claim.modality,
        origin: claim.origin,
        attribution: claim.attribution,
        citation: claim.citation,
        confidence: claim.confidence,
        isThesis: claim.is_thesis,
      })),
    );
  }

  if (graph.occurrences.length > 0) {
    await tx.insert(occurrences).values(
      graph.occurrences.map((occurrence) => ({
        claimId: occurrence.claim_id,
        spanId: occurrence.span_id,
        surfaceText: occurrence.surface_text,
      })),
    );
  }

  if (graph.inferences.length > 0) {
    await tx.insert(inferences).values(
      graph.inferences.map((inference) => ({
        id: inference.id,
        revisionId: inference.revision_id,
        conclusionClaimId: inference.conclusion_claim_id,
        scheme: inference.scheme,
        origin: inference.origin,
        attribution: inference.attribution,
        formalization: inference.formalization,
        confidence: inference.confidence,
      })),
    );
  }

  if (graph.premises.length > 0) {
    await tx.insert(inferencePremises).values(
      graph.premises.map((premise) => ({
        inferenceId: premise.inference_id,
        claimId: premise.claim_id,
        origin: premise.origin,
      })),
    );
  }

  if (graph.relations.length > 0) {
    await tx.insert(relations).values(
      graph.relations.map((relation) => ({
        id: relation.id,
        revisionId: relation.revision_id,
        sourceClaimId: relation.source_claim_id,
        targetClaimId: relation.target_claim_id,
        targetInferenceId: relation.target_inference_id,
        type: relation.type,
      })),
    );
  }

  if (graph.findings.length > 0) {
    await tx.insert(findings).values(
      graph.findings.map((finding) => ({
        id: finding.id,
        revisionId: finding.revision_id,
        kind: finding.kind,
        severity: finding.severity,
        explanation: finding.explanation,
        producedBy: finding.produced_by,
      })),
    );

    const targets = graph.findings.flatMap((finding) =>
      finding.targets.map((target) => ({
        findingId: finding.id,
        claimId: target.target === 'claim' ? target.claim_id : null,
        inferenceId: target.target === 'inference' ? target.inference_id : null,
        ordinal: target.ordinal,
      })),
    );
    if (targets.length > 0) {
      await tx.insert(findingTargets).values(targets);
    }
  }
}

/**
 * Upserts a document's spans by ordinal, keeping the ID of any span already
 * stored there. Segmentation is deterministic and the text immutable, so a
 * rerun produces the same spans; deleting and re-inserting them instead would
 * cascade to, and destroy, the occurrences of earlier revisions.
 */
async function upsertSpans(
  tx: Tx,
  documentId: DocumentId,
  draftSpans: readonly DraftSpan[],
): Promise<Map<LocalId, SpanId>> {
  if (draftSpans.length === 0) return new Map();

  const rows = await tx
    .insert(spans)
    .values(
      draftSpans.map((span) => ({
        id: newId<SpanId>(),
        documentId,
        ordinal: span.ordinal,
        charStart: span.char_start,
        charEnd: span.char_end,
        isHeading: span.is_heading,
        function: span.function,
        functionConfidence: span.function_confidence,
      })),
    )
    .onConflictDoUpdate({
      target: [spans.documentId, spans.ordinal],
      set: {
        charStart: sql`excluded.char_start`,
        charEnd: sql`excluded.char_end`,
        isHeading: sql`excluded.is_heading`,
        function: sql`excluded.function`,
        functionConfidence: sql`excluded.function_confidence`,
      },
    })
    .returning({ id: spans.id, ordinal: spans.ordinal });

  const byOrdinal = new Map(rows.map((row) => [row.ordinal, row.id as SpanId]));
  const ids = new Map<LocalId, SpanId>();
  for (const span of draftSpans) {
    const id = byOrdinal.get(span.ordinal);
    if (id === undefined) throw new Error(`span at ordinal ${String(span.ordinal)} was not saved`);
    ids.set(span.id, id);
  }
  return ids;
}
