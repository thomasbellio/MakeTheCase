import type {
  ArgumentGraphView,
  ClaimView,
  InferenceView,
  OccurrenceView,
  RelationView,
} from '@make-your-case/domain';

/**
 * Lookup tables over an argument graph.
 *
 * Built once per analysis run and shared by every analyzer, so no analyzer pays
 * to re-walk the graph and none of them can disagree about its shape.
 */
export interface GraphIndex<Id extends string> {
  readonly claimById: ReadonlyMap<Id, ClaimView<Id>>;
  readonly inferenceById: ReadonlyMap<Id, InferenceView<Id>>;
  /** claim -> inferences that conclude it (the OR branches of its support). */
  readonly concludedBy: ReadonlyMap<Id, readonly Id[]>;
  /** claim -> inferences that use it as a premise. */
  readonly premiseOf: ReadonlyMap<Id, readonly Id[]>;
  /** inference -> its distinct premise claims, in premise order. */
  readonly premisesOf: ReadonlyMap<Id, readonly Id[]>;
  readonly occurrencesByClaim: ReadonlyMap<Id, readonly OccurrenceView<Id>[]>;
  readonly relationsBySource: ReadonlyMap<Id, readonly RelationView<Id>[]>;
  /** Keyed by the target's id, whether that target is a claim or an inference. */
  readonly relationsByTarget: ReadonlyMap<Id, readonly RelationView<Id>[]>;
  readonly thesis: ClaimView<Id> | null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

export function indexGraph<Id extends string>(graph: ArgumentGraphView<Id>): GraphIndex<Id> {
  const claimById = new Map<Id, ClaimView<Id>>();
  for (const claim of graph.claims) {
    claimById.set(claim.id, claim);
  }

  const inferenceById = new Map<Id, InferenceView<Id>>();
  const concludedBy = new Map<Id, Id[]>();
  const premiseOf = new Map<Id, Id[]>();
  const premisesOf = new Map<Id, Id[]>();

  for (const inference of graph.inferences) {
    inferenceById.set(inference.id, inference);
    push(concludedBy, inference.conclusion_claim_id, inference.id);

    // Distinct, because support evaluation counts how many premises a step is
    // still waiting on; a repeated premise would make that count unreachable.
    // Validation rejects duplicates, but analysis is callable directly.
    const distinct: Id[] = [];
    for (const premise of inference.premises) {
      if (!distinct.includes(premise.claim_id)) {
        distinct.push(premise.claim_id);
        push(premiseOf, premise.claim_id, inference.id);
      }
    }
    premisesOf.set(inference.id, distinct);
  }

  const occurrencesByClaim = new Map<Id, OccurrenceView<Id>[]>();
  for (const occurrence of graph.occurrences) {
    push(occurrencesByClaim, occurrence.claim_id, occurrence);
  }

  const relationsBySource = new Map<Id, RelationView<Id>[]>();
  const relationsByTarget = new Map<Id, RelationView<Id>[]>();
  for (const relation of graph.relations) {
    push(relationsBySource, relation.source_claim_id, relation);
    const target = relation.target_claim_id ?? relation.target_inference_id;
    if (target !== null) {
      push(relationsByTarget, target, relation);
    }
  }

  return {
    claimById,
    inferenceById,
    concludedBy,
    premiseOf,
    premisesOf,
    occurrencesByClaim,
    relationsBySource,
    relationsByTarget,
    thesis: graph.claims.find((c) => c.is_thesis) ?? null,
  };
}
