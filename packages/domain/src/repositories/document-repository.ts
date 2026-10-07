import type { DocumentId } from '../ids.ts';
import type { Document, DocumentSummary, NewDocument } from '../entities/document.ts';

export interface DocumentRepository {
  create(input: NewDocument): Promise<Document>;
  getById(id: DocumentId): Promise<Document | null>;
  list(): Promise<DocumentSummary[]>;
}
