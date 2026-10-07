import { z } from 'zod';
import { claimIdSchema, inferenceIdSchema, localIdSchema, revisionIdSchema } from '../ids.ts';
import { attributionSchema, inferenceSchemeSchema, originSchema } from '../enums.ts';
import { formalizationSchema } from '../graph/formula.ts';

/**
 * A reasoning step from one or more premise claims to one conclusion.
 *
 * **All premises are jointly required.** Independent or alternative reasons are
 * represented as separate inferences concluding the same claim; there is no
 * linked/convergent flag (AGENTS.md section 6).
 */
const inferenceFields = {
  scheme: inferenceSchemeSchema,
  origin: originSchema,
  attribution: attributionSchema,
  confidence: z.number().min(0).max(1),
} as const;

export const inferenceSchema = z
  .object({
    id: inferenceIdSchema,
    revision_id: revisionIdSchema,
    conclusion_claim_id: claimIdSchema,
    formalization: formalizationSchema(claimIdSchema).nullable(),
    ...inferenceFields,
  })
  .readonly();
export type Inference = z.infer<typeof inferenceSchema>;

export const draftInferenceSchema = z
  .object({
    id: localIdSchema,
    conclusion_claim_id: localIdSchema,
    formalization: formalizationSchema(localIdSchema).nullable(),
    ...inferenceFields,
  })
  .readonly();
export type DraftInference = z.infer<typeof draftInferenceSchema>;

/**
 * Join between an inference and a premise claim, with its own `origin` — an
 * inferred premise can join a stated inference.
 */
const premiseFields = { origin: originSchema } as const;

export const inferencePremiseSchema = z
  .object({ inference_id: inferenceIdSchema, claim_id: claimIdSchema, ...premiseFields })
  .readonly();
export type InferencePremise = z.infer<typeof inferencePremiseSchema>;

export const draftInferencePremiseSchema = z
  .object({ inference_id: localIdSchema, claim_id: localIdSchema, ...premiseFields })
  .readonly();
export type DraftInferencePremise = z.infer<typeof draftInferencePremiseSchema>;
