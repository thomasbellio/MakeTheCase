import { z } from 'zod';
import {
  attributionSchema,
  claimKindSchema,
  inferenceSchemeSchema,
  modalitySchema,
  relationTypeSchema,
  spanFunctionSchema,
} from '@make-your-case/domain';
import { wireFormulaNodeSchema } from './wire-formula.ts';

/**
 * The shapes models are asked to produce (AGENTS.md section 8.1).
 *
 * These are deliberately looser than the domain schemas: structured-output
 * strict modes reject brands, refinements, defaults and optional fields, so
 * every field is required (nullable where it may be absent), IDs are plain
 * strings and ranges are unchecked. Field-level rules are enforced afterwards
 * by `validateArgumentGraph`, whose messages go back to the model on a retry.
 *
 * Models nest occurrences under claims and premise IDs under inferences, which
 * is easier to produce consistently; the converters in `to-draft.ts` flatten
 * them into the domain's sibling collections.
 */

const wireOccurrenceSchema = z.object({
  span_id: z.string().describe('The span the claim appears in, e.g. "s12"'),
  surface_text: z.string().describe("The author's exact wording in that span"),
});

const wireRelationSchema = z.object({
  id: z.string().describe('Relation ID, e.g. "r1"'),
  type: relationTypeSchema,
  source_claim_id: z.string(),
  target_claim_id: z
    .string()
    .nullable()
    .describe('Set for rebut, undermine and qualify; otherwise null'),
  target_inference_id: z.string().nullable().describe('Set for undercut; otherwise null'),
});

// ---------------------------------------------------------------------------
// classify

export const classifyResponseSchema = z.object({
  labels: z.array(
    z.object({
      span_id: z.string(),
      function: spanFunctionSchema,
      confidence: z.number().describe('0 to 1'),
    }),
  ),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

// ---------------------------------------------------------------------------
// summarize (the genre summary for a non-argument)

export const summarizeResponseSchema = z.object({
  summary: z.string().describe('One or two sentences on what kind of text this is'),
});
export type SummarizeResponse = z.infer<typeof summarizeResponseSchema>;

// ---------------------------------------------------------------------------
// extract: stated content only

export const extractResponseSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string().describe('Claim ID, e.g. "c1"'),
      text: z.string().describe('The proposition, stated plainly'),
      attribution: attributionSchema,
      citation: z.string().nullable(),
      is_thesis: z.boolean(),
      occurrences: z.array(wireOccurrenceSchema),
    }),
  ),
  inferences: z.array(
    z.object({
      id: z.string().describe('Inference ID, e.g. "i1"'),
      premise_ids: z.array(z.string()),
      conclusion_id: z.string(),
      attribution: attributionSchema,
    }),
  ),
  relations: z.array(wireRelationSchema),
});
export type ExtractResponse = z.infer<typeof extractResponseSchema>;

// ---------------------------------------------------------------------------
// reconstruct: the complete draft

export const wireFormalizationSchema = z.object({
  atoms: z.array(
    z.object({
      name: z.string().describe('Atom name, e.g. "P"'),
      claim_id: z.string().describe('The claim this atom stands for'),
    }),
  ),
  nodes: z.array(wireFormulaNodeSchema),
  premise_roots: z
    .array(z.string())
    .describe("Root node ID of each premise's formula, in the same order as premise_ids"),
  conclusion_root: z.string().describe("Root node ID of the conclusion's formula"),
});
export type WireFormalization = z.infer<typeof wireFormalizationSchema>;

export const reconstructResponseSchema = z.object({
  claims: z.array(
    z.object({
      id: z.string(),
      text: z.string().describe('Canonical text; preserves the author’s hedging'),
      kind: claimKindSchema,
      modality: modalitySchema,
      origin: z.enum(['stated', 'inferred']),
      attribution: attributionSchema,
      citation: z.string().nullable(),
      confidence: z.number().describe('0 to 1'),
      is_thesis: z.boolean(),
      occurrences: z.array(wireOccurrenceSchema).describe('Empty for inferred claims'),
    }),
  ),
  inferences: z.array(
    z.object({
      id: z.string(),
      premise_ids: z.array(z.string()),
      conclusion_id: z.string(),
      scheme: inferenceSchemeSchema,
      origin: z.enum(['stated', 'inferred']),
      attribution: attributionSchema,
      confidence: z.number().describe('0 to 1'),
      formalization: wireFormalizationSchema
        .nullable()
        .describe('Only for deductive rule-application steps; otherwise null'),
    }),
  ),
  relations: z.array(wireRelationSchema),
});
export type ReconstructResponse = z.infer<typeof reconstructResponseSchema>;
