import {
  createDocumentRequestSchema,
  documentIdSchema,
  parseWire,
  type ArgumentGraph,
  type CreateDocumentResponse,
  type DocumentDetail,
  type DocumentId,
  type DocumentSummary,
  type Repositories,
} from '@make-your-case/domain';
import { log } from '../logger.ts';
import type { JobQueue } from '../queue.ts';
import { fail, ok, type ServiceResult } from './result.ts';

export interface DocumentServiceDeps {
  readonly repositories: Repositories;
  readonly queue: JobQueue;
  readonly maxDocumentChars: number;
}

/** Shown when the job could not be queued; the run is marked failed with it. */
export const ENQUEUE_FAILURE_MESSAGE =
  'The analysis could not be started. Nothing was analyzed; the document can be submitted again.';

/**
 * Stores a submitted document, creates its run and queues the analysis.
 *
 * The run row exists before the job is sent, because only identifiers travel
 * on the queue (AGENTS.md section 8.5). A document over `MAX_DOCUMENT_CHARS` is
 * rejected outright — never truncated (section 8.2).
 */
export async function submitDocument(
  deps: DocumentServiceDeps,
  body: unknown,
): Promise<ServiceResult<CreateDocumentResponse>> {
  const parsed = parseWire(createDocumentRequestSchema, body);
  if (!parsed.ok) return fail('validation_failed', parsed.message);

  const { sourceText, title, role } = parsed.value;
  if (sourceText.length > deps.maxDocumentChars) {
    return fail(
      'document_too_large',
      `The text is ${sourceText.length.toLocaleString('en-US')} characters long; ` +
        `the limit is ${deps.maxDocumentChars.toLocaleString('en-US')}.`,
    );
  }

  const { documents, runs } = deps.repositories;
  const document = await documents.create({
    source_text: sourceText,
    title: title ?? null,
    role: role ?? 'other',
  });
  const run = await runs.create({ document_id: document.id, status: 'queued' });

  try {
    await deps.queue.enqueueAnalyzeDocument({ documentId: document.id, runId: run.id });
  } catch (error) {
    log('error', 'enqueue failed', { runId: run.id, error: (error as Error).message });
    await runs.updateStatus(run.id, {
      status: 'failed',
      error: ENQUEUE_FAILURE_MESSAGE,
      finished_at: new Date(),
    });
    return fail('internal', ENQUEUE_FAILURE_MESSAGE);
  }

  log('info', 'document submitted', { documentId: document.id, runId: run.id });
  return ok({ documentId: document.id, runId: run.id });
}

export async function listDocuments(deps: DocumentServiceDeps): Promise<DocumentSummary[]> {
  return deps.repositories.documents.list();
}

export async function getDocumentDetail(
  deps: DocumentServiceDeps,
  rawId: string,
): Promise<ServiceResult<DocumentDetail>> {
  const id = parseDocumentId(rawId);
  const document = id === null ? null : await deps.repositories.documents.getById(id);
  if (id === null || document === null) return documentNotFound();

  const [spans, latestRun] = await Promise.all([
    deps.repositories.spans.listByDocument(id),
    deps.repositories.runs.getLatestForDocument(id),
  ]);
  return ok({ document, spans, latestRun });
}

export async function getDocumentArgument(
  deps: DocumentServiceDeps,
  rawId: string,
): Promise<ServiceResult<ArgumentGraph>> {
  const id = parseDocumentId(rawId);
  const document = id === null ? null : await deps.repositories.documents.getById(id);
  if (id === null || document === null) return documentNotFound();

  const graph = await deps.repositories.revisions.getLatestForDocument(id);
  if (graph === null) {
    return fail('not_found', 'No analysis of this document has completed yet.');
  }
  return ok(graph);
}

/** A malformed id is reported as not found: it names no document. */
function parseDocumentId(raw: string): DocumentId | null {
  const parsed = documentIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function documentNotFound<T>(): ServiceResult<T> {
  return fail('not_found', 'No document with this id exists.');
}
