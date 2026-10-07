import type {
  Attribution,
  ClaimKind,
  InferenceScheme,
  Modality,
  Origin,
  RelationType,
} from '../enums.ts';
import type { Formalization } from './formula.ts';

/**
 * A read-only, ID-agnostic view of an argument graph. Types only — no Zod, no
 * runtime cost.
 *
 * This exists because the pipeline's order is validate → analyze → **persist**
 * (AGENTS.md section 8.2): analysis necessarily runs before local IDs have been
 * mapped to UUIDs, so it cannot require the persisted shape. Both
 * `ArgumentGraphDraft` and `ArgumentGraph` are structurally assignable to it
 * (every field is readonly), which lets `analyzeArgumentGraph` accept either —
 * and makes regenerating findings for a stored revision free.
 *
 * Premises are flattened onto the inference here. The two concrete shapes keep
 * them as a separate join collection, mirroring the database; `toView` bridges.
 */
export interface ClaimView<Id extends string> {
  readonly id: Id;
  readonly canonical_text: string;
  readonly kind: ClaimKind;
  readonly modality: Modality;
  readonly origin: Origin;
  readonly attribution: Attribution;
  readonly citation: string | null;
  readonly confidence: number;
  readonly is_thesis: boolean;
}

export interface OccurrenceView<Id extends string> {
  readonly claim_id: Id;
  readonly span_id: Id;
  readonly surface_text: string;
}

export interface PremiseView<Id extends string> {
  readonly claim_id: Id;
  readonly origin: Origin;
}

export interface InferenceView<Id extends string> {
  readonly id: Id;
  readonly conclusion_claim_id: Id;
  readonly premises: readonly PremiseView<Id>[];
  readonly scheme: InferenceScheme;
  readonly origin: Origin;
  readonly attribution: Attribution;
  readonly formalization: Formalization<Id> | null;
  readonly confidence: number;
}

export interface RelationView<Id extends string> {
  readonly id: Id;
  readonly type: RelationType;
  readonly source_claim_id: Id;
  readonly target_claim_id: Id | null;
  readonly target_inference_id: Id | null;
}

export interface ArgumentGraphView<Id extends string> {
  readonly claims: readonly ClaimView<Id>[];
  readonly occurrences: readonly OccurrenceView<Id>[];
  readonly inferences: readonly InferenceView<Id>[];
  readonly relations: readonly RelationView<Id>[];
}
