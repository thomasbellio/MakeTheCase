import { z } from 'zod';
import {
  claimIdSchema,
  findingIdSchema,
  inferenceIdSchema,
  localIdSchema,
  revisionIdSchema,
  type ClaimId,
  type FindingId,
  type InferenceId,
  type RevisionId,
} from '../ids.ts';
import { findingKindSchema, severitySchema } from '../enums.ts';

/**
 * One element a finding is about.
 *
 * Exactly one of `claim_id` / `inference_id` is set. `ordinal` gives stable
 * order: for a circularity finding it is the position round the cycle, which is
 * what makes the explanation readable.
 */
export type FindingTarget<Id extends string> =
  | { readonly target: 'claim'; readonly claim_id: Id; readonly ordinal: number }
  | { readonly target: 'inference'; readonly inference_id: Id; readonly ordinal: number };

/** Builds a `FindingTarget` schema over the given claim and inference ID schemas. */
export function findingTargetSchema<C extends z.ZodType<string>, I extends z.ZodType<string>>(
  claimId: C,
  inferenceId: I,
) {
  return z.discriminatedUnion('target', [
    z
      .object({
        target: z.literal('claim'),
        claim_id: claimId,
        ordinal: z.number().int().min(0),
      })
      .readonly(),
    z
      .object({
        target: z.literal('inference'),
        inference_id: inferenceId,
        ordinal: z.number().int().min(0),
      })
      .readonly(),
  ]);
}

/**
 * An analysis result, as returned by the analysis layer.
 *
 * Findings have no identity until persisted: `analyzeArgumentGraph` emits these
 * with whatever ID type its input used, and persistence assigns `id` and
 * `revision_id`. They are regenerable and never mutate structure.
 *
 * Explanations are plain English, reference claims by canonical text, and are
 * framed as observations and questions rather than accusations or fallacy
 * labels (AGENTS.md section 1).
 */
export interface AnalysisFinding<Id extends string> {
  readonly kind: z.infer<typeof findingKindSchema>;
  readonly severity: z.infer<typeof severitySchema>;
  readonly explanation: string;
  /** `analyzer-name@version`, e.g. `load-bearing@1.0.0`. */
  readonly produced_by: string;
  readonly targets: readonly FindingTarget<Id>[];
}

export const analysisFindingSchema = z
  .object({
    kind: findingKindSchema,
    severity: severitySchema,
    explanation: z.string().min(1),
    produced_by: z.string().min(1),
    targets: z.array(findingTargetSchema(localIdSchema, localIdSchema)),
  })
  .readonly();

export const findingSchema = z
  .object({
    id: findingIdSchema,
    revision_id: revisionIdSchema,
    kind: findingKindSchema,
    severity: severitySchema,
    explanation: z.string().min(1),
    produced_by: z.string().min(1),
    targets: z.array(findingTargetSchema(claimIdSchema, inferenceIdSchema)).readonly(),
  })
  .readonly();

/**
 * A persisted finding.
 *
 * Declared from `AnalysisFinding` rather than inferred from the schema above,
 * for the same reason `Formula` is hand-written: `FindingTarget` is a
 * discriminated union over a type parameter, which `z.infer` cannot reproduce
 * identically. The schema validates; this type describes.
 */
export type Finding = AnalysisFinding<ClaimId | InferenceId> & {
  readonly id: FindingId;
  readonly revision_id: RevisionId;
};
