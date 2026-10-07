import { z } from 'zod';
import { claimIdSchema, localIdSchema, revisionIdSchema, spanIdSchema } from '../ids.ts';
import { attributionSchema, claimKindSchema, modalitySchema, originSchema } from '../enums.ts';

/**
 * Every non-identity field of a claim, written once and shared by the draft and
 * persisted schemas so the two cannot drift. Only the ID fields differ between
 * them, and those should.
 *
 * `citation` is the external source the text offers — a record citation
 * ("Okafor Decl. ¶ 3") or a legal authority. Internal cross-references
 * ("Undisputed Fact ¶ 17") are not citations; extraction resolves them to the
 * referenced paragraph's citation, if it has one. Allowed on any claim kind.
 *
 * `modality` must preserve the author's hedging; canonical text never
 * strengthens a hedged claim.
 */
const claimFields = {
  canonical_text: z.string().min(1),
  kind: claimKindSchema,
  modality: modalitySchema,
  origin: originSchema,
  attribution: attributionSchema,
  citation: z.string().min(1).nullable(),
  confidence: z.number().min(0).max(1),
  is_thesis: z.boolean(),
} as const;

export const claimSchema = z
  .object({ id: claimIdSchema, revision_id: revisionIdSchema, ...claimFields })
  .readonly();
export type Claim = z.infer<typeof claimSchema>;

export const draftClaimSchema = z.object({ id: localIdSchema, ...claimFields }).readonly();
export type DraftClaim = z.infer<typeof draftClaimSchema>;

/**
 * Links a claim to the span it appears in, keeping the author's original
 * wording. Stated claims have at least one; inferred claims have none.
 */
const occurrenceFields = { surface_text: z.string().min(1) } as const;

export const occurrenceSchema = z
  .object({ claim_id: claimIdSchema, span_id: spanIdSchema, ...occurrenceFields })
  .readonly();
export type Occurrence = z.infer<typeof occurrenceSchema>;

export const draftOccurrenceSchema = z
  .object({ claim_id: localIdSchema, span_id: localIdSchema, ...occurrenceFields })
  .readonly();
export type DraftOccurrence = z.infer<typeof draftOccurrenceSchema>;
