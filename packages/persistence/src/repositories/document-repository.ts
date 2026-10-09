import { desc, eq, sql } from 'drizzle-orm';
import {
  newId,
  type Document,
  type DocumentId,
  type DocumentRepository,
  type DocumentSummary,
  type NewDocument,
} from '@make-your-case/domain';
import type { Db } from '../db.ts';
import { analysisRuns, documents } from '../schema/tables.ts';
import { documentToDomain } from '../mappers/entities.ts';

export class DrizzleDocumentRepository implements DocumentRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async create(input: NewDocument): Promise<Document> {
    const [row] = await this.db
      .insert(documents)
      .values({
        id: newId<DocumentId>(),
        sourceText: input.source_text,
        title: input.title,
        role: input.role,
      })
      .returning();

    if (row === undefined) throw new Error('insert returned no document row');
    return documentToDomain(row);
  }

  async getById(id: DocumentId): Promise<Document | null> {
    const [row] = await this.db.select().from(documents).where(eq(documents.id, id)).limit(1);
    return row === undefined ? null : documentToDomain(row);
  }

  async list(): Promise<DocumentSummary[]> {
    // The status of each document's most recent run, by a lateral subquery so
    // one document with many runs still yields one row.
    const latestStatus = sql<string | null>`(
      select r.status from ${analysisRuns} r
      where r.document_id = ${documents.id}
      order by r.started_at desc nulls last, r.id desc
      limit 1
    )`;

    const rows = await this.db
      .select({
        id: documents.id,
        title: documents.title,
        role: documents.role,
        createdAt: documents.createdAt,
        latestRunStatus: latestStatus,
      })
      .from(documents)
      .orderBy(desc(documents.createdAt));

    return rows.map((row) => ({
      id: row.id as DocumentId,
      title: row.title,
      role: row.role,
      created_at: row.createdAt,
      latest_run_status: row.latestRunStatus as DocumentSummary['latest_run_status'],
    }));
  }
}
