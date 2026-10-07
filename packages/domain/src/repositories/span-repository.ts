import type { DocumentId } from '../ids.ts';
import type { Span } from '../entities/span.ts';

export interface SpanRepository {
  saveAll(documentId: DocumentId, spans: Span[]): Promise<void>;
  listByDocument(documentId: DocumentId): Promise<Span[]>;
}
