import { z } from 'zod';
import { documentIdSchema, localIdSchema, spanIdSchema } from '../ids.ts';
import { spanFunctionSchema } from '../enums.ts';

/**
 * A sentence-level segment of a document.
 *
 * Offsets are computed deterministically before any LLM call (AGENTS.md section
 * 5.3); models reference span IDs only and never produce offsets. `function`
 * and `function_confidence` are filled in by classification.
 */
const spanFields = {
  ordinal: z.number().int().min(0),
  char_start: z.number().int().min(0),
  char_end: z.number().int().min(0),
  is_heading: z.boolean(),
  function: spanFunctionSchema,
  function_confidence: z.number().min(0).max(1).nullable(),
} as const;

export const spanSchema = z
  .object({ id: spanIdSchema, document_id: documentIdSchema, ...spanFields })
  .readonly();
export type Span = z.infer<typeof spanSchema>;

/** A span as produced by segmentation, before persistence assigns a UUID. */
export const draftSpanSchema = z.object({ id: localIdSchema, ...spanFields }).readonly();
export type DraftSpan = z.infer<typeof draftSpanSchema>;
