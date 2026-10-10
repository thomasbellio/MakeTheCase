import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DrizzleAnalysisRunRepository } from '../src/repositories/analysis-run-repository.ts';
import { DrizzleDocumentRepository } from '../src/repositories/document-repository.ts';
import { setupTestDb, type TestDb } from './helpers/db.ts';

let harness: TestDb | undefined;

beforeAll(async () => {
  harness = await setupTestDb();
});
function db(): TestDb {
  if (harness === undefined) throw new Error('the test database was not set up');
  return harness;
}
beforeEach(async () => {
  await db().truncate();
});
afterAll(async () => {
  await harness?.close();
});

describe("a document's latest run", () => {
  it('is null for a document with no run', async () => {
    const documents = new DrizzleDocumentRepository(db().db);
    const runs = new DrizzleAnalysisRunRepository(db().db);
    const document = await documents.create({ source_text: 'text', title: null, role: 'other' });

    expect(await runs.getLatestForDocument(document.id)).toBeNull();
    expect((await documents.list())[0]?.latest_run_status).toBeNull();
  });

  it('is the most recently requested run, even while it is still queued', async () => {
    const documents = new DrizzleDocumentRepository(db().db);
    const runs = new DrizzleAnalysisRunRepository(db().db);
    const document = await documents.create({ source_text: 'text', title: null, role: 'other' });

    const first = await runs.create({ document_id: document.id, status: 'queued' });
    await runs.updateStatus(first.id, {
      status: 'completed',
      started_at: new Date(),
      finished_at: new Date(),
    });
    const rerun = await runs.create({ document_id: document.id, status: 'queued' });

    // The rerun has no `started_at`; ordering by it would pick the older run.
    expect((await runs.getLatestForDocument(document.id))?.id).toBe(rerun.id);
    expect((await documents.list())[0]?.latest_run_status).toBe('queued');
  });

  it("ignores other documents' runs", async () => {
    const documents = new DrizzleDocumentRepository(db().db);
    const runs = new DrizzleAnalysisRunRepository(db().db);
    const a = await documents.create({ source_text: 'a', title: null, role: 'other' });
    const b = await documents.create({ source_text: 'b', title: null, role: 'other' });
    const runA = await runs.create({ document_id: a.id, status: 'queued' });
    await runs.create({ document_id: b.id, status: 'queued' });

    expect((await runs.getLatestForDocument(a.id))?.id).toBe(runA.id);
  });
});
