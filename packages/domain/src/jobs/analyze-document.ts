import { z } from 'zod';
import { documentIdSchema, runIdSchema } from '../ids.ts';

/**
 * The contract between the two sides of the queue (AGENTS.md section 8.5).
 *
 * It lives in `domain` because both sides need it and neither can reach the
 * other: `apps/web` enqueues but may not import `pipeline`, and `apps/worker`
 * consumes (section 4). Putting the queue name in one place is the point — a
 * typo on either side is a job that is never delivered and never errors.
 */
export const ANALYZE_DOCUMENT_QUEUE = 'analyze-document';

/**
 * Only identifiers travel on the queue.
 *
 * The document's text is already in the database and is immutable, so sending
 * it would duplicate it for no gain and put the user's document into the job
 * table. The worker reads what it needs through the repositories.
 */
export const analyzeDocumentJobSchema = z
  .object({
    documentId: documentIdSchema,
    runId: runIdSchema,
  })
  .readonly();

export type AnalyzeDocumentJob = z.infer<typeof analyzeDocumentJobSchema>;

/**
 * Parses a payload off the queue.
 *
 * A job round-trips through JSON and may have been enqueued by an older build,
 * so what comes back is unknown until it is checked. A malformed payload is a
 * bug worth failing loudly rather than a run to attempt.
 */
export function parseAnalyzeDocumentJob(payload: unknown): AnalyzeDocumentJob {
  const result = analyzeDocumentJobSchema.safeParse(payload);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`malformed ${ANALYZE_DOCUMENT_QUEUE} job (${problems})`);
  }
  return result.data;
}
