import { z } from 'zod';
import { documentIdSchema } from '../ids.ts';
import { documentRoleSchema, runStatusSchema } from '../enums.ts';

/** A submitted piece of writing. `source_text` is immutable once created. */
export const documentSchema = z
  .object({
    id: documentIdSchema,
    source_text: z.string().min(1),
    title: z.string().nullable(),
    role: documentRoleSchema,
    created_at: z.date(),
  })
  .readonly();
export type Document = z.infer<typeof documentSchema>;

export const newDocumentSchema = z
  .object({
    source_text: z.string().min(1),
    title: z.string().min(1).nullable().default(null),
    role: documentRoleSchema.default('other'),
  })
  .readonly();
export type NewDocument = z.infer<typeof newDocumentSchema>;

/** List-view projection: a document plus the status of its most recent run. */
export const documentSummarySchema = z
  .object({
    id: documentIdSchema,
    title: z.string().nullable(),
    role: documentRoleSchema,
    created_at: z.date(),
    latest_run_status: runStatusSchema.nullable(),
  })
  .readonly();
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
