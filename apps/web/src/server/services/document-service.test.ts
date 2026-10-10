import { describe, expect, it } from 'vitest';
import type { AnalyzeDocumentJob, DocumentId } from '@make-your-case/domain';
import { createInMemoryRepositories } from '@make-your-case/domain/testing';
import type { JobQueue } from '../queue.ts';
import {
  ENQUEUE_FAILURE_MESSAGE,
  getDocumentArgument,
  getDocumentDetail,
  listDocuments,
  submitDocument,
  type DocumentServiceDeps,
} from './document-service.ts';

class FakeJobQueue implements JobQueue {
  readonly sent: AnalyzeDocumentJob[] = [];
  failWith: Error | undefined;

  enqueueAnalyzeDocument(job: AnalyzeDocumentJob): Promise<void> {
    if (this.failWith !== undefined) return Promise.reject(this.failWith);
    this.sent.push(job);
    return Promise.resolve();
  }
}

function setup(maxDocumentChars = 1000) {
  const repositories = createInMemoryRepositories();
  const queue = new FakeJobQueue();
  const deps: DocumentServiceDeps = { repositories, queue, maxDocumentChars };
  return { repositories, queue, deps };
}

describe('submitDocument', () => {
  it('stores the document, creates a queued run, then enqueues both ids', async () => {
    const { repositories, queue, deps } = setup();

    const result = await submitDocument(deps, {
      title: 'Opposition',
      role: 'own_brief',
      sourceText: 'The motion should be denied.',
    });

    if (!result.ok) throw new Error(result.error.message);
    const document = await repositories.documents.getById(result.value.documentId);
    expect(document).toMatchObject({
      source_text: 'The motion should be denied.',
      title: 'Opposition',
      role: 'own_brief',
    });
    expect((await repositories.runs.getById(result.value.runId))?.status).toBe('queued');
    expect(queue.sent).toEqual([result.value]);
  });

  it('keeps the text exactly as submitted', async () => {
    const { repositories, deps } = setup();
    const sourceText = '  # Heading\n\nAn argument.  \n';

    const result = await submitDocument(deps, { sourceText });

    if (!result.ok) throw new Error(result.error.message);
    expect((await repositories.documents.getById(result.value.documentId))?.source_text).toBe(
      sourceText,
    );
  });

  it('defaults a missing title and role', async () => {
    const { repositories, deps } = setup();
    const result = await submitDocument(deps, { sourceText: 'An argument.' });

    if (!result.ok) throw new Error(result.error.message);
    expect(await repositories.documents.getById(result.value.documentId)).toMatchObject({
      title: null,
      role: 'other',
    });
  });

  it('rejects text over the size limit without storing or truncating anything', async () => {
    const { repositories, queue, deps } = setup(10);

    const result = await submitDocument(deps, { sourceText: 'x'.repeat(11) });

    expect(result).toMatchObject({ ok: false, error: { code: 'document_too_large' } });
    expect(repositories.documents.documents.size).toBe(0);
    expect(repositories.runs.runs.size).toBe(0);
    expect(queue.sent).toEqual([]);
  });

  it('accepts text exactly at the limit', async () => {
    const { deps } = setup(10);
    expect((await submitDocument(deps, { sourceText: 'x'.repeat(10) })).ok).toBe(true);
  });

  it.each([
    ['no body', undefined],
    ['no text', { title: 'Only a title' }],
    ['blank text', { sourceText: '   ' }],
    ['an unknown role', { sourceText: 'An argument.', role: 'judgment' }],
  ])('rejects %s as a validation failure', async (_label, body) => {
    const { repositories, deps } = setup();

    const result = await submitDocument(deps, body);

    expect(result).toMatchObject({ ok: false, error: { code: 'validation_failed' } });
    expect(repositories.documents.documents.size).toBe(0);
  });

  it('marks the run failed when the job cannot be queued', async () => {
    const { repositories, queue, deps } = setup();
    queue.failWith = new Error('connection refused');

    const result = await submitDocument(deps, { sourceText: 'An argument.' });

    expect(result).toEqual({
      ok: false,
      error: { code: 'internal', message: ENQUEUE_FAILURE_MESSAGE },
    });
    const [run] = [...repositories.runs.runs.values()];
    expect(run).toMatchObject({ status: 'failed', error: ENQUEUE_FAILURE_MESSAGE });
    expect(run?.finished_at).toBeInstanceOf(Date);
  });
});

describe('document reads', () => {
  it('lists documents with their latest run status', async () => {
    const { deps } = setup();
    await submitDocument(deps, { sourceText: 'An argument.' });

    expect(await listDocuments(deps)).toMatchObject([{ latest_run_status: 'queued' }]);
  });

  it("returns a document's detail with its latest run", async () => {
    const { deps } = setup();
    const submitted = await submitDocument(deps, { sourceText: 'An argument.' });
    if (!submitted.ok) throw new Error(submitted.error.message);

    const detail = await getDocumentDetail(deps, submitted.value.documentId);

    if (!detail.ok) throw new Error(detail.error.message);
    expect(detail.value.document.id).toBe(submitted.value.documentId);
    expect(detail.value.spans).toEqual([]);
    expect(detail.value.latestRun?.id).toBe(submitted.value.runId);
  });

  it.each([
    ['a malformed id', 'not-a-uuid'],
    ['an unknown id', '00000000-0000-4000-8000-000000000000'],
  ])('reports %s as not found', async (_label, id) => {
    const { deps } = setup();
    expect(await getDocumentDetail(deps, id)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(await getDocumentArgument(deps, id)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('reports a document with no completed analysis as having no argument', async () => {
    const { deps } = setup();
    const submitted = await submitDocument(deps, { sourceText: 'An argument.' });
    if (!submitted.ok) throw new Error(submitted.error.message);

    const result = await getDocumentArgument(deps, submitted.value.documentId);

    expect(result).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it("returns the document's latest revision", async () => {
    const { repositories, deps } = setup();
    const submitted = await submitDocument(deps, { sourceText: 'An argument.' });
    if (!submitted.ok) throw new Error(submitted.error.message);
    const documentId: DocumentId = submitted.value.documentId;
    const revisionId = await repositories.revisions.saveAnalysisResult({
      documentId,
      runId: submitted.value.runId,
      spans: [],
      draft: {
        claims: [],
        occurrences: [],
        inferences: [],
        premises: [],
        relations: [],
        findings: [],
      },
      findings: [],
    });

    const result = await getDocumentArgument(deps, documentId);

    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.revision_id).toBe(revisionId);
  });
});
