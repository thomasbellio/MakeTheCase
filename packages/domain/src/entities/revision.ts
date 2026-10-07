import { z } from 'zod';
import { documentIdSchema, revisionIdSchema } from '../ids.ts';

/**
 * A versioned snapshot of an argument graph.
 *
 * In v1 every successful run produces one revision with `author: "system"`, so
 * reruns never collide. Editing (a later iteration) will create child
 * revisions via `parent_revision_id`.
 */
export const revisionSchema = z
  .object({
    id: revisionIdSchema,
    document_id: documentIdSchema,
    parent_revision_id: revisionIdSchema.nullable(),
    author: z.string().min(1),
    created_at: z.date(),
  })
  .readonly();
export type Revision = z.infer<typeof revisionSchema>;
