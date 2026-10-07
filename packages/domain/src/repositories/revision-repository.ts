import type { DocumentId, RevisionId } from '../ids.ts';
import type { ArgumentGraph } from '../graph/argument-graph.ts';

export interface RevisionRepository {
  /** Writes a whole revision — claims, occurrences, inferences, premises, relations, findings — in one transaction. */
  saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId>;
  getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null>;
  getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null>;
}
