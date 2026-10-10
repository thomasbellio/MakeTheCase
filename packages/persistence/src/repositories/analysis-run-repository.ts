import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import {
  newId,
  type AnalysisRun,
  type AnalysisRunRepository,
  type DocumentId,
  type NewAnalysisRun,
  type NewRunEvent,
  type RunEvent,
  type RunEventId,
  type RunId,
  type RunStatusUpdate,
} from '@make-your-case/domain';
import type { Db } from '../db.ts';
import { analysisRuns, runEvents } from '../schema/tables.ts';
import { runEventToDomain, runToDomain } from '../mappers/entities.ts';

export class DrizzleAnalysisRunRepository implements AnalysisRunRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(input: NewAnalysisRun): Promise<AnalysisRun> {
    const [row] = await this.db
      .insert(analysisRuns)
      .values({ id: newId<RunId>(), documentId: input.document_id, status: input.status })
      .returning();

    if (row === undefined) throw new Error('insert returned no analysis_run row');
    return runToDomain(row);
  }

  async updateStatus(id: RunId, update: RunStatusUpdate): Promise<void> {
    // Only keys actually present are written, so an explicit `null` clears a
    // field while an absent key leaves it alone.
    const patch: Partial<typeof analysisRuns.$inferInsert> = {};
    if (update.status !== undefined) patch.status = update.status;
    if (update.current_stage !== undefined) patch.currentStage = update.current_stage;
    if (update.summary !== undefined) patch.summary = update.summary;
    if (update.model_config !== undefined) patch.modelConfig = update.model_config;
    if (update.error !== undefined) patch.error = update.error;
    if (update.revision_id !== undefined) patch.revisionId = update.revision_id;
    if (update.started_at !== undefined) patch.startedAt = update.started_at;
    if (update.finished_at !== undefined) patch.finishedAt = update.finished_at;

    if (Object.keys(patch).length === 0) return;
    await this.db.update(analysisRuns).set(patch).where(eq(analysisRuns.id, id));
  }

  async getById(id: RunId): Promise<AnalysisRun | null> {
    const [row] = await this.db.select().from(analysisRuns).where(eq(analysisRuns.id, id)).limit(1);
    return row === undefined ? null : runToDomain(row);
  }

  async getLatestForDocument(documentId: DocumentId): Promise<AnalysisRun | null> {
    // By request time, not `started_at`: a rerun still queued is the latest.
    const [row] = await this.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.documentId, documentId))
      .orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id))
      .limit(1);
    return row === undefined ? null : runToDomain(row);
  }

  async appendEvent(event: NewRunEvent): Promise<RunEvent> {
    // `sequence` is assigned in the database so concurrent writers cannot
    // produce a gap or a duplicate; the unique index on (run_id, sequence)
    // backs it up.
    const nextSequence = sql<number>`(
      select coalesce(max(e.sequence) + 1, 0) from ${runEvents} e where e.run_id = ${event.run_id}
    )`;

    const [row] = await this.db
      .insert(runEvents)
      .values({
        id: newId<RunEventId>(),
        runId: event.run_id,
        sequence: nextSequence,
        stage: event.stage,
        type: event.type,
        payload: event.payload,
      })
      .returning();

    if (row === undefined) throw new Error('insert returned no run_event row');
    return runEventToDomain(row);
  }

  async listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.sequence, afterSequence)))
      .orderBy(asc(runEvents.sequence));
    return rows.map(runEventToDomain);
  }
}
