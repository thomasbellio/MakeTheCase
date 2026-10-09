import {
  newId,
  type ClaimId,
  type FindingId,
  type InferenceId,
  type LocalId,
  type RelationId,
  type RevisionId,
  type SpanId,
} from '../ids.ts';
import type { AnalysisFinding, Finding, FindingTarget } from '../entities/finding.ts';
import type { Formalization } from './formula.ts';
import type { ArgumentGraph, ArgumentGraphDraft } from './argument-graph.ts';

/**
 * Local ID -> UUID, one map per entity kind.
 *
 * Only repository implementations call this: the pipeline works in local IDs
 * from segmentation right through analysis (AGENTS.md section 5.3) and never
 * needs to know what a row's UUID will be. It lives in `domain` rather than
 * `persistence` because it is pure and both implementations of
 * `RevisionRepository.saveAnalysisResult` — Drizzle and the in-memory fake —
 * need it.
 */
export interface IdMap {
  readonly claim: ReadonlyMap<LocalId, ClaimId>;
  readonly inference: ReadonlyMap<LocalId, InferenceId>;
  readonly relation: ReadonlyMap<LocalId, RelationId>;
  readonly span: ReadonlyMap<LocalId, SpanId>;
}

/** Mints a UUID for every local ID in a draft. Spans are supplied separately. */
export function assignIds(draft: ArgumentGraphDraft, spanIds: ReadonlyMap<LocalId, SpanId>): IdMap {
  return {
    claim: new Map(draft.claims.map((c) => [c.id, newId<ClaimId>()])),
    inference: new Map(draft.inferences.map((i) => [i.id, newId<InferenceId>()])),
    relation: new Map(draft.relations.map((r) => [r.id, newId<RelationId>()])),
    span: spanIds,
  };
}

function must<T>(map: ReadonlyMap<LocalId, T>, id: LocalId, kind: string): T {
  const mapped = map.get(id);
  if (mapped === undefined) {
    // Unreachable for a validated draft: `checkReferences` rejects any local ID
    // that does not resolve. Throwing rather than skipping keeps a bug loud.
    throw new Error(`no ${kind} was assigned for local ID ${id}`);
  }
  return mapped;
}

function mapFormalization(
  formalization: Formalization<LocalId>,
  ids: IdMap,
): Formalization<ClaimId> {
  return {
    // Atoms are remapped too, so a stored formalization points at real claims
    // rather than leaving local IDs stranded inside a JSON column.
    atoms: Object.fromEntries(
      Object.entries(formalization.atoms).map(([atom, claimId]) => [
        atom,
        must(ids.claim, claimId, 'claim'),
      ]),
    ),
    premises: formalization.premises,
    conclusion: formalization.conclusion,
  };
}

function mapTarget(
  target: FindingTarget<LocalId>,
  ids: IdMap,
): FindingTarget<ClaimId | InferenceId> {
  return target.target === 'claim'
    ? {
        target: 'claim',
        claim_id: must(ids.claim, target.claim_id, 'claim'),
        ordinal: target.ordinal,
      }
    : {
        target: 'inference',
        inference_id: must(ids.inference, target.inference_id, 'inference'),
        ordinal: target.ordinal,
      };
}

/**
 * Turns a validated, analyzed draft into the persisted graph.
 *
 * Total: every local ID in the draft must resolve, which a validated draft
 * guarantees.
 */
export function draftToGraph(
  draft: ArgumentGraphDraft,
  findings: readonly AnalysisFinding<LocalId>[],
  revisionId: RevisionId,
  ids: IdMap,
): ArgumentGraph {
  const mappedFindings: Finding[] = findings.map((finding) => ({
    id: newId<FindingId>(),
    revision_id: revisionId,
    kind: finding.kind,
    severity: finding.severity,
    explanation: finding.explanation,
    produced_by: finding.produced_by,
    targets: finding.targets.map((t) => mapTarget(t, ids)),
  }));

  return {
    revision_id: revisionId,
    claims: draft.claims.map((claim) => ({
      id: must(ids.claim, claim.id, 'claim'),
      revision_id: revisionId,
      canonical_text: claim.canonical_text,
      kind: claim.kind,
      modality: claim.modality,
      origin: claim.origin,
      attribution: claim.attribution,
      citation: claim.citation,
      confidence: claim.confidence,
      is_thesis: claim.is_thesis,
    })),
    occurrences: draft.occurrences.map((occurrence) => ({
      claim_id: must(ids.claim, occurrence.claim_id, 'claim'),
      span_id: must(ids.span, occurrence.span_id, 'span'),
      surface_text: occurrence.surface_text,
    })),
    inferences: draft.inferences.map((inference) => ({
      id: must(ids.inference, inference.id, 'inference'),
      revision_id: revisionId,
      conclusion_claim_id: must(ids.claim, inference.conclusion_claim_id, 'claim'),
      scheme: inference.scheme,
      origin: inference.origin,
      attribution: inference.attribution,
      formalization:
        inference.formalization === null ? null : mapFormalization(inference.formalization, ids),
      confidence: inference.confidence,
    })),
    premises: draft.premises.map((premise) => ({
      inference_id: must(ids.inference, premise.inference_id, 'inference'),
      claim_id: must(ids.claim, premise.claim_id, 'claim'),
      origin: premise.origin,
    })),
    relations: draft.relations.map((relation) => ({
      id: must(ids.relation, relation.id, 'relation'),
      revision_id: revisionId,
      source_claim_id: must(ids.claim, relation.source_claim_id, 'claim'),
      target_claim_id:
        relation.target_claim_id === null
          ? null
          : must(ids.claim, relation.target_claim_id, 'claim'),
      target_inference_id:
        relation.target_inference_id === null
          ? null
          : must(ids.inference, relation.target_inference_id, 'inference'),
      type: relation.type,
    })),
    findings: mappedFindings,
  };
}
