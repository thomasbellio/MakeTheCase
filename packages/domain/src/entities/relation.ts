import { z } from 'zod';
import {
  claimIdSchema,
  inferenceIdSchema,
  localIdSchema,
  relationIdSchema,
  revisionIdSchema,
} from '../ids.ts';
import { relationTypeSchema } from '../enums.ts';

/**
 * An attack or qualification.
 *
 * `rebut` targets a claim's conclusion, `undermine` targets a premise claim,
 * `undercut` targets an inference, `qualify` narrows a claim. Exactly one of
 * `target_claim_id` / `target_inference_id` is set — enforced by validation and
 * by a CHECK constraint in the database.
 */
const relationFields = { type: relationTypeSchema } as const;

export const relationSchema = z
  .object({
    id: relationIdSchema,
    revision_id: revisionIdSchema,
    source_claim_id: claimIdSchema,
    target_claim_id: claimIdSchema.nullable(),
    target_inference_id: inferenceIdSchema.nullable(),
    ...relationFields,
  })
  .readonly();
export type Relation = z.infer<typeof relationSchema>;

export const draftRelationSchema = z
  .object({
    id: localIdSchema,
    source_claim_id: localIdSchema,
    target_claim_id: localIdSchema.nullable(),
    target_inference_id: localIdSchema.nullable(),
    ...relationFields,
  })
  .readonly();
export type DraftRelation = z.infer<typeof draftRelationSchema>;
