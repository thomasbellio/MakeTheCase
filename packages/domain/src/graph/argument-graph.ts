import { z } from 'zod';
import { revisionIdSchema, type LocalId, type RevisionId } from '../ids.ts';
import {
  claimSchema,
  draftClaimSchema,
  draftOccurrenceSchema,
  occurrenceSchema,
  type Claim,
  type DraftClaim,
  type DraftOccurrence,
  type Occurrence,
} from '../entities/claim.ts';
import {
  draftInferencePremiseSchema,
  draftInferenceSchema,
  inferencePremiseSchema,
  inferenceSchema,
  type DraftInference,
  type DraftInferencePremise,
  type Inference,
  type InferencePremise,
} from '../entities/inference.ts';
import {
  draftRelationSchema,
  relationSchema,
  type DraftRelation,
  type Relation,
} from '../entities/relation.ts';
import {
  analysisFindingSchema,
  findingSchema,
  type AnalysisFinding,
  type Finding,
} from '../entities/finding.ts';
import type { ArgumentGraphView, InferenceView } from './view.ts';

/**
 * A revision's complete structure, with persisted UUIDs.
 *
 * Premises and findings are held as sibling collections rather than nested, so
 * the shape mirrors the database and `saveArgumentGraph` can write it in one
 * transaction without reshaping.
 */
export const argumentGraphSchema = z
  .object({
    revision_id: revisionIdSchema,
    claims: z.array(claimSchema),
    occurrences: z.array(occurrenceSchema),
    inferences: z.array(inferenceSchema),
    premises: z.array(inferencePremiseSchema),
    relations: z.array(relationSchema),
    findings: z.array(findingSchema),
  })
  .readonly();

/**
 * Declared rather than inferred, so the hand-written `Finding` type flows
 * through (see `entities/finding.ts`). The schema above validates; this
 * describes.
 */
export interface ArgumentGraph {
  readonly revision_id: RevisionId;
  readonly claims: readonly Claim[];
  readonly occurrences: readonly Occurrence[];
  readonly inferences: readonly Inference[];
  readonly premises: readonly InferencePremise[];
  readonly relations: readonly Relation[];
  readonly findings: readonly Finding[];
}

/**
 * The same shape using local IDs, as produced by the pipeline.
 *
 * This is the schema that validates LLM output, which is why it — not the
 * persisted one — is what `validateArgumentGraph` takes.
 */
export const argumentGraphDraftSchema = z
  .object({
    claims: z.array(draftClaimSchema),
    occurrences: z.array(draftOccurrenceSchema),
    inferences: z.array(draftInferenceSchema),
    premises: z.array(draftInferencePremiseSchema),
    relations: z.array(draftRelationSchema),
    findings: z.array(analysisFindingSchema).default([]),
  })
  .readonly();

export interface ArgumentGraphDraft {
  readonly claims: readonly DraftClaim[];
  readonly occurrences: readonly DraftOccurrence[];
  readonly inferences: readonly DraftInference[];
  readonly premises: readonly DraftInferencePremise[];
  readonly relations: readonly DraftRelation[];
  readonly findings: readonly AnalysisFinding<LocalId>[];
}

/**
 * Flattens premises onto their inferences to produce the ID-agnostic view that
 * the analysis layer consumes.
 *
 * Premise order is preserved: a formalization's `premises` array is positional,
 * so reordering here would silently misalign formulas with claims.
 */
export function toView<Id extends string>(graph: {
  readonly claims: readonly ArgumentGraphView<Id>['claims'][number][];
  readonly occurrences: readonly ArgumentGraphView<Id>['occurrences'][number][];
  readonly inferences: readonly Omit<InferenceView<Id>, 'premises'>[];
  readonly premises: readonly {
    readonly inference_id: Id;
    readonly claim_id: Id;
    readonly origin: InferenceView<Id>['premises'][number]['origin'];
  }[];
  readonly relations: readonly ArgumentGraphView<Id>['relations'][number][];
}): ArgumentGraphView<Id> {
  const byInference = new Map<
    Id,
    { claim_id: Id; origin: InferenceView<Id>['premises'][number]['origin'] }[]
  >();
  for (const premise of graph.premises) {
    const existing = byInference.get(premise.inference_id);
    const entry = { claim_id: premise.claim_id, origin: premise.origin };
    if (existing) {
      existing.push(entry);
    } else {
      byInference.set(premise.inference_id, [entry]);
    }
  }

  return {
    claims: graph.claims,
    occurrences: graph.occurrences,
    inferences: graph.inferences.map((inference) => ({
      ...inference,
      premises: byInference.get(inference.id) ?? [],
    })),
    relations: graph.relations,
  };
}
