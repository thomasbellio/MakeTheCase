import { asc, eq } from 'drizzle-orm';
import type { DocumentId, Span, SpanRepository } from '@make-your-case/domain';
import type { Db } from '../db.ts';
import { spans } from '../schema/tables.ts';
import { spanToDomain, spanToRow } from '../mappers/entities.ts';

export class DrizzleSpanRepository implements SpanRepository {
  constructor(private readonly db: Db) {}

  async saveAll(documentId: DocumentId, toSave: Span[]): Promise<void> {
    if (toSave.length === 0) return;

    // Segmentation is deterministic and a document's text is immutable, so
    // re-running it must replace the previous spans rather than accumulate.
    await this.db.transaction(async (tx) => {
      await tx.delete(spans).where(eq(spans.documentId, documentId));
      await tx.insert(spans).values(toSave.map(spanToRow));
    });
  }

  async listByDocument(documentId: DocumentId): Promise<Span[]> {
    const rows = await this.db
      .select()
      .from(spans)
      .where(eq(spans.documentId, documentId))
      .orderBy(asc(spans.ordinal));
    return rows.map(spanToDomain);
  }
}
