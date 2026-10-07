import type { DocumentId, RevisionId, RunId, SpanId } from '../ids.ts';
import type { Document, DocumentSummary, NewDocument } from '../entities/document.ts';
import type { Span } from '../entities/span.ts';
import type {
  AnalysisRun,
  NewAnalysisRun,
  NewRunEvent,
  RunEvent,
  RunStatusUpdate,
} from '../entities/run.ts';
import type { ArgumentGraph } from '../graph/argument-graph.ts';

/**
 * Repository interfaces (AGENTS.md section 5.2).
 *
 * These speak only in domain types — no Drizzle, no row shapes. Implementations
 * live in `@make-your-case/persistence` and are injected at the composition
 * roots (`apps/worker`, `apps/web` server code). In-memory implementations for
 * tests are in `@make-your-case/domain/testing`.
 */

export interface DocumentRepository {
  create(input: NewDocument): Promise<Document>;
  getById(id: DocumentId): Promise<Document | null>;
  list(): Promise<DocumentSummary[]>;
}

export interface SpanRepository {
  saveAll(documentId: DocumentId, spans: Span[]): Promise<void>;
  listByDocument(documentId: DocumentId): Promise<Span[]>;
}

export interface RevisionRepository {
  /** Writes a whole revision — claims, occurrences, inferences, premises, relations, findings — in one transaction. */
  saveArgumentGraph(graph: ArgumentGraph): Promise<RevisionId>;
  getArgumentGraph(revisionId: RevisionId): Promise<ArgumentGraph | null>;
  getLatestForDocument(documentId: DocumentId): Promise<ArgumentGraph | null>;
}

export interface AnalysisRunRepository {
  create(input: NewAnalysisRun): Promise<AnalysisRun>;
  updateStatus(id: RunId, update: RunStatusUpdate): Promise<void>;
  getById(id: RunId): Promise<AnalysisRun | null>;
  appendEvent(event: NewRunEvent): Promise<RunEvent>;
  listEventsSince(runId: RunId, afterSequence: number): Promise<RunEvent[]>;
}

/** Every repository a composition root must provide. */
export interface Repositories {
  readonly documents: DocumentRepository;
  readonly spans: SpanRepository;
  readonly revisions: RevisionRepository;
  readonly runs: AnalysisRunRepository;
}

export type { SpanId };
